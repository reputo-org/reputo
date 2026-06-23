import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial schema for the DeepFunding Portal SQLite database. Mirrors the
 * snake_case layout the package shipped with under drizzle, ported to TypeORM
 * during the Phase 6 ORM standardization. No data migration is performed — DBs
 * created by this package are ephemeral and rebuilt per snapshot.
 */
export class Init1748000000000 implements MigrationInterface {
  name = 'Init1748000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "rounds" (
        "id" integer PRIMARY KEY NOT NULL,
        "name" text NOT NULL,
        "slug" text NOT NULL,
        "description" text,
        "pool_ids" text NOT NULL,
        "raw_json" text NOT NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "pools" (
        "id" integer PRIMARY KEY NOT NULL,
        "name" text NOT NULL,
        "slug" text NOT NULL,
        "max_funding_amount" integer NOT NULL,
        "description" text,
        "raw_json" text NOT NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "proposals" (
        "id" integer PRIMARY KEY NOT NULL,
        "round_id" integer NOT NULL,
        "pool_id" integer NOT NULL,
        "proposer_id" integer NOT NULL,
        "title" text NOT NULL,
        "content" text NOT NULL,
        "link" text NOT NULL,
        "feature_image" text NOT NULL,
        "requested_amount" text NOT NULL,
        "awarded_amount" text NOT NULL,
        "is_awarded" boolean NOT NULL,
        "is_completed" boolean NOT NULL,
        "created_at" text NOT NULL,
        "updated_at" text,
        "team_members" text NOT NULL,
        "raw_json" text NOT NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_proposals_round_id" ON "proposals" ("round_id")`);
    await queryRunner.query(`CREATE INDEX "idx_proposals_pool_id" ON "proposals" ("pool_id")`);

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" integer PRIMARY KEY NOT NULL,
        "collection_id" text NOT NULL,
        "user_name" text NOT NULL,
        "email" text NOT NULL,
        "total_proposals" integer NOT NULL,
        "did" text NOT NULL,
        "raw_json" text NOT NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "milestones" (
        "id" integer PRIMARY KEY AUTOINCREMENT,
        "proposal_id" integer NOT NULL,
        "title" text NOT NULL,
        "status" text NOT NULL,
        "description" text NOT NULL,
        "development_description" text NOT NULL,
        "budget" integer NOT NULL,
        "created_at" text,
        "updated_at" text,
        "raw_json" text NOT NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "reviews" (
        "review_id" integer PRIMARY KEY AUTOINCREMENT,
        "proposal_id" integer,
        "reviewer_id" integer,
        "review_type" text NOT NULL,
        "overall_rating" text NOT NULL,
        "feasibility_rating" text NOT NULL,
        "viability_rating" text NOT NULL,
        "desirability_rating" text NOT NULL,
        "usefulness_rating" text NOT NULL,
        "created_at" text,
        "raw_json" text NOT NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_reviews_proposal_id" ON "reviews" ("proposal_id")`);
    await queryRunner.query(`CREATE INDEX "idx_reviews_reviewer_id" ON "reviews" ("reviewer_id")`);

    await queryRunner.query(`
      CREATE TABLE "comments" (
        "comment_id" integer PRIMARY KEY NOT NULL,
        "parent_id" integer NOT NULL,
        "is_reply" boolean NOT NULL,
        "user_id" integer NOT NULL,
        "proposal_id" integer NOT NULL,
        "content" text NOT NULL,
        "comment_votes" text NOT NULL,
        "created_at" text NOT NULL,
        "updated_at" text NOT NULL,
        "raw_json" text NOT NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_comments_proposal_id" ON "comments" ("proposal_id")`);
    await queryRunner.query(`CREATE INDEX "idx_comments_user_id" ON "comments" ("user_id")`);

    await queryRunner.query(`
      CREATE TABLE "comment_votes" (
        "voter_id" integer NOT NULL,
        "comment_id" integer NOT NULL,
        "vote_type" text NOT NULL,
        "created_at" text,
        "raw_json" text NOT NULL,
        PRIMARY KEY ("voter_id", "comment_id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_comment_votes_comment_id" ON "comment_votes" ("comment_id")`);

    await queryRunner.query(`
      CREATE TABLE "meta" (
        "key" text PRIMARY KEY NOT NULL,
        "value" text NOT NULL
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "meta"`);
    await queryRunner.query(`DROP INDEX "idx_comment_votes_comment_id"`);
    await queryRunner.query(`DROP TABLE "comment_votes"`);
    await queryRunner.query(`DROP INDEX "idx_comments_user_id"`);
    await queryRunner.query(`DROP INDEX "idx_comments_proposal_id"`);
    await queryRunner.query(`DROP TABLE "comments"`);
    await queryRunner.query(`DROP INDEX "idx_reviews_reviewer_id"`);
    await queryRunner.query(`DROP INDEX "idx_reviews_proposal_id"`);
    await queryRunner.query(`DROP TABLE "reviews"`);
    await queryRunner.query(`DROP TABLE "milestones"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP INDEX "idx_proposals_pool_id"`);
    await queryRunner.query(`DROP INDEX "idx_proposals_round_id"`);
    await queryRunner.query(`DROP TABLE "proposals"`);
    await queryRunner.query(`DROP TABLE "pools"`);
    await queryRunner.query(`DROP TABLE "rounds"`);
  }
}
