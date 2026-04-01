import { createHmac, randomUUID } from 'node:crypto';
import {
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
    }).catch((error) => {
      throw new ServiceUnavailableException(
        `Unable to reach the Python agent service. ${
          error instanceof Error ? error.message : ''
        }`.trim(),
      );
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        payload && typeof payload === 'object' && 'detail' in payload
          ? String(payload.detail || '').trim()
          : '';
      throw new ServiceUnavailableException(
        message || 'Python agent service rejected the sync request.',
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
    }).catch((error) => {
      throw new ServiceUnavailableException(
        `Unable to reach the Python agent service. ${
          error instanceof Error ? error.message : ''
        }`.trim(),
      );
    });

    if (!response.ok) {
      const message = await response.text().catch(() => '');
      throw new ServiceUnavailableException(
        message.trim() || 'Python agent service rejected the request.',
      );
    }

    if (!response.body) {
      throw new ServiceUnavailableException(
        'Python agent service returned no response body.',
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
}
