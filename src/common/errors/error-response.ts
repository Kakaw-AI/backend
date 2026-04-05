import { HttpException, HttpStatus } from '@nestjs/common';

export type ApiErrorInfo = {
  message: string;
  code: string;
  statusCode: number;
  retryable: boolean;
  provider?: string;
  upstreamCode?: string;
  metadata?: {
    raw?: string;
  };
};

export type ApiErrorResponse = {
  error: ApiErrorInfo;
  timestamp?: string;
  path?: string;
};

export function normalizeApiError(
  exception: unknown,
  fallbackMessage = 'Internal server error',
): ApiErrorInfo {
  if (exception instanceof HttpException) {
    return normalizeApiErrorPayload(
      exception.getResponse(),
      fallbackMessage,
      exception.getStatus(),
    );
  }

  if (exception instanceof Error) {
    return normalizeApiErrorPayload(
      exception,
      exception.message || fallbackMessage,
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  return normalizeApiErrorPayload(
    exception,
    fallbackMessage,
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}

export function normalizeApiErrorPayload(
  payload: unknown,
  fallbackMessage: string,
  fallbackStatusCode: number,
): ApiErrorInfo {
  const normalizedSource = unwrapErrorPayload(payload);
  const statusCode =
    readStatusCode(normalizedSource) ??
    readStatusCode(payload) ??
    fallbackStatusCode;
  const message =
    selectBestMessage(normalizedSource, statusCode) ??
    selectBestMessage(payload, statusCode) ??
    fallbackMessage;
  const code =
    readStringField(normalizedSource, 'code') ??
    defaultCodeForStatus(statusCode);
  const retryable =
    readBooleanField(normalizedSource, 'retryable') ??
    isRetryableCode(code, statusCode);
  const provider = readStringField(normalizedSource, 'provider');
  const upstreamCode = readUpstreamCode(normalizedSource);

  return {
    message,
    code,
    statusCode,
    retryable,
    ...(provider ? { provider } : {}),
    ...(upstreamCode ? { upstreamCode } : {}),
  };
}

export function toApiErrorResponse(
  error: ApiErrorInfo,
  metadata?: { path?: string; timestamp?: string },
): ApiErrorResponse {
  return {
    error,
    ...(metadata?.timestamp ? { timestamp: metadata.timestamp } : {}),
    ...(metadata?.path ? { path: metadata.path } : {}),
  };
}

function unwrapErrorPayload(value: unknown): unknown {
  if (!value || typeof value !== 'object') {
    return maybeParseJsonText(value);
  }

  const record = value as Record<string, unknown>;
  if ('error' in record && record.error) {
    return unwrapErrorPayload(record.error);
  }

  return value;
}

function maybeParseJsonText(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function readStatusCode(value: unknown): number | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const key of ['statusCode', 'status', 'code']) {
    const candidate = record[key];
    if (typeof candidate === 'number' && candidate >= 400 && candidate <= 599) {
      return candidate;
    }
    if (typeof candidate === 'string' && /^\d{3}$/.test(candidate)) {
      const numeric = Number(candidate);
      if (numeric >= 400 && numeric <= 599) {
        return numeric;
      }
    }
  }

  return null;
}

function selectBestMessage(value: unknown, statusCode: number): string | null {
  const rawMessage = readRawMessage(value);
  const nestedMessage = flattenMessage(value);
  const genericMessages = new Set(['provider returned error', 'internal server error']);

  if (
    rawMessage &&
    (statusCode === HttpStatus.TOO_MANY_REQUESTS ||
      (nestedMessage && genericMessages.has(nestedMessage.toLowerCase())))
  ) {
    return rawMessage;
  }

  return nestedMessage ?? rawMessage;
}

function readRawMessage(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const metadata = record.metadata;
  if (!metadata || typeof metadata !== 'object') {
    return null;
  }

  const raw = (metadata as Record<string, unknown>).raw;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

function flattenMessage(value: unknown): string | null {
  const parsed = maybeParseJsonText(value);

  if (typeof parsed === 'string') {
    const cleaned = parsed.trim();
    return cleaned ? cleaned : null;
  }

  if (Array.isArray(parsed)) {
    const parts = parsed
      .map((item) => flattenMessage(item))
      .filter((item): item is string => Boolean(item));
    return parts.length ? parts.join(', ') : null;
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  for (const key of ['message', 'detail', 'error_description']) {
    const message = flattenMessage(record[key]);
    if (message) {
      return message;
    }
  }

  return null;
}

function readStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === 'string' && candidate.trim()
    ? candidate.trim()
    : undefined;
}

function readBooleanField(value: unknown, key: string): boolean | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === 'boolean' ? candidate : undefined;
}

function readUpstreamCode(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const upstreamCode = record.upstreamCode;
  if (typeof upstreamCode === 'string' && upstreamCode.trim()) {
    return upstreamCode.trim();
  }

  const code = record.code;
  if (typeof code === 'string' && /^\d+$/.test(code.trim())) {
    return code.trim();
  }

  return undefined;
}

function defaultCodeForStatus(statusCode: number): string {
  if (statusCode === HttpStatus.TOO_MANY_REQUESTS) {
    return 'RATE_LIMITED';
  }
  if ([HttpStatus.BAD_GATEWAY, HttpStatus.SERVICE_UNAVAILABLE, HttpStatus.GATEWAY_TIMEOUT].includes(statusCode)) {
    return 'UPSTREAM_UNAVAILABLE';
  }
  if (statusCode === HttpStatus.BAD_REQUEST || statusCode === HttpStatus.UNPROCESSABLE_ENTITY) {
    return 'INVALID_REQUEST';
  }
  if (statusCode >= 400 && statusCode < 500) {
    return 'REQUEST_FAILED';
  }
  return 'INTERNAL_ERROR';
}

function isRetryableCode(code: string, statusCode: number): boolean {
  return (
    code === 'RATE_LIMITED' ||
    code === 'UPSTREAM_UNAVAILABLE' ||
    [HttpStatus.TOO_MANY_REQUESTS, HttpStatus.BAD_GATEWAY, HttpStatus.SERVICE_UNAVAILABLE, HttpStatus.GATEWAY_TIMEOUT].includes(
      statusCode,
    )
  );
}
