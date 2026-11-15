import { describe, expect, it } from 'vitest';
import { FixedWindowLimiter } from '../../src/common/guards/rate-limit.guard';

describe('FixedWindowLimiter', () => {
  it('allows up to the limit, then reports how long to wait', () => {
    const limiter = new FixedWindowLimiter();
    const start = 1_000_000;

    expect(limiter.hit('user', 2, start)).toBe(0);
    expect(limiter.hit('user', 2, start + 1_000)).toBe(0);
    expect(limiter.hit('user', 2, start + 2_000)).toBe(58);
  });

  it('starts a fresh window once the old one has passed', () => {
    const limiter = new FixedWindowLimiter();
    const start = 1_000_000;

    expect(limiter.hit('user', 1, start)).toBe(0);
    expect(limiter.hit('user', 1, start + 30_000)).toBeGreaterThan(0);
    expect(limiter.hit('user', 1, start + 60_000)).toBe(0);
  });

  it('keeps separate budgets per key', () => {
    const limiter = new FixedWindowLimiter();

    expect(limiter.hit('a', 1, 0)).toBe(0);
    expect(limiter.hit('b', 1, 0)).toBe(0);
    expect(limiter.hit('a', 1, 1)).toBeGreaterThan(0);
  });
});
