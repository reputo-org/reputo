import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Community connections foundation: one row per connected platform community,
 * plus the append-only audit log of privileged operations against it.
 *
 * `credentials_ciphertext` ships unused — Discord and GitHub authenticate with
 * deployment config, and credential sealing arrives with Mattermost.
 */
export class CommunityConnections1787750000000 implements MigrationInterface {
  name = 'CommunityConnections1787750000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "community_platform" AS ENUM ('github', 'discord', 'mattermost')`);
    await queryRunner.query(
      `CREATE TYPE "community_connection_status" AS ENUM ('pending', 'active', 'degraded', 'broken', 'disconnected')`,
    );

    await queryRunner.query(`
      CREATE TABLE "community_connections" (
        "id" UUID NOT NULL,
        "platform" "community_platform" NOT NULL,
        "external_id" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "settings" JSONB,
        "credentials_ciphertext" TEXT,
        "status" "community_connection_status" NOT NULL DEFAULT 'pending',
        "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "community_connections_pkey" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "community_connections_platform_external_id_key" ON "community_connections" ("platform", "external_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "community_connection_audit" (
        "id" UUID NOT NULL,
        "connection_id" UUID,
        "platform" "community_platform" NOT NULL,
        "actor_user_id" UUID,
        "action" TEXT NOT NULL,
        "outcome" TEXT NOT NULL,
        "error_category" TEXT,
        "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "community_connection_audit_pkey" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "community_connection_audit_connection_id_idx" ON "community_connection_audit" ("connection_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "community_connection_audit_created_at_idx" ON "community_connection_audit" ("created_at")`,
    );
    await queryRunner.query(
      `ALTER TABLE "community_connection_audit" ADD CONSTRAINT "community_connection_audit_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "community_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "community_connection_audit" ADD CONSTRAINT "community_connection_audit_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "oauth_users"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "community_connection_audit"`);
    await queryRunner.query(`DROP TABLE "community_connections"`);
    await queryRunner.query(`DROP TYPE "community_connection_status"`);
    await queryRunner.query(`DROP TYPE "community_platform"`);
  }
}
