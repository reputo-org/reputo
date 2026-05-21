-- CreateEnum
CREATE TYPE "snapshot_status" AS ENUM ('queued', 'running', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "oauth_provider" AS ENUM ('deep-id');

-- CreateEnum
CREATE TYPE "access_role" AS ENUM ('owner', 'admin');

-- CreateTable
CREATE TABLE "algorithm_preset" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "inputs" JSONB NOT NULL DEFAULT '[]',
    "name" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "algorithm_preset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "snapshot" (
    "id" TEXT NOT NULL,
    "status" "snapshot_status" NOT NULL DEFAULT 'queued',
    "algorithm_preset_id" TEXT NOT NULL,
    "algorithm_preset_frozen" JSONB NOT NULL,
    "temporal" JSONB,
    "outputs" JSONB,
    "error" JSONB,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_user" (
    "id" TEXT NOT NULL,
    "provider" "oauth_provider" NOT NULL,
    "sub" TEXT NOT NULL,
    "aud" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "auth_time" INTEGER,
    "email" TEXT,
    "email_verified" BOOLEAN,
    "iat" INTEGER,
    "iss" TEXT,
    "picture" TEXT,
    "rat" INTEGER,
    "username" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_session" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "provider" "oauth_provider" NOT NULL,
    "user_id" TEXT NOT NULL,
    "access_token_ciphertext" TEXT NOT NULL,
    "refresh_token_ciphertext" TEXT NOT NULL,
    "access_token_expires_at" TIMESTAMP(3) NOT NULL,
    "refresh_token_expires_at" TIMESTAMP(3) NOT NULL,
    "scope" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "state" TEXT NOT NULL,
    "code_verifier" TEXT NOT NULL,
    "last_refreshed_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_consent_grant" (
    "id" TEXT NOT NULL,
    "provider" "oauth_provider" NOT NULL,
    "source" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "code_verifier" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_consent_grant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_allowlist" (
    "id" TEXT NOT NULL,
    "provider" "oauth_provider" NOT NULL,
    "email" TEXT NOT NULL,
    "role" "access_role" NOT NULL,
    "invited_by" TEXT,
    "invited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "revoked_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "access_allowlist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "algorithm_preset_key_idx" ON "algorithm_preset"("key");

-- CreateIndex
CREATE INDEX "algorithm_preset_version_idx" ON "algorithm_preset"("version");

-- CreateIndex
CREATE INDEX "algorithm_preset_key_version_idx" ON "algorithm_preset"("key", "version");

-- CreateIndex
CREATE INDEX "snapshot_algorithm_preset_id_idx" ON "snapshot"("algorithm_preset_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_user_provider_sub_key" ON "oauth_user"("provider", "sub");

-- CreateIndex
CREATE UNIQUE INDEX "auth_session_session_id_key" ON "auth_session"("session_id");

-- CreateIndex
CREATE INDEX "auth_session_user_id_idx" ON "auth_session"("user_id");

-- CreateIndex
CREATE INDEX "auth_session_expires_at_idx" ON "auth_session"("expires_at");

-- CreateIndex
CREATE INDEX "auth_session_revoked_at_idx" ON "auth_session"("revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_consent_grant_state_key" ON "oauth_consent_grant"("state");

-- CreateIndex
CREATE INDEX "oauth_consent_grant_provider_source_idx" ON "oauth_consent_grant"("provider", "source");

-- CreateIndex
CREATE INDEX "access_allowlist_revoked_at_idx" ON "access_allowlist"("revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "access_allowlist_provider_email_key" ON "access_allowlist"("provider", "email");

-- AddForeignKey
ALTER TABLE "snapshot" ADD CONSTRAINT "snapshot_algorithm_preset_id_fkey" FOREIGN KEY ("algorithm_preset_id") REFERENCES "algorithm_preset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "oauth_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_allowlist" ADD CONSTRAINT "access_allowlist_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "oauth_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_allowlist" ADD CONSTRAINT "access_allowlist_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "oauth_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Functional index supporting Snapshot lookups by the frozen preset's
-- key/version (Mongo had a composite index on
-- `algorithmPresetFrozen.key` + `algorithmPresetFrozen.version`). Prisma
-- cannot model JSON path indexes in `schema.prisma`, so it is declared in
-- raw SQL here.
CREATE INDEX "snapshot_frozen_key_version_idx" ON "snapshot" (
    ("algorithm_preset_frozen" ->> 'key'),
    ("algorithm_preset_frozen" ->> 'version')
);
