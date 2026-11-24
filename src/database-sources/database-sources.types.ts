export const SUPPORTED_DATABASE_PROVIDERS = [
  'postgresql',
  'mongodb',
  'sqlite',
] as const;

export type SupportedDatabaseProvider =
  (typeof SUPPORTED_DATABASE_PROVIDERS)[number];

export type ConnectionStringProvider = Exclude<SupportedDatabaseProvider, 'sqlite'>;

const PROVIDER_LABELS: Record<SupportedDatabaseProvider, string> = {
  postgresql: 'PostgreSQL',
  mongodb: 'MongoDB',
  sqlite: 'SQLite',
};

/** Display name for a stored provider string; unknown values pass through. */
export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider as SupportedDatabaseProvider] ?? provider;
}

export const SQLITE_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
export const SQLITE_ALLOWED_EXTENSIONS = new Set([
  '.db',
  '.sqlite',
  '.sqlite3',
]);
