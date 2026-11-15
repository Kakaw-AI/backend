import { BadRequestException, HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { normalizeApiError } from '../../src/common/errors/error-response';

describe('normalizeApiError', () => {
  it('keeps the message of a Nest exception instead of its status label', () => {
    const error = normalizeApiError(
      new BadRequestException('Please wait 30 seconds before refreshing again.'),
    );

    expect(error.message).toBe('Please wait 30 seconds before refreshing again.');
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('INVALID_REQUEST');
  });

  it('unwraps an error object nested by an upstream service', () => {
    const error = normalizeApiError(
      new HttpException(
        { error: { message: 'Agent failed.', code: 'AGENT_RUNTIME_ERROR', statusCode: 500 } },
        500,
      ),
    );

    expect(error.message).toBe('Agent failed.');
    expect(error.code).toBe('AGENT_RUNTIME_ERROR');
  });

  it('uses a bare string error when there is no message beside it', () => {
    const error = normalizeApiError(
      new HttpException({ error: 'model not found' }, 404),
    );

    expect(error.message).toBe('model not found');
  });

  it('marks rate limiting as retryable', () => {
    const error = normalizeApiError(new HttpException('Too many requests.', 429));

    expect(error.code).toBe('RATE_LIMITED');
    expect(error.retryable).toBe(true);
  });
});
