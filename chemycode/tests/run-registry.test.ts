import { describe, expect, it } from 'vitest';
import {
  addRunCancelHook,
  bindTaskToRun,
  cancelSessionRuns,
  cancelTaskRun,
  registerRun,
  unregisterRun,
} from '../server/src/run-registry';

describe('agent run registry', () => {
  it('cancels the controller associated with a task', () => {
    const controller = new AbortController();
    const runKey = registerRun('user-a', 'session-a', 'message-a', controller);
    bindTaskToRun('user-a', runKey, 'task-a');
    let hookCalled = false;
    addRunCancelHook(runKey, () => { hookCalled = true; });

    expect(cancelTaskRun('user-a', 'task-a')).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    expect(hookCalled).toBe(true);

    unregisterRun(runKey);
  });

  it('cancels only runs from the requested user and session', () => {
    const first = new AbortController();
    const second = new AbortController();
    const firstKey = registerRun('user-a', 'session-a', 'message-1', first);
    const secondKey = registerRun('user-a', 'session-b', 'message-2', second);

    expect(cancelSessionRuns('user-a', 'session-a')).toBe(1);
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);

    unregisterRun(firstKey);
    unregisterRun(secondKey);
  });
});
