// ====== Model Catalog ======
// Preset configurations for known models, inspired by OpenClaw's provider catalog.
// Each preset defines default contextWindow, maxTokens, reasoning support, etc.
// Users can override these per-model in the settings UI.

export interface ModelPreset {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
}

export const MODEL_PRESETS: ModelPreset[] = [
  // DeepSeek
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    contextWindow: 1_000_000,
    maxTokens: 384_000,
    reasoning: true,
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    contextWindow: 1_000_000,
    maxTokens: 384_000,
    reasoning: true,
  },
  {
    id: 'deepseek-chat',
    name: 'DeepSeek Chat',
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    contextWindow: 131_072,
    maxTokens: 8_192,
    reasoning: false,
  },
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek Reasoner',
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    contextWindow: 131_072,
    maxTokens: 65_536,
    reasoning: true,
  },
  // OpenAI
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    baseUrl: 'https://api.openai.com',
    contextWindow: 128_000,
    maxTokens: 16_384,
    reasoning: false,
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'openai',
    baseUrl: 'https://api.openai.com',
    contextWindow: 128_000,
    maxTokens: 16_384,
    reasoning: false,
  },
  // Anthropic
  {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    provider: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    contextWindow: 200_000,
    maxTokens: 64_000,
    reasoning: false,
  },
  // Google
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com',
    contextWindow: 1_048_576,
    maxTokens: 65_536,
    reasoning: true,
  },
  // MiniMax (model names must match the official API exactly)
  {
    id: 'MiniMax-M3',
    name: 'MiniMax-M3',
    provider: 'minimax',
    baseUrl: 'https://api.minimaxi.com',
    contextWindow: 1_000_000,
    maxTokens: 65_536,
    reasoning: true,
  },
  {
    id: 'MiniMax-M2.7',
    name: 'MiniMax-M2.7',
    provider: 'minimax',
    baseUrl: 'https://api.minimaxi.com',
    contextWindow: 204_800,
    maxTokens: 65_536,
    reasoning: false,
  },
  {
    id: 'MiniMax-M2.5',
    name: 'MiniMax-M2.5',
    provider: 'minimax',
    baseUrl: 'https://api.minimaxi.com',
    contextWindow: 204_800,
    maxTokens: 65_536,
    reasoning: false,
  },
  {
    id: 'MiniMax-M2',
    name: 'MiniMax-M2',
    provider: 'minimax',
    baseUrl: 'https://api.minimaxi.com',
    contextWindow: 204_800,
    maxTokens: 65_536,
    reasoning: false,
  },
  // Xiaomi MiMo
  {
    id: 'mimo-v2.5-pro',
    name: 'MiMo V2.5 Pro',
    provider: 'xiaomi',
    baseUrl: '',  // User must configure BASE_URL
    contextWindow: 128_000,
    maxTokens: 65_536,
    reasoning: false,
  },
];

/**
 * Find a preset by model id (case-insensitive).
 */
export function findPreset(modelId: string): ModelPreset | undefined {
  const lower = modelId.toLowerCase();
  return MODEL_PRESETS.find(
    (p) => p.id.toLowerCase() === lower || p.id.toLowerCase().startsWith(lower),
  );
}

/**
 * Get default config for a model. Falls back to sensible defaults if not in catalog.
 */
export function getModelDefaults(modelId: string): { contextWindow: number; maxTokens: number; reasoning: boolean } {
  const preset = findPreset(modelId);
  if (preset) {
    return { contextWindow: preset.contextWindow, maxTokens: preset.maxTokens, reasoning: preset.reasoning };
  }
  // Sensible defaults for unknown models.
  return { contextWindow: 128_000, maxTokens: 8_192, reasoning: false };
}
