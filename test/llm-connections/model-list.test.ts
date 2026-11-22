import { describe, expect, it } from 'vitest';
import { parseModelList } from '../../src/llm-connections/llm-connections.types';

describe('parseModelList', () => {
  it('keeps OpenAI chat models, newest first', () => {
    const payload = {
      data: [
        { id: 'gpt-6.1-terra', created: 1_780_000_000 },
        { id: 'text-embedding-3-large', created: 1_790_000_000 },
        { id: 'gpt-6.2-sol', created: 1_795_000_000 },
        { id: 'whisper-1', created: 1_700_000_000 },
        { id: 'gpt-image-2', created: 1_796_000_000 },
      ],
    };
    expect(parseModelList('openai', payload)).toEqual(['gpt-6.2-sol', 'gpt-6.1-terra']);
  });

  it('keeps Gemini models that generate content and drops the models/ prefix', () => {
    const payload = {
      models: [
        { name: 'models/gemini-4-hydrogen', supportedGenerationMethods: ['generateContent', 'countTokens'] },
        { name: 'models/gemini-embedding-2', supportedGenerationMethods: ['embedContent'] },
        { name: 'models/gemini-3.8-flash-tts', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
      ],
    };
    expect(parseModelList('google', payload)).toEqual(['gemini-4-hydrogen', 'gemini-3.8-flash']);
  });

  it('sorts Anthropic models by their creation date', () => {
    const payload = {
      data: [
        { id: 'claude-haiku-5-5', created_at: '2026-08-01T00:00:00Z' },
        { id: 'claude-opus-5-5', created_at: '2026-10-01T00:00:00Z' },
      ],
    };
    expect(parseModelList('anthropic', payload)).toEqual(['claude-opus-5-5', 'claude-haiku-5-5']);
  });

  it('lists everything a local server runs, unfiltered and deduplicated', () => {
    const payload = { data: [{ id: 'qwen3-9b' }, { id: 'nomic-embed-text' }, { id: 'qwen3-9b' }] };
    expect(parseModelList('lm-studio', payload)).toEqual(['qwen3-9b', 'nomic-embed-text']);
  });

  it('returns nothing for an unexpected response', () => {
    expect(parseModelList('openai', null)).toEqual([]);
    expect(parseModelList('google', { error: 'nope' })).toEqual([]);
  });
});
