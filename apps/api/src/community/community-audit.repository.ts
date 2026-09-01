import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { CommunityPlatform } from '@reputo/contracts';
import { In, Repository } from 'typeorm';
import { CommunityConnectionAuditEntity } from '../persistence';
import {
  CommunityAuditAction,
  type CommunityAuditErrorCategory,
  type CommunityAuditOutcome,
} from './community.constants';

/** Actions that reach the platform, so their outcome reflects real credential health. */
const VERIFYING_ACTIONS = [
  CommunityAuditAction.connect,
  CommunityAuditAction.healthCheck,
  CommunityAuditAction.listResources,
];

export interface LatestVerification {
  checkedAt: Date;
  /** Safe category when that check failed, otherwise null. */
  failureCategory: string | null;
}

export interface RecordAuditInput {
  connectionId?: string | null;
  platform: CommunityPlatform;
  actorUserId?: string | null;
  action: CommunityAuditAction;
  outcome: CommunityAuditOutcome;
  errorCategory?: CommunityAuditErrorCategory | null;
}

@Injectable()
export class CommunityAuditRepository {
  constructor(
    @InjectRepository(CommunityConnectionAuditEntity)
    private readonly audit: Repository<CommunityConnectionAuditEntity>,
  ) {}

  async record(input: RecordAuditInput): Promise<void> {
    await this.audit.save(
      this.audit.create({
        connectionId: input.connectionId ?? null,
        platform: input.platform,
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        outcome: input.outcome,
        errorCategory: input.errorCategory ?? null,
      }),
    );
  }

  /**
   * Outcome of the most recent operation that actually exercised the platform
   * credential, per connection. It gives a non-active connection its reason and
   * tells every connection when its state was last confirmed — the status is
   * only ever as fresh as this timestamp.
   */
  async findLatestVerification(connectionIds: readonly string[]): Promise<Map<string, LatestVerification>> {
    if (connectionIds.length === 0) return new Map();

    const rows = await this.audit
      .createQueryBuilder('audit')
      .distinctOn(['audit.connection_id'])
      .where({ connectionId: In([...connectionIds]), action: In([...VERIFYING_ACTIONS]) })
      .orderBy('audit.connection_id')
      .addOrderBy('audit.created_at', 'DESC')
      .getMany();

    return new Map(
      rows
        .filter((row) => row.connectionId !== null)
        .map((row) => [
          row.connectionId as string,
          {
            checkedAt: row.createdAt,
            failureCategory: row.outcome === 'failure' ? row.errorCategory : null,
          },
        ]),
    );
  }
}
