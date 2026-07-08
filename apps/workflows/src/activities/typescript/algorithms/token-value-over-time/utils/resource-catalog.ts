import { getAlgorithmDefinition } from '@reputo/reputation-algorithms';

import {
  buildResourceId,
  type ResolvedResource,
  type ResourceCatalogEntry,
  type SelectedResourceInput,
  type SupportedChain,
} from '../types.js';

interface RawResourceCatalogResource {
  key: string;
  kind: string;
  identifier: string;
  tokenIdentifier: string;
  tokenKey: string;
  tokenDecimals?: number;
  parentResourceKey?: string;
}

interface RawResourceCatalogChain {
  key: string;
  resources: RawResourceCatalogResource[];
}

export function loadResourceCatalog(): ResourceCatalogEntry[] {
  const definitionJson = getAlgorithmDefinition({ key: 'token_value_over_time', version: '1.0.0' });
  const definition = JSON.parse(definitionJson);

  const selectedResourcesInput = definition.inputs?.find((i: { key: string }) => i.key === 'selected_resources');
  const catalog = selectedResourcesInput?.uiHint?.resourceCatalog;
  if (!catalog?.chains) {
    throw new Error('Resource catalog not found in algorithm definition');
  }

  const entries: ResourceCatalogEntry[] = [];
  for (const chainDef of catalog.chains as RawResourceCatalogChain[]) {
    const chain = chainDef.key as SupportedChain;
    for (const resource of chainDef.resources) {
      entries.push({
        chain,
        key: resource.key,
        kind: resource.kind as 'token' | 'contract',
        identifier: resource.identifier,
        tokenIdentifier: resource.tokenIdentifier,
        tokenKey: resource.tokenKey,
        tokenDecimals: resource.tokenDecimals,
        parentResourceKey: resource.parentResourceKey,
      });
    }
  }

  return entries;
}

export function resolveSelectedResources(
  selected: SelectedResourceInput[],
  catalog: ResourceCatalogEntry[],
): ResolvedResource[] {
  const resolved: ResolvedResource[] = [];
  const seen = new Set<string>();

  for (const sel of selected) {
    const matches = catalog.filter((entry) => entry.chain === sel.chain && entry.key === sel.resourceKey);

    for (const entry of matches) {
      const dedupeKey = `${entry.chain}:${entry.identifier.toLowerCase()}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      resolved.push({
        chain: entry.chain,
        resourceKey: entry.key,
        kind: entry.kind,
        identifier: entry.identifier,
        tokenIdentifier: entry.tokenIdentifier,
        tokenDecimals: entry.tokenDecimals,
        resourceId: buildResourceId(entry.chain, entry.tokenIdentifier),
      });
    }
  }

  return resolved;
}

export function getStakingContractAddresses(catalog: ResourceCatalogEntry[]): Set<string> {
  const addresses = new Set<string>();
  for (const entry of catalog) {
    if (entry.kind === 'contract') {
      addresses.add(entry.identifier.toLowerCase());
    }
  }
  return addresses;
}

export function getSyncTargets(resolved: ResolvedResource[]): Array<{ chain: SupportedChain; identifier: string }> {
  const seen = new Set<string>();
  const targets: Array<{ chain: SupportedChain; identifier: string }> = [];

  for (const resource of resolved) {
    const key = `${resource.chain}:${resource.tokenIdentifier.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ chain: resource.chain, identifier: resource.tokenIdentifier });
  }

  return targets;
}
