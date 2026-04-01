import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { DatabaseSourcesModule } from './database-sources/database-sources.module';
import { LlmConnectionsModule } from './llm-connections/llm-connections.module';
import { UsersModule } from './users/users.module';
import { ChatModule } from './chat/chat.module';
import { AuthGuard } from './common/guards/auth.guard';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    DatabaseSourcesModule,
    LlmConnectionsModule,
    UsersModule,
    ChatModule,
  ],
  providers: [
    // Global auth guard — use @Public() to opt out on specific routes
    { provide: APP_GUARD, useClass: AuthGuard },
    // Global exception filter
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}
