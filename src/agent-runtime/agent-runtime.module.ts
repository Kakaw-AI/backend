import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AgentGatewayService } from '../chat/agent-gateway.service';

@Module({
  imports: [ConfigModule],
  providers: [AgentGatewayService],
  exports: [AgentGatewayService],
})
export class AgentRuntimeModule {}
