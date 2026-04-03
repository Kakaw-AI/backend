import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { Injectable } from '@nestjs/common';

@Injectable()
export class SqliteFingerprintService {
  async fingerprint(filePath: string): Promise<string> {
    const hash = createHash('sha256');

    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve());
    });

    return hash.digest('hex');
  }
}
