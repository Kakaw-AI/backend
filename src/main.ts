import 'dotenv/config';
import 'reflect-metadata';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ensureDatabaseReady } from './config/database.bootstrap';
import { loadInfisicalSecrets } from './config/infisical.bootstrap';

async function bootstrap() {
  // Load secrets from Infisical into process.env BEFORE importing any module
  // that reads env at import time (better-auth.config, Prisma datasource).
  await loadInfisicalSecrets();

  // Create the database if missing and apply migrations before the app boots
  // (Prisma connects during AppModule init).
  await ensureDatabaseReady();

  const [
    { Logger },
    { NestFactory },
    { toNodeHandler },
    { json, urlencoded },
    { AppModule },
    { auth },
  ] = await Promise.all([
    import('@nestjs/common'),
    import('@nestjs/core'),
    import('better-auth/node'),
    import('express'),
    import('./app.module'),
    import('./auth/better-auth.config'),
  ]);

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
