import {
  BadRequestException,
  Body,
  Controller,
  Param,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../auth/better-auth.config';
import { DatabaseSourcesService } from './database-sources.service';
import {
  SUPPORTED_DATABASE_PROVIDERS,
  SupportedDatabaseProvider,
  UploadedSqliteFile,
} from './database-sources.types';
import {
  SQLITE_UPLOAD_FIELD_NAME,
  sqliteFileInterceptorOptions,
} from './sqlite-upload';

type CreateDatabaseSourceBody = {
  provider?: unknown;
  connectionString?: unknown;
};

type UploadedFilePayload = {
  filename: string;
  mimetype: string;
  originalname: string;
  path: string;
  size: number;
};

type RequestWithFileValidation = Request & {
  fileValidationError?: string;
};

@Controller('database-sources')
export class DatabaseSourcesController {
  constructor(
    private readonly databaseSourcesService: DatabaseSourcesService,
  ) {}

  @UseInterceptors(
    FileInterceptor(SQLITE_UPLOAD_FIELD_NAME, sqliteFileInterceptorOptions),
  )
  @Post()
  async createDatabaseSource(
    @CurrentUser() user: AuthUser,
    @Body() body: CreateDatabaseSourceBody,
    @UploadedFile() file?: UploadedFilePayload,
    @Req() request?: RequestWithFileValidation,
  ) {
    if (request?.fileValidationError) {
      throw new BadRequestException(request.fileValidationError);
    }

    const provider =
      typeof body.provider === 'string' ? body.provider.trim() : '';
    const connectionString =
      typeof body.connectionString === 'string'
        ? body.connectionString.trim()
        : '';

    if (!provider) {
      if (file?.path) {
        await this.databaseSourcesService.discardUploadedFile(file.path);
      }
      throw new BadRequestException(
        'provider is required',
      );
    }

    if (
      !SUPPORTED_DATABASE_PROVIDERS.includes(
        provider as SupportedDatabaseProvider,
      )
    ) {
      if (file?.path) {
        await this.databaseSourcesService.discardUploadedFile(file.path);
      }
      throw new BadRequestException(
        'Unsupported provider. Only postgresql and sqlite are available right now.',
      );
    }

    if (provider !== 'sqlite' && file?.path) {
      await this.databaseSourcesService.discardUploadedFile(file.path);
      throw new BadRequestException(
        'File uploads are only supported for SQLite connections.',
      );
    }

    return this.databaseSourcesService.createForUser(user.id, {
      provider: provider as SupportedDatabaseProvider,
      connectionString: connectionString || undefined,
      sqliteFile: file
        ? this.toUploadedSqliteFile(file)
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

  private toUploadedSqliteFile(file: UploadedFilePayload): UploadedSqliteFile {
    return {
      filename: file.filename,
      originalName: file.originalname,
      mimeType: file.mimetype,
      path: file.path,
      size: file.size,
    };
  }
}
