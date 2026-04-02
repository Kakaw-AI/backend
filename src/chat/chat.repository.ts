import {
  MessageArtifactType,
  MessageRole,
  MessageStatus,
  Prisma,
} from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TokenUsage } from './chat.types';

type CreateConversationRecordInput = {
  userId: string;
  title: string;
  databaseSourceId: string;
  llmConnectionId: string;
};

type UpdateConversationRuntimeRecordInput = {
  llmConnectionId: string | null;
  llmModelOverride: string | null;
};

type CreateMessageRecordInput = {
  conversationId: string;
  role: MessageRole;
  status: MessageStatus;
  content: string;
  error?: string;
};

type CreateArtifactRecordInput = {
  messageId: string;
  type: MessageArtifactType;
  payload: object;
};

const conversationMessageSelect = {
  id: true,
  role: true,
  status: true,
  content: true,
  error: true,
  tokenUsage: true,
  suggestions: true,
  createdAt: true,
  updatedAt: true,
  artifacts: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      type: true,
      payload: true,
      createdAt: true,
    },
  },
} as const satisfies Prisma.MessageSelect;

const conversationSummarySelect = {
  id: true,
  title: true,
  lastMessageAt: true,
  createdAt: true,
  updatedAt: true,
  databaseSourceId: true,
  llmModelOverride: true,
  llmConnectionId: true,
  databaseSource: {
    select: {
      id: true,
      provider: true,
      sqliteOriginalFilename: true,
      status: true,
      lastError: true,
      lastTestedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  llmConnection: {
    select: {
      id: true,
      provider: true,
      status: true,
      displayName: true,
      defaultModel: true,
      apiKeyLastFour: true,
      usesLinkedAccount: true,
      linkedProviderId: true,
      isActive: true,
      lastError: true,
      lastTestedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} as const satisfies Prisma.ConversationSelect;

@Injectable()
export class ChatRepository {
  constructor(private readonly prisma: PrismaService) {}

  createConversation(input: CreateConversationRecordInput) {
    return this.prisma.conversation.create({
      data: {
        userId: input.userId,
        title: input.title,
        databaseSourceId: input.databaseSourceId,
        llmConnectionId: input.llmConnectionId,
      },
      select: conversationSummarySelect,
    });
  }

  findConversationSummaryByUser(userId: string) {
    return this.prisma.conversation.findMany({
      where: { userId },
      orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
      select: conversationSummarySelect,
    });
  }

  findConversationForUser(userId: string, conversationId: string) {
    return this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        userId,
      },
      select: {
        ...conversationSummarySelect,
        messages: {
          orderBy: { createdAt: 'asc' },
          select: conversationMessageSelect,
        },
      },
    });
  }

  findConversationRuntime(userId: string, conversationId: string) {
    return this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        userId,
      },
      select: conversationSummarySelect,
    });
  }

  updateConversationRuntime(
    conversationId: string,
    input: UpdateConversationRuntimeRecordInput,
  ) {
    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        llmConnectionId: input.llmConnectionId,
        llmModelOverride: input.llmModelOverride,
      },
      select: {
        id: true,
      },
    });
  }

  async createMessage(input: CreateMessageRecordInput) {
    const message = await this.prisma.message.create({
      data: {
        conversationId: input.conversationId,
        role: input.role,
        status: input.status,
        content: input.content,
        error: input.error,
      },
      select: {
        id: true,
        role: true,
        status: true,
        content: true,
        error: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await this.touchConversation(input.conversationId, message.createdAt);
    return message;
  }

  setStreamingMessageContent(messageId: string, content: string) {
    return this.prisma.message.update({
      where: { id: messageId },
      data: {
        content,
        status: MessageStatus.STREAMING,
      },
      select: {
        id: true,
      },
    });
  }

  completeMessage(
    messageId: string,
    content: string,
    meta: { tokenUsage: TokenUsage | null; suggestions: string[] },
  ) {
    return this.prisma.message.update({
      where: { id: messageId },
      data: {
        content,
        status: MessageStatus.COMPLETED,
        error: null,
        tokenUsage: meta.tokenUsage ?? Prisma.JsonNull,
        suggestions: meta.suggestions,
      },
      select: {
        id: true,
      },
    });
  }

  failMessage(messageId: string, error: string, content: string) {
    return this.prisma.message.update({
      where: { id: messageId },
      data: {
        content,
        status: MessageStatus.FAILED,
        error,
      },
      select: {
        id: true,
      },
    });
  }

  createArtifact(input: CreateArtifactRecordInput) {
    return this.prisma.messageArtifact.create({
      data: {
        messageId: input.messageId,
        type: input.type,
        payload: input.payload,
      },
      select: {
        id: true,
      },
    });
  }

  findRecentHistory(conversationId: string, limit: number) {
    return this.prisma.message.findMany({
      where: {
        conversationId,
        OR: [
          { status: MessageStatus.COMPLETED },
          {
            role: MessageRole.USER,
            status: MessageStatus.PENDING,
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        role: true,
        content: true,
      },
    });
  }

  renameConversation(conversationId: string, title: string) {
    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: { title },
      select: {
        id: true,
      },
    });
  }

  private touchConversation(conversationId: string, at: Date) {
    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: at,
      },
      select: {
        id: true,
      },
    });
  }
}
