const { chromium } = require("playwright");
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { encryptText, decryptText } = require("./keepalive-crypto");

const { addLog } = require("./logger");

let browser = null;
let context = null;
let browserStartupPromise = null;
let browserStateBackupRunning = false;

const dataDir = process.env.DATA_DIR || "/tmp/remain-data";
const browserStateEncryptedPath = path.join(dataDir, "browser-state.enc");
const legacyPlainBrowserStatePath = path.join(dataDir, "browser-state.json");
let restoredBrowserState = null;
const browserStateRestoreDir = path.join(dataDir, "browser-state-restore");
const rcloneConfigPath = path.join(dataDir, "rclone.conf");
const remoteFolder = (process.env.REMOTE_FOLDER || "").replace(/\/+$/, "");
const configuredRemoteBrowserFolder = (process.env.KEEPALIVE_REMOTE_FOLDER || "").replace(/\/+$/, "");
// 浏览器登录态必须使用独立路径，避免与 app-backup.sqlite 的远程目录混用。
const remoteBrowserFolder = configuredRemoteBrowserFolder && configuredRemoteBrowserFolder !== remoteFolder
  ? configuredRemoteBrowserFolder
  : `${remoteFolder}-browser-state`;
const rcloneConf = process.env.RCLONE_CONF || "";

let xvfb = null;
let fluxbox = null;

let display = ":99";


/*
 * ============================
 * 启动 Xvfb
 * ============================
 */

async function startXvfb() {

  console.log(
    `[Browser] 正在启动 Xvfb：${display}`
  );

  xvfb = spawn(
    "Xvfb",
    [
      display,
      "-screen",
      "0",
      "1920x1080x24",
      "-ac",
      "-nolisten",
      "tcp"
    ],
    {
      detached: false,
      stdio: [
        "ignore",
        "ignore",
        "pipe"
      ]
    }
  );

  if (xvfb.stderr) {

    xvfb.stderr.on(
      "data",
      chunk => {

        console.error(
          "[Xvfb]",
          chunk.toString().trim()
        );

      }
    );

  }

  await new Promise(
    (resolve, reject) => {

      let finished = false;

      const timer =
        setTimeout(
          () => {

            if (finished) {
              return;
            }

            finished = true;

            resolve();

          },
          1000
        );

      xvfb.once(
        "error",
        error => {

          if (finished) {
            return;
          }

          finished = true;

          clearTimeout(timer);

          reject(error);

        }
      );

      xvfb.once(
        "exit",
        code => {

          if (finished) {
            return;
          }

          if (
            code !== null &&
            code !== 0
          ) {

            finished = true;

            clearTimeout(timer);

            reject(
              new Error(
                `Xvfb 启动失败，退出码 ${code}`
              )
            );

          }

        }
      );

    }
  );

  process.env.DISPLAY = display;

  console.log(
    `[Browser] Xvfb 启动完成：${display}`
  );

}


/*
 * ============================
 * 启动 Fluxbox
 * ============================
 */

async function startFluxbox() {

  try {

    fluxbox = spawn(
      "fluxbox",
      [],
      {
        detached: false,
        stdio: "ignore"
      }
    );

    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          500
        )
    );

    console.log(
      "[Browser] Fluxbox 启动完成"
    );

  } catch (error) {

    console.log(
      "[Browser] Fluxbox 启动失败，继续运行"
    );

  }

}


/*
 * ============================
 * 启动浏览器
 * ============================
 */

async function ensureBrowser() {
  if (browser && context) return;
  if (browserStartupPromise) return browserStartupPromise;

  browserStartupPromise = (async () => {
    await startXvfb();
    await startFluxbox();

    const userDataDir =
      process.env.PLAYWRIGHT_USER_DATA_DIR || "/tmp/remain-playwright";

    fs.mkdirSync(userDataDir, { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });

    console.log(`[Browser] 当前 DISPLAY：${process.env.DISPLAY}`);
    console.log("[Browser] 启动 Chromium");

    const launchOptions = {
      headless: false,
      viewport: { width: 1920, height: 1080 },
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-software-rasterizer",
        "--disable-blink-features=AutomationControlled"
      ]
    };

    // 使用内存中的解密快照初始化会话，不在磁盘保留明文 Cookie。
    if (restoredBrowserState) {
      launchOptions.storageState = restoredBrowserState;
      console.log("[Browser] 将加载已恢复的浏览器登录态");
    }

    context = await chromium.launchPersistentContext(userDataDir, launchOptions);
    restoredBrowserState = null;
    browser = context;
    console.log("[Browser] Chromium 启动成功");
  })();

  try {
    await browserStartupPromise;
  } catch (error) {
    if (xvfb) { try { xvfb.kill(); } catch {} xvfb = null; }
    if (fluxbox) { try { fluxbox.kill(); } catch {} fluxbox = null; }
    throw error;
  } finally {
    browserStartupPromise = null;
  }
}

function prepareBrowserRcloneConfig() {
  if (!rcloneConf.trim()) return false;
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(rcloneConfigPath, rcloneConf, { encoding: "utf8", mode: 0o600 });
  return true;
}

function validateStorageState(state) {
  return Boolean(
    state &&
    typeof state === "object" &&
    Array.isArray(state.cookies) &&
    Array.isArray(state.origins)
  );
}

/*
 * 在服务监听和任何任务调度器启动前调用。
 * 数据库模块在 server.js 加载时已经同步完成数据库恢复，因此此处自然排在数据库恢复之后。
 */
async function restoreBrowserState() {
  if (!remoteBrowserFolder || !remoteFolder || !rcloneConf.trim()) {
    console.log("[BrowserState] 未配置 rclone 远程目录或 RCLONE_CONF，跳过云端登录态恢复");
    return false;
  }

  try {
    prepareBrowserRcloneConfig();
    fs.rmSync(browserStateRestoreDir, { recursive: true, force: true });
    fs.mkdirSync(browserStateRestoreDir, { recursive: true });

    try {
      execFileSync("rclone", [
        "--config", rcloneConfigPath,
        "copy", remoteBrowserFolder, browserStateRestoreDir
      ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000 });
    } catch (error) {
      // 第一次启动时云端目录尚不存在属于正常情况；继续检查本地加密副本。
      console.log("[BrowserState] 云端登录态备份暂不可用，将检查本地加密备份");
    }

    const cloudPath = path.join(browserStateRestoreDir, "browser-state.enc");
    const candidates = [];
    if (fs.existsSync(cloudPath)) {
      candidates.push({ source: "云端", path: cloudPath });
    }
    if (fs.existsSync(browserStateEncryptedPath)) {
      candidates.push({ source: "本地", path: browserStateEncryptedPath });
    }

    for (const candidate of candidates) {
      try {
        const encrypted = fs.readFileSync(candidate.path, "utf8");
        const state = JSON.parse(decryptText(encrypted));
        if (!validateStorageState(state)) throw new Error("登录态备份内容无效");

        // 只有云端快照解密且校验成功后才更新本地副本，避免损坏文件覆盖可用备份。
        if (candidate.source === "云端") {
          fs.copyFileSync(candidate.path, browserStateEncryptedPath);
          try { fs.chmodSync(browserStateEncryptedPath, 0o600); } catch {}
        }
        restoredBrowserState = state;
        console.log(`[BrowserState] 已从${candidate.source}恢复浏览器登录态到内存，等待 Chromium 启动`);
        return true;
      } catch (error) {
        console.error(`[BrowserState] ${candidate.source}登录态备份不可用：${String(error.message || "校验失败").slice(0, 180)}`);
      }
    }

    console.log("[BrowserState] 未找到可用登录态备份，按首次启动处理");
    restoredBrowserState = null;
    return false;
  } catch (error) {
    restoredBrowserState = null;
    console.error(`[BrowserState] 登录态恢复未完成：${String(error.message || "未知错误").slice(0, 240)}`);
    return false;
  } finally {
    fs.rmSync(browserStateRestoreDir, { recursive: true, force: true });
    // 清理旧版本可能遗留的明文登录态文件。
    try { fs.rmSync(legacyPlainBrowserStatePath, { force: true }); } catch {}
  }
}

async function backupBrowserState() {
  if (browserStateBackupRunning) {
    console.log("[BrowserState] 上一次登录态备份尚未结束，跳过本次");
    return false;
  }
  if (!remoteFolder || !remoteBrowserFolder || !rcloneConf.trim()) {
    console.error("[BrowserState] 未配置 REMOTE_FOLDER / RCLONE_CONF，无法云端备份登录态");
    return false;
  }

  browserStateBackupRunning = true;
  try {
    await ensureBrowser();
    prepareBrowserRcloneConfig();
    fs.mkdirSync(dataDir, { recursive: true });

    // Playwright 生成一致的 Cookie / Local Storage / IndexedDB 快照，避免复制活动中的 Chromium profile。
    const state = await context.storageState({ indexedDB: true });
    if (!validateStorageState(state)) throw new Error("浏览器未生成有效登录态快照");

    const encrypted = encryptText(JSON.stringify(state));
    fs.writeFileSync(browserStateEncryptedPath, encrypted, { encoding: "utf8", mode: 0o600 });

    execFileSync("rclone", [
      "--config", rcloneConfigPath,
      "copy", browserStateEncryptedPath, remoteBrowserFolder
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000 });

    console.log("[BrowserState] 登录态已加密备份到云端");
    return true;
  } catch (error) {
    const reason = String(error.message || "未知错误").split("\nCall log:")[0].slice(0, 240);
    console.error(`[BrowserState] 登录态云端备份失败：${reason}`);
    return false;
  } finally {
    browserStateBackupRunning = false;
  }
}

async function createPage() {
  await ensureBrowser();
  return context.newPage();
}


/*
 * ============================
 * 清理错误信息
 *
 * 注意：
 * 网页日志绝对不能暴露
 * URL、密码、Token 等敏感信息。
 * ============================
 */

function sanitizeErrorMessage(error) {

  let message = "";

  if (
    error &&
    typeof error.message === "string"
  ) {

    message = error.message;

  } else if (
    typeof error === "string"
  ) {

    message = error;

  } else {

    message = "未知错误";

  }


  /*
   * 隐藏 URL
   */

  message =
    message.replace(
      /https?:\/\/[^\s"'<>]+/gi,
      "[目标地址]"
    );


  /*
   * 隐藏常见密码 / Token 参数
   */

  message =
    message.replace(
      /([?&](?:password|passwd|pwd|token|access_token|refresh_token|api_key|apikey|secret|authorization|auth)=)[^&\s"'<>]*/gi,
      "$1[已隐藏]"
    );


  /*
   * 隐藏 password=xxx
   */

  message =
    message.replace(
      /\b(password|passwd|pwd|token|access_token|refresh_token|api_key|apikey|secret|authorization|auth)\s*=\s*[^\s&"'<>]+/gi,
      "$1=[已隐藏]"
    );


  /*
   * 隐藏 Bearer Token
   */

  message =
    message.replace(
      /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
      "Bearer [已隐藏]"
    );


  /*
   * Playwright Call log
   *
   * Call log 里面可能再次出现完整 URL，
   * 所以直接截断。
   */

  const callLogIndex =
    message.indexOf(
      "\nCall log:"
    );

  if (
    callLogIndex !== -1
  ) {

    message =
      message.slice(
        0,
        callLogIndex
      );

  }


  /*
   * 防止错误信息过长
   */

  if (
    message.length > 500
  ) {

    message =
      message.slice(
        0,
        500
      ) +
      "...";

  }

  return (
    message.trim() ||
    "未知错误"
  );

}


/*
 * ============================
 * 访问网页
 * ============================
 */

async function visit(
  url,
  staySeconds = 10
) {

  /*
   * 确保浏览器已经启动
   */

  await ensureBrowser();


  /*
   * 网页日志：
   * 只显示安全的执行步骤。
   *
   * 绝对不把 url 写入 addLog()
   */

  addLog(
    "打开浏览器"
  );


  let page = null;

  try {

    page =
      await context.newPage();


    /*
     * Render 后台日志
     *
     * 不输出 URL
     */

    console.log(
      "[Browser] 开始执行网页访问"
    );


    /*
     * 网页日志
     */

    addLog(
      "正在访问目标网站"
    );


    /*
     * 实际访问
     *
     * URL 只传给 Playwright，
     * 不写入日志。
     */

    await page.goto(
      url,
      {
        waitUntil:
          "domcontentloaded",

        timeout:
          60000
      }
    );


    /*
     * Render 后台日志
     */

    console.log(
      "[Browser] 页面加载完成"
    );


    /*
     * 网页日志
     */

    addLog(
      "页面加载完成"
    );


    /*
     * 停留时间
     */

    addLog(
      `停留 ${staySeconds} 秒`
    );


    if (
      staySeconds > 0
    ) {

      await page.waitForTimeout(
        staySeconds * 1000
      );

    }


    /*
     * Render 后台日志
     */

    console.log(
      "[Browser] 停留完成"
    );


    return {
      success: true
    };

  } catch (error) {

    /*
     * 只保留安全的错误信息
     */

    const reason =
      sanitizeErrorMessage(
        error
      );


    /*
     * 网页日志
     *
     * 不包含 URL
     */

    addLog(
      `访问失败：${reason}`,
      "error"
    );


    /*
     * Render 后台日志
     *
     * 同样不输出 URL。
     */

    console.error(
      `[Browser] 访问失败：${reason}`
    );


    return {
      success: false,
      error: reason
    };

  } finally {

    /*
     * 每次任务完成后关闭当前页面
     */

    if (page) {

      try {

        await page.close();

      } catch (error) {

        console.error(
          "[Browser] 页面关闭失败"
        );

      }

    }

  }

}


/*
 * ============================
 * 关闭浏览器
 * ============================
 */

async function closeBrowser() {

  console.log(
    "[Browser] 正在关闭浏览器..."
  );


  /*
   * 关闭 Chromium
   */

  if (context) {

    try {

      await context.close();

    } catch (error) {

      console.error(
        "[Browser] 关闭 Chromium 失败"
      );

    }

    context = null;

    browser = null;

  }


  /*
   * 关闭 Fluxbox
   */

  if (fluxbox) {

    try {

      fluxbox.kill();

    } catch {}

    fluxbox = null;

  }


  /*
   * 关闭 Xvfb
   */

  if (xvfb) {

    try {

      xvfb.kill();

    } catch {}

    xvfb = null;

  }


  console.log(
    "[Browser] 浏览器已关闭"
  );

}


/*
 * ============================
 * 导出
 * ============================
 */

module.exports = {
  visit,
  closeBrowser,
  ensureBrowser,
  createPage,
  restoreBrowserState,
  backupBrowserState
};
