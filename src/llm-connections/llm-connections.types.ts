import { LlmProvider } from '@prisma/client';

export const SUPPORTED_LLM_PROVIDERS = [
  'openai',
  'anthropic',
  'openrouter',
  'google',
  'ollama',
  'lm-studio',
] as const;

export type SupportedLlmProvider = (typeof SUPPORTED_LLM_PROVIDERS)[number];

export type CreateLlmConnectionInput = {
  provider: SupportedLlmProvider;
  displayName?: string;
  defaultModel?: string;
  apiKey?: string;
  baseUrl?: string;
  /** Use the key saved on this connection of the user's instead of typing it again. */
  reuseKeyFromConnectionId?: string;
};

export type ListProviderModelsInput = Omit<CreateLlmConnectionInput, 'displayName' | 'defaultModel'>;

export type LlmConnectionAction = 'activate' | 'deactivate' | 'delete';

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

export function isSupportedLlmProvider(
  value: string,
): value is SupportedLlmProvider {
  return SUPPORTED_LLM_PROVIDERS.includes(value as SupportedLlmProvider);
}

function assertUnreachable(value: never): never {
  throw new Error(`Unsupported LLM provider: ${String(value)}`);
}

export function toPrismaLlmProvider(provider: SupportedLlmProvider): LlmProvider {
  switch (provider) {
    case 'openai':
      return LlmProvider.OPENAI;
    case 'anthropic':
      return LlmProvider.ANTHROPIC;
    case 'openrouter':
      return LlmProvider.OPENROUTER;
    case 'google':
      return LlmProvider.GOOGLE;
    case 'ollama':
      return LlmProvider.OLLAMA;
    case 'lm-studio':
      return LlmProvider.LM_STUDIO;
  }

  return assertUnreachable(provider);
}

export function fromPrismaLlmProvider(provider: LlmProvider): SupportedLlmProvider {
  switch (provider) {
    case LlmProvider.OPENAI:
      return 'openai';
    case LlmProvider.ANTHROPIC:
      return 'anthropic';
    case LlmProvider.OPENROUTER:
      return 'openrouter';
    case LlmProvider.GOOGLE:
      return 'google';
    case LlmProvider.OLLAMA:
      return 'ollama';
    case LlmProvider.LM_STUDIO:
      return 'lm-studio';
  }

  return assertUnreachable(provider);
}

export function providerTakesOptionalApiKey(provider: SupportedLlmProvider) {
  return provider === 'ollama' || provider === 'lm-studio';
}

export function normalizeBaseUrl(value?: string | null) {
  return value?.trim().replace(/\/+$/, '') || null;
}

export function getEffectiveRuntimeBaseUrl(
  provider: SupportedLlmProvider,
  value?: string | null,
) {
  if (provider === 'ollama') {
    return normalizeBaseUrl(value) ?? 'http://127.0.0.1:11434/v1';
  }

  if (provider === 'lm-studio') {
    return normalizeBaseUrl(value) ?? 'http://127.0.0.1:1234/v1';
  }

  if (provider !== 'openai') {
    return null;
  }

  return normalizeBaseUrl(value) ?? DEFAULT_OPENAI_BASE_URL;
}

export function buildDefaultDisplayName(
  provider: SupportedLlmProvider,
  defaultModel: string,
) {
  const providerLabel = provider
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

  return `${providerLabel} · ${defaultModel}`;
}

// Models a chat cannot use: embeddings, speech, images, video, moderation and
// the like. Only applied to the big providers; OpenRouter, Ollama and LM Studio
// list what the user chose to run.
const NON_CHAT_MODEL =
  /embed|whisper|tts|dall-e|moderation|image|audio|realtime|transcribe|davinci|babbage|search|sora|speech|computer-use|rerank|lyria|genie|imagen|veo|banana|omni|decision|robotics|live|deep-research|antigravity|aqa/i;

const MAX_LISTED_MODELS = 500;

type ListedModel = { id?: unknown; name?: unknown; created?: unknown; created_at?: unknown; supportedGenerationMethods?: unknown };

/**
 * Model ids from a provider's model-list response, chat models only, newest
 * first where the provider says when a model was created.
 */
export function parseModelList(provider: SupportedLlmProvider, payload: unknown): string[] {
  const body = (payload ?? {}) as { data?: ListedModel[]; models?: ListedModel[] };
  const items: ListedModel[] = Array.isArray(body.data) ? body.data : Array.isArray(body.models) ? body.models : [];

  const listed = items
    .filter((item) =>
      provider !== 'google' ||
      (Array.isArray(item.supportedGenerationMethods) && item.supportedGenerationMethods.includes('generateContent')),
    )
    .map((item, index) => {
      const raw = typeof item.id === 'string' ? item.id : typeof item.name === 'string' ? item.name : '';
      const created =
        typeof item.created === 'number'
          ? item.created * 1000
          : typeof item.created_at === 'string'
            ? Date.parse(item.created_at)
            : NaN;
      return { id: raw.replace(/^models\//, '').trim(), created, index };
    })
    .filter((model) => model.id);

  const filtered =
    provider === 'openai' || provider === 'anthropic' || provider === 'google'
      ? listed.filter((model) => !NON_CHAT_MODEL.test(model.id))
      : listed;

  const sorted = filtered.some((model) => Number.isFinite(model.created))
    ? [...filtered].sort((a, b) => (b.created || 0) - (a.created || 0) || a.index - b.index)
    : filtered;

  return [...new Set(sorted.map((model) => model.id))].slice(0, MAX_LISTED_MODELS);
}

