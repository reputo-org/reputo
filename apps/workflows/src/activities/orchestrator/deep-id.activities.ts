import { createDeepIdClient, type DeepIdWallet } from '@reputo/deep-id-api';
import { generateKey } from '@reputo/storage';
import { Context } from '@temporalio/activity';

import config from '../../config/index.js';
import type { DeepIdSyncContext, DeepIdSyncInput, DeepIdSyncOutput } from '../../shared/types/index.js';

/** Chains the wallet algorithms understand; other wallet types are ignored. */
const SUPPORTED_CHAINS = new Set(['ethereum', 'cardano']);

interface DidEntry {
  userWallets: Array<{ address: string; chain: string }>;
}

function toWalletEntries(wallets: DeepIdWallet[] | undefined): DidEntry['userWallets'] {
  if (!wallets) {
    return [];
  }
  return wallets
    .filter((wallet) => SUPPORTED_CHAINS.has(wallet.type) && typeof wallet.address === 'string')
    .map((wallet) => ({ address: wallet.address, chain: wallet.type }));
}

/**
 * Fetches the consented users from DeepID (`GET /v1/users`, paginated) and
 * assembles the wallet-algorithm SubID input — a map of `did:sub:…` →
 * `{ userWallets }` — written to S3. The orchestrator points the algorithm's
 * `dids` input at this key. Idempotent: if the file already exists for the
 * snapshot, the fetch is skipped (safe on Temporal retries).
 */
export function createDeepIdSyncActivity(ctx: DeepIdSyncContext) {
  const { storage, storageConfig } = ctx;

  return async function deep_id_sync(input: DeepIdSyncInput): Promise<DeepIdSyncOutput> {
    const { snapshotId } = input;
    const logger = Context.current().log;
    const { bucket } = storageConfig;

    const didsKey = generateKey('snapshot', snapshotId, 'deep-id/dids.json');

    const client = createDeepIdClient({
      identityBaseUrl: config.deepId.identityBaseUrl,
      appBaseUrl: config.deepId.appBaseUrl,
      clientId: config.deepId.clientId,
      clientSecret: config.deepId.clientSecret,
      scopes: config.deepId.scopes,
      requestTimeoutMs: config.deepId.requestTimeoutMs,
      concurrency: config.deepId.concurrency,
      defaultPageSize: config.deepId.usersPageSize,
      retry: {
        maxAttempts: config.deepId.retryMaxAttempts,
        baseDelayMs: config.deepId.retryBaseDelayMs,
        maxDelayMs: config.deepId.retryMaxDelayMs,
      },
      logLevel: config.logger.level,
    });

    logger.info('Fetching consented DeepID users for SubID assembly', { snapshotId });

    const dids: Record<string, DidEntry> = {};
    let userCount = 0;
    let walletCount = 0;

    for await (const page of client.iterateUsers({ filteredTokenScopes: 'api wallets' })) {
      for (const [didSub, user] of Object.entries(page.users)) {
        const userWallets = toWalletEntries(user.wallets);
        dids[didSub] = { userWallets };
        userCount += 1;
        walletCount += userWallets.length;
      }
      Context.current().heartbeat({ users: userCount });
    }

    // The SubID input file is the raw `did → entry` map (see parseDidInputRecord).
    await storage.putObject({
      bucket,
      key: didsKey,
      body: JSON.stringify(dids),
      contentType: 'application/json',
    });

    logger.info('Assembled DeepID SubID input', { snapshotId, didsKey, userCount, walletCount });

    return { didsKey };
  };
}
