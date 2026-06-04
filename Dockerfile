# syntax=docker/dockerfile:1

# ── deps ─────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── build ────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Generate the Prisma client against the schema, then compile Nest.
RUN npx prisma generate && npm run build

# ── runtime ──────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
# OpenSSL is required by Prisma's query engine on Alpine.
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
# Full node_modules are kept on purpose: boot runs `npx prisma migrate deploy`
# (see src/config/database.bootstrap.ts), which needs the Prisma CLI.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json ./
USER node
EXPOSE 3001
CMD ["node", "dist/main"]
