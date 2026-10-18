const {
  getKeepaliveTaskForExecution,
  updateKeepaliveTaskStatus
} = require("./database");
const { createPage, backupBrowserState } = require("./browser");
const { addLog } = require("./logger");

const activeTasks = new Map();
const startingTasks = new Map();

function safeMessage(value) {
  return String(value || "未知错误")
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[目标地址]")
    .replace(/\b(password|passwd|pwd|token|secret)\s*=\s*[^\s&"'<>]+/gi, "$1=[已隐藏]")
    .split("\nCall log:")[0]
    .slice(0, 240);
}

async function firstVisible(page, selector) {
  if (!selector) return null;
  try {
    const locator = page.locator(selector).first();
    if (await locator.count() && await locator.isVisible()) return locator;
  } catch {}
  return null;
}

async function findVisible(page, customSelector, defaults) {
  if (customSelector) return firstVisible(page, customSelector);
  for (const selector of defaults) {
    const locator = await firstVisible(page, selector);
    if (locator) return locator;
  }
  return null;
}

// Wait for client-side rendering/session restoration after navigation. A DOMContentLoaded
// event alone does not guarantee that SPA login markers have become visible.
async function waitForConfiguredAuthMarker(task, page, timeoutMs = 10000) {
  if (!task.success_selector && !task.logged_out_selector) return;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const loggedOutMarker = task.logged_out_selector
      ? await firstVisible(page, task.logged_out_selector)
      : null;
    const successMarker = task.success_selector
      ? await firstVisible(page, task.success_selector)
      : null;
    if (loggedOutMarker || successMarker) return;
    await page.waitForTimeout(250);
  }
}

async function loginIfRequired(task, page) {
  // Wait for either configured marker before deciding to submit credentials. This avoids
  // mistaking a temporarily hidden success marker during SPA initialization for logout.
  await waitForConfiguredAuthMarker(task, page);
  if (task.auth_mode === "none") {
    return { success: true, attempted: false, message: "页面已打开，保活运行中" };
  }

  // 优先使用每个网站单独配置的标记，避免每次刷新都重复提交密码。
  const loggedOutMarker = task.logged_out_selector
    ? await firstVisible(page, task.logged_out_selector)
    : null;
  const successMarker = task.success_selector
    ? await firstVisible(page, task.success_selector)
    : null;

  if (!loggedOutMarker && successMarker) {
    return { success: true, attempted: false, message: "检测到登录成功标记，当前登录有效" };
  }

  // 当同时配置了登录成功和登录失效标记时，必须命中其中一个才能决定下一步。
  // 如果两个标记都没有出现，即使页面上存在密码框，也不能据此认定已掉线并重复提交凭据。
  if (task.success_selector && task.logged_out_selector && !successMarker && !loggedOutMarker) {
    return {
      success: false,
      attempted: false,
      message: "未检测到登录成功或登录失效标记，已暂停自动提交密码；请检查选择器是否匹配当前页面"
    };
  }

  const passwordField = await findVisible(
    page,
    task.password_selector,
    ['input[type="password"]']
  );

  // 配置成功标记但未命中时，若也没有明确的登录表单/失效标记，不盲目提交密码。
  if (!loggedOutMarker && !passwordField) {
    if (task.success_selector) {
      return { success: false, attempted: false, message: "未检测到登录成功标记或登录表单，登录状态不明确；请检查成功/失效选择器" };
    }
    return {
      success: true,
      attempted: false,
      message: task.logged_out_selector
        ? "未检测到登录失效标记，按当前登录态继续保活"
        : "未发现登录表单，按已有登录态处理"
    };
  }

  if (!passwordField) {
    return { success: false, attempted: false, message: "检测到登录失效，但未找到可见的密码输入框；请检查密码选择器或登录页面" };
  }
  if (!task.password) {
    return { success: false, attempted: false, message: "缺少登录密码" };
  }

  if (task.auth_mode === "username_password") {
    const usernameField = await findVisible(
      page,
      task.username_selector,
      [
        'input[autocomplete="username"]',
        'input[type="email"]',
        'input[name*="user" i]',
        'input[name*="email" i]',
        'input[type="text"]'
      ]
    );
    if (!usernameField || !task.username) {
      return { success: false, attempted: false, message: "未找到用户名输入框或未填写用户名；可在高级选项中设置用户名选择器" };
    }
    await usernameField.fill(task.username);
  }

  await passwordField.fill(task.password);
  const submit = await findVisible(page, task.submit_selector, [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Sign in")',
    'button:has-text("Log in")',
    'button:has-text("Login")',
    'button:has-text("Continue")'
  ]);

  if (submit) await submit.click({ timeout: 10000 });
  else await passwordField.press("Enter");

  await page.waitForTimeout(2500);

  if (task.success_selector) {
    const success = await firstVisible(page, task.success_selector);
    if (!success) {
      return { success: false, attempted: true, message: "提交后未检测到登录成功标记；可能密码错误或需要额外验证" };
    }
  } else {
    const stillLoggedOut = task.logged_out_selector
      ? await firstVisible(page, task.logged_out_selector)
      : null;
    const stillHasPassword = await firstVisible(page, task.password_selector || 'input[type="password"]');
    if (stillLoggedOut || stillHasPassword) {
      return { success: false, attempted: true, message: "提交后登录表单或失效标记仍可见；请检查凭据、选择器或网站是否需要额外验证" };
    }
  }

  return { success: true, attempted: true, message: "登录成功" };
}

async function saveLoginState(record) {
  if (record.task.auth_mode === "none") return true;
  // 每次成功刷新都检查备份时机；实际上传频率由 browser.js 统一限制为每小时一次。
  // 因此刷新可以是 30 秒、60 秒等频率，但不会每次都执行 rclone 上传。
  record.stateBackupAttempted = true;
  record.stateSaved = await backupBrowserState();
  return record.stateSaved;
}

function scheduleRefresh(id, record) {
  if (record.stopRequested || record.needsAttention || activeTasks.get(id) !== record) return;
  record.timer = setTimeout(() => {
    refreshTask(id, record).catch(error => {
      if (!record.stopRequested) {
        const reason = safeMessage(error.message);
        updateKeepaliveTaskStatus(id, "error", `刷新失败：${reason}`, new Date().toISOString());
        addLog(`登录保活任务 #${id} 刷新失败：${reason}`, "error");
      }
      scheduleRefresh(id, record);
    });
  }, Math.max(10, Number(record.task.refresh_interval_seconds) || 60) * 1000);
  if (record.timer && typeof record.timer.unref === "function") record.timer.unref();
}

async function refreshTask(id, record) {
  if (record.stopRequested || activeTasks.get(id) !== record || record.refreshing) return;
  record.refreshing = true;
  try {
    if (record.page.isClosed()) throw new Error("保活页面已关闭");
    await record.page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    const auth = await loginIfRequired(record.task, record.page);
    const now = new Date().toISOString();

    if (!auth.success) {
      record.needsAttention = true;
      updateKeepaliveTaskStatus(id, "needs_attention", auth.message, now);
      addLog(`登录保活任务 #${id} 需要处理：${auth.message}`, "error");
    } else {
      record.needsAttention = false;
      if (auth.attempted) {
        record.stateSaved = false;
        record.stateBackupAttempted = false;
      }
      const backedUp = await saveLoginState(record);
      const message = !record.stateSaved && !backedUp
        ? `${auth.message}；云端登录态备份失败，请检查 rclone 配置`
        : auth.message;
      updateKeepaliveTaskStatus(id, "running", message, now);
      if (auth.attempted) {
        addLog(`登录保活任务 #${id} 已执行登录提交并完成本轮检查`);
      } else if (record.task.auth_mode !== "none" && auth.success) {
        addLog(`登录保活任务 #${id} 已检测到登录状态，跳过重复登录`);
      }
    }
  } catch (error) {
    if (!record.stopRequested) {
      const reason = safeMessage(error.message);
      updateKeepaliveTaskStatus(id, "error", `刷新失败：${reason}`, new Date().toISOString());
      addLog(`登录保活任务 #${id} 刷新失败：${reason}`, "error");
    }
  } finally {
    record.refreshing = false;
    scheduleRefresh(id, record);
  }
}

async function startKeepaliveTask(id) {
  const taskId = Number(id);
  if (activeTasks.has(taskId)) return activeTasks.get(taskId).task;
  if (startingTasks.has(taskId)) return startingTasks.get(taskId);

  const starting = (async () => {
    const task = getKeepaliveTaskForExecution(taskId);
    if (!task) throw new Error("登录保活任务不存在");

    updateKeepaliveTaskStatus(taskId, "starting", "正在打开保活页面");
    let page = null;
    let record = null;

    try {
      page = await createPage();
      record = {
        task,
        page,
        timer: null,
        refreshing: false,
        stopRequested: false,
        needsAttention: false,
        stateSaved: false,
        stateBackupAttempted: false
      };
      activeTasks.set(taskId, record);

      await page.goto(task.url, { waitUntil: "domcontentloaded", timeout: 60000 });
      if (record.stopRequested || activeTasks.get(taskId) !== record) {
        throw new Error("任务已停止");
      }

      const auth = await loginIfRequired(task, page);
      const now = new Date().toISOString();

      if (!auth.success) {
        record.needsAttention = true;
        updateKeepaliveTaskStatus(taskId, "needs_attention", auth.message, now);
        addLog(`登录保活任务 #${taskId} 需要处理：${auth.message}`, "error");
      } else {
        const backedUp = await saveLoginState(record);
        const message = task.auth_mode !== "none" && !backedUp
          ? `${auth.message}；云端登录态备份失败，请检查 rclone 配置`
          : auth.message;
        updateKeepaliveTaskStatus(taskId, "running", message, now);
        addLog(`登录保活任务 #${taskId} 已启动`);
      }

      scheduleRefresh(taskId, record);
      return task;
    } catch (error) {
      if (record) {
        activeTasks.delete(taskId);
        if (record.timer) clearTimeout(record.timer);
      }
      if (page) {
        try { await page.close(); } catch {}
      }
      const reason = safeMessage(error.message);
      if (!record || !record.stopRequested) {
        updateKeepaliveTaskStatus(taskId, "error", `启动失败：${reason}`, new Date().toISOString());
        addLog(`登录保活任务 #${taskId} 启动失败：${reason}`, "error");
      }
      throw new Error(reason);
    }
  })();

  startingTasks.set(taskId, starting);
  try {
    return await starting;
  } finally {
    startingTasks.delete(taskId);
  }
}

async function stopKeepaliveTask(id) {
  const taskId = Number(id);
  let record = activeTasks.get(taskId);
  if (!record) {
    const pending = startingTasks.get(taskId);
    if (pending) {
      try { await pending; } catch {}
      record = activeTasks.get(taskId);
    }
  }
  if (!record) {
    updateKeepaliveTaskStatus(taskId, "stopped", "已停止");
    return false;
  }

  record.stopRequested = true;
  if (record.timer) clearTimeout(record.timer);
  activeTasks.delete(taskId);
  try { await record.page.close(); } catch {}
  updateKeepaliveTaskStatus(taskId, "stopped", "已停止");
  addLog(`登录保活任务 #${taskId} 已停止`);
  return true;
}

async function stopAllKeepaliveTasks() {
  const pending = [...startingTasks.values()];
  if (pending.length) await Promise.all(pending.map(task => task.catch(() => null)));
  const ids = [...activeTasks.keys()];
  await Promise.all(ids.map(id => stopKeepaliveTask(id)));
}

module.exports = {
  startKeepaliveTask,
  stopKeepaliveTask,
  stopAllKeepaliveTasks
};
