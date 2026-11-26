<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/banner-dark.svg">
  <img alt="backend — kakaw-ai by gitnasr" src=".github/banner-light.svg" width="100%">
</picture>

The API behind [Kakaw AI](https://kakaw.gitnasr.com): sign-in, chat, saved database connections, what Kakaw learns about those databases, and streaming answers back from the [agent](https://github.com/Kakaw-AI/agent).

[Frontend](https://github.com/Kakaw-AI/frontend) · [Agent](https://github.com/Kakaw-AI/agent) · [Monitoring](https://github.com/Kakaw-AI/monitoring) · [Site](https://kakaw.gitnasr.com)

## What is in here

NestJS with Prisma on PostgreSQL (the app's own database; users connect PostgreSQL, MongoDB or SQLite). The modules in `src/`:

| Module | What it does |
| --- | --- |
| `auth` | Sign-in with better-auth |
| `users` | User records |
| `chat` | Conversations, messages, artifacts, and streaming from the agent |
| `agent-runtime` | Runtime wiring for the agent |
| `database-sources` | The databases people connect |
| `database-knowledge` | What Kakaw keeps about a connected database |
| `llm-connections` | The LLM provider each user brings |
| `retrieval` | Embeddings and query memory (the model is fetched by `scripts/fetch-embedding-model.cjs`) |
| `storage` | S3 object storage |
| `telemetry.ts` | OpenTelemetry traces, metrics and logs |

## Run it

```bash
npm install
npm run prisma:generate
npm run prisma:migrate     # needs DATABASE_URL
npm run start:dev
```

| Script | |
| --- | --- |
| `npm run build` / `start:prod` | Build with Nest, run `dist/main` |
| `npm test` / `test:watch` | Vitest |
| `npm run lint` | ESLint (CI runs lint and tests on every push) |
| `npm run prisma:studio` | Browse the database |
| `npm run backfill:query-memory` | Rebuild stored query memory |

## Configuration

Secrets are read from Infisical at boot. Set `INFISICAL_CLIENT_ID`, `INFISICAL_CLIENT_SECRET`, `INFISICAL_PROJECT_ID`, `INFISICAL_ENVIRONMENT`, `INFISICAL_SECRET_PATH` and `INFISICAL_SITE_URL`. `DATABASE_URL` is the PostgreSQL connection string. Never commit a `.env` file.

## Safeguards

- LLM API keys and database connection strings are encrypted at rest with `LLM_CONNECTIONS_ENCRYPTION_KEY`.
- Every signed-in user has a request budget per minute; chat runs, syncs and connection checks have tighter ones (`src/common/guards/rate-limit.guard.ts`). The counters are in memory, which is correct for a single replica.
- A custom LLM base URL that points at a private or internal address is refused in production (`ALLOW_PRIVATE_HOSTS=true` turns that off for self-hosted installs).
- `GET /api/health` reports whether the API can reach its database. The image uses it as its health check.
- Users can delete a database source (`DELETE /api/database-sources/:id`) or their whole account (`DELETE /api/me`); uploaded files are removed with them.

## Docker

The `Dockerfile` is a multi-stage build on `node:22-slim`. CI builds and publishes the image on pushes to `master` and on `v*` tags.
