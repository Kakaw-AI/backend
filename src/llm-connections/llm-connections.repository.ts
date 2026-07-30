import { Injectable } from '@nestjs/common';
import { LlmConnectionStatus, LlmProvider, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  SupportedLlmProvider,
  fromPrismaLlmProvider,
  toPrismaLlmProvider,
} from './llm-connections.types';

type LlmConnectionsDbClient = Prisma.TransactionClient | PrismaService;

type CreatePendingLlmConnectionInput = {
  userId: string;
  provider: SupportedLlmProvider;
  displayName: string;
  defaultModel: string;
  encryptedApiKey?: string;
  apiKeyLastFour?: string;
  usesLinkedAccount: boolean;
  linkedProviderId?: string;
  baseUrl?: string;
};

@Injectable()
export class LlmConnectionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByUser(userId: string) {
    const connections = await this.prisma.llmConnection.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        provider: true,
        status: true,
        displayName: true,
        defaultModel: true,
        apiKeyLastFour: true,
        usesLinkedAccount: true,
        linkedProviderId: true,
        baseUrl: true,
        isActive: true,
        lastError: true,
        lastTestedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return connections.map((connection) => ({
      ...connection,
      provider: fromPrismaLlmProvider(connection.provider),
    }));
  }

  async findByUserAndId(userId: string, id: string) {
    const connection = await this.prisma.llmConnection.findFirst({
      where: { id, userId },
      select: {
        id: true,
        provider: true,
        status: true,
        displayName: true,
        defaultModel: true,
        apiKeyLastFour: true,
        usesLinkedAccount: true,
        linkedProviderId: true,
        baseUrl: true,
        isActive: true,
        lastError: true,
        lastTestedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!connection) {
      return null;
    }

    return {
      ...connection,
      provider: fromPrismaLlmProvider(connection.provider),
    };
  }

  async findRuntimeByUserAndId(userId: string, id: string) {
    const connection = await this.prisma.llmConnection.findFirst({
      where: { id, userId },
      select: {
        id: true,
        provider: true,
        status: true,
        displayName: true,
        defaultModel: true,
        encryptedApiKey: true,
        apiKeyLastFour: true,
        usesLinkedAccount: true,
        linkedProviderId: true,
        baseUrl: true,
        isActive: true,
        lastError: true,
        lastTestedAt: true,
      },
    });

    if (!connection) {
      return null;
    }

    return {
      ...connection,
      provider: fromPrismaLlmProvider(connection.provider),
    };
  }

  countByUser(userId: string): Promise<number> {
    return this.prisma.llmConnection.count({
      where: { userId },
    });
  }

  countSuccessfulByUser(userId: string): Promise<number> {
    return this.prisma.llmConnection.count({
      where: {
        userId,
        isActive: true,
        status: LlmConnectionStatus.SUCCESS,
      },
    });
  }

  findDuplicateCandidatesForUser(
    userId: string,
    provider: LlmProvider,
    db: LlmConnectionsDbClient = this.prisma,
  ) {
    return db.llmConnection.findMany({
      where: {
        userId,
        provider,
        status: {
          not: LlmConnectionStatus.FAILED,
        },
      },
      select: {
        id: true,
        displayName: true,
        defaultModel: true,
        encryptedApiKey: true,
        linkedProviderId: true,
        baseUrl: true,
        isActive: true,
        status: true,
      },
    });
  }

  createPending(
    input: CreatePendingLlmConnectionInput,
    db: LlmConnectionsDbClient = this.prisma,
  ) {
    return db.llmConnection.create({
      data: {
        userId: input.userId,
        provider: toPrismaLlmProvider(input.provider),
        status: LlmConnectionStatus.PENDING,
        displayName: input.displayName,
        defaultModel: input.defaultModel,
        encryptedApiKey: input.encryptedApiKey,
        apiKeyLastFour: input.apiKeyLastFour,
        usesLinkedAccount: input.usesLinkedAccount,
        linkedProviderId: input.linkedProviderId,
        baseUrl: input.baseUrl,
      },
      select: {
        id: true,
      },
    });
  }

  markSuccess(id: string) {
    return this.prisma.llmConnection.update({
      where: { id },
      data: {
        status: LlmConnectionStatus.SUCCESS,
        lastError: null,
        lastTestedAt: new Date(),
      },
      select: {
        id: true,
      },
    });
  }

  markFailure(id: string, lastError: string) {
    return this.prisma.llmConnection.update({
      where: { id },
      data: {
        status: LlmConnectionStatus.FAILED,
        lastError,
        lastTestedAt: new Date(),
      },
      select: {
        id: true,
      },
    });
  }

  activate(id: string) {
    return this.prisma.llmConnection.update({
      where: { id },
      data: {
        isActive: true,
      },
      select: {
        id: true,
      },
    });
  }

  deactivate(id: string) {
    return this.prisma.llmConnection.update({
      where: { id },
      data: {
        isActive: false,
      },
      select: {
        id: true,
      },
    });
  }

  deleteForUser(id: string, userId: string) {
    return this.prisma.llmConnection.deleteMany({
      where: {
        id,
        userId,
      },
    });
  }
}
