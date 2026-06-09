// ====== Provider Configuration ======
// Provider-level settings that apply to ALL models under a provider.
// This is separate from model presets (which are UI convenience defaults).
//
// Users configure model names freely — the provider config determines
// HOW to talk to the API (thinking mechanism, base URL format, etc.).

export interface ProviderConfig {
  /** Display name. */
  name: string;
  /** Default base URL for this provider's OpenAI-compatible endpoint. */
  defaultBaseUrl: string;
  /** How to enable thinking/reasoning mode. */
  thinking:
    | { type: 'none' }                                    // Provider doesn't support thinking
    | { type: 'deepseek' }                                // extraBody: { thinking: { type: 'enabled' } }
    | { type: 'minimax_reasoning_split' }                 // extraBody: { reasoning_split: true }
    | { type: 'openai_compatible' };                      // No special body needed (model handles it)
  /** Whether to always send the thinking config, even when user toggle is off. */
  alwaysSendThinkingConfig: boolean;
}

export const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  deepseek: {
    name: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com',
    thinking: { type: 'deepseek' },
    alwaysSendThinkingConfig: false,
  },
  openai: {
    name: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com',
    thinking: { type: 'openai_compatible' },
    alwaysSendThinkingConfig: false,
  },
  anthropic: {
    name: 'Anthropic',
    defaultBaseUrl: 'https://api.anthropic.com',
    thinking: { type: 'none' },
    alwaysSendThinkingConfig: false,
  },
  google: {
    name: 'Google',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    thinking: { type: 'none' },
    alwaysSendThinkingConfig: false,
  },
  minimax: {
    name: 'MiniMax',
    defaultBaseUrl: 'https://api.minimaxi.com',
    thinking: { type: 'minimax_reasoning_split' },
    // MiniMax needs reasoning_split in every request for proper
    // interleaved thinking separation, even when user toggle is off.
    alwaysSendThinkingConfig: true,
  },
  xiaomi: {
    name: 'Xiaomi (MiMo)',
    defaultBaseUrl: '',  // User must configure BASE_URL
    // MiMo uses standard OpenAI protocol, no special thinking body needed.
    thinking: { type: 'openai_compatible' },
    alwaysSendThinkingConfig: false,
  },
  other: {
    name: 'Other',
    defaultBaseUrl: '',
    thinking: { type: 'none' },
    alwaysSendThinkingConfig: false,
  },
};

/**
 * Get provider config. Falls back to 'other' for unknown providers.
 */
export function getProviderConfig(provider: string): ProviderConfig {
  const key = (provider || '').toLowerCase();
  return PROVIDER_CONFIGS[key] || PROVIDER_CONFIGS.other;
}

/**
 * Build extraBody for a given provider + thinking level.
 * Returns undefined if no extra body is needed.
 * @param thinking - false (off), true (generic on), or a level string: 'low' | 'medium' | 'high'
 */
export function buildExtraBody(provider: string, thinking: boolean | string): Record<string, unknown> | undefined {
  const cfg = getProviderConfig(provider);
  const isOn = thinking === true || (typeof thinking === 'string' && thinking !== 'off' && thinking !== '');
  const level = typeof thinking === 'string' ? thinking : (thinking ? 'medium' : 'off');

  if (cfg.thinking.type === 'none') return undefined;

  // If thinking is off and provider doesn't require always-on config, skip.
  if (!isOn && !cfg.alwaysSendThinkingConfig) return undefined;

  switch (cfg.thinking.type) {
    case 'deepseek': {
      if (!isOn) return undefined;
      // Map thinking level to DeepSeek thinking budget.
      // low = 1024, medium = 4096, high = max (omit budget for unlimited)
      const budgetMap: Record<string, number | undefined> = { low: 1024, medium: 4096, high: undefined };
      const budget = budgetMap[level] ?? 4096;
      return budget !== undefined
        ? { thinking: { type: 'enabled', budget_tokens: budget } }
        : { thinking: { type: 'enabled' } };
    }
    case 'minimax_reasoning_split':
      // Always send for MiniMax — needed for proper tool call context.
      return { reasoning_split: true };
    case 'openai_compatible':
      return undefined;
    default:
      return undefined;
  }
}
