import { describe, expect, it } from 'vitest';
import { isStreamEventForMessage } from '../src/api/event-correlation';
import type { StreamEvent } from '../src/api/types';

describe('stream event correlation', () => {
  it('accepts only events belonging to the current agent message', () => {
    const current = {
      type: 'text_delta',
      messageId: 'msg-current',
      delta: 'hello',
      index: 0,
    } satisfies StreamEvent;
    const other = { ...current, messageId: 'msg-other' } satisfies StreamEvent;

    expect(isStreamEventForMessage(current, 'msg-current')).toBe(true);
    expect(isStreamEventForMessage(other, 'msg-current')).toBe(false);
  });

  it('rejects uncorrelated status events', () => {
    const event = {
      type: 'status',
      status: 'running',
      message: 'working',
    } satisfies StreamEvent;

    expect(isStreamEventForMessage(event, 'msg-current')).toBe(false);
  });
});
