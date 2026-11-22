import { Injectable } from '@nestjs/common';
import { AgentGatewayService } from './agent-gateway.service';
import { AgentStreamEvent } from './chat.types';

type StreamChatInput = Parameters<AgentGatewayService['streamChat']>[0];
type StreamChatSignal = Parameters<AgentGatewayService['streamChat']>[1];

@Injectable()
export class MessageStreamingService {
  constructor(private readonly agentGatewayService: AgentGatewayService) {}

  createRequestId(): string {
    return this.agentGatewayService.createRequestId();
  }

  streamFromAgent(
    input: StreamChatInput,
    signal?: StreamChatSignal,
  ): AsyncIterable<AgentStreamEvent> {
    return this.agentGatewayService.streamChat(input, signal);
  }
}
