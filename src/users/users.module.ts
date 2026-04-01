import { Module } from '@nestjs/common';
import { DatabaseSourcesModule } from '../database-sources/database-sources.module';
import { LlmConnectionsModule } from '../llm-connections/llm-connections.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [DatabaseSourcesModule, LlmConnectionsModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
