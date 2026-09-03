import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Broadcasts community connection changes on the `community_connection_updates`
 * NOTIFY channel, so the API's SSE stream can push them to open pages.
 *
 * The update trigger fires only when something a client can see changed —
 * status, name, or the stored settings other than the check timestamp — so the
 * watch loop's routine probes do not fan out as events.
 */
export class CommunityConnectionUpdates1788400000000 implements MigrationInterface {
  name = 'CommunityConnectionUpdates1788400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION community_connection_notify() RETURNS trigger AS $$
      BEGIN
        PERFORM pg_notify(
          'community_connection_updates',
          json_build_object('op', TG_OP, 'id', CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END)::text
        );
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER community_connections_notify_row
      AFTER INSERT OR DELETE ON community_connections
      FOR EACH ROW EXECUTE FUNCTION community_connection_notify()
    `);
    await queryRunner.query(`
      CREATE TRIGGER community_connections_notify_change
      AFTER UPDATE ON community_connections
      FOR EACH ROW
      WHEN (
        OLD.status IS DISTINCT FROM NEW.status
        OR OLD.name IS DISTINCT FROM NEW.name
        OR (OLD.settings - 'lastCheck') IS DISTINCT FROM (NEW.settings - 'lastCheck')
        OR (OLD.settings #>> '{lastCheck,category}') IS DISTINCT FROM (NEW.settings #>> '{lastCheck,category}')
      )
      EXECUTE FUNCTION community_connection_notify()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS community_connections_notify_change ON community_connections`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS community_connections_notify_row ON community_connections`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS community_connection_notify()`);
  }
}
