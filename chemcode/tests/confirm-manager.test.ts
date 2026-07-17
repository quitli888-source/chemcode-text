import { describe, expect, it } from 'vitest';
import { ConfirmManager } from '../server/src/agent/confirm';
import { toolRegistry } from '../server/src/tools';
import type { StreamEvent } from '../server/src/types';

const options = [
  { id: 'accept', label: 'Accept' },
  { id: 'reject', label: 'Reject', destructive: true },
];

describe('mandatory human confirmations', () => {
  it('does not bypass a required checkpoint in full-access mode', async () => {
    const manager = new ConfirmManager();
    const events: StreamEvent[] = [];
    manager.setFullAccess(true);

    const pending = manager.requestConfirmation(
      'checkpoint',
      options,
      (event) => events.push(event),
      'message-1',
      'human_checkpoint',
      { required: true, allowAlways: false },
    );

    expect(manager.pendingCount).toBe(1);
    expect(events[0]).toMatchObject({
      type: 'confirm_request',
      required: true,
      allowAlways: false,
    });
    expect(manager.getPendingAllowAlways('message-1')).toBe(false);

    manager.handleResponse('message-1', 'accept');
    await expect(pending).resolves.toBe(true);
  });

  it('still bypasses ordinary confirmations when a tool is allowed', async () => {
    const manager = new ConfirmManager();
    manager.addAllowedTool('bash_exec');
    const events: StreamEvent[] = [];

    await expect(
      manager.requestConfirmation(
        'ordinary confirmation',
        options,
        (event) => events.push(event),
        'message-2',
        'bash_exec',
      ),
    ).resolves.toBe(true);
    expect(events).toHaveLength(0);
  });

  it('emits a timeout event and rejects the operation', async () => {
    const manager = new ConfirmManager({ timeoutMs: 5 });
    const events: StreamEvent[] = [];

    await expect(
      manager.requestConfirmation(
        'checkpoint',
        options,
        (event) => events.push(event),
        'message-3',
        'human_checkpoint',
        { required: true, allowAlways: false },
      ),
    ).resolves.toBe(false);

    expect(events.some((event) => event.type === 'confirm_timeout')).toBe(true);
    expect(manager.pendingCount).toBe(0);
  });

  it('registers human_checkpoint as a non-bypassable tool', () => {
    const tool = toolRegistry.get('human_checkpoint');
    expect(tool?.definition.dangerous).toBe(true);
    expect(tool?.definition.confirmationMode).toBe('required');
  });

  it('persists and resets workflow progress on the session manager', () => {
    const manager = new ConfirmManager();
    expect(manager.getWorkflowCheckpointIndex('pygamd')).toBe(0);
    manager.advanceWorkflowCheckpoint('pygamd');
    manager.advanceWorkflowCheckpoint('pygamd');
    expect(manager.getWorkflowCheckpointIndex('pygamd')).toBe(2);
    manager.resetWorkflow('pygamd');
    expect(manager.getWorkflowCheckpointIndex('pygamd')).toBe(0);
  });
});
