import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial schema for the API database. Mirrors the snake_case + normalized
 * layout produced by Prisma tasks 14, 15, and 16; this is a one-shot rewrite
 * of the persistence layer in TypeORM. No data migration is performed — see
 * the Mongo → PG main task for the no-backwards-compat rule.
 */
export class Init1748000000000 implements MigrationInterface {
  name = 'Init1748000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "snapshot_status" AS ENUM ('queued', 'running', 'completed', 'failed', 'cancelled')`,
    );
    await queryRunner.query(`CREATE TYPE "oauth_provider" AS ENUM ('deep-id')`);
    await queryRunner.query(`CREATE TYPE "access_role" AS ENUM ('owner', 'admin')`);

    await queryRunner.query(`
      CREATE TABLE "algorithm_presets" (
        "id" UUID NOT NULL,
        "key" TEXT NOT NULL,
        "version" TEXT NOT NULL,
        "name" TEXT,
        "description" TEXT,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "algorithm_presets_pkey" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "algorithm_presets_key_idx" ON "algorithm_presets" ("key")`);
    await queryRunner.query(`CREATE INDEX "algorithm_presets_version_idx" ON "algorithm_presets" ("version")`);
    await queryRunner.query(
      `CREATE INDEX "algorithm_presets_key_version_idx" ON "algorithm_presets" ("key", "version")`,
    );

    await queryRunner.query(`
      CREATE TABLE "algorithm_preset_inputs" (
        "id" UUID NOT NULL,
        "algorithm_preset_id" UUID NOT NULL,
        "key" TEXT NOT NULL,
        "value" JSONB NOT NULL,
        "position" INTEGER NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "algorithm_preset_inputs_pkey" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "algorithm_preset_inputs_algorithm_preset_id_idx" ON "algorithm_preset_inputs" ("algorithm_preset_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "algorithm_preset_inputs_algorithm_preset_id_key_key" ON "algorithm_preset_inputs" ("algorithm_preset_id", "key")`,
    );
    await queryRunner.query(
      `ALTER TABLE "algorithm_preset_inputs" ADD CONSTRAINT "algorithm_preset_inputs_algorithm_preset_id_fkey" FOREIGN KEY ("algorithm_preset_id") REFERENCES "algorithm_presets"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    await queryRunner.query(`
      CREATE TABLE "snapshots" (
        "id" UUID NOT NULL,
        "status" "snapshot_status" NOT NULL DEFAULT 'queued',
        "algorithm_preset_id" UUID NOT NULL,
        "algorithm_preset_frozen" JSONB NOT NULL,
        "temporal" JSONB,
        "error" JSONB,
        "started_at" TIMESTAMP(3),
        "completed_at" TIMESTAMP(3),
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "snapshots_pkey" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "snapshots_algorithm_preset_id_idx" ON "snapshots" ("algorithm_preset_id")`);
    // Functional index supporting Snapshot lookups by the frozen preset's
    // key/version. TypeORM cannot model JSON path indexes on entities, so we
    // declare it in raw SQL here.
    await queryRunner.query(
      `CREATE INDEX "snapshots_frozen_key_version_idx" ON "snapshots" (("algorithm_preset_frozen" ->> 'key'), ("algorithm_preset_frozen" ->> 'version'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_algorithm_preset_id_fkey" FOREIGN KEY ("algorithm_preset_id") REFERENCES "algorithm_presets"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    );

    await queryRunner.query(`
      CREATE TABLE "snapshot_outputs" (
        "id" UUID NOT NULL,
        "snapshot_id" UUID NOT NULL,
        "key" TEXT NOT NULL,
        "value" TEXT NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "snapshot_outputs_pkey" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "snapshot_outputs_snapshot_id_idx" ON "snapshot_outputs" ("snapshot_id")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "snapshot_outputs_snapshot_id_key_key" ON "snapshot_outputs" ("snapshot_id", "key")`,
    );
    await queryRunner.query(
      `ALTER TABLE "snapshot_outputs" ADD CONSTRAINT "snapshot_outputs_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    await queryRunner.query(`
      CREATE TABLE "oauth_users" (
        "id" UUID NOT NULL,
        "provider" "oauth_provider" NOT NULL,
        "sub" TEXT NOT NULL,
        "aud" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        "auth_time" INTEGER,
        "email" TEXT,
        "email_verified" BOOLEAN,
        "iat" INTEGER,
        "iss" TEXT,
        "picture" TEXT,
        "rat" INTEGER,
        "username" TEXT,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "oauth_users_pkey" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "oauth_users_provider_sub_key" ON "oauth_users" ("provider", "sub")`);

    await queryRunner.query(`
      CREATE TABLE "auth_sessions" (
        "id" UUID NOT NULL,
        "session_id" TEXT NOT NULL,
        "provider" "oauth_provider" NOT NULL,
        "user_id" UUID NOT NULL,
        "access_token_ciphertext" TEXT NOT NULL,
        "refresh_token_ciphertext" TEXT NOT NULL,
        "access_token_expires_at" TIMESTAMP(3) NOT NULL,
        "refresh_token_expires_at" TIMESTAMP(3) NOT NULL,
        "scope" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        "state" TEXT NOT NULL,
        "code_verifier" TEXT NOT NULL,
        "last_refreshed_at" TIMESTAMP(3),
        "revoked_at" TIMESTAMP(3),
        "expires_at" TIMESTAMP(3) NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "auth_sessions_session_id_key" ON "auth_sessions" ("session_id")`);
    await queryRunner.query(`CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions" ("expires_at")`);
    await queryRunner.query(`CREATE INDEX "auth_sessions_revoked_at_idx" ON "auth_sessions" ("revoked_at")`);
    await queryRunner.query(
      `ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "oauth_users"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );

    await queryRunner.query(`
      CREATE TABLE "oauth_consent_grants" (
        "id" UUID NOT NULL,
        "provider" "oauth_provider" NOT NULL,
        "source" TEXT NOT NULL,
        "state" TEXT NOT NULL,
        "code_verifier" TEXT NOT NULL,
        "expires_at" TIMESTAMP(3) NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "oauth_consent_grants_pkey" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "oauth_consent_grants_state_key" ON "oauth_consent_grants" ("state")`);
    await queryRunner.query(
      `CREATE INDEX "oauth_consent_grants_provider_source_idx" ON "oauth_consent_grants" ("provider", "source")`,
    );

    await queryRunner.query(`
      CREATE TABLE "access_allowlist" (
        "id" UUID NOT NULL,
        "provider" "oauth_provider" NOT NULL,
        "email" TEXT NOT NULL,
        "role" "access_role" NOT NULL,
        "invited_by_user_id" UUID,
        "invited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "revoked_at" TIMESTAMP(3),
        "revoked_by_user_id" UUID,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "access_allowlist_pkey" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "access_allowlist_provider_email_key" ON "access_allowlist" ("provider", "email")`,
    );
    await queryRunner.query(`CREATE INDEX "access_allowlist_revoked_at_idx" ON "access_allowlist" ("revoked_at")`);
    await queryRunner.query(
      `ALTER TABLE "access_allowlist" ADD CONSTRAINT "access_allowlist_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "oauth_users"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "access_allowlist" ADD CONSTRAINT "access_allowlist_revoked_by_user_id_fkey" FOREIGN KEY ("revoked_by_user_id") REFERENCES "oauth_users"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "access_allowlist"`);
    await queryRunner.query(`DROP TABLE "oauth_consent_grants"`);
    await queryRunner.query(`DROP TABLE "auth_sessions"`);
    await queryRunner.query(`DROP TABLE "oauth_users"`);
    await queryRunner.query(`DROP TABLE "snapshot_outputs"`);
    await queryRunner.query(`DROP TABLE "snapshots"`);
    await queryRunner.query(`DROP TABLE "algorithm_preset_inputs"`);
    await queryRunner.query(`DROP TABLE "algorithm_presets"`);
    await queryRunner.query(`DROP TYPE "access_role"`);
    await queryRunner.query(`DROP TYPE "oauth_provider"`);
    await queryRunner.query(`DROP TYPE "snapshot_status"`);
  }
}
