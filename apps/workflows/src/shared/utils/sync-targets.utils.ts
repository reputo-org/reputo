import type { SyncTarget } from '../types/index.js';

interface AlgorithmPresetFrozenLike {
  inputs: Array<{ key: string; value?: unknown }>;
}

interface ResourceCatalogResource {
  key: string;
  kind: string;
  identifier: string;
  tokenIdentifier: string;
  parentResourceKey?: string;
}

interface ResourceCatalogChain {
  key: string;
  resources: ResourceCatalogResource[];
}

interface AlgorithmDefinitionLike {
  inputs?: Array<{
    key: string;
    uiHint?: {
      resourceCatalog?: {
        chains: ResourceCatalogChain[];
      };
    };
  }>;
}

/**
 * Extracts onchain sync targets from the frozen preset and algorithm definition.
 * Maps selected_resources (chain + resource_key) through the resource catalog to
 * get concrete chain+identifier pairs for the onchain worker to sync.
 */
export function extractOnchainSyncTargets(
  preset: AlgorithmPresetFrozenLike,
  definition: AlgorithmDefinitionLike,
): SyncTarget[] {
  const selectedResourcesRaw = preset.inputs.find((i) => i.key === 'selected_resources')?.value as
    | Array<{ chain: string; resource_key: string }>
    | undefined;
  if (!selectedResourcesRaw || selectedResourcesRaw.length === 0) {
    return [];
  }

  const resourcesInput = definition.inputs?.find((i) => i.key === 'selected_resources');
  const catalog = resourcesInput?.uiHint?.resourceCatalog;
  if (!catalog?.chains) {
    return [];
  }

  const catalogMap = new Map<string, ResourceCatalogResource>();
  for (const chain of catalog.chains) {
    for (const resource of chain.resources) {
      catalogMap.set(`${chain.key}:${resource.key}:${resource.identifier}`, resource);
    }
  }

  const seen = new Set<string>();
  const targets: SyncTarget[] = [];

  for (const sel of selectedResourcesRaw) {
    for (const chain of catalog.chains) {
      if (chain.key !== sel.chain) continue;
      for (const resource of chain.resources) {
        if (resource.key !== sel.resource_key) continue;

        const syncIdentifier = resource.tokenIdentifier;
        const dedupeKey = `${sel.chain}:${syncIdentifier.toLowerCase()}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        targets.push({ chain: sel.chain, identifier: syncIdentifier });
      }
    }
  }

  return targets;
}
