import {
  BadRequestException,
  Body,
  Controller,
  Param,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/better-auth.config';
import { DatabaseSourcesService } from './database-sources.service';
import {
  SUPPORTED_DATABASE_PROVIDERS,
  SupportedDatabaseProvider,
} from './database-sources.types';

type CreateDatabaseSourceBody = {
  provider?: unknown;
  connectionString?: unknown;
  objectKey?: unknown;
  originalFilename?: unknown;
};

type PresignUploadBody = {
  filename?: unknown;
  size?: unknown;
  contentType?: unknown;
};

@Controller('database-sources')
export class DatabaseSourcesController {
  constructor(
    private readonly databaseSourcesService: DatabaseSourcesService,
  ) {}

  @Post('uploads/presign')
  presignUpload(
    @CurrentUser() user: AuthUser,
    @Body() body: PresignUploadBody,
  ) {
    const filename = typeof body.filename === 'string' ? body.filename.trim() : '';
    const size = typeof body.size === 'number' ? body.size : Number(body.size);
    const contentType =
      typeof body.contentType === 'string' ? body.contentType.trim() : undefined;

    if (!filename) {
      throw new BadRequestException('filename is required');
    }

    return this.databaseSourcesService.presignSqliteUpload(user.id, {
      filename,
      size,
      contentType,
    });
  }

  @Post()
  async createDatabaseSource(
    @CurrentUser() user: AuthUser,
    @Body() body: CreateDatabaseSourceBody,
  ) {
    const provider =
      typeof body.provider === 'string' ? body.provider.trim() : '';
    const connectionString =
      typeof body.connectionString === 'string'
        ? body.connectionString.trim()
        : '';
    const objectKey =
      typeof body.objectKey === 'string' ? body.objectKey.trim() : '';
    const originalFilename =
      typeof body.originalFilename === 'string'
        ? body.originalFilename.trim()
        : '';

    if (!provider) {
      throw new BadRequestException('provider is required');
    }

    if (
      !SUPPORTED_DATABASE_PROVIDERS.includes(
        provider as SupportedDatabaseProvider,
      )
    ) {
      throw new BadRequestException(
        'Unsupported provider. Only postgresql and sqlite are available right now.',
      );
    }

    if (provider !== 'sqlite' && objectKey) {
      throw new BadRequestException(
        'File uploads are only supported for SQLite connections.',
      );
    }

    return this.databaseSourcesService.createForUser(user.id, {
      provider: provider as SupportedDatabaseProvider,
      connectionString: connectionString || undefined,
      sqlite: objectKey
        ? { objectKey, originalFilename }
        : undefined,
    });
  }

  @Post(':id/refresh')
  refreshDatabaseSource(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    const sourceId = id.trim();
    if (!sourceId) {
      throw new BadRequestException('id is required');
    }

    return this.databaseSourcesService.refreshForUser(user.id, sourceId);
  }
}
