export const SUPPORTED_DATABASE_PROVIDERS = ['postgresql', 'sqlite'] as const;

export type SupportedDatabaseProvider =
  (typeof SUPPORTED_DATABASE_PROVIDERS)[number];

export const SQLITE_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
export const SQLITE_ALLOWED_EXTENSIONS = new Set([
  '.db',
  '.sqlite',
  '.sqlite3',
]);
