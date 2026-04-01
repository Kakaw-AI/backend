import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AgentGatewayService } from '../chat/agent-gateway.service';
import { InternalAgentAuthService } from '../chat/internal-agent-auth.service';

@Module({
  imports: [ConfigModule],
  providers: [AgentGatewayService, InternalAgentAuthService],
  exports: [AgentGatewayService, InternalAgentAuthService],
})
export class AgentRuntimeModule {}
