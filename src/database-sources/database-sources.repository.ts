import { Injectable } from '@nestjs/common';
import { DatabaseSourceStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SupportedDatabaseProvider } from './database-sources.types';

type CreatePendingDatabaseSourceInput = {
  userId: string;
  provider: SupportedDatabaseProvider;
  connectionString?: string;
  sqliteFilePath?: string;
  sqliteOriginalFilename?: string;
};

@Injectable()
export class DatabaseSourcesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByUser(userId: string) {
    return this.prisma.databaseSource.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        provider: true,
        status: true,
        sqliteOriginalFilename: true,
        lastError: true,
        lastTestedAt: true,
        lastSyncedAt: true,
        syncRequestedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  findRuntimeByUserAndId(userId: string, id: string) {
    return this.prisma.databaseSource.findFirst({
      where: { id, userId },
      select: {
        id: true,
        provider: true,
        status: true,
        connectionString: true,
        sqliteFilePath: true,
        sqliteOriginalFilename: true,
        lastError: true,
        lastTestedAt: true,
        lastSyncedAt: true,
        syncRequestedAt: true,
      },
    });
  }

  countByUser(userId: string): Promise<number> {
    return this.prisma.databaseSource.count({
      where: { userId },
    });
  }

  countSuccessfulByUser(userId: string): Promise<number> {
    return this.countReadyByUser(userId);
  }

  countReadyByUser(userId: string): Promise<number> {
    return this.prisma.databaseSource.count({
      where: {
        userId,
        status: DatabaseSourceStatus.READY,
      },
    });
  }

  createPending(input: CreatePendingDatabaseSourceInput) {
    return this.prisma.databaseSource.create({
      data: {
        userId: input.userId,
        provider: input.provider,
        status: DatabaseSourceStatus.PENDING,
        connectionString: input.connectionString,
        sqliteFilePath: input.sqliteFilePath,
        sqliteOriginalFilename: input.sqliteOriginalFilename,
      },
      select: {
        id: true,
      },
    });
  }

  markSuccess(id: string) {
    return this.markReady(id);
  }

  markSyncing(id: string) {
    return this.prisma.databaseSource.update({
      where: { id },
      data: {
        status: DatabaseSourceStatus.SYNCING,
        lastError: null,
        syncRequestedAt: new Date(),
      },
      select: {
        id: true,
        provider: true,
        status: true,
        connectionString: true,
        sqliteFilePath: true,
        sqliteOriginalFilename: true,
        lastError: true,
        lastTestedAt: true,
        lastSyncedAt: true,
        syncRequestedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  markReady(id: string) {
    return this.prisma.databaseSource.update({
      where: { id },
      data: {
        status: DatabaseSourceStatus.READY,
        lastError: null,
        lastTestedAt: new Date(),
        lastSyncedAt: new Date(),
        schemaFingerprint: null,
      },
      select: {
        id: true,
        provider: true,
        status: true,
        sqliteOriginalFilename: true,
        lastError: true,
        lastTestedAt: true,
        lastSyncedAt: true,
        syncRequestedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  markFailure(id: string, lastError: string) {
    return this.prisma.databaseSource.update({
      where: { id },
      data: {
        status: DatabaseSourceStatus.FAILED,
        lastError,
        lastTestedAt: new Date(),
      },
      select: {
        id: true,
        provider: true,
        status: true,
        sqliteOriginalFilename: true,
        lastError: true,
        lastTestedAt: true,
        lastSyncedAt: true,
        syncRequestedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  findRuntimeById(id: string) {
    return this.prisma.databaseSource.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        provider: true,
        status: true,
        connectionString: true,
        sqliteFilePath: true,
        sqliteOriginalFilename: true,
        lastError: true,
        lastTestedAt: true,
        lastSyncedAt: true,
      },
    });
  }
}
