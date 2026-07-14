// ====== Session Message Store ======
// Stores chat messages for each session in a separate JSONL file.
// This separates chat history from core user data (user.json), so:
//   - Core data (tasks, skills, models, session metadata) → data/users/{userId}.json
//   - Chat messages (user/agent/tool messages) → data/sessions/{sessionId}.jsonl
//
// JSONL format: one JSON object per line, append-only.
// Benefits:
//   - Append-only writes (no full-rewrite on every message)
//   - Crash-safe: existing lines are never modified
//   - Can be streamed/truncated independently
//   - user.json stays small and fast to read/write

import fs from 'node:fs';
import path from 'node:path';
import type { ChatMessage } from './types.js';
import { dataDir } from './storage.js';

/** In-memory cache: sessionId → ChatMessage[] (loaded lazily, kept in sync). */
const cache = new Map<string, ChatMessage[]>();

function sessionDir(): string {
  return path.join(dataDir(), 'sessions');
}

function fileFor(sessionId: string): string {
  return path.join(sessionDir(), `${sessionId}.jsonl`);
}

/** Ensure the sessions directory exists. */
export function ensureSessionDir(): void {
  try {
    fs.mkdirSync(sessionDir(), { recursive: true });
  } catch { /* ignore */ }
}

/** Get all messages for a session (loads from disk on first access, then cached). */
export function getMessages(sessionId: string): ChatMessage[] {
  const cached = cache.get(sessionId);
  if (cached) return cached;

  ensureSessionDir();
  const file = fileFor(sessionId);
  const messages: ChatMessage[] = [];

  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf-8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        messages.push(JSON.parse(line) as ChatMessage);
      } catch { /* skip malformed lines */ }
    }
  }

  cache.set(sessionId, messages);
  return messages;
}

/** Append a single message to the session's JSONL file. */
export function appendMessage(sessionId: string, msg: ChatMessage): void {
  ensureSessionDir();
  const file = fileFor(sessionId);
  const line = JSON.stringify(msg) + '\n';
  try {
    fs.appendFileSync(file, line, 'utf-8');
  } catch (e) {
    console.warn('[session-store] append failed', e);
  }
  // Update in-memory cache.
  const messages = cache.get(sessionId);
  if (messages) {
    messages.push(msg);
  } else {
    cache.set(sessionId, [msg]);
  }
}

/** Append multiple messages at once (batch). */
export function appendMessages(sessionId: string, msgs: ChatMessage[]): void {
  ensureSessionDir();
  const file = fileFor(sessionId);
  const lines = msgs.map(m => JSON.stringify(m)).join('\n') + '\n';
  try {
    fs.appendFileSync(file, lines, 'utf-8');
  } catch (e) {
    console.warn('[session-store] batch append failed', e);
  }
  // Update in-memory cache.
  const messages = cache.get(sessionId);
  if (messages) {
    messages.push(...msgs);
  } else {
    cache.set(sessionId, [...msgs]);
  }
}

/** Get message count for a session. */
export function getMessageCount(sessionId: string): number {
  return getMessages(sessionId).length;
}

/** Delete all messages for a session (when session is deleted). */
export function deleteMessages(sessionId: string): void {
  cache.delete(sessionId);
  const file = fileFor(sessionId);
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch (e) {
    console.warn('[session-store] delete failed', e);
  }
}

/**
 * Migration: extract messages from old UserData.sessions format.
 * Called once on boot if user.json still contains `messages` arrays.
 * Moves messages to JSONL files and strips them from user.json.
 */
export function migrateFromUserData(userId: string, sessions: Record<string, {
  info: { messageCount: number };
  messages?: ChatMessage[];
}>): boolean {
  let migrated = false;
  for (const [sessionId, session] of Object.entries(sessions)) {
    if (session.messages && session.messages.length > 0) {
      // Write all messages to JSONL file.
      appendMessages(sessionId, session.messages);
      // Update messageCount if missing.
      session.info.messageCount = session.messages.length;
      // Strip messages from user.json (saves space, speeds up read/write).
      session.messages = [];
      migrated = true;
    }
  }
  if (migrated) {
    console.log(`[session-store] migrated messages for user ${userId} to JSONL files`);
  }
  return migrated;
}
