// ====== LLM Types ======
// OpenAI-compatible message and tool types for the agent loop.

export type LLMRole = 'system' | 'user' | 'assistant' | 'tool';

// ── Multimodal content blocks (OpenAI vision format) ──
export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ImageUrlBlock {
  type: 'image_url';
  image_url: { url: string; detail?: 'auto' | 'low' | 'high' };
}

export interface VideoUrlBlock {
  type: 'video_url';
  video_url: { url: string };
}

export type ContentBlock = TextBlock | ImageUrlBlock | VideoUrlBlock;

export interface LLMMessage {
  role: LLMRole;
  /** string for text-only, array for multimodal (OpenAI vision format). */
  content: string | ContentBlock[] | null;
  tool_calls?: LLMToolCall[];
  tool_call_id?: string;  // for role='tool'
  name?: string;          // for role='tool'
}

export interface LLMToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;  // JSON string
  };
}

export interface LLMToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parameters: any;  // JSON Schema object
  };
}

export interface LLMCompletionRequest {
  model: string;
  messages: LLMMessage[];
  tools?: LLMToolDefinition[];
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  stream: boolean;
  stream_options?: { include_usage?: boolean };
  temperature?: number;
  max_tokens?: number;
  /** Extra provider-specific body fields (e.g. thinking for DeepSeek). */
  extra_body?: Record<string, unknown>;
}

export interface LLMStreamChunk {
  id: string;
  choices: {
    index: number;
    delta: {
      role?: string;
      content?: string | null;
      tool_calls?: {
        index: number;
        id?: string;
        type?: 'function';
        function?: {
          name?: string;
          arguments?: string;
        };
      }[];
      /** MiniMax interleaved thinking blocks. */
      reasoning_details?: Array<{
        type: string;
        id?: string;
        format?: string;
        index?: number;
        thinking?: string;
      }>;
    };
    finish_reason: 'stop' | 'tool_calls' | 'length' | null;
  }[];
}

/** Parsed result from consuming a full streaming response. */
/** Parsed result from consuming a full streaming response. */
export interface LLMStreamResult {
  content: string;
  toolCalls: LLMToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'max_tokens';
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number; reasoningTokens?: number };
  /** Accumulated thinking/reasoning content (MiniMax interleaved thinking). */
  thinking?: string;
}

/** Callback for incremental streaming events. */
export interface LLMStreamCallbacks {
  onTextDelta?: (delta: string, accumulated: string) => void;
  onToolCallDelta?: (index: number, id: string | undefined, name: string | undefined, argsDelta: string) => void;
  onFinish?: (result: LLMStreamResult) => void;
  onError?: (error: Error) => void;
  /** Called when usage data arrives (typically in the last SSE chunk). */
  onUsage?: (usage: { promptTokens: number; completionTokens: number; totalTokens: number; reasoningTokens?: number }) => void;
  /** Called when thinking/reasoning content arrives (MiniMax interleaved thinking). */
  onThinkingDelta?: (delta: string, accumulated: string) => void;
}
