import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Opts a route out of the global AuthGuard (and the per-user rate limit). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
