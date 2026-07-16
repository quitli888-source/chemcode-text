// ====== Knowledge Store ======
// User-owned knowledge base stored in JSONL files (like session-store).
//
// Storage:
//   data/knowledge/{userId}.jsonl  — all knowledge entries for a user (append-only)
//
// Features:
//   - No disk limit: JSONL grows unbounded on disk
//   - Cache mirrors disk exactly so update/delete operations cannot rewrite a
//     truncated subset and silently destroy older records
//   - Hierarchical: entries support parentPath for tree structure (e.g. "ProjectA/MD")
//   - Pagination: getRecords supports offset+limit for large knowledge bases
//
// "Learning" = LLM analyzes raw material → generates structured knowledge entry
// Retrieval = keyword search (with optional embedding-based semantic search)

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { KnowledgeEntry } from './types.js';
import { dataDir } from './storage.js';

// Extended knowledge entry with learning metadata
export interface KnowledgeRecord extends KnowledgeEntry {
  /** Where this knowledge came from: 'manual' | 'chat' | 'upload' */
  source: 'manual' | 'chat' | 'upload';
  /** Original raw content (before LLM processing) */
  rawContent?: string;
  /** Creation timestamp */
  createdAt: string;
  /** Whether LLM learning succeeded */
  learned: boolean;
  /** Hierarchical path for tree organization (e.g. "ProjectA/SubTopic"). Empty = root level. */
  parentPath?: string;
  /** Importance level: 0=normal, 1=important, 2=critical. Higher = prioritized in retrieval. */
  importance?: number;
}

const cache = new Map<string, KnowledgeRecord[]>();

function knowledgeDir(): string {
  return path.join(dataDir(), 'knowledge');
}

function fileFor(userId: string): string {
  return path.join(knowledgeDir(), `${userId}.jsonl`);
}

export function ensureKnowledgeDir(): void {
  try {
    fs.mkdirSync(knowledgeDir(), { recursive: true });
  } catch { /* ignore */ }
}

/** Get all knowledge records for a user (loads from disk, then cached). */
export function getRecords(userId: string, offset = 0, limit = 0): KnowledgeRecord[] {
  const cached = cache.get(userId);
  if (cached) {
    if (limit > 0) return cached.slice(offset, offset + limit);
    return cached;
  }

  ensureKnowledgeDir();
  const file = fileFor(userId);
  const records: KnowledgeRecord[] = [];

  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf-8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line) as KnowledgeRecord);
      } catch { /* skip malformed */ }
    }
  }

  cache.set(userId, records);
  if (limit > 0) return records.slice(offset, offset + limit);
  return records;
}

/** Count total records for a user without loading all into memory. */
export function countRecords(userId: string): number {
  const cached = cache.get(userId);
  if (cached) return cached.length;
  ensureKnowledgeDir();
  const file = fileFor(userId);
  if (!fs.existsSync(file)) return 0;
  const raw = fs.readFileSync(file, 'utf-8');
  return raw.split('\n').filter((l) => l.trim()).length;
}

/** Append a single record (atomic write via append). */
export function appendRecord(userId: string, record: KnowledgeRecord): void {
  ensureKnowledgeDir();
  const file = fileFor(userId);
  const line = JSON.stringify(record) + '\n';
  try {
    fs.appendFileSync(file, line, 'utf-8');
  } catch (e) {
    console.warn('[knowledge-store] append failed', e);
  }
  const records = cache.get(userId);
  if (records) {
    records.push(record);
  } else {
    cache.set(userId, [record]);
  }
}

/** Update a record (rewrite entire file — records are small). */
export function updateRecord(userId: string, id: string, patch: Partial<KnowledgeRecord>): KnowledgeRecord | null {
  const records = getRecords(userId);
  const idx = records.findIndex((r) => r.id === id);
  if (idx < 0) return null;
  records[idx] = { ...records[idx], ...patch, updatedAt: new Date().toISOString() };
  rewriteFile(userId, records);
  return records[idx];
}

/** Delete a record. */
export function deleteRecord(userId: string, id: string): boolean {
  const records = getRecords(userId);
  const idx = records.findIndex((r) => r.id === id);
  if (idx < 0) return false;
  records.splice(idx, 1);
  rewriteFile(userId, records);
  return true;
}

/** Full-text search over knowledge records.
 *  Supports hierarchical filtering by parentPath. */
export function searchRecords(
  userId: string,
  query: string,
  limit = 20,
  options?: { parentPath?: string; importance?: number },
): KnowledgeRecord[] {
  let records = getRecords(userId);
  const q = query.toLowerCase().trim();

  // Filter by parentPath (hierarchical)
  if (options?.parentPath) {
    const pp = options.parentPath.toLowerCase();
    records = records.filter((r) => (r.parentPath || '').toLowerCase().startsWith(pp));
  }

  // Filter by importance level
  if (options?.importance !== undefined) {
    records = records.filter((r) => (r.importance || 0) >= options.importance!);
  }

  if (!q) return records.slice(0, limit);

  const scored = records.map((r) => {
    let score = 0;
    const title = r.title.toLowerCase();
    const content = r.content.toLowerCase();
    const tags = r.tags.join(' ').toLowerCase();
    const category = r.category.toLowerCase();
    const parentPath = (r.parentPath || '').toLowerCase();

    // Title match is highest priority
    if (title.includes(q)) score += 10;
    // Tag match
    if (tags.includes(q)) score += 5;
    // Category match
    if (category.includes(q)) score += 3;
    // ParentPath match (hierarchical context)
    if (parentPath.includes(q)) score += 4;
    // Content match
    if (content.includes(q)) score += 1;
    // Importance boost
    score += (r.importance || 0) * 2;

    // Also score by individual words
    const words = q.split(/\s+/);
    for (const w of words) {
      if (title.includes(w)) score += 3;
      if (tags.includes(w)) score += 2;
      if (content.includes(w)) score += 1;
    }

    return { record: r, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.record);
}

/** Retrieve the most relevant knowledge entries for a given user query.
 * Used by the agent loop to inject knowledge context.
 * Prioritizes by relevance score + importance level. */
export function retrieveRelevant(userId: string, query: string, limit = 5): KnowledgeRecord[] {
  return searchRecords(userId, query, limit);
}

/** Get the hierarchical tree structure of knowledge entries.
 * Returns groups grouped by parentPath. */
export function getTreeStructure(userId: string): Array<{ path: string; count: number; children: string[] }> {
  const records = getRecords(userId);
  const pathMap = new Map<string, number>();
  const pathChildren = new Map<string, Set<string>>();

  for (const r of records) {
    const pp = r.parentPath || '';
    pathMap.set(pp, (pathMap.get(pp) || 0) + 1);

    // Track sub-paths
    if (pp) {
      const parts = pp.split('/');
      for (let i = 1; i <= parts.length; i++) {
        const parent = parts.slice(0, i - 1).join('/');
        const child = parts.slice(0, i).join('/');
        if (!pathChildren.has(parent)) pathChildren.set(parent, new Set());
        pathChildren.get(parent)!.add(child);
      }
    }
  }

  const result: Array<{ path: string; count: number; children: string[] }> = [];
  for (const [p, count] of pathMap) {
    const children = pathChildren.get(p);
    result.push({
      path: p,
      count,
      children: children ? Array.from(children) : [],
    });
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

/** Create a new knowledge record. */
export function createRecord(
  userId: string,
  opts: {
    title: string;
    category: string;
    content: string;
    tags?: string[];
    source?: 'manual' | 'chat' | 'upload';
    rawContent?: string;
    learned?: boolean;
    parentPath?: string;
    importance?: number;
  },
): KnowledgeRecord {
  const now = new Date().toISOString();
  const record: KnowledgeRecord = {
    id: `kw-${crypto.randomUUID()}`,
    title: opts.title,
    category: opts.category || 'General',
    content: opts.content,
    tags: opts.tags || [],
    source: opts.source || 'manual',
    rawContent: opts.rawContent,
    createdAt: now,
    updatedAt: now,
    learned: opts.learned ?? false,
    parentPath: opts.parentPath || '',
    importance: opts.importance || 0,
  };
  appendRecord(userId, record);
  return record;
}

/** Rewrite the entire file (used by update/delete). */
function rewriteFile(userId: string, records: KnowledgeRecord[]): void {
  ensureKnowledgeDir();
  const file = fileFor(userId);
  const tmp = file + '.tmp.' + Date.now().toString(36);
  const lines = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  try {
    fs.writeFileSync(tmp, lines, 'utf-8');
    fs.renameSync(tmp, file);
  } catch (e) {
    console.warn('[knowledge-store] rewrite failed', e);
  }
}
