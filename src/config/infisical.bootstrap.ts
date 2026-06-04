import { InfisicalSDK } from '@infisical/sdk';

const DEFAULT_SITE_URL = 'https://hush.gitnasr.com';

function resolveEnvironment(): string {
  const explicit = process.env.INFISICAL_ENVIRONMENT?.trim();
  if (explicit) {
    return explicit;
  }
  return process.env.NODE_ENV === 'production' ? 'prod' : 'dev';
}

/**
 * Fetches secrets from Infisical (via universal-auth machine identity) and
 * injects them into `process.env` BEFORE the app modules that read env at
 * import time (e.g. better-auth.config, Prisma) are loaded.
 *
 * Existing real env vars take precedence over fetched values, so the
 * INFISICAL_* bootstrap creds, NODE_ENV, and container overrides are never
 * clobbered. If the bootstrap creds are absent, this is a no-op and the app
 * falls back to whatever is already in the environment (local `.env`).
 */
export async function loadInfisicalSecrets(): Promise<void> {
  const siteUrl = process.env.INFISICAL_SITE_URL?.trim() || DEFAULT_SITE_URL;
  const projectId = process.env.INFISICAL_PROJECT_ID?.trim();
  const clientId = process.env.INFISICAL_CLIENT_ID?.trim();
  const clientSecret = process.env.INFISICAL_CLIENT_SECRET?.trim();

  if (!projectId || !clientId || !clientSecret) {
    return;
  }

  const environment = resolveEnvironment();
  const client = new InfisicalSDK({ siteUrl });
  await client.auth().universalAuth.login({ clientId, clientSecret });

  const { secrets } = await client.secrets().listSecrets({
    environment,
    projectId,
    secretPath: process.env.INFISICAL_SECRET_PATH?.trim() || '/',
    expandSecretReferences: true,
    viewSecretValue: true,
  });

  for (const secret of secrets) {
    if (process.env[secret.secretKey] === undefined) {
      process.env[secret.secretKey] = secret.secretValue;
    }
  }
}
