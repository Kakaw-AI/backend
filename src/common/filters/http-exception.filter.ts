import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import {
  normalizeApiError,
  toApiErrorResponse,
} from '../errors/error-response';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const error = normalizeApiError(exception);

    if (error.statusCode >= 500) {
      this.logger.error(exception);
    }

    response
      .status(error.statusCode)
      .json(
        toApiErrorResponse(error, {
          timestamp: new Date().toISOString(),
          path: request.url,
        }),
      );
  }
}
