import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { diskStorage } from 'multer';
import type { Request } from 'express';
import {
  SQLITE_ALLOWED_EXTENSIONS,
  SQLITE_UPLOAD_FIELD_NAME,
  SQLITE_UPLOAD_MAX_BYTES,
} from './database-sources.types';

type RequestWithFileValidation = Request & {
  fileValidationError?: string;
};

const SQLITE_UPLOAD_DIR = resolve(process.cwd(), 'uploads', 'sqlite');

function ensureSqliteUploadDir() {
  mkdirSync(SQLITE_UPLOAD_DIR, { recursive: true });
}

function normalizeExtension(filename: string) {
  return extname(filename).toLowerCase();
}

export const sqliteFileInterceptorOptions: MulterOptions = {
  storage: diskStorage({
    destination: (_request, _file, callback) => {
      ensureSqliteUploadDir();
      callback(null, SQLITE_UPLOAD_DIR);
    },
    filename: (_request, file, callback) => {
      const extension = normalizeExtension(file.originalname);
      callback(null, `${Date.now()}-${randomUUID()}${extension}`);
    },
  }),
  fileFilter: (request, file, callback) => {
    const extension = normalizeExtension(file.originalname);

    if (SQLITE_ALLOWED_EXTENSIONS.has(extension)) {
      callback(null, true);
      return;
    }

    (request as RequestWithFileValidation).fileValidationError =
      'SQLite uploads must use a .db, .sqlite, or .sqlite3 file.';
    callback(null, false);
  },
  limits: {
    fileSize: SQLITE_UPLOAD_MAX_BYTES,
    files: 1,
  },
};

export { SQLITE_UPLOAD_DIR, SQLITE_UPLOAD_FIELD_NAME };
