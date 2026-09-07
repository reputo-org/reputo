import {
  type AlgorithmDefinition,
  type AlgorithmKind,
  getAlgorithmDefinition,
  getAlgorithmDefinitionKeys,
  searchAlgorithmDefinitions,
} from "@reputo/reputation-algorithms"

/** Display labels for known algorithm dependency keys (e.g. external data sources) */
const DEPENDENCY_KEY_TO_LABEL: Record<string, string> = {
  "deepfunding-portal-api": "Deep Funding Portal",
  "onchain-data": "On-chain data",
  "onchain-data-service": "On-chain data",
  "deep-id": "DeepID",
  "discord-activity": "Discord",
  "github-activity": "GitHub",
  "mattermost-activity": "Mattermost",
}

export interface Algorithm {
  id: string
  title: string
  category: string
  summary: string
  description: string
  inputSummary: string
  kind: AlgorithmKind
  inputs: Array<{
    key: string
    type: string
    label: string
  }>
  /** Labels for read-only dependencies (e.g. external APIs or indexed services). */
  dependencyLabels: string[]
}

function formatInputSummary(inputCount: number): string {
  return `${inputCount} input${inputCount !== 1 ? "s" : ""}`
}

function transformAlgorithm(definition: AlgorithmDefinition): Algorithm {
  const dependencyLabels =
    definition.dependencies
      ?.map((dep) => DEPENDENCY_KEY_TO_LABEL[dep.key])
      .filter((label): label is string => Boolean(label)) ?? []

  return {
    id: definition.key,
    title: definition.name,
    category: definition.category,
    summary: definition.summary,
    description: definition.description,
    inputSummary: formatInputSummary(definition.inputs.length),
    kind: definition.kind ?? "standalone",
    inputs: definition.inputs.map((input) => ({
      key: input.key,
      type: input.type,
      label: input.label || input.key,
    })),
    dependencyLabels,
  }
}

function getAllAlgorithms(): Algorithm[] {
  try {
    const keys = getAlgorithmDefinitionKeys()
    const algorithms: Algorithm[] = []

    for (const key of keys) {
      try {
        const definitionJson = getAlgorithmDefinition({ key })
        const definition = JSON.parse(definitionJson) as AlgorithmDefinition
        algorithms.push(transformAlgorithm(definition))
      } catch (error) {
        console.error(`Failed to load algorithm ${key}:`, error)
      }
    }

    return algorithms
  } catch (error) {
    console.error("Failed to get algorithms:", error)
    return []
  }
}

export const algorithms: Algorithm[] = getAllAlgorithms()

export function getAlgorithmById(id: string): Algorithm | undefined {
  return algorithms.find((algo) => algo.id === id)
}

/**
 * Search algorithms using the registry's search functionality.
 * Uses OR logic across filters: matches if key, name, or category matches.
 *
 * @param query - Search query string to match against key, name, and category
 * @returns Array of matching algorithms
 */
export function searchAlgorithms(query: string): Algorithm[] {
  if (!query.trim()) {
    return algorithms
  }

  try {
    const results = searchAlgorithmDefinitions({
      key: query,
      name: query,
      category: query,
    })

    return results.map((jsonStr) => {
      const definition = JSON.parse(jsonStr) as AlgorithmDefinition
      return transformAlgorithm(definition)
    })
  } catch (error) {
    console.error("Failed to search algorithms:", error)
    return []
  }
}
