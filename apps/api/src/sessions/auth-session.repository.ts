import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { AuthSession, AuthSessionModel, AuthSessionWithId } from '@reputo/database';
import { MODEL_NAMES } from '@reputo/database';
import type { Types } from 'mongoose';

@Injectable()
export class AuthSessionRepository {
  constructor(
    @InjectModel(MODEL_NAMES.AUTH_SESSION)
    private readonly model: AuthSessionModel,
  ) {}

  async create(data: Omit<AuthSession, 'createdAt' | 'updatedAt'>): Promise<AuthSessionWithId> {
    const created = await this.model.create(data);
    return created.toObject() as AuthSessionWithId;
  }

  async findActiveBySessionId(sessionId: string, includeSecrets = false): Promise<AuthSessionWithId | null> {
    const query = this.model.findOne({
      sessionId,
      revokedAt: { $exists: false },
      expiresAt: { $gt: new Date() },
    });

    if (includeSecrets) {
      query.select('+accessTokenCiphertext +refreshTokenCiphertext');
    }

    return (await query.lean().exec()) as AuthSessionWithId | null;
  }

  async updateAfterRefresh(
    sessionId: string,
    update: Partial<
      Pick<
        AuthSession,
        | 'accessTokenCiphertext'
        | 'refreshTokenCiphertext'
        | 'accessTokenExpiresAt'
        | 'refreshTokenExpiresAt'
        | 'scope'
        | 'lastRefreshedAt'
        | 'expiresAt'
      >
    >,
  ): Promise<AuthSessionWithId | null> {
    return (await this.model
      .findOneAndUpdate(
        {
          sessionId,
          revokedAt: { $exists: false },
          expiresAt: { $gt: new Date() },
        },
        update,
        { new: true },
      )
      .lean()
      .exec()) as AuthSessionWithId | null;
  }

  async revokeBySessionId(sessionId: string, revokedAt = new Date()): Promise<void> {
    await this.model
      .findOneAndUpdate(
        { sessionId, revokedAt: { $exists: false } },
        {
          revokedAt,
          expiresAt: revokedAt,
        },
        { new: false },
      )
      .exec();
  }

  async revokeAllByUserId(userId: Types.ObjectId | string, revokedAt = new Date()): Promise<number> {
    const result = await this.model
      .updateMany(
        {
          userId,
          revokedAt: { $exists: false },
          expiresAt: { $gt: revokedAt },
        },
        {
          $set: {
            revokedAt,
            expiresAt: revokedAt,
          },
        },
      )
      .exec();

    return result.modifiedCount;
  }

  async aggregateActivityByUserIds(
    userIds: ReadonlyArray<Types.ObjectId | string>,
    now = new Date(),
  ): Promise<Map<string, UserSessionActivity>> {
    const activity = new Map<string, UserSessionActivity>();

    if (userIds.length === 0) {
      return activity;
    }

    const rows = (await this.model
      .aggregate([
        { $match: { userId: { $in: userIds } } },
        {
          $group: {
            _id: '$userId',
            lastSignInAt: { $max: '$createdAt' },
            activeSessionCount: {
              $sum: {
                $cond: [
                  {
                    // The schema sets revokedAt only when revoked, so $ifNull
                    // covers both missing-field and explicit-null variants.
                    $and: [{ $not: [{ $ifNull: ['$revokedAt', false] }] }, { $gt: ['$expiresAt', now] }],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ])
      .exec()) as AggregatedActivityRow[];

    for (const row of rows) {
      activity.set(String(row._id), {
        lastSignInAt: row.lastSignInAt ?? null,
        activeSessionCount: row.activeSessionCount,
      });
    }

    return activity;
  }
}

export interface UserSessionActivity {
  lastSignInAt: Date | null;
  activeSessionCount: number;
}

interface AggregatedActivityRow extends UserSessionActivity {
  _id: Types.ObjectId;
}
