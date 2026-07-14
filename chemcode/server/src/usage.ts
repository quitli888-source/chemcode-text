// ====== Usage Statistics ======
// Tracks token usage, cost, and tool calls per message.
// Persists to data/usage.jsonl (append-only).
// Aggregates on-the-fly for the /api/usage endpoint.

import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './storage.js';

export interface UsageRecord {
  ts: string;           // ISO-8601 timestamp
  userId: string;
  sessionId: string;
  messageId: string;
  role: 'user' | 'assistant';
  model?: string;
  provider?: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens: number;
  costUsd: number;
  toolCalls: string[];  // tool names used in this turn
  isError: boolean;
}

export interface UsageQuery {
  userId: string;
  from?: string;        // ISO-8601
  to?: string;          // ISO-8601
  model?: string;
  provider?: string;
  sessionId?: string;
}

export interface UsageSummary {
  totalMessages: number;
  userMessages: number;
  assistantMessages: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  totalCostUsd: number;
  totalToolCalls: number;
  uniqueTools: number;
  avgTokensPerMessage: number;
  avgCostPerMessage: number;
  errorCount: number;
  sessionCount: number;
  topModels: Array<{ model: string; cost: number; tokens: number; messages: number }>;
  topProviders: Array<{ provider: string; cost: number; tokens: number; messages: number }>;
  topTools: Array<{ tool: string; count: number }>;
  dailyBreakdown: Array<{ date: string; messages: number; tokens: number; cost: number }>;
}

// ── Cost per 1M tokens (input/output) ──
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'deepseek-v4-pro':       { input: 0.27, output: 1.10 },
  'deepseek-v4-flash':     { input: 0.07, output: 0.28 },
  'deepseek-chat':         { input: 0.07, output: 0.28 },
  'deepseek-reasoner':     { input: 0.55, output: 2.19 },
  'gpt-4o':                { input: 2.50, output: 10.00 },
  'gpt-4o-mini':           { input: 0.15, output: 0.60 },
  'claude-sonnet-4-20250514': { input: 3.00, output: 15.00 },
  'gemini-2.5-pro':        { input: 1.25, output: 5.00 },
  'minimax-m3':            { input: 0.20, output: 0.80 },
  'minimax-m2.7':          { input: 0.10, output: 0.40 },
  'minimax-m2.5':          { input: 0.10, output: 0.40 },
};

function getUsageFile(): string {
  return path.join(dataDir(), 'usage.jsonl');
}

/** Append a usage record to the log. */
export function recordUsage(record: UsageRecord): void {
  const file = getUsageFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(record) + '\n', 'utf-8');
}

/** Calculate cost for a given model and token counts. */
export function calculateCost(model: string | undefined, promptTokens: number, completionTokens: number): number {
  if (!model) return 0;
  const key = model.toLowerCase();
  const costs = MODEL_COSTS[key];
  if (!costs) return 0;
  return (promptTokens * costs.input + completionTokens * costs.output) / 1_000_000;
}

/** Read all usage records for a user, optionally filtered. */
function readRecords(query: UsageQuery): UsageRecord[] {
  const file = getUsageFile();
  if (!fs.existsSync(file)) return [];

  const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean);
  const records: UsageRecord[] = [];

  for (const line of lines) {
    try {
      const r = JSON.parse(line) as UsageRecord;
      if (r.userId !== query.userId) continue;
      if (query.from && r.ts < query.from) continue;
      if (query.to && r.ts > query.to) continue;
      if (query.model && r.model !== query.model) continue;
      if (query.provider && r.provider !== query.provider) continue;
      if (query.sessionId && r.sessionId !== query.sessionId) continue;
      records.push(r);
    } catch { /* skip malformed lines */ }
  }

  return records;
}

/** Aggregate usage records into a summary. */
export function aggregateUsage(query: UsageQuery): UsageSummary {
  const records = readRecords(query);

  let totalTokens = 0, promptTokens = 0, completionTokens = 0, reasoningTokens = 0;
  let totalCostUsd = 0, totalToolCalls = 0, errorCount = 0;
  let userMessages = 0, assistantMessages = 0;
  const modelMap = new Map<string, { cost: number; tokens: number; messages: number }>();
  const providerMap = new Map<string, { cost: number; tokens: number; messages: number }>();
  const toolMap = new Map<string, number>();
  const sessionSet = new Set<string>();
  const dailyMap = new Map<string, { messages: number; tokens: number; cost: number }>();

  for (const r of records) {
    totalTokens += r.totalTokens;
    promptTokens += r.promptTokens;
    completionTokens += r.completionTokens;
    reasoningTokens += r.reasoningTokens;
    totalCostUsd += r.costUsd;
    totalToolCalls += r.toolCalls.length;
    if (r.isError) errorCount++;
    sessionSet.add(r.sessionId);

    if (r.role === 'user') userMessages++;
    else assistantMessages++;

    // Model aggregation
    if (r.model) {
      const m = modelMap.get(r.model) || { cost: 0, tokens: 0, messages: 0 };
      m.cost += r.costUsd;
      m.tokens += r.totalTokens;
      m.messages++;
      modelMap.set(r.model, m);
    }

    // Provider aggregation
    if (r.provider) {
      const p = providerMap.get(r.provider) || { cost: 0, tokens: 0, messages: 0 };
      p.cost += r.costUsd;
      p.tokens += r.totalTokens;
      p.messages++;
      providerMap.set(r.provider, p);
    }

    // Tool aggregation
    for (const tool of r.toolCalls) {
      toolMap.set(tool, (toolMap.get(tool) || 0) + 1);
    }

    // Daily breakdown
    const date = r.ts.slice(0, 10);
    const d = dailyMap.get(date) || { messages: 0, tokens: 0, cost: 0 };
    d.messages++;
    d.tokens += r.totalTokens;
    d.cost += r.costUsd;
    dailyMap.set(date, d);
  }

  const totalMessages = userMessages + assistantMessages;

  return {
    totalMessages,
    userMessages,
    assistantMessages,
    totalTokens,
    promptTokens,
    completionTokens,
    reasoningTokens,
    totalCostUsd,
    totalToolCalls,
    uniqueTools: toolMap.size,
    avgTokensPerMessage: totalMessages > 0 ? Math.round(totalTokens / totalMessages) : 0,
    avgCostPerMessage: totalMessages > 0 ? totalCostUsd / totalMessages : 0,
    errorCount,
    sessionCount: sessionSet.size,
    topModels: [...modelMap.entries()]
      .map(([model, d]) => ({ model, ...d }))
      .sort((a, b) => b.cost - a.cost),
    topProviders: [...providerMap.entries()]
      .map(([provider, d]) => ({ provider, ...d }))
      .sort((a, b) => b.cost - a.cost),
    topTools: [...toolMap.entries()]
      .map(([tool, count]) => ({ tool, count }))
      .sort((a, b) => b.count - a.count),
    dailyBreakdown: [...dailyMap.entries()]
      .map(([date, d]) => ({ date, ...d }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}
