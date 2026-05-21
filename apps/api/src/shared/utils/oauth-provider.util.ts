import type { OAuthProvider as PrismaOAuthProvider } from '@prisma/client';
import type { OAuthProvider } from '@reputo/database';

// The wire form is hyphenated (`deep-id`) so it stays stable across HTTP,
// Temporal, and Mongo. The Prisma enum label cannot contain hyphens, so the
// schema maps `deep_id @map("deep-id")` and the generated TS literal is
// `'deep_id'`. Translate at the repository boundary so callers above the
// repos keep using the wire form.

export function toPrismaProvider(provider: OAuthProvider): PrismaOAuthProvider {
  return provider.replace(/-/g, '_') as PrismaOAuthProvider;
}

export function toWireProvider(provider: PrismaOAuthProvider): OAuthProvider {
  return provider.replace(/_/g, '-') as OAuthProvider;
}
