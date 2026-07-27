const MAX_NAME_LENGTH = 100
const MIN_DESCRIPTION_LENGTH = 10
const MAX_DESCRIPTION_LENGTH = 500

/** Default preset name, e.g. "Voting Engagement preset — Jul 27". */
export function suggestPresetName(
  algorithmTitle: string,
  now: Date = new Date()
): string {
  const day = now.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
  return `${algorithmTitle} preset — ${day}`.slice(0, MAX_NAME_LENGTH)
}

/** Name for a duplicated preset, clamped to the API's max length. */
export function duplicatePresetName(sourceName: string | undefined): string {
  const base = sourceName?.trim() ? sourceName.trim() : "Preset"
  return `${base} (copy)`.slice(0, MAX_NAME_LENGTH)
}

/**
 * Default preset description: the algorithm's own summary, which already
 * says what the preset computes. Falls back to the title when a definition
 * has no usable summary.
 */
export function suggestPresetDescription(args: {
  algorithmTitle: string
  algorithmSummary?: string
}): string {
  const summary = args.algorithmSummary?.trim() ?? ""

  if (summary.length >= MIN_DESCRIPTION_LENGTH) {
    return summary.length > MAX_DESCRIPTION_LENGTH
      ? `${summary.slice(0, MAX_DESCRIPTION_LENGTH - 1)}…`
      : summary
  }

  return `Default preset for ${args.algorithmTitle}.`.slice(
    0,
    MAX_DESCRIPTION_LENGTH
  )
}
