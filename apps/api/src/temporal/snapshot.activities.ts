import {
  type AlgorithmPresetFrozenDto,
  type ApiSnapshotActivities,
  COMMUNITY_CONNECTION_NOT_FOUND_ERROR_TYPE,
  COMMUNITY_CREDENTIAL_NOT_FOUND_ERROR_TYPE,
  type CommunityConnectionDto,
  type CommunitySealedCredentialDto,
  type GetCommunityConnectionInput,
  type GetCommunitySealedCredentialInput,
  type GetSnapshotInput,
  type RecordSnapshotPublicationInput,
  SNAPSHOT_NOT_FOUND_ERROR_TYPE,
  type SnapshotDto,
  type UpdateSnapshotInput,
} from '@reputo/contracts';
import { ApplicationFailure, Context } from '@temporalio/activity';
import type { CommunityConnectionRepository } from '../community/community-connection.repository';
import type { AlgorithmPresetFrozen, SnapshotRow } from '../snapshot/snapshot.repository';
import type { SnapshotService } from '../snapshot/snapshot.service';

const toIso = (value: Date | string | undefined): string | undefined => {
  if (value === undefined) return undefined;
  return value instanceof Date ? value.toISOString() : value;
};

const toRequiredIso = (value: Date | string): string => (value instanceof Date ? value.toISOString() : value);

function toAlgorithmPresetFrozenDto(frozen: AlgorithmPresetFrozen): AlgorithmPresetFrozenDto {
  return {
    key: frozen.key,
    version: frozen.version,
    inputs: frozen.inputs.map((input) => ({ key: input.key, value: input.value })),
    name: frozen.name,
    description: frozen.description,
    createdAt: toIso(frozen.createdAt),
    updatedAt: toIso(frozen.updatedAt),
  };
}

export function toSnapshotDto(row: SnapshotRow): SnapshotDto {
  return {
    id: row._id,
    status: row.status,
    algorithmPresetId: row.algorithmPreset,
    algorithmPresetFrozen: toAlgorithmPresetFrozenDto(row.algorithmPresetFrozen),
    temporal: row.temporal,
    outputs: row.outputs,
    error: row.error,
    startedAt: toIso(row.startedAt),
    completedAt: toIso(row.completedAt),
    createdAt: toRequiredIso(row.createdAt),
    updatedAt: toRequiredIso(row.updatedAt),
  };
}

/**
 * Wires the contracted `ApiSnapshotActivities` to in-process service calls. The
 * factory is exported so the worker bootstrap can register implementations and
 * tests can invoke activities against a real (or mocked) `SnapshotService`.
 *
 * NOT_FOUND surfaces as a non-retryable `ApplicationFailure` so the workflow
 * does not retry forever when a snapshot has been deleted.
 */
export function createSnapshotActivities(
  snapshotService: SnapshotService,
  communityConnections: CommunityConnectionRepository,
): ApiSnapshotActivities {
  return {
    async getSnapshot(input: GetSnapshotInput): Promise<SnapshotDto> {
      const logger = Context.current().log;
      logger.info('Fetching snapshot', { snapshotId: input.snapshotId });

      const row = await snapshotService.findByIdOrNull(input.snapshotId);
      if (!row) {
        logger.warn('Snapshot not found', { snapshotId: input.snapshotId });
        throw ApplicationFailure.create({
          message: `Snapshot ${input.snapshotId} not found`,
          type: SNAPSHOT_NOT_FOUND_ERROR_TYPE,
          nonRetryable: true,
        });
      }

      return toSnapshotDto(row);
    },

    async updateSnapshot(input: UpdateSnapshotInput): Promise<void> {
      const logger = Context.current().log;
      logger.info('Updating snapshot', { snapshotId: input.snapshotId, status: input.status });

      const updated = await snapshotService.applyExternalUpdate(input);
      if (!updated) {
        throw ApplicationFailure.create({
          message: `Snapshot ${input.snapshotId} not found`,
          type: SNAPSHOT_NOT_FOUND_ERROR_TYPE,
          nonRetryable: true,
        });
      }
    },

    async getCommunityConnection(input: GetCommunityConnectionInput): Promise<CommunityConnectionDto> {
      const logger = Context.current().log;
      logger.info('Fetching community connection', { connectionId: input.connectionId });

      const row = await communityConnections.findById(input.connectionId);
      if (!row) {
        logger.warn('Community connection not found', { connectionId: input.connectionId });
        throw ApplicationFailure.create({
          message: `Community connection ${input.connectionId} not found`,
          type: COMMUNITY_CONNECTION_NOT_FOUND_ERROR_TYPE,
          nonRetryable: true,
        });
      }

      return {
        id: row.id,
        platform: row.platform,
        externalId: row.externalId,
        name: row.name,
        status: row.status,
        createdAt: toRequiredIso(row.createdAt),
        updatedAt: toRequiredIso(row.updatedAt),
      };
    },

    /**
     * The envelope is returned sealed. It is AAD-bound to its connection and
     * only the workers' sealing key opens it, so the token itself never enters
     * an activity result or workflow history.
     */
    async getCommunitySealedCredential(
      input: GetCommunitySealedCredentialInput,
    ): Promise<CommunitySealedCredentialDto> {
      const logger = Context.current().log;
      logger.info('Fetching community sealed credential', { connectionId: input.connectionId });

      const credentialsCiphertext = await communityConnections.findCredentialsCiphertextById(input.connectionId);
      if (credentialsCiphertext === null) {
        logger.warn('Community connection stores no sealed credential', { connectionId: input.connectionId });
        throw ApplicationFailure.create({
          message: `Community connection ${input.connectionId} stores no sealed credential; reconnect it`,
          type: COMMUNITY_CREDENTIAL_NOT_FOUND_ERROR_TYPE,
          nonRetryable: true,
        });
      }

      return { credentialsCiphertext };
    },

    async recordSnapshotPublication(input: RecordSnapshotPublicationInput): Promise<void> {
      const logger = Context.current().log;
      logger.info('Recording snapshot publication', {
        snapshotId: input.snapshotId,
        algorithmKey: input.algorithmKey,
        status: input.status,
      });

      const recorded = await snapshotService.recordPublication(input);
      if (!recorded) {
        throw ApplicationFailure.create({
          message: `Snapshot ${input.snapshotId} not found`,
          type: SNAPSHOT_NOT_FOUND_ERROR_TYPE,
          nonRetryable: true,
        });
      }
    },
  };
}
