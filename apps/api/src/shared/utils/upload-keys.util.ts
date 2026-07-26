import type { AlgorithmInputValue } from './algorithm-input-validation.util';

const UPLOADS_PREFIX = 'uploads/';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSubAlgorithmEntry(value: unknown): value is { inputs: unknown[] } {
  return isRecord(value) && typeof value.algorithm_key === 'string' && Array.isArray(value.inputs);
}

function collectFromValue(value: unknown, keys: Set<string>): void {
  if (typeof value === 'string') {
    if (value.startsWith(UPLOADS_PREFIX)) {
      keys.add(value);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (!isSubAlgorithmEntry(entry)) {
        continue;
      }
      for (const childInput of entry.inputs) {
        if (isRecord(childInput)) {
          collectFromValue(childInput.value, keys);
        }
      }
    }
  }
}

/**
 * Collects every `uploads/` storage key referenced by preset inputs, including
 * file inputs nested inside sub-algorithm entries (e.g. `custom_score`), deduped.
 */
export function collectUploadKeys(inputs: ReadonlyArray<AlgorithmInputValue>): string[] {
  const keys = new Set<string>();

  for (const input of inputs) {
    collectFromValue(input.value, keys);
  }

  return [...keys];
}
