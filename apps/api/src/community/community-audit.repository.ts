import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { CommunityPlatform } from '@reputo/contracts';
import { Repository } from 'typeorm';
import { CommunityConnectionAuditEntity } from '../persistence';
import type { CommunityAuditAction, CommunityAuditErrorCategory, CommunityAuditOutcome } from './community.constants';

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
}
