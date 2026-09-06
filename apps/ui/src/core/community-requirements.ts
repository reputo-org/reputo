import {
  type AlgorithmDefinition,
  getAlgorithmDefinition,
  getAlgorithmDefinitionVersions,
} from "@reputo/reputation-algorithms"
import type { CommunityPlatform } from "@/lib/api/types"

const COMMUNITY_PLATFORM_IDS: ReadonlySet<string> = new Set([
  "discord",
  "github",
  "mattermost",
])

/**
 * The community platform an algorithm needs a connection for, read from its
 * registry definition: the input whose widget is `community_connection`
 * carries the platform in its uiHint. Undefined for algorithms without one —
 * including combined algorithms, whose children declare their own.
 */
export function getRequiredCommunityPlatform(
  algorithmKey: string,
  version?: string
): CommunityPlatform | undefined {
  let definition: AlgorithmDefinition
  try {
    const versions = getAlgorithmDefinitionVersions(algorithmKey)
    const resolved = version ?? versions[versions.length - 1]
    if (!resolved) return undefined
    definition = JSON.parse(
      getAlgorithmDefinition({ key: algorithmKey, version: resolved })
    ) as AlgorithmDefinition
  } catch {
    return undefined
  }

  for (const input of definition.inputs ?? []) {
    const uiHint = (
      input as { uiHint?: { widget?: string; platform?: string } }
    ).uiHint
    if (
      uiHint?.widget === "community_connection" &&
      uiHint.platform !== undefined &&
      COMMUNITY_PLATFORM_IDS.has(uiHint.platform)
    ) {
      return uiHint.platform as CommunityPlatform
    }
  }

  return undefined
}
