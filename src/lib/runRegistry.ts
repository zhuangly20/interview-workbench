/** 长任务运行注册表（服务端内存态）。
 *  拆解 / 出题 / 归类这类要跑一两分钟的任务，与发起它的 HTTP 请求解耦：
 *  用户切走页面、连接断开都不影响服务端继续跑完；
 *  注册表让前端切回来时能查到「还在跑」，恢复运行中状态。
 *  服务进程重启即清空（正在跑的调用本来也会随进程一起消失）。 */
export type RunTask = "analyze" | "generate" | "classify";

const RUNS = new Map<string, { startedAt: string; controller: AbortController }>();

const key = (id: string, task: RunTask) => `${id}:${task}`;

/** 登记一次运行并返回它的中止信号；同一任务已在跑则先掐掉旧的，避免并发写同一份文件 */
export function startRun(id: string, task: RunTask): AbortSignal {
  stopRun(id, task);
  const controller = new AbortController();
  RUNS.set(key(id, task), { startedAt: new Date().toISOString(), controller });
  return controller.signal;
}

/** 运行结束（无论成败）都要注销 */
export function endRun(id: string, task: RunTask) {
  RUNS.delete(key(id, task));
}

/** 该目标当前在跑的任务列表（给状态查询接口用） */
export function listRuns(id: string): { task: RunTask; startedAt: string }[] {
  return [...RUNS]
    .filter(([k]) => k.startsWith(`${id}:`))
    .map(([k, v]) => ({ task: k.slice(id.length + 1) as RunTask, startedAt: v.startedAt }));
}

/** 全部目标的在跑任务（给全站常驻的全局运行条轮询用） */
export function listAllRuns(): { targetId: string; task: RunTask; startedAt: string }[] {
  return [...RUNS].map(([k, v]) => {
    const i = k.indexOf(":");
    return { targetId: k.slice(0, i), task: k.slice(i + 1) as RunTask, startedAt: v.startedAt };
  });
}

/** 主动停止；任务不存在返回 false（无害） */
export function stopRun(id: string, task: RunTask): boolean {
  const run = RUNS.get(key(id, task));
  if (!run) return false;
  run.controller.abort();
  RUNS.delete(key(id, task));
  return true;
}
