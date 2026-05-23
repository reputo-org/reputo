import type { AlgorithmPresetFrozenDto as AlgorithmPresetFrozen } from '@reputo/contracts';
import type { Storage } from '@reputo/storage';

export type SubIdSupportedChain = 'ethereum' | 'cardano';

export interface SubIdWallet {
  address: string;
  chain: SubIdSupportedChain;
}

export interface SubIdEntry {
  deepVotingPortalId?: string;
  deepProposalPortalId?: string;
  userWallets: SubIdWallet[];
}

export interface SubIdInputMap {
  subIds: Record<string, SubIdEntry>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeId(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function normalizeWalletAddress(wallet: string, chain: SubIdSupportedChain): string {
  return chain === 'ethereum' ? wallet.toLowerCase() : wallet;
}

function parseUserWallets(value: unknown): SubIdWallet[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const wallets: SubIdWallet[] = [];

  for (const wallet of value) {
    if (!isRecord(wallet)) {
      continue;
    }

    const chain = wallet.chain;
    const address = wallet.address;

    if ((chain !== 'ethereum' && chain !== 'cardano') || typeof address !== 'string' || address.trim() === '') {
      continue;
    }

    const normalizedAddress = normalizeWalletAddress(address.trim(), chain);
    const dedupeKey = `${chain}:${normalizedAddress}`;

    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    wallets.push({
      address: normalizedAddress,
      chain,
    });
  }

  return wallets;
}

function parseSubIdInputRecord(parsed: unknown): SubIdInputMap {
  if (!isRecord(parsed)) {
    return { subIds: {} };
  }

  const subIds: SubIdInputMap['subIds'] = {};

  for (const [subId, rawEntry] of Object.entries(parsed)) {
    if (!isRecord(rawEntry) || subId.trim() === '') {
      continue;
    }

    subIds[subId] = {
      deepVotingPortalId: normalizeId(rawEntry.deepVotingPortalId),
      deepProposalPortalId: normalizeId(rawEntry.deepProposalPortalId),
      userWallets: parseUserWallets(rawEntry.userWallets),
    };
  }

  return { subIds };
}

export function extractSubIdsKey(inputs: AlgorithmPresetFrozen['inputs']): string {
  const subIdsInput = inputs.find((input) => input.key === 'sub_ids');
  if (subIdsInput == null || typeof subIdsInput.value !== 'string') {
    throw new Error('Missing required "sub_ids" input');
  }

  return subIdsInput.value;
}

export async function loadSubIdInputMap(input: {
  storage: Storage;
  bucket: string;
  key: string;
}): Promise<SubIdInputMap> {
  const fileBuffer = await input.storage.getObject({
    bucket: input.bucket,
    key: input.key,
  });

  return parseSubIdInputRecord(JSON.parse(fileBuffer.toString('utf-8')));
}

export function getSubIds(subIdInputMap: SubIdInputMap): string[] {
  return Object.keys(subIdInputMap.subIds).sort((a, b) => a.localeCompare(b));
}

function buildIndex(values: Array<[string, string | undefined]>): Map<string, string[]> {
  const index = new Map<string, string[]>();

  for (const [subId, rawValue] of values) {
    if (!rawValue) {
      continue;
    }

    const matches = index.get(rawValue) ?? [];
    matches.push(subId);
    index.set(rawValue, matches);
  }

  for (const subIds of index.values()) {
    subIds.sort((a, b) => a.localeCompare(b));
  }

  return index;
}

export function buildDeepVotingPortalSubIdsIndex(subIdInputMap: SubIdInputMap): Map<string, string[]> {
  return buildIndex(Object.entries(subIdInputMap.subIds).map(([subId, entry]) => [subId, entry.deepVotingPortalId]));
}

export function buildDeepProposalPortalSubIdsIndex(subIdInputMap: SubIdInputMap): Map<string, string[]> {
  return buildIndex(Object.entries(subIdInputMap.subIds).map(([subId, entry]) => [subId, entry.deepProposalPortalId]));
}

export function buildWalletSubIdsIndex(subIdInputMap: SubIdInputMap): Map<string, string[]> {
  const index = new Map<string, string[]>();

  for (const [subId, entry] of Object.entries(subIdInputMap.subIds)) {
    for (const wallet of entry.userWallets) {
      const matches = index.get(wallet.address) ?? [];
      matches.push(subId);
      index.set(wallet.address, matches);
    }
  }

  for (const subIds of index.values()) {
    subIds.sort((a, b) => a.localeCompare(b));
  }

  return index;
}

export function getWalletsForChain(subIdInputMap: SubIdInputMap, chain: SubIdSupportedChain): string[] {
  const wallets = new Set<string>();

  for (const entry of Object.values(subIdInputMap.subIds)) {
    for (const wallet of entry.userWallets) {
      if (wallet.chain === chain) {
        wallets.add(wallet.address);
      }
    }
  }

  return [...wallets];
}

export function getWalletsForSelectedResources(
  subIdInputMap: SubIdInputMap,
  selectedResources: Array<{ chain: SubIdSupportedChain }>,
): string[] {
  const selectedChains = new Set(selectedResources.map((resource) => resource.chain));
  const wallets = new Set<string>();

  for (const entry of Object.values(subIdInputMap.subIds)) {
    for (const wallet of entry.userWallets) {
      if (selectedChains.has(wallet.chain)) {
        wallets.add(wallet.address);
      }
    }
  }

  return [...wallets];
}
