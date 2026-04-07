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
};

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
