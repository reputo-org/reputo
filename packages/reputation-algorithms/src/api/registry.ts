import { _DEFINITIONS, REGISTRY_INDEX } from '../registry/index.gen.js';
import { NotFoundError } from '../shared/errors/index.js';
import type { AlgorithmDefinition, SearchAlgorithmFilters } from '../shared/types/algorithm.js';

function getVersionsOrThrow(key: string): readonly string[] {
  const versions = REGISTRY_INDEX[key as keyof typeof REGISTRY_INDEX] as readonly string[] | undefined;

  if (!versions) {
    throw new NotFoundError('KEY_NOT_FOUND', key);
  }
  return versions;
}

function resolveVersion(key: string, version: string | 'latest'): string {
  const versions = getVersionsOrThrow(key);
  const resolved = version === 'latest' ? versions[versions.length - 1] : version;

  if (!resolved) {
    throw new NotFoundError('VERSION_NOT_FOUND', key, version);
  }

  if (!versions.includes(resolved)) {
    throw new NotFoundError('VERSION_NOT_FOUND', key, resolved);
  }

  return resolved;
}

function normalize(value: string | undefined): string | undefined {
  return typeof value === 'string' ? value.trim().toLowerCase() : undefined;
}

function matchesField(fieldValue: string | undefined, filterValue: string | undefined): boolean {
  if (!filterValue) return false;
  const normalizedField = normalize(fieldValue);
  const normalizedFilter = normalize(filterValue);
  if (!normalizedField || !normalizedFilter) return false;

  if (normalizedField === normalizedFilter) return true;

  return normalizedField.includes(normalizedFilter);
}

function getLatestVersion(key: string): string {
  const versions = getVersionsOrThrow(key);
  return versions[versions.length - 1] as string;
}

/**
 * Retrieves all available algorithm definition keys from the registry.
 *
 * @returns A sorted array of algorithm keys available in the registry
 *
 * @example
 * ```ts
 * const keys = getAlgorithmDefinitionKeys()
 * console.log('Available algorithms:', keys)
 * // e.g. ['voting-engagement', 'contribution-score', ...]
 * ```
 */
export function getAlgorithmDefinitionKeys(): readonly string[] {
  return Object.keys(REGISTRY_INDEX).sort();
}

/**
 * Retrieves all available versions for a specific algorithm definition.
 *
 * @param key - The algorithm key to get versions for
 * @returns A readonly array of version strings available for the algorithm
 * @throws {NotFoundError} When the algorithm key is not found in the registry
 *
 * @example
 * ```ts
 * const versions = getAlgorithmDefinitionVersions('my-algorithm')
 * console.log('Available versions:', versions)
 * // e.g. ['1.0.0', '1.1.0', '2.0.0']
 * ```
 */
export function getAlgorithmDefinitionVersions(key: string): readonly string[] {
  return getVersionsOrThrow(key);
}

/**
 * Retrieves a complete algorithm definition by key and version.
 *
 * @param filters - Object containing the algorithm key and optional version
 * @param filters.key - The algorithm key to retrieve
 * @param filters.version - The version to retrieve (defaults to 'latest')
 * @returns A JSON string representation of the algorithm definition object
 * @throws {NotFoundError} When the algorithm key or version is not found
 *
 * @example
 * ```ts
 * const definition = getAlgorithmDefinition({ key: 'voting-engagement' })
 *
 * const specific = getAlgorithmDefinition({
 *   key: 'voting-engagement',
 *   version: '1.0.0'
 * })
 * ```
 */
export function getAlgorithmDefinition(filters: { key: string; version?: string | 'latest' }): string {
  const { key, version = 'latest' } = filters;
  const resolvedVersion = resolveVersion(key, version);
  const definitionKey = `${key}@${resolvedVersion}`;
  const definition = _DEFINITIONS[definitionKey];
  if (!definition) {
    throw new NotFoundError('KEY_NOT_FOUND', key);
  }
  return JSON.stringify(definition);
}

/**
 * Searches algorithm definitions by metadata using flexible filters.
 *
 * Matching rules:
 * - OR logic across fields: an algorithm matches if it satisfies ANY provided filter
 * - Within each field, matching is case-insensitive and supports:
 *   - Exact match (e.g. 'voting_power' === 'voting_power')
 *   - Partial/substring match (e.g. 'engagement' matches 'Engagement Score')
 *
 * Version handling:
 * - Only the latest version of each algorithm key is considered and returned
 *
 * @param filters - Optional filters to apply when searching
 * @returns Array of JSON string representations of matching algorithm definitions
 *
 * @example
 * ```ts
 * // Search by key (exact or partial)
 * const byKey = searchAlgorithmDefinitions({ key: 'voting' })
 *
 * // Search by name
 * const byName = searchAlgorithmDefinitions({ name: 'Engagement Score' })
 *
 * // Search by category
 * const byCategory = searchAlgorithmDefinitions({ category: 'engagement' })
 *
 * // Combined filters (OR logic)
 * const mixed = searchAlgorithmDefinitions({ key: 'voting', category: 'engagement' })
 * ```
 */
export function searchAlgorithmDefinitions(filters: SearchAlgorithmFilters = {}): string[] {
  const { key, name, category } = filters;
  const hasAnyFilter = Boolean(key || name || category);

  const result: string[] = [];

  for (const algorithmKey of Object.keys(REGISTRY_INDEX)) {
    const latestVersion = getLatestVersion(algorithmKey);
    const definitionKey = `${algorithmKey}@${latestVersion}`;
    const definition = _DEFINITIONS[definitionKey] as AlgorithmDefinition | undefined;

    if (!definition) {
      continue;
    }

    if (!hasAnyFilter) {
      result.push(JSON.stringify(definition));
      continue;
    }

    const matchesKey = matchesField(definition.key, key);
    const matchesName = matchesField(definition.name, name);
    const matchesCategory = matchesField(definition.category, category);

    if (matchesKey || matchesName || matchesCategory) {
      result.push(JSON.stringify(definition));
    }
  }

  return result;
}
