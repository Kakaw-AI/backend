import { createHash } from 'node:crypto';

/**
 * Question normalization and hashing for query memory.
 *
 * `normalizeQuestion` MUST stay byte-identical to the agent's own
 * `normalizeQuestion` in `kakaw-agent/src/llm/cache.ts`. The two caches key on
 * the same notion of "the same question", and if they drift the persistent
 * memory and the in-process plan cache will disagree about what a hit is.
 */
export function normalizeQuestion(message: string): string {
  return message.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Stable key for one question against one data source. */
export function questionHash(
  databaseSourceId: string,
  normalizedQuestion: string,
): string {
  return createHash('sha256')
    .update(databaseSourceId)
    .update('\0')
    .update(normalizedQuestion)
    .digest('hex');
}

const QUOTED = /"([^"]{2,64})"|'([^']{2,64})'|`([^`]{2,64})`/g;
const CAPITALIZED_RUN = /\b([A-Z][\w&.-]*(?:\s+[A-Z][\w&.-]*)*)\b/g;
const ALL_CAPS = /\b([A-Z]{2,}(?:[-_][A-Z0-9]{2,})*)\b/g;

const STOPWORD_CAPS = new Set([
  'I',
  'A',
  'THE',
  'SQL',
  'ID',
  'US',
  'UK',
  'EU',
]);

/**
 * Candidate filter values mentioned in a question — the things a user is
 * likely asking us to match against a column, e.g. "Acme Corp" or 'pending'.
 *
 * Precision matters more than recall here: each literal becomes a lookup, and
 * a junk literal produces a misleading value hint. Sentence-initial words are
 * dropped because capitalization there carries no signal.
 */
export function extractLiterals(question: string): string[] {
  const found = new Set<string>();
  const trimmed = question.trim();

  for (const match of trimmed.matchAll(QUOTED)) {
    const value = match[1] ?? match[2] ?? match[3];
    if (value?.trim()) {
      found.add(value.trim());
    }
  }

  const firstWord = trimmed.split(/\s+/)[0] ?? '';

  for (const match of trimmed.matchAll(CAPITALIZED_RUN)) {
    const value = match[1]?.trim();
    if (!value || value.length < 3) {
      continue;
    }
    // A capitalized first word is just sentence case.
    if (value === firstWord) {
      continue;
    }
    if (STOPWORD_CAPS.has(value.toUpperCase())) {
      continue;
    }
    found.add(value);
  }

  for (const match of trimmed.matchAll(ALL_CAPS)) {
    const value = match[1]?.trim();
    if (value && value.length >= 2 && !STOPWORD_CAPS.has(value)) {
      found.add(value);
    }
  }

  return [...found];
}
