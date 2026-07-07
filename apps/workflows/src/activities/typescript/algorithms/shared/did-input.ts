import type { AlgorithmPresetFrozenDto as AlgorithmPresetFrozen } from '@reputo/contracts';
import type { Storage } from '@reputo/storage';

export type DidSupportedChain = 'ethereum' | 'cardano';

export interface DidWallet {
  address: string;
  chain: DidSupportedChain;
}

export interface DidEntry {
  userWallets: DidWallet[];
}

export interface DidInputMap {
  dids: Record<string, DidEntry>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeWalletAddress(wallet: string, chain: DidSupportedChain): string {
  return chain === 'ethereum' ? wallet.toLowerCase() : wallet;
}

function parseUserWallets(value: unknown): DidWallet[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const wallets: DidWallet[] = [];

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

function parseDidInputRecord(parsed: unknown): DidInputMap {
  if (!isRecord(parsed)) {
    return { dids: {} };
  }

  const dids: DidInputMap['dids'] = {};

  for (const [did, rawEntry] of Object.entries(parsed)) {
    if (!isRecord(rawEntry) || did.trim() === '') {
      continue;
    }

    dids[did] = {
      userWallets: parseUserWallets(rawEntry.userWallets),
    };
  }

  return { dids };
}

export function extractDidsKey(inputs: AlgorithmPresetFrozen['inputs']): string {
  const didsInput = inputs.find((input) => input.key === 'dids');
  if (didsInput == null || typeof didsInput.value !== 'string') {
    throw new Error('Missing required "dids" input');
  }

  return didsInput.value;
}

export async function loadDidInputMap(input: { storage: Storage; bucket: string; key: string }): Promise<DidInputMap> {
  const fileBuffer = await input.storage.getObject({
    bucket: input.bucket,
    key: input.key,
  });

  return parseDidInputRecord(JSON.parse(fileBuffer.toString('utf-8')));
}

export function getDids(didInputMap: DidInputMap): string[] {
  return Object.keys(didInputMap.dids).sort((a, b) => a.localeCompare(b));
}

export function buildWalletDidsIndex(didInputMap: DidInputMap): Map<string, string[]> {
  const index = new Map<string, string[]>();

  for (const [did, entry] of Object.entries(didInputMap.dids)) {
    for (const wallet of entry.userWallets) {
      const matches = index.get(wallet.address) ?? [];
      matches.push(did);
      index.set(wallet.address, matches);
    }
  }

  for (const dids of index.values()) {
    dids.sort((a, b) => a.localeCompare(b));
  }

  return index;
}

export function getWalletsForChain(didInputMap: DidInputMap, chain: DidSupportedChain): string[] {
  const wallets = new Set<string>();

  for (const entry of Object.values(didInputMap.dids)) {
    for (const wallet of entry.userWallets) {
      if (wallet.chain === chain) {
        wallets.add(wallet.address);
      }
    }
  }

  return [...wallets];
}

export function getWalletsForSelectedResources(
  didInputMap: DidInputMap,
  selectedResources: Array<{ chain: DidSupportedChain }>,
): string[] {
  const selectedChains = new Set(selectedResources.map((resource) => resource.chain));
  const wallets = new Set<string>();

  for (const entry of Object.values(didInputMap.dids)) {
    for (const wallet of entry.userWallets) {
      if (selectedChains.has(wallet.chain)) {
        wallets.add(wallet.address);
      }
    }
  }

  return [...wallets];
}
