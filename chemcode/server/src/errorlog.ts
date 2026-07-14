// ====== Error Logger ======
// Appends runtime errors to data/errors.log for post-mortem debugging.
// Format: JSONL (one JSON object per line).
//
// Usage:
//   import { logError } from './errorlog.js';
//   logError({ userId, sessionId, messageId, error: e });

import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './storage.js';

export interface ErrorLogEntry {
  ts: string;
  userId?: string;
  sessionId?: string;
  messageId?: string;
  source: string;       // e.g. 'ws.agentLoop', 'agent.loop.llmCall'
  message: string;
  stack?: string;
}

/** Append an error entry to data/errors.log. */
export function logError(entry: Omit<ErrorLogEntry, 'ts'>): void {
  try {
    const file = path.join(dataDir(), 'errors.log');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const full: ErrorLogEntry = {
      ts: new Date().toISOString(),
      ...entry,
    };
    fs.appendFileSync(file, JSON.stringify(full) + '\n', 'utf-8');
  } catch (e) {
    // Don't let logging failures crash the server.
    console.warn('[errorlog] failed to write error log', e);
  }
}
