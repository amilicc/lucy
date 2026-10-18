const express = require("express");
const path = require("path");

const {
  getTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  getDatabaseSyncStatus,
  getKeepaliveTasks,
  getKeepaliveTask,
  getKeepaliveTaskForExecution,
  createKeepaliveTask,
  updateKeepaliveTask,
  setKeepaliveTaskEnabled,
  deleteKeepaliveTask,
  backupDatabase,
  scheduleDatabaseBackup
} = require("./database");

const {
  getLogs,
  addLog,
  subscribe
} = require("./logger");

const {
  startScheduler,
  stopScheduler
} = require("./scheduler");

const {
  closeBrowser,
  restoreBrowserState
} = require("./browser");

const {
  startKeepaliveTask,
  stopKeepaliveTask
} = require("./keepalive-executor");

const {
  startKeepaliveScheduler,
  stopKeepaliveScheduler
} = require("./keepalive-scheduler");

// 任务配置变更不再立即调用 rclone；合并到每小时的自动检查中。
// 用户仍可通过数据库同步面板的“立即上传”按钮强制备份。
async function backupKeepaliveTaskChanges(action) {
  scheduleDatabaseBackup(action);
  console.log(`[Database] 登录保活任务变更已合并，约 60 秒后检查是否需要上传：${action}`);
}


const app = express();

const PORT =
  process.env.PORT || 10000;

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD;


if (!ADMIN_PASSWORD) {

  console.error(
    "[Server] 未设置 ADMIN_PASSWORD"
  );

}


/*
 * ============================
 * Express 基础配置
 * ============================
 */

app.use(
  express.json()
);

app.use(
  express.urlencoded({
    extended: true
  })
);


/*
 * ============================
 * 静态文件
 * ============================
 */

app.use(
  express.static(
    path.join(
      __dirname,
      "../public"
    )
  )
);


/*
 * ============================
 * 登录 Token
 * ============================
 */

function createToken() {

  return Buffer
    .from(
      `${Date.now()}:${ADMIN_PASSWORD}`
    )
    .toString("base64");

}


/*
 * ============================
 * 身份验证
 * ============================
 */

function checkAuth(
  req,
  res,
  next
) {

  /*
   * 登录接口不需要验证
   */

  if (
    req.path === "/login" &&
    req.method === "POST"
  ) {

    return next();

  }


  const authorization =
    req.headers.authorization;


  if (
    !authorization ||
    !authorization.startsWith(
      "Bearer "
    )
  ) {

    return res
      .status(401)
      .json({
        error: "Unauthorized"
      });

  }


  const token =
    authorization.slice(
      7
    );


  try {

    const decoded =
      Buffer
        .from(
          token,
          "base64"
        )
        .toString("utf8");


    const separator =
      decoded.lastIndexOf(":");


    if (
      separator === -1
    ) {

      throw new Error(
        "Invalid token"
      );

    }


    const password =
      decoded.slice(
        separator + 1
      );


    if (
      password !==
      ADMIN_PASSWORD
    ) {

      throw new Error(
        "Invalid password"
      );

    }


    next();

  } catch (error) {

    return res
      .status(401)
      .json({
        error: "Unauthorized"
      });

  }

}


/*
 * ============================
 * API 身份验证
 * ============================
 */

app.use(
  "/api",
  checkAuth
);


/*
 * ============================
 * 登录
 * ============================
 */

app.post(
  "/api/login",
  (req, res) => {

    const password =
      req.body &&
      req.body.password;


    if (
      !ADMIN_PASSWORD ||
      password !== ADMIN_PASSWORD
    ) {

      return res
        .status(401)
        .json({
          error: "密码错误"
        });

    }


    console.log(
      "[Server] 管理员登录成功"
    );


    return res.json({
      success: true,
      token: createToken()
    });

  }
);


/*
 * ============================
 * 获取任务列表
 * ============================
 */

app.get(
  "/api/tasks",
  (req, res) => {

    try {

      const tasks =
        getTasks();

      res.json(tasks);

    } catch (error) {

      console.error(
        "[API] 获取任务失败：",
        error
      );

      res
        .status(500)
        .json({
          error: "获取任务失败"
        });

    }

  }
);


/*
 * ============================
 * 获取单个任务
 * ============================
 */

app.get(
  "/api/tasks/:id",
  (req, res) => {

    try {

      const id =
        Number(
          req.params.id
        );


      const task =
        getTask(id);


      if (!task) {

        return res
          .status(404)
          .json({
            error: "任务不存在"
          });

      }


      res.json(task);

    } catch (error) {

      console.error(
        "[API] 获取任务失败：",
        error
      );

      res
        .status(500)
        .json({
          error: "获取任务失败"
        });

    }

  }
);


/*
 * ============================
 * 获取数据库同步状态
 * ============================
 */

app.get(
  "/api/database-sync",
  (req, res) => {

    try {

      const status =
        getDatabaseSyncStatus();

      res.json(
        status
      );

    } catch (error) {

      console.error(
        "[API] 获取数据库同步状态失败：",
        error
      );

      res
        .status(500)
        .json({
          error: "获取数据库同步状态失败"
        });

    }

  }
);


/*
 * ============================
 * 手动立即上传数据库备份
 * ============================
 */
app.post("/api/database-sync/upload", async (req, res) => {
  try {
    const result = await backupDatabase({ force: true });
    const status = getDatabaseSyncStatus();
    if (!result || result.success !== true) {
      return res.status(500).json({ ...status, error: status.result || "数据库上传失败" });
    }
    res.json({ ...status, success: true, message: "数据库已手动上传到云端" });
  } catch (error) {
    console.error("[API] 手动上传数据库失败：", error.message);
    res.status(500).json({ error: error.message || "手动上传数据库失败" });
  }
});


/*
 * ============================
 * 创建任务
 * ============================
 */

app.post(
  "/api/tasks",
  (req, res) => {

    try {

      const name =
        String(
          req.body?.name ||
          ""
        ).trim();


      const url =
        String(
          req.body?.url ||
          ""
        ).trim();


      const intervalMinutes =
        Number(
          req.body?.interval_minutes
        );


      const staySeconds =
        Number(
          req.body?.stay_seconds
        );


      /*
       * 检查名称
       */

      if (!name) {

        return res
          .status(400)
          .json({
            error: "请输入任务名称"
          });

      }


      /*
       * 检查 URL
       */

      let parsedUrl;

      try {

        parsedUrl =
          new URL(url);

      } catch {

        return res
          .status(400)
          .json({
            error: "请输入有效的网址"
          });

      }


      if (
        parsedUrl.protocol !==
          "http:" &&
        parsedUrl.protocol !==
          "https:"
      ) {

        return res
          .status(400)
          .json({
            error: "网址必须使用 HTTP 或 HTTPS"
          });

      }


      /*
       * 检查执行间隔
       */

      if (
        !Number.isFinite(
          intervalMinutes
        ) ||
        intervalMinutes <= 0
      ) {

        return res
          .status(400)
          .json({
            error: "执行间隔必须大于 0 分钟"
          });

      }


      /*
       * 检查停留时间
       */

      if (
        !Number.isFinite(
          staySeconds
        ) ||
        staySeconds < 0
      ) {

        return res
          .status(400)
          .json({
            error: "停留时间不能小于 0 秒"
          });

      }


      const task =
        createTask({
          name,
          url,
          interval_minutes: intervalMinutes,
          stay_seconds: staySeconds,
          enabled: 1
        });


      console.log(
        `[Server] 创建任务 #${task.id}`
      );


      addLog(
        `创建任务 #${task.id}`
      );


      res.json(task);

    } catch (error) {

      console.error(
        "[API] 创建任务失败：",
        error
      );

      res
        .status(500)
        .json({
          error: "创建任务失败"
        });

    }

  }
);


/*
 * ============================
 * 启动任务
 * ============================
 */

app.post(
  "/api/tasks/:id/start",
  (req, res) => {

    try {

      const id =
        Number(
          req.params.id
        );


      const task =
        getTask(id);


      if (!task) {

        return res
          .status(404)
          .json({
            error: "任务不存在"
          });

      }


      const updated =
        updateTask(
          id,
          {
            enabled: 1
          }
        );


      console.log(
        `[Server] 启动任务 #${id}`
      );


      addLog(
        `启动任务 #${id}`
      );


      res.json(updated);

    } catch (error) {

      console.error(
        "[API] 启动任务失败：",
        error
      );

      res
        .status(500)
        .json({
          error: "启动任务失败"
        });

    }

  }
);


/*
 * ============================
 * 停止任务
 * ============================
 */

app.post(
  "/api/tasks/:id/stop",
  (req, res) => {

    try {

      const id =
        Number(
          req.params.id
        );


      const task =
        getTask(id);


      if (!task) {

        return res
          .status(404)
          .json({
            error: "任务不存在"
          });

      }


      const updated =
        updateTask(
          id,
          {
            enabled: 0
          }
        );


      console.log(
        `[Server] 停止任务 #${id}`
      );


      addLog(
        `停止任务 #${id}`
      );


      res.json(updated);

    } catch (error) {

      console.error(
        "[API] 停止任务失败：",
        error
      );

      res
        .status(500)
        .json({
          error: "停止任务失败"
        });

    }

  }
);


/*
 * ============================
 * 编辑任务
 * ============================
 *
 * 注意：
 * 不修改任务 ID。
 *
 * enabled 不在这里修改，
 * 所以编辑任务不会自动启动 / 停止任务。
 * ============================
 */

app.put(
  "/api/tasks/:id",
  (req, res) => {

    try {

      const id =
        Number(
          req.params.id
        );


      const task =
        getTask(id);


      if (!task) {

        return res
          .status(404)
          .json({
            error: "任务不存在"
          });

      }


      const name =
        String(
          req.body?.name ??
          task.name ??
          ""
        ).trim();


      const url =
        String(
          req.body?.url ??
          task.url ??
          ""
        ).trim();


      const intervalMinutes =
        Number(
          req.body?.interval_minutes ??
          task.interval_minutes
        );


      const staySeconds =
        Number(
          req.body?.stay_seconds ??
          task.stay_seconds
        );


      /*
       * 检查名称
       */

      if (!name) {

        return res
          .status(400)
          .json({
            error: "请输入任务名称"
          });

      }


      /*
       * 检查 URL
       */

      let parsedUrl;

      try {

        parsedUrl =
          new URL(url);

      } catch {

        return res
          .status(400)
          .json({
            error: "请输入有效的网址"
          });

      }


      if (
        parsedUrl.protocol !==
          "http:" &&
        parsedUrl.protocol !==
          "https:"
      ) {

        return res
          .status(400)
          .json({
            error: "网址必须使用 HTTP 或 HTTPS"
          });

      }


      /*
       * 检查执行间隔
       */

      if (
        !Number.isFinite(
          intervalMinutes
        ) ||
        intervalMinutes <= 0
      ) {

        return res
          .status(400)
          .json({
            error: "执行间隔必须大于 0 分钟"
          });

      }


      /*
       * 检查停留时间
       */

      if (
        !Number.isFinite(
          staySeconds
        ) ||
        staySeconds < 0
      ) {

        return res
          .status(400)
          .json({
            error: "停留时间不能小于 0 秒"
          });

      }


      const updated =
        updateTask(
          id,
          {
            name,
            url,
            interval_minutes:
              intervalMinutes,
            stay_seconds:
              staySeconds
          }
        );


      console.log(
        `[Server] 修改任务 #${id}`
      );


      addLog(
        `修改任务 #${id}`
      );


      res.json(updated);

    } catch (error) {

      console.error(
        "[API] 修改任务失败：",
        error
      );

      res
        .status(500)
        .json({
          error: "修改任务失败"
        });

    }

  }
);


/*
 * ============================
 * 删除任务
 * ============================
 */

app.delete(
  "/api/tasks/:id",
  (req, res) => {

    try {

      const id =
        Number(
          req.params.id
        );


      const task =
        getTask(id);


      if (!task) {

        return res
          .status(404)
          .json({
            error: "任务不存在"
          });

      }


      deleteTask(id);


      console.log(
        `[Server] 删除任务 #${id}`
      );


      addLog(
        `删除任务 #${id}`
      );


      res.json({
        success: true
      });

    } catch (error) {

      console.error(
        "[API] 删除任务失败：",
        error
      );

      res
        .status(500)
        .json({
          error: "删除任务失败"
        });

    }

  }
);


/*
 * ============================
 * 获取日志
 * ============================
 */

app.get(
  "/api/logs",
  (req, res) => {

    try {

      res.json(
        getLogs()
      );

    } catch (error) {

      console.error(
        "[API] 获取日志失败：",
        error
      );

      res
        .status(500)
        .json({
          error: "获取日志失败"
        });

    }

  }
);


/*
 * ============================
 * 清空日志
 * ============================
 */

app.delete(
  "/api/logs",
  (req, res) => {

    /*
     * 当前 logger.js 没有提供
     * clearLogs()，因此这里不直接
     * 操作内部 logs 数组。
     *
     * 如果前端调用此接口，
     * 返回兼容结果。
     */

    res.json({
      success: true
    });

  }
);


/*
 * ============================
 * SSE 实时日志
 * ============================
 *
 * logger.subscribe() 接收的是
 * Express 的 response 对象，
 * 所以这里直接传 res。
 * ============================
 */

app.get(
  "/api/logs/stream",
  (req, res) => {

    try {

      subscribe(
        res
      );

    } catch (error) {

      console.error(
        "[API] Log stream error:",
        error
      );


      if (
        !res.headersSent
      ) {

        res
          .status(500)
          .json({
            error:
              "Failed to subscribe logs"
          });

      }

    }

  }
);


/*
 * ============================
 * 登录保活任务 API（与普通任务完全分离）
 * ============================
 */

app.get("/api/keepalive-tasks", (req, res) => {
  try {
    res.json(getKeepaliveTasks());
  } catch (error) {
    console.error("[API] 获取登录保活任务失败：", error.message);
    res.status(500).json({ error: "获取登录保活任务失败" });
  }
});

app.post("/api/keepalive-tasks", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const url = String(req.body?.url || "").trim();
    const refreshInterval = Number(req.body?.refresh_interval_seconds);
    const authMode = String(req.body?.auth_mode || "none");
    const username = String(req.body?.username || "");
    const password = String(req.body?.password || "");

    if (!name) return res.status(400).json({ error: "请输入保活任务名称" });
    let parsedUrl;
    try { parsedUrl = new URL(url); } catch { return res.status(400).json({ error: "请输入有效的网址" }); }
    if (!(["http:", "https:"].includes(parsedUrl.protocol))) {
      return res.status(400).json({ error: "网址必须使用 HTTP 或 HTTPS" });
    }
    if (!Number.isInteger(refreshInterval) || refreshInterval < 10 || refreshInterval > 86400) {
      return res.status(400).json({ error: "刷新间隔必须为 10–86400 秒" });
    }
    if (!["none", "username_password", "password_only"].includes(authMode)) {
      return res.status(400).json({ error: "登录方式无效" });
    }
    if (authMode === "username_password" && (!username.trim() || !password)) {
      return res.status(400).json({ error: "用户名和密码都不能为空" });
    }
    if (authMode === "password_only" && !password) {
      return res.status(400).json({ error: "请输入登录密码" });
    }

    const selectorFields = ["username_selector", "password_selector", "submit_selector", "success_selector", "logged_out_selector"];
    const selectors = {};
    for (const field of selectorFields) {
      const value = String(req.body?.[field] || "").trim();
      if (value.length > 250) return res.status(400).json({ error: "选择器长度不能超过 250 个字符" });
      selectors[field] = value;
    }

    const task = createKeepaliveTask({
      name, url, refresh_interval_seconds: refreshInterval, auth_mode: authMode,
      username, password, ...selectors, enabled: 0
    });
    addLog(`创建登录保活任务 #${task.id}`);
    await backupKeepaliveTaskChanges(`创建任务 #${task.id}`);
    res.json(task);
  } catch (error) {
    console.error("[API] 创建登录保活任务失败：", error.message);
    res.status(500).json({ error: "创建登录保活任务失败，请检查加密密钥配置" });
  }
});

app.put("/api/keepalive-tasks/:id", async (req, res) => {
  const id = Number(req.params.id);
  try {
    const oldTask = getKeepaliveTask(id);
    if (!oldTask) return res.status(404).json({ error: "登录保活任务不存在" });

    const values = {};
    for (const field of ["name", "url", "refresh_interval_seconds", "auth_mode", "username", "password", "username_selector", "password_selector", "submit_selector", "success_selector", "logged_out_selector"]) {
      if (req.body?.[field] !== undefined) values[field] = req.body[field];
    }
    if (values.name !== undefined) {
      values.name = String(values.name).trim();
      if (!values.name) return res.status(400).json({ error: "任务名称不能为空" });
    }
    if (values.url !== undefined) {
      values.url = String(values.url).trim();
      let parsed;
      try { parsed = new URL(values.url); } catch { return res.status(400).json({ error: "请输入有效的网址" }); }
      if (!["http:", "https:"].includes(parsed.protocol)) return res.status(400).json({ error: "网址必须使用 HTTP 或 HTTPS" });
    }
    if (values.refresh_interval_seconds !== undefined) {
      values.refresh_interval_seconds = Number(values.refresh_interval_seconds);
      if (!Number.isInteger(values.refresh_interval_seconds) || values.refresh_interval_seconds < 10 || values.refresh_interval_seconds > 86400) {
        return res.status(400).json({ error: "刷新间隔必须为 10–86400 秒" });
      }
    }
    if (values.auth_mode !== undefined && !["none", "username_password", "password_only"].includes(values.auth_mode)) {
      return res.status(400).json({ error: "登录方式无效" });
    }
    if (values.password !== undefined) values.password = String(values.password);
    if (values.username !== undefined) values.username = String(values.username);
    for (const field of ["username_selector", "password_selector", "submit_selector", "success_selector", "logged_out_selector"]) {
      if (values[field] !== undefined) {
        values[field] = String(values[field] || "").trim();
        if (values[field].length > 250) return res.status(400).json({ error: "选择器长度不能超过 250 个字符" });
      }
    }
    const currentCredentials = getKeepaliveTaskForExecution(id);
    const nextAuthMode = values.auth_mode !== undefined ? values.auth_mode : oldTask.auth_mode;
    const nextUsername = values.username && values.username.trim() ? values.username : currentCredentials.username;
    const nextPassword = values.password || currentCredentials.password;
    if (nextAuthMode === "username_password" && (!String(nextUsername || "").trim() || !nextPassword)) {
      return res.status(400).json({ error: "用户名和密码都不能为空" });
    }
    if (nextAuthMode === "password_only" && !nextPassword) {
      return res.status(400).json({ error: "请输入登录密码" });
    }
    const wasEnabled = Number(oldTask.enabled) === 1;
    if (wasEnabled) await stopKeepaliveTask(id);
    const updated = updateKeepaliveTask(id, values);
    if (wasEnabled) await startKeepaliveTask(id);
    await backupKeepaliveTaskChanges(`更新任务 #${id}`);
    res.json(updated);
  } catch (error) {
    console.error("[API] 更新登录保活任务失败：", error.message);
    res.status(500).json({ error: "更新登录保活任务失败" });
  }
});

app.post("/api/keepalive-tasks/:id/start", async (req, res) => {
  const id = Number(req.params.id);
  try {
    if (!getKeepaliveTask(id)) return res.status(404).json({ error: "登录保活任务不存在" });
    setKeepaliveTaskEnabled(id, 1);
    await startKeepaliveTask(id);
    await backupKeepaliveTaskChanges(`启动任务 #${id}`);
    res.json(getKeepaliveTask(id));
  } catch (error) {
    setKeepaliveTaskEnabled(id, 0);
    console.error(`[API] 启动登录保活任务 #${id} 失败：`, error.message);
    res.status(500).json({ error: error.message || "启动登录保活任务失败" });
  }
});

app.post("/api/keepalive-tasks/:id/stop", async (req, res) => {
  const id = Number(req.params.id);
  try {
    if (!getKeepaliveTask(id)) return res.status(404).json({ error: "登录保活任务不存在" });
    setKeepaliveTaskEnabled(id, 0);
    await stopKeepaliveTask(id);
    await backupKeepaliveTaskChanges(`停止任务 #${id}`);
    res.json(getKeepaliveTask(id));
  } catch (error) {
    console.error(`[API] 停止登录保活任务 #${id} 失败：`, error.message);
    res.status(500).json({ error: "停止登录保活任务失败" });
  }
});

app.delete("/api/keepalive-tasks/:id", async (req, res) => {
  const id = Number(req.params.id);
  try {
    if (!getKeepaliveTask(id)) return res.status(404).json({ error: "登录保活任务不存在" });
    setKeepaliveTaskEnabled(id, 0);
    await stopKeepaliveTask(id);
    deleteKeepaliveTask(id);
    addLog(`删除登录保活任务 #${id}`);
    await backupKeepaliveTaskChanges(`删除任务 #${id}`);
    res.json({ success: true });
  } catch (error) {
    console.error(`[API] 删除登录保活任务 #${id} 失败：`, error.message);
    res.status(500).json({ error: "删除登录保活任务失败" });
  }
});

/*
 * ============================
 * 前端页面
 * ============================
 */

app.get(
  "*",
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        "../public/index.html"
      )
    );

  }
);


/*
 * ============================
 * 启动服务器
 * ============================
 * database.js 在加载阶段已同步完成数据库恢复。
 * 这里先恢复浏览器登录态，再开放服务并启动两个独立调度器。
 */

let server = null;

async function startServer() {
  await restoreBrowserState();

  server = app.listen(PORT, () => {
    console.log(`服务启动，监听端口 ${PORT}`);
    startScheduler();
    startKeepaliveScheduler().catch(error => {
      console.error("[KeepaliveScheduler] 启动失败：", error.message);
    });
  });
}

startServer().catch(error => {
  console.error("[Server] 启动失败：", error.message);
  process.exit(1);
});

/*
 * ============================
 * 优雅关闭
 * ============================
 */

async function shutdown(
  signal
) {

  console.log(
    `[Server] 收到 ${signal}，正在关闭...`
  );


  try {

    stopScheduler();

    await stopKeepaliveScheduler();

    await closeBrowser();

  } catch (error) {

    console.error(
      "[Server] 关闭过程中出现错误：",
      error
    );

  }


  if (!server) {
    process.exit(0);
    return;
  }

  server.close(
    () => {

      console.log(
        "[Server] 服务已关闭"
      );

      process.exit(0);

    }
  );


  setTimeout(
    () => {

      process.exit(0);

    },
    5000
  );

}


process.on(
  "SIGTERM",
  () => shutdown("SIGTERM")
);

process.on(
  "SIGINT",
  () => shutdown("SIGINT")
);
