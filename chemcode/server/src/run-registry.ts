interface ActiveRun {
  userId: string;
  sessionId: string;
  messageId: string;
  controller: AbortController;
  taskIds: Set<string>;
  cancelHooks: Set<() => void>;
}

const runs = new Map<string, ActiveRun>();
const taskToRun = new Map<string, string>();

function taskKey(userId: string, taskId: string): string {
  return `${userId}:${taskId}`;
}

export function makeRunKey(sessionId: string, messageId: string): string {
  return `${sessionId}:${messageId}`;
}

export function registerRun(
  userId: string,
  sessionId: string,
  messageId: string,
  controller: AbortController,
): string {
  const runKey = makeRunKey(sessionId, messageId);
  runs.set(runKey, {
    userId,
    sessionId,
    messageId,
    controller,
    taskIds: new Set(),
    cancelHooks: new Set(),
  });
  return runKey;
}

export function addRunCancelHook(runKey: string, hook: () => void): void {
  runs.get(runKey)?.cancelHooks.add(hook);
}

function cancelRun(run: ActiveRun, reason: Error): void {
  for (const hook of run.cancelHooks) {
    try { hook(); } catch { /* best effort */ }
  }
  run.controller.abort(reason);
}

export function bindTaskToRun(userId: string, runKey: string, taskId: string): void {
  const run = runs.get(runKey);
  if (!run || run.userId !== userId) return;
  run.taskIds.add(taskId);
  taskToRun.set(taskKey(userId, taskId), runKey);
}

export function unbindTaskFromRun(userId: string, taskId: string): void {
  const key = taskKey(userId, taskId);
  const runKey = taskToRun.get(key);
  taskToRun.delete(key);
  if (runKey) runs.get(runKey)?.taskIds.delete(taskId);
}

export function cancelTaskRun(userId: string, taskId: string): boolean {
  const runKey = taskToRun.get(taskKey(userId, taskId));
  if (!runKey) return false;
  const run = runs.get(runKey);
  if (!run || run.userId !== userId) return false;
  cancelRun(run, new Error(`Task ${taskId} cancelled by user`));
  return true;
}

export function cancelSessionRuns(userId: string, sessionId: string): number {
  let cancelled = 0;
  for (const run of runs.values()) {
    if (run.userId === userId && run.sessionId === sessionId && !run.controller.signal.aborted) {
      cancelRun(run, new Error(`Session ${sessionId} cancelled by user`));
      cancelled++;
    }
  }
  return cancelled;
}

export function unregisterRun(runKey: string): void {
  const run = runs.get(runKey);
  if (!run) return;
  for (const taskId of run.taskIds) {
    taskToRun.delete(taskKey(run.userId, taskId));
  }
  runs.delete(runKey);
}
