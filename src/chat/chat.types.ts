import {
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import {
  LlmConnectionStatus,
  MessageArtifactType,
  MessageRole,
  MessageStatus,
} from '@prisma/client';
import { normalizeApiError } from '../common/errors/error-response';
import { DatabaseKnowledgeRuntime } from '../database-knowledge/database-knowledge.types';
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
    schemaFingerprint?: string;
    connectionString?: string;
    sqliteFilePath?: string;
    sqliteOriginalFilename?: string;
  };

export type AgentDatabaseContext = {
  runtime: AgentDatabaseRuntime;
  knowledge: DatabaseKnowledgeRuntime;
};

export type AgentLlmRuntime = {
  connectionId: string;
  provider: SupportedLlmProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
};

export type AgentRunRequest = {
  requestId: string;
  conversationId: string;
  userId: string;
  messageId: string;
  message: string;
  history: AgentHistoryMessage[];
  database: AgentDatabaseRuntime;
  knowledge: DatabaseKnowledgeRuntime;
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
  schemaFingerprint: string;
  syncedAt: string;
  syncMetadata: Record<string, unknown>;
  catalog: {
    tables: DatabaseKnowledgeRuntime['tables'];
    knowledgeDocuments: DatabaseKnowledgeRuntime['knowledgeDocuments'];
  };
  error?: string;
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type VisualizationRequest = {
  categoryFields: string[];
  metricField: string | null;
  seriesField: string | null;
  groupField: string | null;
  networkViewRequested: boolean;
};

export type VisualizationCapabilityKind =
  | 'simple_xy_chart'
  | 'grouped_bar'
  | 'stacked_bar'
  | 'network_graph'
  | 'unsupported_needs_narrowing';

export type VisualizationCapabilityDecision = {
  kind: VisualizationCapabilityKind;
  supported: boolean;
  reason: string | null;
  requestedCategoryFields: string[];
  metricField: string | null;
  seriesField: string | null;
  groupField: string | null;
  networkViewRequested: boolean;
};

export type VisualizationValidationStatus = 'pending' | 'valid' | 'invalid' | 'narrowed';

export type VisualizationValidationResult = {
  status: VisualizationValidationStatus;
  errors: string[];
  narrowedFrom: string[];
  droppedFields: string[];
};

export type VisualizationOutcome = {
  request: VisualizationRequest;
  capabilityDecision: VisualizationCapabilityDecision | null;
  validation: VisualizationValidationResult | null;
  narrowingReason: string | null;
};

export type TraceAnalyticsOutcome =
  | 'failed'
  | 'no_rows'
  | 'narrowed'
  | 'chart_rendered'
  | 'completed_text';

export type PersistedAgentTraceMetadata = {
  chartSpec?: Record<string, unknown> | null;
  visualizationOutcome?: VisualizationOutcome | null;
  analyticsOutcome?: TraceAnalyticsOutcome | null;
  rowCount?: number | null;
};

export type VisualizationChartSpecBase = {
  kind: 'bar' | 'line' | 'pie' | 'scatter' | 'histogram' | 'network';
  title?: string;
  xField: string;
  yField: string;
  xLabel: string;
  yLabel: string;
  data: Array<Record<string, unknown>>;
  seriesField?: string | null;
  stacked?: boolean;
  legendLabel?: string | null;
  validation?: VisualizationValidationResult | null;
  visualization?: VisualizationOutcome | null;
};

export type VisualizationChartSpec = VisualizationChartSpecBase & Record<string, unknown>;

export type AgentErrorInfo = {
  message: string;
  code: string;
  statusCode: number;
  retryable: boolean;
  provider?: string;
  upstreamCode?: string;
  metadata?: {
    raw?: string;
  };
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
    spec: VisualizationChartSpec;
    visualizationOutcome?: VisualizationOutcome | null;
  };
};

export type MessageCompletedEvent = {
  type: 'message_completed';
  data: {
    messageId: string;
    content: string;
    tokenUsage?: TokenUsage;
    visualizationOutcome?: VisualizationOutcome | null;
    analyticsOutcome?: TraceAnalyticsOutcome;
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

export type AgentTraceEvent = {
  type: 'agent_trace';
  data: {
    steps: Array<{ text: string; at: string }>;
    toolCalls: Array<Record<string, unknown>>;
    repairHistory: Array<Record<string, unknown>>;
    cacheKey?: string;
    cacheHit?: boolean;
    chartSpec?: VisualizationChartSpec | null;
    visualizationOutcome?: VisualizationOutcome | null;
    analyticsOutcome?: TraceAnalyticsOutcome;
    rowCount?: number;
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
  | SuggestionsGeneratedEvent
  | AgentTraceEvent;

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

export type UpdateConversationRuntimeInput = {
  llmConnectionId: string;
  llmModelOverride: string | null;
};

export type UpdateConversationRuntimeBody = {
  llmConnectionId?: unknown;
  llmModelOverride?: unknown;
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
  agentRunTraces?: Array<{
    steps: unknown;
  }>;
};

export type ConversationDatabaseSourceResponse = {
  id: string;
  provider: 'postgresql' | 'sqlite';
  status: string;
  sqliteOriginalFilename: string | null;
  lastError: string | null;
  lastTestedAt: string | null;
  lastSyncedAt: string | null;
  syncRequestedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ConversationLlmConnectionResponse = {
  id: string;
  provider: SupportedLlmProvider;
  status: LlmConnectionStatus;
  displayName: string;
  defaultModel: string;
  apiKeyLastFour: string | null;
  usesLinkedAccount: boolean;
  linkedProviderId: string | null;
  isActive: boolean;
  lastError: string | null;
  lastTestedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ConversationRuntimeState = {
  effectiveModel: string | null;
  isMissing: boolean;
  isActive: boolean;
  isAvailableForChat: boolean;
  warning: string | null;
};

export type ConversationSummaryResponse = {
  id: string;
  title: string;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
  databaseSourceId: string;
  llmConnectionId: string | null;
  llmModelOverride: string | null;
  databaseSource: ConversationDatabaseSourceResponse;
  llmConnection: ConversationLlmConnectionResponse | null;
  runtime: ConversationRuntimeState;
};

export type ConversationMessageResponse = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  status: MessageStatus;
  content: string;
  error: string | null;
  tokenUsage: TokenUsage | null;
  suggestions: string[];
  createdAt: string;
  updatedAt: string;
  steps?: Array<{
    seq: number;
    text: string;
    done: boolean;
  }>;
  stepsCollapsed?: boolean;
  artifacts: Array<{
    id: string;
    type: MessageArtifactType;
    payload: unknown;
    createdAt: string;
  }>;
};

export type ConversationDetailsResponse = ConversationSummaryResponse & {
  messages: ConversationMessageResponse[];
};

export const RUNTIME_UNAVAILABLE_ERROR_CODE = 'LLM_CONNECTION_UNAVAILABLE';

export function buildRuntimeUnavailableException(message: string) {
  return new BadRequestException({
    error: {
      message,
      code: RUNTIME_UNAVAILABLE_ERROR_CODE,
      statusCode: HttpStatus.BAD_REQUEST,
      retryable: false,
    },
  });
}

export function toRuntimeUnavailableException(
  error: unknown,
  fallbackMessage = 'Selected LLM runtime is unavailable.',
) {
  const normalized = normalizeApiError(error, fallbackMessage);

  if (normalized.code === RUNTIME_UNAVAILABLE_ERROR_CODE) {
    return buildRuntimeUnavailableException(normalized.message);
  }

  if (
    error instanceof HttpException &&
    normalized.statusCode === HttpStatus.BAD_REQUEST
  ) {
    return buildRuntimeUnavailableException(normalized.message);
  }

  return null;
}
