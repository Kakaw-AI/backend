import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { DatabaseSourcesModule } from './database-sources/database-sources.module';
import { LlmConnectionsModule } from './llm-connections/llm-connections.module';
import { UsersModule } from './users/users.module';
import { ChatModule } from './chat/chat.module';
import { AuthGuard } from './common/guards/auth.guard';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';

const isProd = process.env.NODE_ENV === 'production';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        // Every line carries service="backend" so Loki can split by service.
        base: { service: 'backend' },
        messageKey: 'message',
        // ISO timestamps so Loki/Grafana parse `time` cleanly.
        timestamp: () => `,"time":"${new Date().toISOString()}"`,
        // Emit the level as a string label ("info"/"error") instead of pino's
        // numeric code, so Alloy can lift it into a Loki label.
        formatters: { level: (label: string) => ({ level: label }) },
        // Keep session cookies and the agent HMAC out of the logs.
        redact: [
          'req.headers.cookie',
          'req.headers.authorization',
          'req.headers["x-kakaw-signature"]',
        ],
        // Reuse an inbound request id or mint one, and echo it back for tracing.
        genReqId: (req: IncomingMessage, res: ServerResponse) => {
          const header = req.headers['x-request-id'];
          const existing = Array.isArray(header) ? header[0] : header;
          const id = existing ?? randomUUID();
          res.setHeader('x-request-id', id);
          return id;
        },
        autoLogging: {
          // The middleware polls these constantly; don't drown the logs.
          ignore: (req: IncomingMessage) =>
            req.url === '/api/auth/get-session' ||
            req.url === '/api/me/onboarding-state',
        },
        // Human-readable colorized logs locally; raw JSON in prod.
        ...(isProd
          ? {}
          : { transport: { target: 'pino-pretty', options: { singleLine: true } } }),
      },
    }),
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
