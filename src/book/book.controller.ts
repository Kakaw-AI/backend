import { BadRequestException, Body, Controller, Get, Param, Post } from '@nestjs/common';
import { AuthUser } from '../auth/better-auth.config';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RateLimit } from '../common/guards/rate-limit.guard';
import { BookService } from './book.service';

/** The knowledge book of one database: status, start ("Improve accuracy") and cancel. */
@Controller('database-sources/:id/book')
export class BookController {
  constructor(private readonly bookService: BookService) {}

  @Get()
  getStatus(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bookService.getStatus(user, id);
  }

  @RateLimit(10)
  @Post()
  start(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: { llmConnectionId?: unknown }) {
    const llmConnectionId = typeof body.llmConnectionId === 'string' ? body.llmConnectionId.trim() : '';
    if (!llmConnectionId) {
      throw new BadRequestException('llmConnectionId is required');
    }
    return this.bookService.start(user, id, llmConnectionId);
  }

  @Post('cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bookService.cancel(user, id);
  }
}
