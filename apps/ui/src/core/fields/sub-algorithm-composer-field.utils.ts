import {
  type AlgorithmDefinition,
  type AlgorithmNormalization,
  getAlgorithmDefinition,
  getAlgorithmDefinitionKeys,
  getAlgorithmDefinitionVersions,
} from "@reputo/reputation-algorithms"

export interface ChildAlgorithmOption {
  key: string
  label: string
  /** One-line summary from the definition, for the picker menu. */
  summary: string
  /** Latest registry version, pre-assigned when the child is added. */
  latestVersion: string
}

const NORMALIZATION_METHOD_LABELS: Record<string, string> = {
  observed_min_max: "Observed min–max",
}

export interface NormalizationSummary {
  methodLabel: string
  targetMin: number
  targetMax: number
}

/**
 * Display summary of the active normalization method. Definitions without
 * metadata default to observed min–max over [0, 100].
 */
export function describeNormalization(
  normalization?: AlgorithmNormalization | null
): NormalizationSummary {
  const method = normalization?.method ?? "observed_min_max"

  return {
    methodLabel:
      NORMALIZATION_METHOD_LABELS[method] ?? method.replace(/_/g, " "),
    targetMin: normalization?.targetMin ?? 0,
    targetMax: normalization?.targetMax ?? 100,
  }
}

export function safeGetDefinition(
  key: string,
  version: string
): AlgorithmDefinition | null {
  try {
    return JSON.parse(
      getAlgorithmDefinition({ key, version })
    ) as AlgorithmDefinition
  } catch {
    return null
  }
}

export function safeGetVersions(key: string): string[] {
  try {
    return [...getAlgorithmDefinitionVersions(key)]
  } catch {
    return []
  }
}

/**
 * Returns the list of algorithms available as sub-algorithms, excluding
 * combined ones (they cannot be nested further).
 */
export function getSelectableChildAlgorithms(): ChildAlgorithmOption[] {
  const options: ChildAlgorithmOption[] = []

  for (const key of getAlgorithmDefinitionKeys()) {
    const versions = safeGetVersions(key)
    const latestVersion = versions[versions.length - 1]

    if (!latestVersion) {
      continue
    }

    const definition = safeGetDefinition(key, latestVersion)
    if (!definition || definition.kind === "combined") {
      continue
    }

    options.push({
      key,
      label: definition.name,
      summary: definition.summary ?? "",
      latestVersion,
    })
  }

  return options.sort((a, b) => a.label.localeCompare(b.label))
}

export interface WeightShare {
  /** Percentage share of the total weight, or null when not computable. */
  sharePercent: number | null
}

/**
 * Computes each entry's share of the total weight. An entry with a
 * non-finite or non-positive weight gets a null share; when the total is
 * not a positive finite number, every share is null.
 */
export function computeWeightShares(
  rows: ReadonlyArray<{ weight?: number | string | null } | undefined>
): WeightShare[] {
  const weights = rows.map((row) => {
    const weight = row?.weight
    const parsed =
      typeof weight === "number"
        ? weight
        : typeof weight === "string" && weight.trim() !== ""
          ? Number(weight.replace(",", "."))
          : Number.NaN
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  })

  const total = weights.reduce<number>((sum, weight) => sum + (weight ?? 0), 0)
  const totalValid = Number.isFinite(total) && total > 0

  return weights.map((weight) => ({
    sharePercent: totalValid && weight !== null ? (weight / total) * 100 : null,
  }))
}

/** Display form of a share: "62%", "<1%", or "—" when not computable. */
export function formatSharePercent(sharePercent: number | null): string {
  if (sharePercent === null) {
    return "—"
  }
  if (sharePercent > 0 && sharePercent < 1) {
    return "<1%"
  }
  return `${Math.round(sharePercent)}%`
}

/** Build a fresh inputs array for the selected child algorithm definition. */
export function buildChildInputsArray(
  definition: AlgorithmDefinition,
  sharedInputKeys: ReadonlyArray<string>
): Array<{ key: string; value: unknown }> {
  return definition.inputs
    .filter((input) => !sharedInputKeys.includes(input.key))
    .map((input) => {
      let defaultValue: unknown = ""

      if (input.type === "boolean") {
        defaultValue = false
      } else if ("default" in input && input.default !== undefined) {
        defaultValue = input.default
      }

      return { key: input.key, value: defaultValue }
    })
}
