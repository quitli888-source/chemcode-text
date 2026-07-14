// ====== LLM Client ======
// OpenAI-compatible streaming client with function calling support.
// Supports: OpenAI, DeepSeek, Anthropic (via OpenAI-compatible proxy),
//           Google (via OpenAI-compatible proxy), and any provider that
//           implements the /v1/chat/completions endpoint.
//
// Reference: OpenClaw model-transport/provider-transport-stream.ts pattern.

import type {
  LLMCompletionRequest,
  LLMMessage,
  LLMStreamCallbacks,
  LLMStreamChunk,
  LLMStreamResult,
  LLMToolCall,
  LLMToolDefinition,
} from './types.js';

/**
 * Retry configuration for transient failures (429 rate-limit / 5xx).
 *
 * The upstream model provider may enforce a hard per-minute quota (e.g.
 * "3 times per minute"). We cannot remove that server-side limit, but we
 * CAN absorb transient throttling on the client so a single 429 does not
 * blow up the whole agent task. We retry with exponential backoff and
 * honour the provider's `Retry-After` header when present.
 *
 * TUNED for ModelArts (3 req/min limit):
 *   - MAX_RETRIES = 8 (unchanged): the global rate limiter below ensures
 *     retries are properly spaced, so 8 retries won't cause cascading 429s.
 *   - BASE_BACKOFF = 3000ms: aligned to the 3/min window (20s apart).
 *   - MAX_BACKOFF = 20000ms: cap at one quota window.
 *   - The global rate limiter ensures we never exceed 3 req/min
 *     across ALL concurrent calls (agent loop, retries, compaction, etc).
 *     Retries that would exceed the quota simply WAIT for a slot.
 */
const LLM_MAX_RETRIES = 8;
const LLM_BASE_BACKOFF_MS = 3000; // 3s base — aligned to 3/min quota window.
const LLM_MAX_BACKOFF_MS = 20000; // Cap at ~1 quota window.

// ── Global Rate Limiter ──
// DISABLED: User is switching to a different model provider.
// To re-enable, set RATE_LIMIT_ENABLED = true and adjust constants.
const RATE_LIMIT_ENABLED = false;
// ModelArts enforces a hard "3 times per minute" quota. Without a global
// limiter, concurrent calls (agent loop + retries + compaction + auto-continue)
// all fight for the same quota, causing cascading 429s.
// This limiter tracks timestamps of recent calls and blocks until a slot
// opens, ensuring we NEVER exceed the configured rate.
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute rolling window.
const RATE_LIMIT_MAX_CALLS = 3;     // ModelArts default: 3 calls per minute.
const RATE_LIMIT_MAX_TOKENS = 28_000; // ModelArts also has 30K tokens/min limit.
const recentCallTimestamps: number[] = [];
let recentTokenEstimate = 0;  // Estimated tokens consumed in the current window.

/**
 * Wait until a rate-limit slot is available, then record the call.
 * This is called BEFORE every fetch() to proactively prevent 429s.
 */
async function acquireRateLimitSlot(): Promise<void> {
  if (!RATE_LIMIT_ENABLED) return; // Rate limiting disabled.
  while (true) {
    const now = Date.now();
    // Prune timestamps older than the window.
    while (recentCallTimestamps.length > 0 && now - recentCallTimestamps[0] >= RATE_LIMIT_WINDOW_MS) {
      recentCallTimestamps.shift();
      // Token estimate also resets when the oldest call exits the window.
      // This is approximate - real per-call token usage is tracked via onUsage.
    }
    // Check both call count AND token estimate limits.
    const callSlotAvailable = recentCallTimestamps.length < RATE_LIMIT_MAX_CALLS;
    const tokenSlotAvailable = recentTokenEstimate < RATE_LIMIT_MAX_TOKENS;
    if (callSlotAvailable && tokenSlotAvailable) {
      // Slot available — record and proceed.
      recentCallTimestamps.push(now);
      return;
    }
    // Wait until the oldest timestamp exits the window.
    const waitMs = RATE_LIMIT_WINDOW_MS - (now - recentCallTimestamps[0]) + 100; // +100ms buffer
    const actualWait = Math.min(waitMs, RATE_LIMIT_WINDOW_MS);
    const reason = !callSlotAvailable ? recentCallTimestamps.length + '/' + RATE_LIMIT_MAX_CALLS + ' calls' : recentTokenEstimate + '/' + RATE_LIMIT_MAX_TOKENS + ' tokens';
      console.warn('[llm] rate limiter: ' + reason + ' in window, waiting ' + Math.round(actualWait / 1000) + 's...');
    await sleep(actualWait);
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Compute backoff delay for a given attempt, honouring Retry-After if provided.
 */
function backoffMs(attempt: number, retryAfterHeader?: string | null): number {
  if (retryAfterHeader) {
    const secs = Number(retryAfterHeader);
    if (!Number.isNaN(secs) && secs > 0) return Math.min(secs * 1000, LLM_MAX_BACKOFF_MS);
  }
  const exp = LLM_BASE_BACKOFF_MS * Math.pow(2, attempt);
  // Jitter ±20% to avoid thundering-herd retries.
  const jitter = exp * (0.8 + Math.random() * 0.4);
  return Math.min(jitter, LLM_MAX_BACKOFF_MS);
}

export interface LLMClientConfig {
  apiUrl: string;     // e.g. https://api.deepseek.com
  apiKey: string;
  model: string;      // e.g. deepseek-chat
  provider?: string;  // deepseek | openai | anthropic | google | other
  temperature?: number;
  maxTokens?: number;
  /** Extra body fields merged into every request (e.g. {thinking: {type: "enabled"}}). */
  extraBody?: Record<string, unknown>;
}

/**
 * Stream a chat completion with function calling support.
 *
 * The callback receives incremental text deltas and tool call deltas
 * as they arrive from the provider. Returns the final assembled result.
 *
 * Follows the OpenClaw pattern of yielding intermediate events so the
 * frontend can display real-time progress.
 */
export async function streamChatCompletion(
  config: LLMClientConfig,
  messages: LLMMessage[],
  tools: LLMToolDefinition[],
  callbacks: LLMStreamCallbacks = {},
  signal?: AbortSignal,
): Promise<LLMStreamResult> {
  if (!config.apiKey) {
    throw new Error('LLM API key is required');
  }
  // Normalize apiUrl: strip trailing slashes and trailing /v1 to avoid double /v1/v1/...
  const normalizedUrl = config.apiUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
  const url = `${normalizedUrl}/v1/chat/completions`;

  const body: LLMCompletionRequest = {
    model: config.model,
    messages,
    stream: true,
    temperature: config.temperature ?? 0.7,
    stream_options: { include_usage: true },
    ...(tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
    ...(config.extraBody || {}),
  };

  const controller = new AbortController();

  // Forward caller's abort signal.
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }

  let res: Response | undefined;
  let attempt = 0;
  while (true) {
    // Acquire a rate-limit slot BEFORE EVERY API call (first attempt + retries).
    // This proactively prevents 429s by ensuring we never exceed
    // the provider's per-minute quota across all concurrent calls.
    await acquireRateLimitSlot();
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
          'api-key': config.apiKey,  // Support Azure/MiMo-style api-key header.
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      // Network-level error: retry a few times (may be transient).
      // But don't retry if the abort signal fired (WebSocket disconnected).
      const isAbort = e instanceof Error && e.name === 'AbortError';
      if (attempt < LLM_MAX_RETRIES && !controller.signal.aborted && !isAbort) {
        const wait = backoffMs(attempt);
        console.warn(`[llm] network error (attempt ${attempt + 1}/${LLM_MAX_RETRIES}), retrying in ${Math.round(wait)}ms: ${(e as Error).message}`);
        await sleep(wait);
        attempt++;
        continue;
      }
      const msg = e instanceof Error ? e.message : String(e);
      callbacks.onError?.(new Error(`LLM network error: ${msg}`));
      throw e;
    }

    if (res.ok) break; // Success — proceed to stream parsing.

    // Non-2xx: retry only on transient statuses (429 / 5xx).
    const errText = await res.text().catch(() => '');
    const retryAfter = res.headers.get('retry-after');
    if (isRetryableStatus(res.status) && attempt < LLM_MAX_RETRIES && !controller.signal.aborted) {
      const wait = backoffMs(attempt, retryAfter);
      console.warn(`[llm] upstream ${res.status} (attempt ${attempt + 1}/${LLM_MAX_RETRIES}), retrying in ${Math.round(wait)}ms${retryAfter ? ` (Retry-After=${retryAfter}s)` : ''}`);
      await sleep(wait);
      attempt++;
      continue;
    }

    const msg = `LLM API error ${res.status}: ${errText.slice(0, 200)}`;
    callbacks.onError?.(new Error(msg));
    throw new Error(msg);
  }

  if (!res) {
    throw new Error('LLM request failed after retries');
  }

  if (!res.body) {
    throw new Error('LLM API returned no body');
  }

  // ---------- Parse SSE stream ----------
  // OpenAI-compatible providers send:
  //   data: {"id":"...","choices":[{"delta":{"content":"hi"},...}],...}
  //   data: [DONE]

  const result: LLMStreamResult = {
    content: '',
    toolCalls: [],
    finishReason: 'stop',
    thinking: '',
  };

  // Accumulate tool call arguments across chunks.
  const toolCallAccum: Map<number, { id: string; name: string; args: string }> = new Map();

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE lines.
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer.

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue; // Skip empty lines and comments.
        if (trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;

        const jsonStr = trimmed.slice(6);
        let chunk: LLMStreamChunk & { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; completion_tokens_details?: { reasoning_tokens?: number } } };
        try {
          chunk = JSON.parse(jsonStr);
        } catch {
          continue; // Skip malformed chunks.
        }

        // Capture usage data (typically in the last chunk when stream_options.include_usage is set).
        if (chunk.usage) {
          result.usage = {
            promptTokens: chunk.usage.prompt_tokens ?? 0,
            completionTokens: chunk.usage.completion_tokens ?? 0,
            totalTokens: chunk.usage.total_tokens ?? 0,
            reasoningTokens: chunk.usage.completion_tokens_details?.reasoning_tokens ?? 0,
          };
          callbacks.onUsage?.(result.usage);
        }

        const choice = chunk.choices?.[0];
        if (!choice) continue;

        // Text delta.
        if (choice.delta?.content) {
          result.content += choice.delta.content;
          callbacks.onTextDelta?.(choice.delta.content, result.content);
        }

        // Reasoning content (DeepSeek-R1, Qwen-QwQ, ModelArts reasoning models).
        // This is the standard OpenAI-compatible field for thinking/reasoning.
        if (choice.delta?.reasoning_content) {
          result.thinking = (result.thinking || '') + choice.delta.reasoning_content;
          callbacks.onThinkingDelta?.(choice.delta.reasoning_content, result.thinking);
        }

        // MiniMax interleaved thinking (reasoning_details).
        if (choice.delta?.reasoning_details) {
          for (const rd of choice.delta.reasoning_details) {
            if (rd.thinking) {
              result.thinking = (result.thinking || '') + rd.thinking;
              callbacks.onThinkingDelta?.(rd.thinking, result.thinking);
            }
          }
        }

        // Tool call deltas.
        if (choice.delta?.tool_calls) {
          for (const tc of choice.delta.tool_calls) {
            const idx = tc.index;
            let acc = toolCallAccum.get(idx);
            if (!acc) {
              acc = { id: tc.id || `call_${idx}`, name: '', args: '' };
              toolCallAccum.set(idx, acc);
            }
            if (tc.id) acc.id = tc.id;
            if (tc.function?.name) acc.name = tc.function.name;
            if (tc.function?.arguments) {
              acc.args += tc.function.arguments;
              callbacks.onToolCallDelta?.(idx, acc.id, acc.name || undefined, tc.function.arguments);
            }
          }
        }

        // Finish reason.
        if (choice.finish_reason) {
          result.finishReason = choice.finish_reason as LLMStreamResult['finishReason'];
        }
      }
    }
  } catch (e) {
    // Handle abort in both browser (DOMException) and Node.js (AbortError).
    const isAbort =
      (typeof DOMException !== 'undefined' && e instanceof DOMException && e.name === 'AbortError') ||
      (e instanceof Error && e.name === 'AbortError');
    if (isAbort) {
      callbacks.onError?.(new Error('LLM request aborted'));
    }
    throw e;
  }

  // Assemble tool calls.
  for (const [idx, acc] of toolCallAccum) {
    result.toolCalls.push({
      id: acc.id,
      type: 'function',
      function: {
        name: acc.name,
        arguments: acc.args,
      },
    });
  }

  callbacks.onFinish?.(result);
  return result;
}

/**
 * Non-streaming chat completion (for simple calls like tool result processing).
 */
export async function chatCompletion(
  config: LLMClientConfig,
  messages: LLMMessage[],
  tools: LLMToolDefinition[] = [],
  signal?: AbortSignal,
): Promise<LLMStreamResult> {
  if (!config.apiKey) {
    throw new Error('LLM API key is required');
  }
  // Normalize apiUrl: strip trailing slashes and trailing /v1 to avoid double /v1/v1/...
  const normalizedUrl = config.apiUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
  const url = `${normalizedUrl}/v1/chat/completions`;

  const body: LLMCompletionRequest = {
    model: config.model,
    messages,
    stream: false,
    temperature: config.temperature ?? 0.7,
    ...(tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
    // Do NOT send max_tokens — let the API use its own defaults to avoid truncation.
    // ...(config.maxTokens ? { max_tokens: config.maxTokens } : {}),
    ...(config.extraBody || {}),
  };

  const ctrl = new AbortController();

  if (signal) {
    if (signal.aborted) ctrl.abort(signal.reason);
    else signal.addEventListener('abort', () => ctrl.abort(signal.reason), { once: true });
  }

  try {
    let res: Response | undefined;
    let attempt = 0;
    while (true) {
      // Acquire a rate-limit slot BEFORE EVERY API call (first attempt + retries).
      await acquireRateLimitSlot();
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
            'api-key': config.apiKey,  // Support Azure/MiMo-style api-key header.
          },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
      } catch (e) {
        if (attempt < LLM_MAX_RETRIES && !ctrl.signal.aborted) {
          const wait = backoffMs(attempt);
          console.warn(`[llm] network error (attempt ${attempt + 1}/${LLM_MAX_RETRIES}), retrying in ${Math.round(wait)}ms: ${(e as Error).message}`);
          await sleep(wait);
          attempt++;
          continue;
        }
        throw e;
      }

      if (res.ok) break;

      const errText = await res.text().catch(() => '');
      const retryAfter = res.headers.get('retry-after');
      if (isRetryableStatus(res.status) && attempt < LLM_MAX_RETRIES && !ctrl.signal.aborted) {
        const wait = backoffMs(attempt, retryAfter);
        console.warn(`[llm] upstream ${res.status} (attempt ${attempt + 1}/${LLM_MAX_RETRIES}), retrying in ${Math.round(wait)}ms${retryAfter ? ` (Retry-After=${retryAfter}s)` : ''}`);
        await sleep(wait);
        attempt++;
        continue;
      }
      throw new Error(`LLM API error ${res.status}: ${errText.slice(0, 200)}`);
    }

    if (!res) throw new Error('LLM request failed after retries');

    const data = await res.json() as {
      choices: { message: { content: string | null; tool_calls?: LLMToolCall[]; reasoning_content?: string }; finish_reason: string }[];
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };

    const choice = data.choices?.[0];
    return {
      content: choice?.message?.content || '',
      toolCalls: choice?.message?.tool_calls || [],
      finishReason: (choice?.finish_reason as LLMStreamResult['finishReason']) || 'stop',
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      } : undefined,
      thinking: choice?.message?.reasoning_content || undefined,
    };
  } catch (e) {
    throw e;
  }
}

/**
 * Record actual token usage after an LLM call completes.
 * Called from onUsage callback to track the token-per-minute limit
 * (ModelArts enforces BOTH 3 calls/min AND 30K tokens/min).
 */
export function recordTokenUsage(tokens: number): void {
  if (!RATE_LIMIT_ENABLED) return; // Rate limiting disabled.
  recentTokenEstimate += tokens;
  // Safety: if timestamps are empty but token estimate is high,
  // reset (shouldn't happen in normal operation).
  if (recentCallTimestamps.length === 0) {
    recentTokenEstimate = 0;
  }
}
