import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DatabaseSourceStatus, MessageStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Both limits sit well past the longest a healthy run can take: a chat stream
// is cut at 30 minutes (agent-gateway) and a sync at 60 seconds plus the catalog
// write.
const STREAM_STALE_MS = 35 * 60_000;
const SYNC_STALE_MS = 5 * 60_000;

/**
 * Streams and syncs run inside the process that started them. If that process
 * restarts mid-flight nothing ever finishes the row: the message stays
 * STREAMING and the source stays SYNCING, which parks the user on the
 * onboarding sync page for good. This fails those rows so the UI offers a retry.
 *
 * Age-based rather than "everything in flight at boot", so it stays correct
 * during a rolling deploy when the old process is still working.
 */
@Injectable()
export class StaleStateSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StaleStateSweeper.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    void this.sweep();
    this.timer = setInterval(() => void this.sweep(), 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async sweep() {
    try {
      const messages = await this.prisma.message.updateMany({
        where: {
          status: MessageStatus.STREAMING,
          updatedAt: { lt: new Date(Date.now() - STREAM_STALE_MS) },
        },
        data: {
          status: MessageStatus.FAILED,
          error: 'The response was interrupted. Please try again.',
        },
      });
      const sources = await this.prisma.databaseSource.updateMany({
        where: {
          status: {
            in: [DatabaseSourceStatus.PENDING, DatabaseSourceStatus.SYNCING],
          },
          updatedAt: { lt: new Date(Date.now() - SYNC_STALE_MS) },
        },
        data: {
          status: DatabaseSourceStatus.FAILED,
          lastError: 'The sync was interrupted. Refresh the connection to try again.',
        },
      });

      if (messages.count || sources.count) {
        this.logger.warn(
          `Failed ${messages.count} stale message(s) and ${sources.count} stale sync(s).`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Stale state sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
