import type { IncomingMessage, ServerResponse } from 'node:http';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { toNodeHandler } from 'better-auth/node';
import { json, urlencoded } from 'express';
import 'reflect-metadata';
import { AppModule } from './app.module';
import { auth } from './auth/better-auth.config';

async function bootstrap() {
  // bodyParser: false — Better Auth must read the raw body stream itself.
  // NestJS's built-in body-parser would consume the stream before Better Auth.
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const logger = new Logger('Bootstrap');
  const authHandler = toNodeHandler(auth);
  const expressApp = app.getHttpAdapter().getInstance();

  const captureRawBody = (
    req: IncomingMessage & { rawBody?: Buffer },
    _res: ServerResponse,
    buffer: Buffer,
  ) => {
    req.rawBody = Buffer.from(buffer);
  };

  // Better Auth docs recommend an Express catch-all auth route. With
  // Express v5, `/{*any}` is the supported wildcard syntax.
  expressApp.all('/api/auth', authHandler);
  expressApp.all('/api/auth/{*any}', authHandler);

  // Re-add body parsing for all NestJS-handled routes.
  app.use(json({ verify: captureRawBody }));
  app.use(urlencoded({ extended: true, verify: captureRawBody }));

  app.setGlobalPrefix('api');

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  logger.log(`Server running on http://localhost:${port}`);
  logger.log(`Better Auth at http://localhost:${port}/api/auth`);
}

bootstrap();
