import { rm } from 'node:fs/promises';
import { generateKey, type Storage } from '@reputo/storage';
import { Context } from '@temporalio/activity';
import config from '../../../../config/index.js';
import { HEARTBEAT_INTERVAL } from '../../../../shared/constants/index.js';
import type { AlgorithmResult, Snapshot } from '../../../../shared/types/index.js';
import { stringifyCsvAsync } from '../../../../shared/utils/index.js';
import { aggregateCommunityActivity } from './aggregate.js';
import { downloadCommunityDataset } from './dataset.js';
import { extractActivityWeights } from './inputs.js';
import {
  type CommunityEngagementConfig,
  type CommunityEngagementDetails,
  type CommunityEngagementUserDetails,
  roundPoints,
} from './types.js';

/**
 * Scores one platform's frozen community dataset: integer units aggregated and
 * capped in SQL, weights applied here in the canonical activity order, one CSV
 * row per cohort DID — explicit zeros for inactive and unmatched users. Scores
 * stay raw; normalization and weighting across algorithms happen only in
 * `custom_score`. No wall clock touches the outputs, so replaying the same
 * dataset yields byte-identical files.
 */
export async function computeCommunityEngagement(
  engagement: CommunityEngagementConfig,
  snapshot: Snapshot,
  storage: Storage,
): Promise<AlgorithmResult> {
  const ctx = Context.current();
  const logger = ctx.log;
  const snapshotId = snapshot.id;
  const { platform, algorithmKey, activityTypes } = engagement;

  logger.info(`Starting ${algorithmKey} algorithm`, { snapshotId });

  const { bucket } = config.storage;
  const weights = extractActivityWeights(snapshot.algorithmPresetFrozen.inputs, activityTypes);

  ctx.heartbeat({ phase: 'download' });
  const dataset = await downloadCommunityDataset({
    snapshotId,
    platform,
    storage,
    bucket,
    heartbeat: () => ctx.heartbeat({ phase: 'download' }),
  });

  try {
    const { cohort, coverage, totals } = await aggregateCommunityActivity({
      dataset,
      weights,
      activeDay: engagement.activeDay,
    });

    logger.info('Aggregated community activity', {
      snapshotId,
      cohortSize: cohort.length,
      scoredUsers: totals.size,
      window: dataset.manifest.window,
    });

    const csvRecords: Array<Record<string, string | number>> = [];
    const userDetails: CommunityEngagementUserDetails[] = [];
    let active = 0;
    let processed = 0;
    for (const member of cohort) {
      if (processed % HEARTBEAT_INTERVAL === 0) {
        ctx.heartbeat({ phase: 'scoring', processed, total: cohort.length });
      }
      processed += 1;

      const byType = totals.get(member.did);
      const activities: CommunityEngagementUserDetails['activities'] = {};
      const record: Record<string, string | number> = { did: member.did };
      let score = 0;
      let unitTotal = 0;

      // Weights are applied in the canonical activity order, so the sum is
      // bit-for-bit deterministic for a given dataset and configuration.
      for (const type of activityTypes) {
        const weight = weights.get(type);
        const unit = byType?.get(type);
        const points = weight === undefined || unit === undefined ? 0 : roundPoints(unit.cappedUnits * weight.points);
        record[`${type}_points`] = points;
        score += points;
        unitTotal += unit?.units ?? 0;
        activities[type] = {
          units: unit?.units ?? 0,
          capped_units: unit?.cappedUnits ?? 0,
          points,
        };
      }

      const finalScore = roundPoints(score);
      record[algorithmKey] = finalScore;
      if (unitTotal > 0) {
        active += 1;
      }

      csvRecords.push(record);
      userDetails.push({
        did: member.did,
        status: member.status,
        username: member.username,
        account_id: member.accountId,
        score: finalScore,
        activities,
      });
    }

    ctx.heartbeat({ phase: 'upload' });

    const columns = ['did', algorithmKey, ...activityTypes.map((type) => `${type}_points`)];
    const csvContent = await stringifyCsvAsync(csvRecords, { header: true, columns });
    const outputKey = generateKey('snapshot', snapshotId, `${algorithmKey}.csv`);
    await storage.putObject({ bucket, key: outputKey, body: csvContent, contentType: 'text/csv' });

    const details: CommunityEngagementDetails = {
      users: userDetails,
      metadata: {
        snapshot_id: snapshotId,
        platform,
        window: dataset.manifest.window,
        cohort: {
          consented: cohort.length,
          matched: cohort.filter((member) => member.status === 'matched').length,
          unmatched: cohort.filter((member) => member.status !== 'matched').length,
          active,
          inactive: cohort.length - active,
        },
        coverage,
        activities: [...weights.entries()].map(([activity, weight]) => ({
          activity,
          points: weight.points,
          daily_cap: weight.dailyCap,
        })),
      },
    };
    const detailsKey = generateKey('snapshot', snapshotId, `${algorithmKey}_details.json`);
    await storage.putObject({
      bucket,
      key: detailsKey,
      body: JSON.stringify(details, null, 2),
      contentType: 'application/json',
    });

    logger.info(`Uploaded ${algorithmKey} results`, { snapshotId, outputKey, detailsKey, users: cohort.length });

    return {
      outputs: {
        [algorithmKey]: outputKey,
        [`${algorithmKey}_details`]: detailsKey,
      },
    };
  } finally {
    await rm(dataset.scratch, { recursive: true, force: true });
  }
}
