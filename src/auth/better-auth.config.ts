import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { PrismaClient } from '@prisma/client';

// Shared PrismaClient instance for Better Auth.
// This is separate from the NestJS-managed PrismaService because Better Auth
// initialises at module load time, before NestJS DI is ready.
const prisma = new PrismaClient();

// When the API and frontend are on different subdomains of one site (e.g.
// api.kakaw.gitnasr.com + kakaw.gitnasr.com), set COOKIE_DOMAIN to the shared
// parent (".gitnasr.com") so the session cookie is sent to both — the frontend
// middleware reads it and the API receives it on credentialed requests.
const cookieDomain = process.env.COOKIE_DOMAIN;

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),

  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3001',
  secret: process.env.BETTER_AUTH_SECRET,

  ...(cookieDomain
    ? {
        advanced: {
          crossSubDomainCookies: { enabled: true, domain: cookieDomain },
        },
      }
    : {}),

  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    },
  },

  trustedOrigins: [process.env.FRONTEND_URL ?? 'http://localhost:3000'],
});

export type AuthSession = typeof auth.$Infer.Session;
export type AuthUser = typeof auth.$Infer.Session.user;
