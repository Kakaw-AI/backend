import { MessageArtifactType, MessageRole, MessageStatus } from '@prisma/client';
import { SupportedLlmProvider } from '../llm-connections/llm-connections.types';

export type AgentHistoryMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export type AgentDatabaseRuntime =
  {
    sourceId: string;
    provider: 'postgresql' | 'sqlite';
    label: string;
    connectionString?: string;
    sqliteFilePath?: string;
    sqliteOriginalFilename?: string;
  };

type AgentBaseLlmRuntime = {
  connectionId: string;
  model: string;
};

type AgentApiKeyLlmRuntime = AgentBaseLlmRuntime & {
  provider: Exclude<SupportedLlmProvider, 'github-copilot'>;
  apiKey?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
};

type AgentGithubCopilotRuntime = AgentBaseLlmRuntime & {
  provider: 'github-copilot';
  accessToken: string;
};

export type AgentLlmRuntime = AgentApiKeyLlmRuntime | AgentGithubCopilotRuntime;

export type AgentRunRequest = {
  requestId: string;
  conversationId: string;
  userId: string;
  messageId: string;
  message: string;
  history: AgentHistoryMessage[];
  database: AgentDatabaseRuntime;
  llm: AgentLlmRuntime;
};

export type AgentSyncRequest = {
  requestId: string;
  userId: string;
  database: AgentDatabaseRuntime;
};

export type AgentSyncResponse = {
  sourceId: string;
  status: 'READY' | 'FAILED';
  memoryCount: number;
  syncedAt: string;
  error?: string;
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type AgentErrorInfo = {
  message: string;
  code: string;
  statusCode: number;
  retryable: boolean;
  provider?: string;
  upstreamCode?: string;
};

export type MessageStartedEvent = {
  type: 'message_started';
  data: {
    messageId: string;
  };
};

export type MessageDeltaEvent = {
  type: 'message_delta';
  data: {
    messageId: string;
    delta: string;
  };
};

export type SqlGeneratedEvent = {
  type: 'sql_generated';
  data: {
    sql: string;
  };
};

export type SqlResultEvent = {
  type: 'sql_result';
  data: {
    rowCount: number;
    columns: string[];
    rows: Record<string, unknown>[];
  };
};

export type ArtifactEvent = {
  type: 'artifact';
  data: {
    artifactType: 'TEXT' | 'SQL' | 'TABLE' | 'CHART' | 'ERROR';
    payload: Record<string, unknown>;
  };
};

export type ChartGeneratedEvent = {
  type: 'chart_generated';
  data: {
    chartType: string;
    title?: string;
    spec: Record<string, unknown>;
    config?: Record<string, unknown>;
  };
};

export type MessageCompletedEvent = {
  type: 'message_completed';
  data: {
    messageId: string;
    content: string;
    tokenUsage?: TokenUsage;
  };
};

export type MessageFailedEvent = {
  type: 'message_failed';
  data: {
    messageId: string;
    error: string;
    errorInfo?: AgentErrorInfo;
  };
};

export type AgentStepEvent = {
  type: 'agent_step';
  data: {
    text: string;
  };
};

export type SuggestionsGeneratedEvent = {
  type: 'suggestions_generated';
  data: {
    messageId: string;
    suggestions: string[];
  };
};

export type AgentStreamEvent =
  | MessageStartedEvent
  | MessageDeltaEvent
  | SqlGeneratedEvent
  | SqlResultEvent
  | ChartGeneratedEvent
  | ArtifactEvent
  | MessageCompletedEvent
  | MessageFailedEvent
  | AgentStepEvent
  | SuggestionsGeneratedEvent;

export type CreateConversationInput = {
  databaseSourceId: string;
  llmConnectionId: string;
  title?: string;
};

export type CreateConversationBody = {
  databaseSourceId?: unknown;
  llmConnectionId?: unknown;
  title?: unknown;
};

export type SendConversationMessageBody = {
  content?: unknown;
};

export type PersistedMessageArtifact = {
  id: string;
  type: MessageArtifactType;
  payload: unknown;
  createdAt: Date;
};

export type PersistedConversationMessage = {
  id: string;
  role: MessageRole;
  status: MessageStatus;
  content: string;
  error: string | null;
  tokenUsage: TokenUsage | null;
  suggestions: string[];
  createdAt: Date;
  updatedAt: Date;
  artifacts: PersistedMessageArtifact[];
};
