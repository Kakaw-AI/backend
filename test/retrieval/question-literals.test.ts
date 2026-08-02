import { describe, expect, it } from 'vitest';
import {
  extractLiterals,
  normalizeQuestion,
  questionHash,
} from '../../src/retrieval/question-literals';

describe('normalizeQuestion', () => {
  it('matches the agent plan cache exactly: trim, lowercase, collapse spaces', () => {
    // Must stay byte-identical to normalizeQuestion in
    // kakaw-agent/src/llm/cache.ts, or the persistent memory and the
    // in-process cache will disagree about what counts as the same question.
    expect(normalizeQuestion('  Total   Revenue By Region  ')).toBe(
      'total revenue by region',
    );
    expect(normalizeQuestion('a\tb\nc')).toBe('a b c');
    expect(normalizeQuestion('')).toBe('');
  });

  it('does not strip punctuation, which the agent also keeps', () => {
    expect(normalizeQuestion('How many orders?')).toBe('how many orders?');
  });
});

describe('questionHash', () => {
  it('is stable and scoped to the source', () => {
    const a = questionHash('src-1', 'total revenue');
    expect(questionHash('src-1', 'total revenue')).toBe(a);
    expect(questionHash('src-2', 'total revenue')).not.toBe(a);
    expect(questionHash('src-1', 'total revenues')).not.toBe(a);
  });

  it('cannot be confused by the separator', () => {
    // Without a delimiter, ("ab","c") and ("a","bc") would collide.
    expect(questionHash('ab', 'c')).not.toBe(questionHash('a', 'bc'));
  });
});

describe('extractLiterals', () => {
  it('picks up quoted values', () => {
    expect(extractLiterals(`orders from "Acme Corp"`)).toContain('Acme Corp');
    expect(extractLiterals(`status is 'pending'`)).toContain('pending');
  });

  it('picks up capitalized names mid-sentence', () => {
    expect(extractLiterals('how many orders from Acme Corp')).toContain(
      'Acme Corp',
    );
  });

  it('ignores a capitalized first word, which is just sentence case', () => {
    expect(extractLiterals('Show me all orders')).toEqual([]);
  });

  it('ignores common capitalized noise', () => {
    expect(extractLiterals('what is the ID for A record')).toEqual([]);
  });

  it('returns nothing for an ordinary lowercase question', () => {
    expect(extractLiterals('total revenue by region last quarter')).toEqual([]);
  });
});
