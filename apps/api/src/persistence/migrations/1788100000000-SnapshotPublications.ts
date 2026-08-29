import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * DeepID publication ledger: one row per (snapshot, algorithm key), written by
 * the workflow through the API activities queue. Upsert semantics keep retries
 * on the same row; `error` carries a safe category or summary only.
 */
export class SnapshotPublications1788100000000 implements MigrationInterface {
  name = 'SnapshotPublications1788100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "snapshot_publication_status" AS ENUM ('pending', 'sent', 'failed')`);

    await queryRunner.query(`
      CREATE TABLE "snapshot_publications" (
        "id" UUID NOT NULL,
        "snapshot_id" UUID NOT NULL,
        "algorithm_key" TEXT NOT NULL,
        "status" "snapshot_publication_status" NOT NULL DEFAULT 'pending',
        "counts" JSONB,
        "error" TEXT,
        "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "snapshot_publications_pkey" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "snapshot_publications_snapshot_id_idx" ON "snapshot_publications" ("snapshot_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "snapshot_publications_snapshot_id_algorithm_key_key" ON "snapshot_publications" ("snapshot_id", "algorithm_key")`,
    );
    await queryRunner.query(
      `ALTER TABLE "snapshot_publications" ADD CONSTRAINT "snapshot_publications_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "snapshot_publications"`);
    await queryRunner.query(`DROP TYPE "snapshot_publication_status"`);
  }
}
