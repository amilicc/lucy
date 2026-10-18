const TOKEN_KEY = "remain_token";

let token =
  localStorage.getItem(
    TOKEN_KEY
  );


let logStreamController =
  null;

let refreshTimer =
  null;


/*
 * ============================
 * 数据库同步
 * ============================
 */

let databaseSyncTimer =
  null;


/*
 * 当前数据库同步状态
 *
 * 接口：
 * GET /api/database-sync
 *
 * 字段：
 * interval_minutes
 * last_sync
 * next_sync
 * result
 * running
 */

let databaseSyncState = {
  interval_minutes: null,
  last_sync: null,
  next_sync: null,
  result: null,
  running: null
};


/*
 * ============================
 * DOM
 * ============================
 */

const loginPage =
  document.getElementById(
    "login-page"
  );

const appPage =
  document.getElementById(
    "app-page"
  );

const loginForm =
  document.getElementById(
    "login-form"
  );

const loginPassword =
  document.getElementById(
    "login-password"
  );

const loginError =
  document.getElementById(
    "login-error"
  );

const logoutButton =
  document.getElementById(
    "logout-button"
  );

const createTaskForm =
  document.getElementById(
    "create-task-form"
  );

const createTaskMessage =
  document.getElementById(
    "create-task-message"
  );

const tasksContainer =
  document.getElementById(
    "tasks-container"
  );

const tasksTitle =
  document.getElementById(
    "tasks-title"
  );

const refreshTasksButton =
  document.getElementById(
    "refresh-tasks-button"
  );

const logsContainer =
  document.getElementById(
    "logs-container"
  );

const clearLogsButton =
  document.getElementById(
    "clear-logs-button"
  );


/* 登录保活 */
const keepaliveForm = document.getElementById("keepalive-form");
const keepaliveName = document.getElementById("keepalive-name");
const keepaliveUrl = document.getElementById("keepalive-url");
const keepaliveInterval = document.getElementById("keepalive-interval");
const keepaliveAuthMode = document.getElementById("keepalive-auth-mode");
const keepaliveUsername = document.getElementById("keepalive-username");
const keepalivePassword = document.getElementById("keepalive-password");
const keepaliveUsernameGroup = document.getElementById("keepalive-username-group");
const keepalivePasswordGroup = document.getElementById("keepalive-password-group");
const keepaliveUsernameSelector = document.getElementById("keepalive-username-selector");
const keepalivePasswordSelector = document.getElementById("keepalive-password-selector");
const keepaliveSubmitSelector = document.getElementById("keepalive-submit-selector");
const keepaliveSuccessSelector = document.getElementById("keepalive-success-selector");
const keepaliveLoggedOutSelector = document.getElementById("keepalive-logged-out-selector");
const keepaliveFormMessage = document.getElementById("keepalive-form-message");
const keepaliveTasksContainer = document.getElementById("keepalive-tasks-container");
const refreshKeepaliveButton = document.getElementById("refresh-keepalive-button");
const keepaliveCancelEditButton = document.getElementById("keepalive-cancel-edit");
let editingKeepaliveId = null;


/*
 * 数据库同步
 */

const databaseSyncStatus =
  document.getElementById(
    "database-sync-status"
  );

const databaseSyncInterval =
  document.getElementById(
    "database-sync-interval"
  );

const databaseSyncLast =
  document.getElementById(
    "database-sync-last"
  );

const databaseSyncNext =
  document.getElementById(
    "database-sync-next"
  );

const databaseSyncResult =
  document.getElementById(
    "database-sync-result"
  );

const databaseSyncUploadButton = document.getElementById("database-sync-upload-button");


/*
 * 编辑任务
 */

const editTaskModal =
  document.getElementById(
    "edit-task-modal"
  );

const editModalBackdrop =
  document.getElementById(
    "edit-modal-backdrop"
  );

const closeEditTaskButton =
  document.getElementById(
    "close-edit-task-button"
  );

const editTaskForm =
  document.getElementById(
    "edit-task-form"
  );

const editTaskId =
  document.getElementById(
    "edit-task-id"
  );

const editTaskName =
  document.getElementById(
    "edit-task-name"
  );

const editTaskUrl =
  document.getElementById(
    "edit-task-url"
  );

const editTaskInterval =
  document.getElementById(
    "edit-task-interval"
  );

const editTaskStay =
  document.getElementById(
    "edit-task-stay"
  );

const editTaskMessage =
  document.getElementById(
    "edit-task-message"
  );

const cancelEditTaskButton =
  document.getElementById(
    "cancel-edit-task-button"
  );


/*
 * ============================
 * 通用 API 请求
 * ============================
 */

async function apiFetch(
  url,
  options = {}
) {

  const requestOptions = {
    ...options
  };


  const headers =
    new Headers(
      requestOptions.headers ||
      {}
    );


  /*
   * 所有 API 请求自动带 Token
   */

  if (token) {

    headers.set(
      "Authorization",
      `Bearer ${token}`
    );

  }


  /*
   * JSON 请求自动设置 Content-Type
   */

  if (
    requestOptions.body &&
    typeof requestOptions.body ===
      "string"
  ) {

    headers.set(
      "Content-Type",
      "application/json"
    );

  }


  requestOptions.headers =
    headers;


  const response =
    await fetch(
      url,
      requestOptions
    );


  /*
   * Token 失效
   */

  if (
    response.status === 401
  ) {

    logout();

    throw new Error(
      "登录已失效，请重新登录"
    );

  }


  return response;

}


/*
 * ============================
 * 显示页面
 * ============================
 */

function showLoginPage() {

  loginPage.classList.remove(
    "hidden"
  );

  appPage.classList.add(
    "hidden"
  );

}


function showAppPage() {

  loginPage.classList.add(
    "hidden"
  );

  appPage.classList.remove(
    "hidden"
  );

}



/*
 * ============================
 * 登录
 * ============================
 */

loginForm.noValidate = true;


loginForm.addEventListener(
  "submit",
  async event => {

    event.preventDefault();


    loginError.textContent =
      "";


    const password =
      loginPassword.value;


    /*
     * 空密码
     */

    if (!password) {

      loginError.textContent =
        "Please enter your password.";

      return;

    }


    try {

      const response =
        await fetch(
          "/api/login",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify({
                password
              })
          }
        );


      const data =
        await response.json();


      if (
        !response.ok
      ) {

        /*
         * 密码错误统一显示英文
         */

        throw new Error(
          "Incorrect password."
        );

      }


      token =
        data.token;


      localStorage.setItem(
        TOKEN_KEY,
        token
      );


      loginPassword.value =
        "";


      showAppPage();


      await loadTasks();

      await loadKeepaliveTasks();

      await loadLogs();

      await loadDatabaseSync();

      startLogStream();

      startAutoRefresh();

      startDatabaseSyncAutoRefresh();

    } catch (error) {

      loginError.textContent =
        error.message ||
        "Login failed.";

    }

  }
);




/*
 * ============================
 * 退出登录
 * ============================
 */

logoutButton.addEventListener(
  "click",
  () => {

    logout();

  }
);


function logout() {

  token = null;

  localStorage.removeItem(
    TOKEN_KEY
  );


  stopLogStream();

  stopAutoRefresh();

  stopDatabaseSyncAutoRefresh();

  closeEditModal();


  /*
   * 清除当前数据库同步状态
   */

  databaseSyncState = {
    interval_minutes: null,
    last_sync: null,
    next_sync: null,
    result: null,
    running: null
  };


  renderDatabaseSync();


  showLoginPage();


  loginPassword.value =
    "";

  loginError.textContent =
    "";

}


/*
 * ============================
 * 加载任务
 * ============================
 */

async function loadTasks() {

  try {

    const response =
      await apiFetch(
        "/api/tasks"
      );


    const tasks =
      await response.json();


    if (
      !response.ok
    ) {

      throw new Error(
        tasks.error ||
        "获取任务失败"
      );

    }


    renderTasks(
      tasks
    );

  } catch (error) {

    if (
      error.message
        .includes("登录已失效")
    ) {

      return;

    }


    console.error(
      "[App] 获取任务失败：",
      error
    );

  }

}


/*
 * ============================
 * 格式化时间
 * ============================
 */

function formatTime(
  value
) {

  if (!value) {

    return "暂无";

  }


  const date =
    new Date(value);


  if (
    Number.isNaN(
      date.getTime()
    )
  ) {

    return "暂无";

  }


  return date.toLocaleString();

}


/*
 * ============================
 * 格式化数据库同步时间
 *
 * 第一次还没有同步：
 * 显示「暂无」
 *
 * 日期和时间之间固定 6 个空格
 *
 * 例如：
 * 2026/10/3      11:56:49
 * ============================
 */

function formatDatabaseSyncTime(
  value
) {

  if (!value) {

    return "暂无";

  }


  const date =
    new Date(value);


  if (
    Number.isNaN(
      date.getTime()
    )
  ) {

    return "暂无";

  }


  const datePart =
    date.toLocaleDateString();


  const timePart =
    date.toLocaleTimeString();


  return `${datePart}      ${timePart}`;

}


/*
 * ============================
 * 数据库同步结果
 *
 * 这里只负责判断状态。
 *
 * success
 * error: 具体原因
 * 第一次没有同步：
 * 暂无
 * ============================
 */

function getDatabaseSyncResult(
  result
) {

  if (!result) {

    return "暂无";

  }


  const status =
    String(
      result
    );


  if (
    status === "success"
  ) {

    return "success";

  }


  if (
    status.startsWith(
      "error:"
    )
  ) {

    return status;

  }


  return status;

}


/*
 * ============================
 * 数据库同步运行状态
 * ============================
 */

function getDatabaseSyncStatus() {

  /*
   * 如果后端明确返回 running，
   * 直接使用后端状态。
   */

  if (
    databaseSyncState.running !==
      null &&
    databaseSyncState.running !==
      undefined
  ) {

    return Boolean(
      databaseSyncState.running
    );

  }


  /*
   * 当前后端如果没有 running 字段，
   * 只要同步间隔已经正常返回，
   * 就认为数据库同步服务正在运行。
   */

  return (
    databaseSyncState.interval_minutes !==
      null &&
    databaseSyncState.interval_minutes !==
      undefined
  );

}


/*
 * ============================
 * 渲染数据库同步状态
 * ============================
 */

function renderDatabaseSync() {

  if (
    !databaseSyncStatus ||
    !databaseSyncInterval ||
    !databaseSyncLast ||
    !databaseSyncNext ||
    !databaseSyncResult
  ) {

    return;

  }


  /*
   * 运行状态
   *
   * 与任务列表完全相同：
   *
   * status-on  -> 绿色「运行中」
   * status-off -> 灰色「已停止」
   */

  const isRunning =
    getDatabaseSyncStatus();


  databaseSyncStatus.classList.remove(
    "status-on",
    "status-off"
  );


  if (isRunning) {

    databaseSyncStatus.classList.add(
      "status-on"
    );

    databaseSyncStatus.textContent =
      "运行中";

  } else {

    databaseSyncStatus.classList.add(
      "status-off"
    );

    databaseSyncStatus.textContent =
      "已停止";

  }


  /*
   * 同步间隔
   */

  if (
    databaseSyncState.interval_minutes !==
      null &&
    databaseSyncState.interval_minutes !==
      undefined
  ) {

    databaseSyncInterval.textContent =
      `${databaseSyncState.interval_minutes} 分钟`;

  } else {

    databaseSyncInterval.textContent =
      "暂无";

  }


  /*
   * 上次同步
   */

  databaseSyncLast.textContent =
    formatDatabaseSyncTime(
      databaseSyncState.last_sync
    );


  /*
   * 下次同步
   */

  databaseSyncNext.textContent =
    formatDatabaseSyncTime(
      databaseSyncState.next_sync
    );


  /*
   * 同步结果
   */

  const result =
    getDatabaseSyncResult(
      databaseSyncState.result
    );


  databaseSyncResult.textContent =
    result;


  /*
   * 根据结果设置 CSS class
   *
   * success -> 绿色
   * error   -> 红色
   * 暂无    -> 灰色
   */

  databaseSyncResult.classList.remove(
    "database-sync-result-success",
    "database-sync-result-error",
    "database-sync-result-empty"
  );


  if (
    result === "success"
  ) {

    databaseSyncResult.classList.add(
      "database-sync-result-success"
    );

  } else if (
    result.startsWith(
      "error:"
    )
  ) {

    databaseSyncResult.classList.add(
      "database-sync-result-error"
    );

  } else if (
    result === "暂无" || result.startsWith("skipped:")
  ) {

    databaseSyncResult.classList.add(
      "database-sync-result-empty"
    );

  } else {

    databaseSyncResult.classList.add(
      "database-sync-result-error"
    );

  }

}


/*
 * ============================
 * 获取数据库同步状态
 * ============================
 */

async function loadDatabaseSync() {

  try {

    const response =
      await apiFetch(
        "/api/database-sync"
      );


    const data =
      await response.json();


    if (
      !response.ok
    ) {

      throw new Error(
        data.error ||
        "获取数据库同步状态失败"
      );

    }


    /*
     * 保存同步状态
     */

    databaseSyncState = {
      interval_minutes:
        data.interval_minutes ??
        null,

      last_sync:
        data.last_sync ??
        null,

      next_sync:
        data.next_sync ??
        null,

      result:
        data.result ??
        null,

      running:
        data.running ??
        null
    };


    /*
     * 获取数据后立即更新面板
     */

    renderDatabaseSync();

  } catch (error) {

    if (
      error.message
        .includes("登录已失效")
    ) {

      return;

    }


    console.error(
      "[App] 获取数据库同步状态失败：",
      error
    );

  }

}


// 手动上传始终强制上传最新数据库快照，不受“内容未变化”跳过规则影响。
if (databaseSyncUploadButton) {
  databaseSyncUploadButton.addEventListener("click", async () => {
    if (!token || databaseSyncUploadButton.disabled) return;
    const originalText = databaseSyncUploadButton.textContent;
    databaseSyncUploadButton.disabled = true;
    databaseSyncUploadButton.textContent = "上传中…";
    try {
      const response = await apiFetch("/api/database-sync/upload", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "数据库上传失败");
      await loadDatabaseSync();
      if (databaseSyncResult) {
        databaseSyncResult.textContent = data.message || "手动上传成功";
        databaseSyncResult.classList.remove("database-sync-result-error", "database-sync-result-empty");
        databaseSyncResult.classList.add("database-sync-result-success");
      }
    } catch (error) {
      if (databaseSyncResult) {
        databaseSyncResult.textContent = `error: ${error.message || "手动上传失败"}`;
        databaseSyncResult.classList.remove("database-sync-result-success", "database-sync-result-empty");
        databaseSyncResult.classList.add("database-sync-result-error");
      }
    } finally {
      databaseSyncUploadButton.disabled = false;
      databaseSyncUploadButton.textContent = originalText;
    }
  });
}


/*
 * ============================
 * 数据库同步状态自动刷新
 *
 * 与任务列表一样，
 * 每 5 秒检查一次。
 * ============================
 */

function startDatabaseSyncAutoRefresh() {

  stopDatabaseSyncAutoRefresh();


  databaseSyncTimer =
    setInterval(
      () => {

        if (!token) {

          return;

        }


        loadDatabaseSync();

      },
      5000
    );

}


function stopDatabaseSyncAutoRefresh() {

  if (
    databaseSyncTimer
  ) {

    clearInterval(
      databaseSyncTimer
    );

    databaseSyncTimer =
      null;

  }

}


/*
 * ============================
 * 格式化任务卡片时间
 *
 * 日期和时间之间增加空格，
 * 例如：
 * 2026/10/3   10:07:12
 * ============================
 */

function formatTaskTime(
  value
) {

  if (!value) {

    return "暂无";

  }


  const date =
    new Date(value);


  if (
    Number.isNaN(
      date.getTime()
    )
  ) {

    return "暂无";

  }


  const datePart =
    date.toLocaleDateString();


  const timePart =
    date.toLocaleTimeString();


  return `${datePart}      ${timePart}`;

}


/*
 * ============================
 * 计算任务下一次访问时间
 *
 * 使用：
 * 上次访问时间 + 执行间隔
 *
 * 不增加数据库字段。
 * ============================
 */

function getNextVisitTime(
  task
) {

  if (
    Number(task.enabled) !== 1
  ) {

    return null;

  }


  if (!task.last_visit) {

    return null;

  }


  const lastVisit =
    new Date(
      task.last_visit
    );


  if (
    Number.isNaN(
      lastVisit.getTime()
    )
  ) {

    return null;

  }


  const intervalMinutes =
    Number(
      task.interval_minutes
    );


  if (
    !Number.isFinite(
      intervalMinutes
    ) ||
    intervalMinutes < 0
  ) {

    return null;

  }


  return new Date(
    lastVisit.getTime() +
    intervalMinutes * 60 * 1000
  );

}


/*
 * ============================
 * 最后执行结果
 * ============================
 */

function getTaskResult(
  task
) {

  if (!task.last_status) {

    return `
      <span class="task-result-empty">
        暂无
      </span>
    `;

  }


  const status =
    String(
      task.last_status
    );


  if (
    status === "success"
  ) {

    return `
      <span class="task-result-success">
        success
      </span>
    `;

  }


  if (
    status.startsWith(
      "error:"
    )
  ) {

    return `
      <span class="task-result-error">
        ${escapeHtml(status)}
      </span>
    `;

  }


  return `
    <span class="task-result-error">
      ${escapeHtml(status)}
    </span>
  `;

}


/*
 * ============================
 * 格式化任务状态
 * ============================
 */

function getTaskStatus(
  task
) {

  if (
    Number(task.enabled) === 1
  ) {

    return `
      <span class="status-on">
        运行中
      </span>
    `;

  }


  return `
    <span class="status-off">
      已停止
    </span>
  `;

}


/*
 * ============================
 * HTML 转义
 * ============================
 */

function escapeHtml(
  value
) {

  return String(
    value ?? ""
  )
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "&#039;"
    );

}


/*
 * ============================
 * 渲染任务列表
 * ============================
 */

function renderTasks(
  tasks
) {

  tasksTitle.textContent =
    `任务列表（共 ${tasks.length} 个任务）`;


  if (
    !tasks.length
  ) {

    tasksContainer.innerHTML = `
      <div class="empty-state">
        暂无任务
      </div>
    `;

    return;

  }


  tasksContainer.innerHTML =
    tasks
      .map(
        task => {

          const nextVisit =
            getNextVisitTime(
              task
            );


          return `
          <div
            class="task-card"
            data-task-id="${task.id}"
          >

            <div class="task-card-header">

              <div class="task-title-area">

                <div class="task-id">
                  #${task.id}
                </div>

                <div class="task-name">
                  ${escapeHtml(
                    task.name ||
                    `任务 #${task.id}`
                  )}
                </div>

              </div>

              <div class="task-status">
                ${getTaskStatus(task)}
              </div>

            </div>


            <div class="task-url">

              <span class="task-label">
                网址
              </span>

              <span class="task-value task-url-value">
                ${escapeHtml(
                  task.url
                )}
              </span>

            </div>


            <div class="task-meta">

              <div class="task-meta-item">

                <span class="task-label">
                  执行间隔
                </span>

                <span class="task-value">
                  ${escapeHtml(
                    task.interval_minutes
                  )} 分钟
                </span>

              </div>


              <div class="task-meta-item">

                <span class="task-label">
                  停留时间
                </span>

                <span class="task-value">
                  ${escapeHtml(
                    task.stay_seconds
                  )} 秒
                </span>

              </div>


              <div class="task-meta-item">

                <span class="task-label">
                  访问次数
                </span>

                <span class="task-value">
                  ${escapeHtml(
                    task.visit_count || 0
                  )}
                </span>

              </div>


              <div class="task-meta-item">

                <span class="task-label">
                  上次访问
                </span>

                <span class="task-value">
                  ${formatTaskTime(
                    task.last_visit
                  )}
                </span>

              </div>


              <div class="task-meta-item">

                <span class="task-label">
                  下次访问
                </span>

                <span class="task-value">
                  ${
                    nextVisit
                      ? formatTaskTime(
                          nextVisit
                        )
                      : "暂无"
                  }
                </span>

              </div>


              <div class="task-meta-item">

                <span class="task-label">
                  最后结果
                </span>

                <span class="task-value">
                  ${getTaskResult(
                    task
                  )}
                </span>

              </div>

            </div>


            <div class="task-actions">

              ${
                Number(task.enabled) === 1
                  ? `
                    <button
                      type="button"
                      class="secondary-button task-stop-button"
                      data-id="${task.id}"
                    >
                      停止
                    </button>
                  `
                  : `
                    <button
                      type="button"
                      class="primary-button task-start-button"
                      data-id="${task.id}"
                    >
                      启动
                    </button>
                  `
              }


              <button
                type="button"
                class="secondary-button task-edit-button"
                data-id="${task.id}"
              >
                编辑
              </button>


              <button
                type="button"
                class="danger-button task-delete-button"
                data-id="${task.id}"
              >
                删除
              </button>

            </div>

          </div>
          `;

        }
      )
      .join("");


  /*
   * 启动按钮
   */

  document
    .querySelectorAll(
      ".task-start-button"
    )
    .forEach(
      button => {

        button.addEventListener(
          "click",
          () =>
            startTask(
              button.dataset.id
            )
        );

      }
    );


  /*
   * 停止按钮
   */

  document
    .querySelectorAll(
      ".task-stop-button"
    )
    .forEach(
      button => {

        button.addEventListener(
          "click",
          () =>
            stopTask(
              button.dataset.id
            )
        );

      }
    );


  /*
   * 编辑按钮
   */

  document
    .querySelectorAll(
      ".task-edit-button"
    )
    .forEach(
      button => {

        button.addEventListener(
          "click",
          () =>
            openEditModal(
              button.dataset.id
            )
        );

      }
    );


  /*
   * 删除按钮
   */

  document
    .querySelectorAll(
      ".task-delete-button"
    )
    .forEach(
      button => {

        button.addEventListener(
          "click",
          () =>
            deleteTask(
              button.dataset.id
            )
        );

      }
    );

}


/*
 * ============================
 * 创建任务
 * ============================
 */

createTaskForm.addEventListener(
  "submit",
  async event => {

    event.preventDefault();


    createTaskMessage.textContent =
      "";


    const name =
      document
        .getElementById(
          "task-name"
        )
        .value
        .trim();


    const url =
      document
        .getElementById(
          "task-url"
        )
        .value
        .trim();


    const intervalMinutes =
      Number(
        document
          .getElementById(
            "task-interval"
          )
          .value
      );


    const staySeconds =
      Number(
        document
          .getElementById(
            "task-stay"
          )
          .value
      );


    try {

      const response =
        await apiFetch(
          "/api/tasks",
          {
            method: "POST",

            body:
              JSON.stringify({
                name,
                url,
                interval_minutes:
                  intervalMinutes,
                stay_seconds:
                  staySeconds
              })
          }
        );


      const data =
        await response.json();


      if (
        !response.ok
      ) {

        throw new Error(
          data.error ||
          "创建任务失败"
        );

      }


      createTaskForm.reset();


      document
        .getElementById(
          "task-interval"
        )
        .value = 5;


      document
        .getElementById(
          "task-stay"
        )
        .value = 10;


      createTaskMessage.textContent =
        "任务创建成功";


      await loadTasks();

    } catch (error) {

      createTaskMessage.textContent =
        error.message ||
        "创建任务失败";

    }

  }
);


/*
 * ============================
 * 启动任务
 * ============================
 */

async function startTask(
  id
) {

  try {

    const response =
      await apiFetch(
        `/api/tasks/${id}/start`,
        {
          method: "POST"
        }
      );


    const data =
      await response.json();


    if (
      !response.ok
    ) {

      throw new Error(
        data.error ||
        "启动任务失败"
      );

    }


    await loadTasks();

  } catch (error) {

    alert(
      error.message ||
      "启动任务失败"
    );

  }

}


/*
 * ============================
 * 停止任务
 * ============================
 */

async function stopTask(
  id
) {

  try {

    const response =
      await apiFetch(
        `/api/tasks/${id}/stop`,
        {
          method: "POST"
        }
      );


    const data =
      await response.json();


    if (
      !response.ok
    ) {

      throw new Error(
        data.error ||
        "停止任务失败"
      );

    }


    await loadTasks();

  } catch (error) {

    alert(
      error.message ||
      "停止任务失败"
    );

  }

}


/*
 * ============================
 * 删除任务
 * ============================
 */

async function deleteTask(
  id
) {

  const confirmed =
    window.confirm(
      `确定要删除任务 #${id} 吗？`
    );


  if (!confirmed) {

    return;

  }


  try {

    const response =
      await apiFetch(
        `/api/tasks/${id}`,
        {
          method: "DELETE"
        }
      );


    const data =
      await response.json();


    if (
      !response.ok
    ) {

      throw new Error(
        data.error ||
        "删除任务失败"
      );

    }


    await loadTasks();

  } catch (error) {

    alert(
      error.message ||
      "删除任务失败"
    );

  }

}


/*
 * ============================
 * 打开编辑弹窗
 * ============================
 */

async function openEditModal(
  id
) {

  editTaskMessage.textContent =
    "";


  try {

    const response =
      await apiFetch(
        `/api/tasks/${id}`
      );


    const task =
      await response.json();


    if (
      !response.ok
    ) {

      throw new Error(
        task.error ||
        "获取任务失败"
      );

    }


    editTaskId.value =
      task.id;


    editTaskName.value =
      task.name || "";


    editTaskUrl.value =
      task.url || "";


    editTaskInterval.value =
      task.interval_minutes;


    editTaskStay.value =
      task.stay_seconds;


    editTaskModal.classList.remove(
      "hidden"
    );


    setTimeout(
      () => {

        editTaskName.focus();

      },
      50
    );

  } catch (error) {

    alert(
      error.message ||
      "获取任务失败"
    );

  }

}


/*
 * ============================
 * 关闭编辑弹窗
 * ============================
 */

function closeEditModal() {

  editTaskModal.classList.add(
    "hidden"
  );


  editTaskMessage.textContent =
    "";

}


/*
 * 关闭按钮
 */

closeEditTaskButton.addEventListener(
  "click",
  closeEditModal
);


/*
 * 取消按钮
 */

cancelEditTaskButton.addEventListener(
  "click",
  closeEditModal
);


/*
 * 点击背景关闭
 */

editModalBackdrop.addEventListener(
  "click",
  closeEditModal
);


/*
 * ESC 关闭
 */

document.addEventListener(
  "keydown",
  event => {

    if (
      event.key === "Escape" &&
      !editTaskModal.classList.contains(
        "hidden"
      )
    ) {

      closeEditModal();

    }

  }
);


/*
 * ============================
 * 保存编辑
 * ============================
 */

editTaskForm.addEventListener(
  "submit",
  async event => {

    event.preventDefault();


    editTaskMessage.textContent =
      "";


    const id =
      editTaskId.value;


    const name =
      editTaskName.value.trim();


    const url =
      editTaskUrl.value.trim();


    const intervalMinutes =
      Number(
        editTaskInterval.value
      );


    const staySeconds =
      Number(
        editTaskStay.value
      );


    try {

      const response =
        await apiFetch(
          `/api/tasks/${id}`,
          {
            method: "PUT",

            body:
              JSON.stringify({
                name,
                url,
                interval_minutes:
                  intervalMinutes,
                stay_seconds:
                  staySeconds
              })
          }
        );


      const data =
        await response.json();


      if (
        !response.ok
      ) {

        throw new Error(
          data.error ||
          "保存修改失败"
        );

      }


      closeEditModal();


      await loadTasks();

    } catch (error) {

      editTaskMessage.textContent =
        error.message ||
        "保存修改失败";

    }

  }
);


/*
 * ============================
 * 加载日志
 * ============================
 */

async function loadLogs() {

  try {

    const response =
      await apiFetch(
        "/api/logs"
      );


    const logs =
      await response.json();


    if (
      !response.ok
    ) {

      throw new Error(
        logs.error ||
        "获取日志失败"
      );

    }


    renderLogs(
      logs
    );

  } catch (error) {

    if (
      error.message
        .includes("登录已失效")
    ) {

      return;

    }


    console.error(
      "[App] 获取日志失败：",
      error
    );

  }

}


/*
 * ============================
 * 渲染日志
 * ============================
 */

function renderLogs(
  logs
) {

  if (
    !logs ||
    !logs.length
  ) {

    logsContainer.innerHTML = `
      <div class="empty-state">
        暂无日志
      </div>
    `;

    return;

  }


  logsContainer.innerHTML =
    logs
      .map(
        log =>
          `
          <div class="log-entry ${
            log.level === "error"
              ? "log-error"
              : ""
          }">

            <span class="log-time">
              ${escapeHtml(
                formatTime(
                  log.time
                )
              )}
            </span>

            <span class="log-message">
              ${escapeHtml(
                log.message
              )}
            </span>

          </div>
          `
      )
      .join("");


  /*
   * 自动滚动到底部
   */

  logsContainer.scrollTop =
    logsContainer.scrollHeight;

}


/*
 * ============================
 * SSE 实时日志
 * ============================
 */

async function startLogStream() {

  stopLogStream();


  if (!token) {

    return;

  }


  logStreamController =
    new AbortController();


  const signal =
    logStreamController.signal;


  try {

    const response =
      await fetch(
        "/api/logs/stream",
        {
          method: "GET",

          headers: {
            "Authorization":
              `Bearer ${token}`,

            "Accept":
              "text/event-stream"
          },

          signal
        }
      );


    if (
      response.status === 401
    ) {

      logout();

      return;

    }


    if (
      !response.ok
    ) {

      throw new Error(
        `日志连接失败：${response.status}`
      );

    }


    if (
      !response.body
    ) {

      throw new Error(
        "浏览器不支持日志流"
      );

    }


    const reader =
      response.body.getReader();


    const decoder =
      new TextDecoder();


    let buffer = "";


    while (
      !signal.aborted
    ) {

      const {
        value,
        done
      } =
        await reader.read();


      if (done) {

        break;

      }


      buffer +=
        decoder.decode(
          value,
          {
            stream: true
          }
        );


      const events =
        buffer.split(
          "\n\n"
        );


      buffer =
        events.pop() || "";


      for (
        const event of events
      ) {

        processLogEvent(
          event
        );

      }

    }

  } catch (error) {

    if (
      signal.aborted
    ) {

      return;

    }


    console.error(
      "[App] 日志连接断开：",
      error
    );

  }


  /*
   * 自动重连
   */

  if (
    token &&
    !signal.aborted
  ) {

    setTimeout(
      () => {

        if (token) {

          startLogStream();

        }

      },
      3000
    );

  }


}


/*
 * ============================
 * 处理 SSE 事件
 * ============================
 */

function processLogEvent(
  event
) {

  const lines =
    event.split(
      "\n"
    );


  let data = "";


  for (
    const line of lines
  ) {

    if (
      line.startsWith(
        "data:"
      )
    ) {

      data +=
        line
          .slice(5)
          .trim();

    }

  }


  if (!data) {

    return;

  }


  try {

    const payload =
      JSON.parse(data);


    /*
     * 历史日志
     */

    if (
      payload.type ===
      "history"
    ) {

      renderLogs(
        payload.logs || []
      );

      return;

    }


    /*
     * 新日志
     */

    if (
      payload.message
    ) {

      appendLog(
        payload
      );

    }

  } catch (error) {

    console.error(
      "[App] 日志解析失败：",
      error
    );

  }

}


/*
 * ============================
 * 添加单条日志
 * ============================
 */

function appendLog(
  log
) {

  /*
   * 如果当前是空状态，
   * 先清除。
   */

  const empty =
    logsContainer.querySelector(
      ".empty-state"
    );


  if (empty) {

    empty.remove();

  }


  const entry =
    document.createElement(
      "div"
    );


  entry.className =
    "log-entry";


  if (
    log.level ===
    "error"
  ) {

    entry.classList.add(
      "log-error"
    );

  }


  const time =
    document.createElement(
      "span"
    );


  time.className =
    "log-time";


  time.textContent =
    formatTime(
      log.time
    );


  const message =
    document.createElement(
      "span"
    );


  message.className =
    "log-message";


  message.textContent =
    log.message;


  entry.appendChild(
    time
  );


  entry.appendChild(
    message
  );


  logsContainer.appendChild(
    entry
  );


  /*
   * 最多显示 200 条。
   */

  while (
    logsContainer
      .querySelectorAll(
        ".log-entry"
      )
      .length > 200
  ) {

    const first =
      logsContainer
        .querySelector(
          ".log-entry"
        );


    if (!first) {

      break;

    }


    first.remove();

  }


  logsContainer.scrollTop =
    logsContainer.scrollHeight;

}


/*
 * ============================
 * 停止日志流
 * ============================
 */

function stopLogStream() {

  if (
    logStreamController
  ) {

    try {

      logStreamController.abort();

    } catch {}

    logStreamController =
      null;

  }

}


/*
 * ============================
 * 清空日志
 * ============================
 */

clearLogsButton.addEventListener(
  "click",
  async () => {

    const confirmed =
      window.confirm(
        "确定要清空当前日志吗？"
      );


    if (!confirmed) {

      return;

    }


    /*
     * 当前后端 logger.js
     * 没有提供真正的 clearLogs()
     *
     * 所以这里刷新日志。
     *
     * 保持与现有后端兼容。
     */

    try {

      const response =
        await apiFetch(
          "/api/logs",
          {
            method: "DELETE"
          }
        );


      if (
        !response.ok
      ) {

        throw new Error(
          "清空日志失败"
        );

      }


      await loadLogs();

    } catch (error) {

      alert(
        error.message ||
        "清空日志失败"
      );

    }

  }
);


/*
 * ============================
 * 刷新任务
 * ============================
 */

refreshTasksButton.addEventListener(
  "click",
  () => {

    loadTasks();

  }
);


/*
 * ============================
 * 登录保活任务
 * ============================
 */

function updateKeepaliveAuthFields() {
  const mode = keepaliveAuthMode.value;
  keepaliveUsernameGroup.classList.toggle("hidden", mode !== "username_password");
  keepalivePasswordGroup.classList.toggle("hidden", mode === "none");
}

function resetKeepaliveForm() {
  editingKeepaliveId = null;
  keepaliveForm.reset();
  keepaliveInterval.value = "60";
  keepaliveAuthMode.value = "none";
  keepaliveUsername.placeholder = "目标网站用户名";
  keepalivePassword.placeholder = "仅保存在 Remain 数据库加密字段中";
  keepaliveForm.querySelector('button[type="submit"]').textContent = "创建保活任务";
  keepaliveCancelEditButton.classList.add("hidden");
  keepaliveFormMessage.textContent = "";
  keepaliveFormMessage.classList.remove("form-error-text");
  updateKeepaliveAuthFields();
}

function keepaliveStatusLabel(task) {
  const labels = {
    stopped: "已停止",
    starting: "启动中",
    running: "运行中",
    needs_attention: "需要处理",
    error: "异常"
  };
  return labels[task.status] || task.status || "未知";
}

function renderKeepaliveTasks(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    keepaliveTasksContainer.innerHTML = '<div class="empty-state">暂无登录保活任务</div>';
    return;
  }

  keepaliveTasksContainer.innerHTML = tasks.map(task => {
    const running = Number(task.enabled) === 1;
    const statusClass = task.status === "running" ? "status-on" : "status-off";
    const statusText = keepaliveStatusLabel(task);
    const authLabels = {
      none: "无需登录",
      username_password: "用户名 + 密码",
      password_only: "仅密码"
    };
    return `
      <article class="task-card keepalive-card" data-keepalive-id="${Number(task.id)}">
        <div class="task-card-header">
          <div class="task-title-area">
            <span class="task-id">#${Number(task.id)}</span>
            <strong class="task-name">${escapeHtml(task.name)}</strong>
            <span class="${statusClass}">${escapeHtml(statusText)}</span>
          </div>
          <div class="keepalive-card-actions">
            <button type="button" class="secondary-button" data-keepalive-action="edit" data-id="${Number(task.id)}">编辑</button>
            ${running
              ? `<button type="button" class="secondary-button" data-keepalive-action="stop" data-id="${Number(task.id)}">停止</button>`
              : `<button type="button" class="primary-button" data-keepalive-action="start" data-id="${Number(task.id)}">启动</button>`}
            <button type="button" class="danger-button" data-keepalive-action="delete" data-id="${Number(task.id)}">删除</button>
          </div>
        </div>
        <div class="task-url"><span class="task-label">目标网址</span><span class="task-url-value">${escapeHtml(task.url)}</span></div>
        <div class="keepalive-meta">
          <span>刷新间隔：${Number(task.refresh_interval_seconds)} 秒</span>
          <span>登录方式：${escapeHtml(authLabels[task.auth_mode] || task.auth_mode)}</span>
          <span>最近刷新：${escapeHtml(formatTime(task.last_refresh))}</span>
        </div>
        ${task.last_status ? `<p class="keepalive-last-status">${escapeHtml(task.last_status)}</p>` : ""}
      </article>`;
  }).join("");
}

async function loadKeepaliveTasks() {
  if (!token) return;
  try {
    const response = await apiFetch("/api/keepalive-tasks");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "获取登录保活任务失败");
    renderKeepaliveTasks(data);
  } catch (error) {
    if (!String(error.message || "").includes("登录已失效")) {
      console.error("[App] 获取登录保活任务失败：", error);
      keepaliveFormMessage.textContent = error.message || "获取登录保活任务失败";
      keepaliveFormMessage.classList.add("form-error-text");
    }
  }
}

keepaliveAuthMode.addEventListener("change", updateKeepaliveAuthFields);
keepaliveCancelEditButton.addEventListener("click", resetKeepaliveForm);
refreshKeepaliveButton.addEventListener("click", loadKeepaliveTasks);

keepaliveForm.addEventListener("submit", async event => {
  event.preventDefault();
  keepaliveFormMessage.textContent = "";
  keepaliveFormMessage.classList.remove("form-error-text");

  const mode = keepaliveAuthMode.value;
  const payload = {
    name: keepaliveName.value.trim(),
    url: keepaliveUrl.value.trim(),
    refresh_interval_seconds: Number(keepaliveInterval.value),
    auth_mode: mode,
    username: keepaliveUsername.value,
    password: keepalivePassword.value,
    username_selector: keepaliveUsernameSelector.value.trim(),
    password_selector: keepalivePasswordSelector.value.trim(),
    submit_selector: keepaliveSubmitSelector.value.trim(),
    success_selector: keepaliveSuccessSelector.value.trim(),
    logged_out_selector: keepaliveLoggedOutSelector.value.trim()
  };

  if (!payload.name || !payload.url) {
    keepaliveFormMessage.textContent = "请填写任务名称和目标网址。";
    keepaliveFormMessage.classList.add("form-error-text");
    return;
  }
  if (!Number.isInteger(payload.refresh_interval_seconds) || payload.refresh_interval_seconds < 10 || payload.refresh_interval_seconds > 86400) {
    keepaliveFormMessage.textContent = "刷新间隔需为 10–86400 秒的整数。";
    keepaliveFormMessage.classList.add("form-error-text");
    return;
  }
  if (mode === "username_password" && !editingKeepaliveId && (!payload.username.trim() || !payload.password)) {
    keepaliveFormMessage.textContent = "请填写用户名和密码。";
    keepaliveFormMessage.classList.add("form-error-text");
    return;
  }
  if (mode === "password_only" && !editingKeepaliveId && !payload.password) {
    keepaliveFormMessage.textContent = "请填写网站登录密码。";
    keepaliveFormMessage.classList.add("form-error-text");
    return;
  }

  const isEditing = editingKeepaliveId !== null;
  const url = isEditing ? `/api/keepalive-tasks/${editingKeepaliveId}` : "/api/keepalive-tasks";
  try {
    const response = await apiFetch(url, {
      method: isEditing ? "PUT" : "POST",
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || (isEditing ? "更新保活任务失败" : "创建保活任务失败"));
    const successMessage = isEditing ? "保活任务已更新。" : "保活任务已创建。";
    resetKeepaliveForm();
    keepaliveFormMessage.textContent = successMessage;
    keepaliveFormMessage.classList.remove("form-error-text");
    await loadKeepaliveTasks();
  } catch (error) {
    keepaliveFormMessage.textContent = error.message || "操作失败";
    keepaliveFormMessage.classList.add("form-error-text");
  }
});

keepaliveTasksContainer.addEventListener("click", async event => {
  const button = event.target.closest("button[data-keepalive-action]");
  if (!button) return;
  const id = Number(button.dataset.id);
  const action = button.dataset.keepaliveAction;
  button.disabled = true;
  try {
    if (action === "edit") {
      const response = await apiFetch(`/api/keepalive-tasks`);
      const tasks = await response.json();
      if (!response.ok) throw new Error(tasks.error || "读取任务失败");
      const task = tasks.find(item => Number(item.id) === id);
      if (!task) throw new Error("登录保活任务不存在");
      editingKeepaliveId = id;
      keepaliveName.value = task.name || "";
      keepaliveUrl.value = task.url || "";
      keepaliveInterval.value = String(task.refresh_interval_seconds || 60);
      keepaliveAuthMode.value = task.auth_mode || "none";
      keepaliveUsername.value = "";
      keepalivePassword.value = "";
      keepaliveUsername.placeholder = "留空则保留原用户名；填写则更新用户名";
      keepalivePassword.placeholder = "留空则保留原密码；填写则更新密码";
      keepaliveUsernameSelector.value = task.username_selector || "";
      keepalivePasswordSelector.value = task.password_selector || "";
      keepaliveSubmitSelector.value = task.submit_selector || "";
      keepaliveSuccessSelector.value = task.success_selector || "";
      keepaliveLoggedOutSelector.value = task.logged_out_selector || "";
      keepaliveForm.querySelector('button[type="submit"]').textContent = "保存修改";
      keepaliveCancelEditButton.classList.remove("hidden");
      keepaliveFormMessage.textContent = "编辑时密码可以留空，表示保留原密码。";
      keepaliveFormMessage.classList.remove("form-error-text");
      updateKeepaliveAuthFields();
      keepaliveForm.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (action === "delete" && !confirm(`确定删除登录保活任务 #${id} 吗？`)) return;
    const endpoint = `/api/keepalive-tasks/${id}`;
    let response;
    if (action === "start") response = await apiFetch(`${endpoint}/start`, { method: "POST" });
    else if (action === "stop") response = await apiFetch(`${endpoint}/stop`, { method: "POST" });
    else if (action === "delete") response = await apiFetch(endpoint, { method: "DELETE" });
    else return;
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "保活任务操作失败");
    await loadKeepaliveTasks();
  } catch (error) {
    alert(error.message || "保活任务操作失败");
  } finally {
    button.disabled = false;
  }
});

updateKeepaliveAuthFields();

/*
 * ============================
 * 自动刷新
 * ============================
 */

function startAutoRefresh() {

  stopAutoRefresh();


  refreshTimer =
    setInterval(
      () => {

        if (!token) {

          return;

        }


        loadTasks();
        loadKeepaliveTasks();

      },
      5000
    );

}


function stopAutoRefresh() {

  if (
    refreshTimer
  ) {

    clearInterval(
      refreshTimer
    );

    refreshTimer =
      null;

  }

}


/*
 * ============================
 * 页面初始化
 * ============================
 */

async function initialize() {

  if (!token) {

    showLoginPage();

    return;

  }


  try {

    /*
     * 通过任务接口验证 Token
     */

    const response =
      await apiFetch(
        "/api/tasks"
      );


    if (
      !response.ok
    ) {

      throw new Error(
        "登录已失效"
      );

    }


    const tasks =
      await response.json();


    showAppPage();


    renderTasks(
      tasks
    );


    await loadKeepaliveTasks();

    await loadLogs();

    await loadDatabaseSync();


    startLogStream();

    startAutoRefresh();

    startDatabaseSyncAutoRefresh();

  } catch (error) {

    logout();

  }

}


/*
 * ============================
 * 启动
 * ============================
 */

initialize();
