import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import {
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const DEFAULT_PRESIGN_TTL_SECONDS = 300;

@Injectable()
export class R2Service {
  private client: S3Client | null = null;
  private bucket: string | null = null;

  constructor(private readonly configService: ConfigService) {}

  /** Builds the R2 client lazily so the app can boot without R2 configured. */
  private getClient(): { client: S3Client; bucket: string } {
    if (this.client && this.bucket) {
      return { client: this.client, bucket: this.bucket };
    }

    const accountId = this.configService.get<string>('R2_ACCOUNT_ID')?.trim();
    const accessKeyId = this.configService.get<string>('R2_ACCESS_KEY_ID')?.trim();
    const secretAccessKey = this.configService
      .get<string>('R2_SECRET_ACCESS_KEY')
      ?.trim();
    const bucket = this.configService.get<string>('R2_BUCKET')?.trim();
    const endpoint = this.resolveEndpoint(
      accountId,
      this.configService.get<string>('R2_ENDPOINT')?.trim(),
    );

    if (!accessKeyId || !secretAccessKey || !bucket || !endpoint) {
      throw new InternalServerErrorException(
        'R2 storage is not configured (need R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_ACCOUNT_ID or R2_ENDPOINT).',
      );
    }

    this.bucket = bucket;
    this.client = new S3Client({
      region: 'auto',
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      // The SDK v3 default injects an x-amz-checksum-crc32 into presigned URLs,
      // which breaks browser PUT uploads to R2 (the body checksum won't match
      // the signed placeholder). Only add checksums when the operation requires
      // it so presigned PUT/GET URLs stay clean.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });

    return { client: this.client, bucket: this.bucket };
  }

  /**
   * Resolves a valid S3 endpoint URL. Accepts a full R2_ENDPOINT (adding the
   * https:// scheme if missing), otherwise derives it from R2_ACCOUNT_ID —
   * tolerating an account id that was mistakenly pasted as a full URL.
   */
  private resolveEndpoint(
    accountId?: string,
    rawEndpoint?: string,
  ): string | undefined {
    if (rawEndpoint) {
      return /^https?:\/\//i.test(rawEndpoint)
        ? rawEndpoint
        : `https://${rawEndpoint}`;
    }

    if (accountId) {
      const cleanId = accountId
        .replace(/^https?:\/\//i, '')
        .split(/[./]/)[0];
      return `https://${cleanId}.r2.cloudflarestorage.com`;
    }

    return undefined;
  }

  /** Object key for a user's SQLite upload — unique and immutable per upload. */
  buildSqliteKey(userId: string, originalFilename: string): string {
    const extension = extname(originalFilename).toLowerCase();
    return `sqlite/${userId}/${randomUUID()}${extension}`;
  }

  presignUpload(
    key: string,
    contentType: string,
    ttlSeconds = DEFAULT_PRESIGN_TTL_SECONDS,
  ): Promise<string> {
    const { client, bucket } = this.getClient();
    return getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
      }),
      { expiresIn: ttlSeconds },
    );
  }

  presignDownload(
    key: string,
    ttlSeconds = DEFAULT_PRESIGN_TTL_SECONDS,
  ): Promise<string> {
    const { client, bucket } = this.getClient();
    return getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { expiresIn: ttlSeconds },
    );
  }

  /** Returns the object's ETag (used as a content fingerprint) and size. */
  async headObject(key: string): Promise<{ etag: string; size: number }> {
    const { client, bucket } = this.getClient();
    const result = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
    return {
      etag: (result.ETag ?? '').replace(/"/g, ''),
      size: result.ContentLength ?? 0,
    };
  }
}
