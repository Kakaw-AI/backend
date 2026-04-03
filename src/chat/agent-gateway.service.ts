import { createHmac, randomUUID } from 'node:crypto';
import {
  HttpException,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { normalizeApiErrorPayload } from '../common/errors/error-response';
import {
  AgentRunRequest,
  AgentStreamEvent,
  AgentSyncRequest,
  AgentSyncResponse,
} from './chat.types';

@Injectable()
export class AgentGatewayService {
  constructor(private readonly configService: ConfigService) {}

  createRequestId() {
    return randomUUID();
  }

  async syncDatabaseSource(input: AgentSyncRequest): Promise<AgentSyncResponse> {
    const body = JSON.stringify(input);
    const timestamp = Date.now().toString();
    const response = await fetch(this.resolveUrl('/api/chat/sync'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-kakaw-request-timestamp': timestamp,
        'x-kakaw-signature': this.sign(timestamp, body),
      },
      body,
      signal: AbortSignal.timeout(60_000),
    }).catch((error) => {
      const message =
        error instanceof Error && error.name === 'TimeoutError'
          ? 'Agent runtime timed out (sync exceeded 60s).'
          : `Unable to reach the agent runtime service. ${error instanceof Error ? error.message : ''}`.trim();
      throw new ServiceUnavailableException({
        error: {
          message,
          code: 'UPSTREAM_UNAVAILABLE',
          statusCode: 503,
          retryable: true,
        },
      });
    });

    const payload = await this.readResponsePayload(response);
    if (!response.ok) {
      this.throwAgentHttpError(
        payload,
        response.status,
        'Agent runtime rejected the sync request.',
      );
    }

    return payload as AgentSyncResponse;
  }

  async *streamChat(input: AgentRunRequest): AsyncGenerator<AgentStreamEvent> {
    const body = JSON.stringify(input);
    const timestamp = Date.now().toString();
    const response = await fetch(this.resolveUrl('/api/chat/run'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-kakaw-request-timestamp': timestamp,
        'x-kakaw-signature': this.sign(timestamp, body),
      },
      body,
      signal: AbortSignal.timeout(300_000),
    }).catch((error) => {
      const message =
        error instanceof Error && error.name === 'TimeoutError'
          ? 'Agent runtime timed out (stream exceeded 5 minutes).'
          : `Unable to reach the agent runtime service. ${error instanceof Error ? error.message : ''}`.trim();
      throw new ServiceUnavailableException({
        error: {
          message,
          code: 'UPSTREAM_UNAVAILABLE',
          statusCode: 503,
          retryable: true,
        },
      });
    });

    if (!response.ok) {
      const payload = await this.readResponsePayload(response);
      this.throwAgentHttpError(
        payload,
        response.status,
        'Agent runtime rejected the request.',
      );
    }

    if (!response.body) {
      throw new ServiceUnavailableException(
        'Agent runtime returned no response body.',
      );
    }

    for await (const item of this.readNdjson(response.body)) {
      const event = this.parseEvent(item);
      if (event) {
        yield event;
      }
    }
  }

  private resolveUrl(pathname: string) {
    const baseUrl =
      this.configService.get<string>('AGENT_SERVICE_URL')?.trim() ||
      'http://localhost:8000';
    return `${baseUrl}${pathname}`;
  }

  private sign(timestamp: string, body: string) {
    const secret = this.configService.get<string>('AGENT_SHARED_SECRET')?.trim();
    if (!secret) {
      throw new InternalServerErrorException(
        'AGENT_SHARED_SECRET is not configured.',
      );
    }

    return createHmac('sha256', secret)
      .update(`${timestamp}.${body}`)
      .digest('hex');
  }

  private async *readNdjson(
    stream: ReadableStream<Uint8Array>,
  ): AsyncGenerator<string> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex === -1) {
          break;
        }

        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) {
          yield line;
        }
      }
    }

    const lastLine = buffer.trim();
    if (lastLine) {
      yield lastLine;
    }
  }

  private parseEvent(line: string): AgentStreamEvent | null {
    try {
      const parsed = JSON.parse(line) as Partial<AgentStreamEvent>;
      if (!parsed || typeof parsed.type !== 'string' || !parsed.data) {
        return null;
      }

      return parsed as AgentStreamEvent;
    } catch {
      return null;
    }
  }

  private async readResponsePayload(response: Response): Promise<unknown> {
    const text = await response.text().catch(() => '');
    if (!text.trim()) {
      return null;
    }

    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private throwAgentHttpError(
    payload: unknown,
    statusCode: number,
    fallbackMessage: string,
  ): never {
    const error = normalizeApiErrorPayload(payload, fallbackMessage, statusCode);
    if (error.statusCode === 429) {
      throw new HttpException({ error }, 429);
    }
    throw new HttpException({ error }, error.statusCode);
  }
}
