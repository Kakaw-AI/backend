import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SecretsService {
  constructor(private readonly configService: ConfigService) {}

  encrypt(value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.getKey(), iv);
    const encrypted = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return `${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
  }

  decrypt(payload: string) {
    const [ivBase64, tagBase64, encryptedBase64] = payload.split('.');
    if (!ivBase64 || !tagBase64 || !encryptedBase64) {
      throw new InternalServerErrorException('Stored secret is malformed.');
    }

    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.getKey(),
      Buffer.from(ivBase64, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tagBase64, 'base64'));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedBase64, 'base64')),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }

  private getKey() {
    const secret = this.configService.get<string>('LLM_CONNECTIONS_ENCRYPTION_KEY');
    if (!secret?.trim()) {
      throw new InternalServerErrorException(
        'LLM_CONNECTIONS_ENCRYPTION_KEY is not configured.',
      );
    }

    return createHash('sha256').update(secret).digest();
  }
}
