const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { encryptText, decryptText } = require("./keepalive-crypto");

const dataDir = process.env.DATA_DIR || "/tmp/remain-data";
const dbPath = path.join(dataDir, "app.db");

const backupPath = path.join(dataDir, "app-backup.sqlite");
const restoreDir = path.join(dataDir, "restore");
const rcloneConfigPath = path.join(dataDir, "rclone.conf");

const remoteFolder = (process.env.REMOTE_FOLDER || "").replace(/\/+$/, "");
const rcloneConf = process.env.RCLONE_CONF || "";

const BACKUP_INTERVAL = 60 * 60 * 1000;

let db = null;
let backupRunning = false;
let lastUploadedHash = null;
let pendingBackupTimer = null;
const CHANGE_BACKUP_DEBOUNCE = 60 * 1000;


/* =========================================================
   数据库同步状态
   ========================================================= */

let lastSyncAt = null;
let lastSyncResult = null;

let nextSyncAt =
  Date.now() + BACKUP_INTERVAL;


/* =========================================================
   基础目录
   ========================================================= */

fs.mkdirSync(dataDir, { recursive: true });


/* =========================================================
   rclone 配置
   RCLONE_CONF 是完整配置内容
   ========================================================= */

function prepareRcloneConfig() {
  if (!rcloneConf.trim()) {
    return false;
  }

  fs.writeFileSync(
    rcloneConfigPath,
    rcloneConf,
    {
      encoding: "utf8",
      mode: 0o600
    }
  );

  return true;
}


/* =========================================================
   删除文件 / 目录
   ========================================================= */

function removeFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, {
        recursive: true,
        force: true
      });
    }
  } catch (error) {
    console.error(
      `[Database] 删除文件失败：${filePath}`,
      error.message
    );
  }
}


/* =========================================================
   从云端恢复数据库
   ========================================================= */

function restoreDatabase() {
  console.log("[Database] 正在从云端恢复数据库...");

  if (!remoteFolder) {
    console.log("[Database] 未配置 REMOTE_FOLDER");
    return false;
  }

  if (!rcloneConf.trim()) {
    console.log("[Database] 未配置 RCLONE_CONF");
    return false;
  }

  try {
    prepareRcloneConfig();

    // 清理上一次可能残留的恢复目录
    removeFile(restoreDir);

    fs.mkdirSync(restoreDir, {
      recursive: true
    });

    /*
     * 标准 rclone copy：
     *
     * 云端：
     * huggingface:like/
     *
     * ↓
     *
     * 本地：
     * /tmp/remain-data/restore/
     *
     * 最终得到：
     * /tmp/remain-data/restore/app-backup.sqlite
     */
    execFileSync(
      "rclone",
      [
        "--config",
        rcloneConfigPath,
        "copy",
        remoteFolder,
        restoreDir
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    const restoredBackupPath = path.join(
      restoreDir,
      "app-backup.sqlite"
    );

    if (!fs.existsSync(restoredBackupPath)) {
      console.log("[Database] 云端没有可用数据库备份");
      removeFile(restoreDir);
      return false;
    }

    /*
     * 先删除当前数据库。
     * 正常情况下启动时这里还不存在。
     */
    removeFile(dbPath);

    // 将恢复出来的数据库变成正式 app.db
    fs.renameSync(
      restoredBackupPath,
      dbPath
    );

    removeFile(restoreDir);

    console.log("[Database] 云端数据库恢复完成");

    return true;

  } catch (error) {
    console.error(
      "[Database] 云端数据库恢复失败，创建新数据库"
    );

    if (error.stderr) {
      console.error(
        `[Database] rclone：${error.stderr.toString().trim()}`
      );
    } else if (error.message) {
      console.error(
        `[Database] ${error.message}`
      );
    }

    removeFile(restoreDir);

    return false;
  }
}


/* =========================================================
   初始化数据库
   ========================================================= */

function initializeDatabase() {
  console.log(`[Database] ${dbPath}`);

  /*
   * 非常重要：
   * 必须先恢复，再打开 SQLite。
   * 避免 Render 启动时出现 db 尚未初始化的问题。
   */
  restoreDatabase();

  db = new Database(dbPath);

  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      stay_seconds INTEGER NOT NULL DEFAULT 40,
      interval_minutes INTEGER NOT NULL DEFAULT 60,
      enabled INTEGER NOT NULL DEFAULT 1,
      visit_count INTEGER NOT NULL DEFAULT 0,
      last_visit TEXT,
      last_status TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 登录保活使用独立表，不改动原有普通任务表。
  db.exec(`
    CREATE TABLE IF NOT EXISTS keepalive_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      refresh_interval_seconds INTEGER NOT NULL DEFAULT 60,
      auth_mode TEXT NOT NULL DEFAULT 'none',
      username_enc TEXT,
      password_enc TEXT,
      username_selector TEXT,
      password_selector TEXT,
      submit_selector TEXT,
      success_selector TEXT,
      logged_out_selector TEXT,
      enabled INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'stopped',
      last_refresh TEXT,
      last_status TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  /*
   * 兼容旧数据库：
   * 如果之前的数据库缺少某些字段，就补上。
   */

  const columns = db
    .prepare("PRAGMA table_info(tasks)")
    .all()
    .map(row => row.name);

  // 登录保活表升级：为旧数据库增加可配置的“登录失效标记”选择器。
  const keepaliveColumns = db
    .prepare("PRAGMA table_info(keepalive_tasks)")
    .all()
    .map(row => row.name);
  if (!keepaliveColumns.includes("logged_out_selector")) {
    db.exec("ALTER TABLE keepalive_tasks ADD COLUMN logged_out_selector TEXT");
  }

  if (!columns.includes("stay_seconds")) {
    db.exec(`
      ALTER TABLE tasks
      ADD COLUMN stay_seconds INTEGER NOT NULL DEFAULT 40
    `);
  }

  if (!columns.includes("interval_minutes")) {
    db.exec(`
      ALTER TABLE tasks
      ADD COLUMN interval_minutes INTEGER NOT NULL DEFAULT 60
    `);
  }

  if (!columns.includes("enabled")) {
    db.exec(`
      ALTER TABLE tasks
      ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1
    `);
  }

  if (!columns.includes("visit_count")) {
    db.exec(`
      ALTER TABLE tasks
      ADD COLUMN visit_count INTEGER NOT NULL DEFAULT 0
    `);
  }

  if (!columns.includes("last_visit")) {
    db.exec(`
      ALTER TABLE tasks
      ADD COLUMN last_visit TEXT
    `);
  }

  if (!columns.includes("last_status")) {
    db.exec(`
      ALTER TABLE tasks
      ADD COLUMN last_status TEXT
    `);
  }

  if (!columns.includes("created_at")) {
    db.exec(`
      ALTER TABLE tasks
      ADD COLUMN created_at TEXT
    `);
  }

  console.log("[Database] SQLite 初始化完成");

  return db;
}


/* =========================================================
   数据库备份 / 同步
   ========================================================= */

async function backupDatabase(options = {}) {
  const forceUpload = options.force === true;
  // 若备份正在进行，等待它结束后再执行本次备份，避免任务刚变更却被跳过。
  while (backupRunning) {
    console.log("[Database] 上一次备份还未完成，等待后再备份最新数据");
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  if (!db) {
    console.log("[Database] 数据库尚未初始化，跳过备份");

    lastSyncAt = new Date().toISOString();
    lastSyncResult = "error: 数据库尚未初始化";

    return;
  }

  if (!remoteFolder) {
    console.log("[Database] 未配置 REMOTE_FOLDER，跳过备份");

    lastSyncAt = new Date().toISOString();
    lastSyncResult = "error: 未配置 REMOTE_FOLDER";

    return;
  }

  if (!rcloneConf.trim()) {
    console.log("[Database] 未配置 RCLONE_CONF，跳过备份");

    lastSyncAt = new Date().toISOString();
    lastSyncResult = "error: 未配置 RCLONE_CONF";

    return;
  }

  backupRunning = true;

  try {
    console.log("[Database] 开始数据库备份");

    prepareRcloneConfig();

    /*
     * 使用 SQLite 官方 backup API 创建临时备份。
     *
     * 本地：
     * /tmp/remain-data/app-backup.sqlite
     */
    removeFile(backupPath);

    await db.backup(backupPath);

    if (!fs.existsSync(backupPath)) {
      throw new Error("数据库备份文件未生成");
    }

    console.log("[Database] 本地备份文件生成完成");

    // 用备份文件内容判断数据库是否真的发生变化；没有变化时跳过 rclone。
    const currentHash = crypto
      .createHash("sha256")
      .update(fs.readFileSync(backupPath))
      .digest("hex");

    if (!forceUpload && lastUploadedHash && currentHash === lastUploadedHash) {
      lastSyncResult = "skipped: 数据未变化，已跳过上传";
      console.log("[Database] 数据库内容未变化，跳过 rclone 上传");
      return { success: true, skipped: true, reason: "unchanged" };
    }

    /*
     * 标准 rclone copy：
     *
     * /tmp/remain-data/app-backup.sqlite
     *              ↓
     * huggingface:like/
     *
     * 云端最终：
     * huggingface:like/app-backup.sqlite
     */
    execFileSync(
      "rclone",
      [
        "--config",
        rcloneConfigPath,
        "copy",
        backupPath,
        remoteFolder
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    console.log("[Database] 数据库已上传到云端");

    /*
     * 记录本次同步成功。
     */
    lastSyncAt = new Date().toISOString();
    lastSyncResult = "success";
    lastUploadedHash = currentHash;
    return { success: true, skipped: false };

  } catch (error) {
    console.error(
      "[Database] 数据库备份失败：",
      error.message
    );

    let reason =
      error.message ||
      "未知错误";

    if (error.stderr) {
      const stderr =
        error.stderr
          .toString()
          .trim();

      if (stderr) {
        reason = stderr;
      }
    }

    /*
     * 记录本次同步失败。
     */
    lastSyncAt = new Date().toISOString();
    lastSyncResult =
      `error: ${reason}`;

    if (error.stderr) {
      console.error(
        `[Database] rclone：${error.stderr.toString().trim()}`
      );
    }

  } finally {
    /*
     * 无论成功还是失败，
     * 都删除临时数据库备份文件。
     */
    removeFile(backupPath);

    backupRunning = false;

    console.log("[Database] 本地临时备份已清理");
  }
}


/* =========================================================
   合并短时间内的任务变更，延迟 60 秒上传一次
   ========================================================= */
function scheduleDatabaseBackup(reason = "数据库内容变更") {
  if (pendingBackupTimer) clearTimeout(pendingBackupTimer);
  pendingBackupTimer = setTimeout(async () => {
    pendingBackupTimer = null;
    try {
      console.log(`[Database] 延迟合并备份开始：${reason}`);
      await backupDatabase({ force: false });
    } catch (error) {
      console.error(`[Database] 延迟合并备份失败：${error.message}`);
    }
  }, CHANGE_BACKUP_DEBOUNCE);
  if (typeof pendingBackupTimer.unref === "function") pendingBackupTimer.unref();
}


/* =========================================================
   获取数据库同步状态
   ========================================================= */

function getDatabaseSyncStatus() {
  return {
    interval_minutes: 60,

    last_sync:
      lastSyncAt,

    next_sync:
      new Date(
        nextSyncAt
      ).toISOString(),

    result:
      lastSyncResult
  };
}


/* =========================================================
   每 1 小时自动备份
   ========================================================= */

function startDatabaseBackupScheduler() {
  setInterval(() => {

    /*
     * 本次定时同步开始后，
     * 下一次同步时间继续顺延 1 小时。
     */
    nextSyncAt = Date.now() + BACKUP_INTERVAL;

    backupDatabase({ force: false }).catch(error => {

      console.error(
        "[Database] 自动备份异常：",
        error.message
      );

      lastSyncAt =
        new Date().toISOString();

      lastSyncResult =
        `error: ${error.message || "未知错误"}`;

    });

  }, BACKUP_INTERVAL);

  console.log("[Database] 数据库自动备份已启动：每 1 小时一次");
}


/* =========================================================
   初始化
   ========================================================= */

initializeDatabase();

startDatabaseBackupScheduler();


/* =========================================================
   Tasks API
   ========================================================= */

function getTasks() {
  return db
    .prepare(`
      SELECT
        id,
        name,
        url,
        stay_seconds,
        interval_minutes,
        enabled,
        visit_count,
        last_visit,
        last_status,
        created_at
      FROM tasks
      ORDER BY id ASC
    `)
    .all();
}


function getTask(id) {
  return db
    .prepare(`
      SELECT
        id,
        name,
        url,
        stay_seconds,
        interval_minutes,
        enabled,
        visit_count,
        last_visit,
        last_status,
        created_at
      FROM tasks
      WHERE id = ?
    `)
    .get(id);
}


function createTask({
  name,
  url,
  stay_seconds = 40,
  interval_minutes = 60,
  enabled = 1
}) {
  const result = db
    .prepare(`
      INSERT INTO tasks (
        name,
        url,
        stay_seconds,
        interval_minutes,
        enabled
      )
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(
      name,
      url,
      Number(stay_seconds),
      Number(interval_minutes),
      enabled ? 1 : 0
    );

  return getTask(result.lastInsertRowid);
}


function updateTask(
  id,
  {
    name,
    url,
    stay_seconds,
    interval_minutes,
    enabled
  }
) {
  const oldTask = getTask(id);

  if (!oldTask) {
    return null;
  }

  const newName =
    name !== undefined
      ? name
      : oldTask.name;

  const newUrl =
    url !== undefined
      ? url
      : oldTask.url;

  const newStaySeconds =
    stay_seconds !== undefined
      ? Number(stay_seconds)
      : oldTask.stay_seconds;

  const newIntervalMinutes =
    interval_minutes !== undefined
      ? Number(interval_minutes)
      : oldTask.interval_minutes;

  const newEnabled =
    enabled !== undefined
      ? (enabled ? 1 : 0)
      : oldTask.enabled;

  db
    .prepare(`
      UPDATE tasks
      SET
        name = ?,
        url = ?,
        stay_seconds = ?,
        interval_minutes = ?,
        enabled = ?
      WHERE id = ?
    `)
    .run(
      newName,
      newUrl,
      newStaySeconds,
      newIntervalMinutes,
      newEnabled,
      id
    );

  return getTask(id);
}


function deleteTask(id) {
  const result = db
    .prepare(`
      DELETE FROM tasks
      WHERE id = ?
    `)
    .run(id);

  return result.changes > 0;
}


function recordVisit(id, status = "success") {
  db
    .prepare(`
      UPDATE tasks
      SET
        visit_count = visit_count + 1,
        last_visit = ?,
        last_status = ?
      WHERE id = ?
    `)
    .run(
      new Date().toISOString(),
      status || "success",
      id
    );
}


/* =========================================================
   登录保活任务（独立于普通任务）
   ========================================================= */

function getKeepaliveTasks() {
  return db.prepare(`
    SELECT id, name, url, refresh_interval_seconds, auth_mode,
           username_selector, password_selector, submit_selector, success_selector, logged_out_selector,
           enabled, status, last_refresh, last_status, created_at
    FROM keepalive_tasks
    ORDER BY id ASC
  `).all();
}

function getKeepaliveTask(id) {
  return db.prepare(`
    SELECT id, name, url, refresh_interval_seconds, auth_mode,
           username_selector, password_selector, submit_selector, success_selector, logged_out_selector,
           enabled, status, last_refresh, last_status, created_at
    FROM keepalive_tasks WHERE id = ?
  `).get(id);
}

function getKeepaliveTaskForExecution(id) {
  const task = db.prepare(`
    SELECT * FROM keepalive_tasks WHERE id = ?
  `).get(id);
  if (!task) return null;
  return {
    ...task,
    username: decryptText(task.username_enc),
    password: decryptText(task.password_enc)
  };
}

function createKeepaliveTask({
  name, url, refresh_interval_seconds = 60, auth_mode = "none",
  username = "", password = "", username_selector = "",
  password_selector = "", submit_selector = "", success_selector = "",
  logged_out_selector = "", enabled = 0
}) {
  const result = db.prepare(`
    INSERT INTO keepalive_tasks (
      name, url, refresh_interval_seconds, auth_mode, username_enc, password_enc,
      username_selector, password_selector, submit_selector, success_selector, logged_out_selector, enabled, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name, url, Number(refresh_interval_seconds), auth_mode,
    encryptText(username), encryptText(password),
    username_selector || null, password_selector || null, submit_selector || null,
    success_selector || null, logged_out_selector || null, enabled ? 1 : 0, enabled ? "starting" : "stopped"
  );
  return getKeepaliveTask(result.lastInsertRowid);
}

function updateKeepaliveTask(id, values = {}) {
  const old = getKeepaliveTaskForExecution(id);
  if (!old) return null;
  const name = values.name !== undefined ? values.name : old.name;
  const url = values.url !== undefined ? values.url : old.url;
  const interval = values.refresh_interval_seconds !== undefined
    ? Number(values.refresh_interval_seconds) : old.refresh_interval_seconds;
  const authMode = values.auth_mode !== undefined ? values.auth_mode : old.auth_mode;
  const username = values.username !== undefined && String(values.username).trim() !== "" ? values.username : old.username;
  const password = values.password !== undefined && values.password !== "" ? values.password : old.password;
  const usernameSelector = values.username_selector !== undefined ? values.username_selector : old.username_selector;
  const passwordSelector = values.password_selector !== undefined ? values.password_selector : old.password_selector;
  const submitSelector = values.submit_selector !== undefined ? values.submit_selector : old.submit_selector;
  const successSelector = values.success_selector !== undefined ? values.success_selector : old.success_selector;
  const loggedOutSelector = values.logged_out_selector !== undefined ? values.logged_out_selector : old.logged_out_selector;

  db.prepare(`
    UPDATE keepalive_tasks SET name = ?, url = ?, refresh_interval_seconds = ?, auth_mode = ?,
      username_enc = ?, password_enc = ?, username_selector = ?, password_selector = ?,
      submit_selector = ?, success_selector = ?, logged_out_selector = ? WHERE id = ?
  `).run(
    name, url, interval, authMode, encryptText(username), encryptText(password),
    usernameSelector || null, passwordSelector || null, submitSelector || null,
    successSelector || null, loggedOutSelector || null, id
  );
  return getKeepaliveTask(id);
}

function setKeepaliveTaskEnabled(id, enabled) {
  db.prepare("UPDATE keepalive_tasks SET enabled = ? WHERE id = ?")
    .run(enabled ? 1 : 0, id);
  return getKeepaliveTask(id);
}

function updateKeepaliveTaskStatus(id, status, lastStatus, lastRefresh = null) {
  db.prepare(`
    UPDATE keepalive_tasks
    SET status = ?, last_status = ?,
        last_refresh = COALESCE(?, last_refresh)
    WHERE id = ?
  `).run(status, lastStatus || null, lastRefresh, id);
}

function deleteKeepaliveTask(id) {
  return db.prepare("DELETE FROM keepalive_tasks WHERE id = ?").run(id).changes > 0;
}


/* =========================================================
   导出
   ========================================================= */

module.exports = {
  db,
  getTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  recordVisit,
  getKeepaliveTasks,
  getKeepaliveTask,
  getKeepaliveTaskForExecution,
  createKeepaliveTask,
  updateKeepaliveTask,
  setKeepaliveTaskEnabled,
  updateKeepaliveTaskStatus,
  deleteKeepaliveTask,
  backupDatabase,
  scheduleDatabaseBackup,
  getDatabaseSyncStatus
};
