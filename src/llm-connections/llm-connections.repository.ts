import { Injectable } from '@nestjs/common';
import { LlmConnectionStatus, LlmProvider } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  SupportedLlmProvider,
  fromPrismaLlmProvider,
  toPrismaLlmProvider,
} from './llm-connections.types';

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
        status: LlmConnectionStatus.SUCCESS,
      },
    });
  }

  hasLinkedGithubAccount(userId: string): Promise<boolean> {
    return this.prisma.account
      .count({
        where: {
          userId,
          providerId: 'github',
        },
      })
      .then((count) => count > 0);
  }

  findByDisplayNameForUser(userId: string, displayName: string) {
    return this.prisma.llmConnection.findFirst({
      where: { userId, displayName },
      select: { id: true },
    });
  }

  findByProviderAndLastFourForUser(
    userId: string,
    provider: LlmProvider,
    apiKeyLastFour: string,
  ) {
    return this.prisma.llmConnection.findFirst({
      where: { userId, provider, apiKeyLastFour },
      select: { id: true },
    });
  }

  createPending(input: CreatePendingLlmConnectionInput) {
    return this.prisma.llmConnection.create({
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
}
