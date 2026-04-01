import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class InternalAgentAuthService {
  constructor(private readonly configService: ConfigService) {}

  verifySignature(timestamp: string, signature: string, rawBody: Buffer | string) {
    const sharedSecret = this.configService.get<string>('AGENT_SHARED_SECRET')?.trim();
    if (!sharedSecret) {
      throw new InternalServerErrorException(
        'AGENT_SHARED_SECRET is not configured.',
      );
    }

    const now = Date.now();
    const requestTime = Number(timestamp);
    if (!Number.isFinite(requestTime) || Math.abs(now - requestTime) > 5 * 60 * 1000) {
      throw new UnauthorizedException('Agent request timestamp is invalid or expired.');
    }

    const expected = createHmac('sha256', sharedSecret)
      .update(`${timestamp}.${rawBody.toString()}`)
      .digest('hex');

    const providedBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');

    if (
      providedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(providedBuffer, expectedBuffer)
    ) {
      throw new UnauthorizedException('Agent request signature is invalid.');
    }
  }
}
