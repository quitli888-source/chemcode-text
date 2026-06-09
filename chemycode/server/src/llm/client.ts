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

  let res: Response;
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
    const msg = e instanceof Error ? e.message : String(e);
    callbacks.onError?.(new Error(`LLM network error: ${msg}`));
    throw e;
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    const msg = `LLM API error ${res.status}: ${errText.slice(0, 200)}`;
    callbacks.onError?.(new Error(msg));
    throw new Error(msg);
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
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
        'api-key': config.apiKey,  // Support Azure/MiMo-style api-key header.
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`LLM API error ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json() as {
      choices: { message: { content: string | null; tool_calls?: LLMToolCall[] }; finish_reason: string }[];
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
    };
  } catch (e) {
    throw e;
  }
}
