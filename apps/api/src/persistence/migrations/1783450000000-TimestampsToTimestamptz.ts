import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Convert every timestamp column to TIMESTAMPTZ(3). The previous
 * TIMESTAMP-without-time-zone columns mixed writer conventions (DB defaults
 * wrote UTC wall-clock, TypeORM wrote host-local wall-clock) and node-postgres
 * reads them as local time, so on a non-UTC host `snapshot.createdAt` reached
 * the Temporal workers shifted by the host TZ offset — skewing lot ages and
 * the transfer-window cutoff in token_value_over_time and every UI timestamp.
 * Existing values are reinterpreted as UTC, which is exact for all
 * container-written (UTC) data; rows written by the ORM from a non-UTC dev
 * host keep that host's fixed offset error.
 */
export class TimestampsToTimestamptz1783450000000 implements MigrationInterface {
  name = 'TimestampsToTimestamptz1783450000000';

  private readonly columns: ReadonlyArray<readonly [table: string, column: string]> = [
    ['algorithm_presets', 'created_at'],
    ['algorithm_presets', 'updated_at'],
    ['algorithm_preset_inputs', 'created_at'],
    ['algorithm_preset_inputs', 'updated_at'],
    ['snapshots', 'started_at'],
    ['snapshots', 'completed_at'],
    ['snapshots', 'created_at'],
    ['snapshots', 'updated_at'],
    ['snapshot_outputs', 'created_at'],
    ['snapshot_outputs', 'updated_at'],
    ['oauth_users', 'created_at'],
    ['oauth_users', 'updated_at'],
    ['auth_sessions', 'access_token_expires_at'],
    ['auth_sessions', 'refresh_token_expires_at'],
    ['auth_sessions', 'last_refreshed_at'],
    ['auth_sessions', 'revoked_at'],
    ['auth_sessions', 'expires_at'],
    ['auth_sessions', 'created_at'],
    ['auth_sessions', 'updated_at'],
    ['oauth_consent_grants', 'expires_at'],
    ['oauth_consent_grants', 'created_at'],
    ['oauth_consent_grants', 'updated_at'],
    ['access_allowlist', 'invited_at'],
    ['access_allowlist', 'revoked_at'],
    ['access_allowlist', 'created_at'],
    ['access_allowlist', 'updated_at'],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [table, column] of this.columns) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE TIMESTAMPTZ(3) USING "${column}" AT TIME ZONE 'UTC'`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [table, column] of this.columns) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE TIMESTAMP(3) USING "${column}" AT TIME ZONE 'UTC'`,
      );
    }
  }
}
