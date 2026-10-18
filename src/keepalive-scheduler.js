const { getKeepaliveTasks } = require("./database");
const { startKeepaliveTask } = require("./keepalive-executor");

let started = false;

async function startKeepaliveScheduler() {
  if (started) return;
  started = true;

  const tasks = getKeepaliveTasks().filter(task => Number(task.enabled) === 1);
  console.log(`[KeepaliveScheduler] 正在恢复 ${tasks.length} 个已启用的登录保活任务`);

  for (const task of tasks) {
    try {
      await startKeepaliveTask(task.id);
    } catch (error) {
      console.error(`[KeepaliveScheduler] 任务 #${task.id} 启动失败：${String(error.message || "未知错误").slice(0, 200)}`);
    }
  }

  console.log("[KeepaliveScheduler] 登录保活调度已启动");
}

async function stopKeepaliveScheduler() {
  started = false;
  const { stopAllKeepaliveTasks } = require("./keepalive-executor");
  await stopAllKeepaliveTasks();
  console.log("[KeepaliveScheduler] 登录保活调度已停止");
}

module.exports = { startKeepaliveScheduler, stopKeepaliveScheduler };
