import type { SupportedDatabaseProvider } from './database-sources.types';

/**
 * Format only. Which hosts may be dialled, and which MongoDB options are
 * allowed, is enforced by the agent on the connection it opens, where a
 * query-string override cannot get past it.
 */
export function connectionStringError(
  provider: Exclude<SupportedDatabaseProvider, 'sqlite'>,
  connectionString: string,
): string | null {
  if (provider === 'postgresql') {
    return /^postgres(ql)?:\/\/./i.test(connectionString)
      ? null
      : 'The connection string must be a URL starting with postgresql://';
  }

  // Not `new URL`: a replica-set string lists several host:port pairs.
  const match = /^mongodb(\+srv)?:\/\/[^/?]+(?:\/([^?]*))?/i.exec(
    connectionString,
  );
  if (!match) {
    return 'The connection string must start with mongodb:// or mongodb+srv://';
  }
  if (!match[2]) {
    return 'The connection string must name a database, e.g. mongodb+srv://user:pass@host/shop';
  }
  return null;
}
