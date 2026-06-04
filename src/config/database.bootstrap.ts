import { execSync } from 'node:child_process';
import { Logger } from '@nestjs/common';
import { Client } from 'pg';

const logger = new Logger('DatabaseBootstrap');

function getDatabaseName(databaseUrl: string): string | null {
  try {
    const url = new URL(databaseUrl);
    const segment = url.pathname.replace(/^\//, '').split('/')[0];
    return segment ? decodeURIComponent(segment) : null;
  } catch {
    return null;
  }
}

/**
 * Connects to the server's maintenance database (`postgres`) and creates the
 * target database if it doesn't exist yet. Prisma cannot do this at connect
 * time — it only manages schema/tables inside an existing database.
 *
 * Requires the connecting role to have CREATE DATABASE privilege. On managed /
 * pooled Postgres where that isn't allowed, this is a no-op-on-failure and the
 * subsequent migrate step surfaces the real error.
 */
async function ensureDatabaseExists(databaseUrl: string): Promise<void> {
  const dbName = getDatabaseName(databaseUrl);
  if (!dbName || dbName === 'postgres') {
    return;
  }

  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = '/postgres';

  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    const result = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName],
    );

    if (result.rowCount === 0) {
      logger.log(`Database "${dbName}" does not exist — creating it.`);
      // Identifiers can't be parameterized; quote-escape to stay injection-safe.
      await client.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
    }
  } finally {
    await client.end();
  }
}

/**
 * Ensures the database exists and all migrations are applied. Call once during
 * startup, after secrets are loaded and before the Nest app initializes Prisma.
 */
export async function ensureDatabaseReady(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return;
  }

  try {
    await ensureDatabaseExists(databaseUrl);
  } catch (error) {
    logger.warn(
      `Could not auto-create the database (continuing to migrations): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  logger.log('Applying database migrations...');
  execSync('npx prisma migrate deploy', { stdio: 'inherit' });
  logger.log('Database is ready.');
}
