# syntax=docker/dockerfile:1

# Debian (glibc), not Alpine (musl): onnxruntime-node ships glibc-only prebuilt
# binaries for the local embedding model. On musl it fails to load, and the
# library's WASM fallback is both slower and not something to depend on
# silently in production. The slim image also already carries the OpenSSL that
# Prisma's query engine needs, so the previous `apk add openssl` is gone.

# ── deps ─────────────────────────────────────────────────────────────────────
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── build ────────────────────────────────────────────────────────────────────
FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Generate the Prisma client against the schema, then compile Nest.
RUN npx prisma generate && npm run build
# Download the embedding model now so the runtime image never reaches out to
# huggingface.co. It lands in node_modules/@huggingface/transformers/.cache in
# the {modelId}/... layout that EMBEDDING_MODEL_PATH expects.
RUN node scripts/fetch-embedding-model.cjs \
    && mkdir -p /app/models \
    && cp -r node_modules/@huggingface/transformers/.cache/. /app/models/

# ── prune ────────────────────────────────────────────────────────────────────
# onnxruntime ships every platform's binaries (211 MB) plus a full WASM build
# (130 MB). A linux/x64 image needs one 34 MB native binary. The node build of
# transformers.js never requires onnxruntime-web at all — verified by removing
# the package and re-running the model.
FROM build AS pruned
RUN find node_modules/onnxruntime-node/bin/napi-v6 -mindepth 1 -maxdepth 1 \
      ! -name linux -exec rm -rf {} + \
 && find node_modules/onnxruntime-node/bin/napi-v6/linux -mindepth 1 -maxdepth 1 \
      ! -name x64 -exec rm -rf {} + \
 && rm -rf node_modules/onnxruntime-web \
 && rm -rf node_modules/@huggingface/transformers/.cache

# ── runtime ──────────────────────────────────────────────────────────────────
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Serve the model from the image; never fetch at runtime.
ENV EMBEDDING_MODEL_PATH=/app/models
# Full node_modules are kept on purpose: boot runs `npx prisma migrate deploy`
# (see src/config/database.bootstrap.ts), which needs the Prisma CLI.
COPY --from=pruned /app/node_modules ./node_modules
COPY --from=pruned /app/dist ./dist
COPY --from=pruned /app/prisma ./prisma
COPY --from=pruned /app/models ./models
COPY package.json ./
USER node
EXPOSE 3001
CMD ["node", "dist/main"]
