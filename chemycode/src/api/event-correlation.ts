import type { StreamEvent } from './types';

export function isStreamEventForMessage(ev: StreamEvent, messageId: string): boolean {
  const eventMessageId = 'messageId' in ev ? ev.messageId : undefined;
  return eventMessageId === messageId;
}
