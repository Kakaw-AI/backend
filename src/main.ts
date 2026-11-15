import 'dotenv/config';
// Telemetry must initialize before any instrumented module is imported so the
// OpenTelemetry auto-instrumentations can patch http/express/pg/nestjs.
import { shutdownTelemetry } from './telemetry';
import 'reflect-metadata';
// `import x = require()` because compression is a CommonJS `export =` module:
// a dynamic import() of it has no `.default` under this tsconfig, so the
// destructured default was undefined and the server died on boot.
import compression = require('compression');
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
    { Logger: PinoLogger },
  ] = await Promise.all([
    import('@nestjs/common'),
    import('@nestjs/core'),
    import('better-auth/node'),
    import('express'),
    import('./app.module'),
    import('./auth/better-auth.config'),
    import('nestjs-pino'),
  ]);

  // bodyParser: false — Better Auth must read the raw body stream itself.
  // NestJS's built-in body-parser would consume the stream before Better Auth.
  // bufferLogs: true holds boot logs until the pino logger is wired in below.
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    bufferLogs: true,
  });

  // Route all Nest logging (including `new Logger(ctx)` calls everywhere) through
  // pino, so the backend emits structured JSON like the agent does.
  app.useLogger(app.get(PinoLogger));

  // The browser calls this API directly from the frontend origin (a same-site
  // subdomain), so credentialed CORS must be enabled. Registered before the
  // Better Auth routes below so preflight + headers cover /api/auth too.
  app.enableCors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    credentials: true,
  });

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

  // Conversation payloads carry every message with its full result-set
  // artifacts, so they compress well. The NDJSON chat stream is excluded: gzip
  // buffers until its window fills, which would hold back streamed tokens.
  app.use(
    compression({
      filter: (req, res) => {
        const contentType = String(res.getHeader('content-type') ?? '');
        if (contentType.includes('ndjson')) {
          return false;
        }
        return compression.filter(req, res);
      },
    }),
  );

  // Re-add body parsing for all NestJS-handled routes.
  app.use(json({ verify: captureRawBody }));
  app.use(urlencoded({ extended: true, verify: captureRawBody }));

  app.setGlobalPrefix('api');

  // Stop accepting connections, let in-flight requests finish, close Prisma
  // (app.close runs the module destroy hooks), then flush telemetry. Docker's
  // default stop grace period is 10s, so the wait is capped inside it; raise
  // both together if long chat streams should survive a deploy.
  const shutdown = () => {
    const deadline = new Promise<void>((resolve) => {
      setTimeout(resolve, 8_000).unref();
    });
    void Promise.race([app.close(), deadline])
      .catch(() => undefined)
      .then(shutdownTelemetry)
      .finally(() => process.exit(0));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  logger.log(`Server running on http://localhost:${port}`);
  logger.log(`Better Auth at http://localhost:${port}/api/auth`);
}

bootstrap();
