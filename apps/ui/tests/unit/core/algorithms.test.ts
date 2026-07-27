import { beforeEach, describe, expect, it, vi } from "vitest"

const mockGetAlgorithmDefinition = vi.fn()
const mockGetAlgorithmDefinitionKeys = vi.fn()
const mockSearchAlgorithmDefinitions = vi.fn()

vi.mock("@reputo/reputation-algorithms", () => ({
  getAlgorithmDefinition: mockGetAlgorithmDefinition,
  getAlgorithmDefinitionKeys: mockGetAlgorithmDefinitionKeys,
  searchAlgorithmDefinitions: mockSearchAlgorithmDefinitions,
}))

async function loadAlgorithmsModule() {
  vi.resetModules()
  return import("../../../src/core/algorithms")
}

describe("ui algorithms", () => {
  beforeEach(() => {
    mockGetAlgorithmDefinition.mockReset()
    mockGetAlgorithmDefinitionKeys.mockReset()
    mockSearchAlgorithmDefinitions.mockReset()
  })

  it("builds the initial algorithm list and skips invalid registry entries", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    mockGetAlgorithmDefinitionKeys.mockReturnValue([
      "voting_engagement",
      "broken_algorithm",
    ])
    mockGetAlgorithmDefinition.mockImplementation(
      ({ key }: { key: string }) => {
        if (key === "broken_algorithm") {
          throw new Error("bad registry entry")
        }

        return JSON.stringify({
          key: "voting_engagement",
          name: "Voting Engagement",
          category: "Engagement",
          summary: "Scores voting diversity.",
          description: "Calculates voting engagement from a vote file.",
          version: "1.0.0",
          inputs: [{ key: "votes_csv", type: "csv", label: "Votes CSV" }],
          outputs: [],
          runtime: "typescript",
          dependencies: [{ key: "deepfunding-portal-api" }],
        })
      }
    )

    const { algorithms, getAlgorithmById } = await loadAlgorithmsModule()

    expect(algorithms).toEqual([
      {
        id: "voting_engagement",
        title: "Voting Engagement",
        category: "Engagement",
        summary: "Scores voting diversity.",
        description: "Calculates voting engagement from a vote file.",
        duration: "1–3 min",
        inputSummary: "1 input",
        level: "Beginner",
        kind: "standalone",
        inputs: [{ key: "votes_csv", type: "csv", label: "Votes CSV" }],
        dependencyLabels: ["Deep Funding Portal"],
      },
    ])
    expect(getAlgorithmById("voting_engagement")).toEqual(algorithms[0])
    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to load algorithm broken_algorithm:",
      expect.any(Error)
    )
  })

  it("uses registry search results and falls back safely on search errors", async () => {
    mockGetAlgorithmDefinitionKeys.mockReturnValue([])
    mockSearchAlgorithmDefinitions
      .mockReturnValueOnce([
        JSON.stringify({
          key: "proposal_engagement",
          name: "Proposal Engagement",
          category: "Engagement",
          summary: "Scores proposal outcomes.",
          description: "Calculates proposal engagement.",
          version: "1.0.0",
          inputs: [
            { key: "reviews_csv", type: "csv", label: "Reviews CSV" },
            { key: "threshold", type: "number", label: "Threshold" },
          ],
          outputs: [],
          runtime: "typescript",
        }),
      ])
      .mockImplementationOnce(() => {
        throw new Error("search failed")
      })

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const { searchAlgorithms } = await loadAlgorithmsModule()

    expect(searchAlgorithms("proposal")).toEqual([
      {
        id: "proposal_engagement",
        title: "Proposal Engagement",
        category: "Engagement",
        summary: "Scores proposal outcomes.",
        description: "Calculates proposal engagement.",
        duration: "2–4 min",
        inputSummary: "2 inputs",
        level: "Beginner",
        kind: "standalone",
        inputs: [
          { key: "reviews_csv", type: "csv", label: "Reviews CSV" },
          { key: "threshold", type: "number", label: "Threshold" },
        ],
        dependencyLabels: [],
      },
    ])
    expect(mockSearchAlgorithmDefinitions).toHaveBeenNthCalledWith(1, {
      key: "proposal",
      name: "proposal",
      category: "proposal",
    })
    expect(searchAlgorithms("broken")).toEqual([])
    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to search algorithms:",
      expect.any(Error)
    )
  })

  it("maps the canonical onchain-data dependency label for browse surfaces", async () => {
    mockGetAlgorithmDefinitionKeys.mockReturnValue([])
    mockSearchAlgorithmDefinitions.mockReturnValue([
      JSON.stringify({
        key: "token_value_over_time",
        name: "Token Value Over Time",
        category: "Activity",
        summary: "Scores held token value.",
        description: "Measures holdings over time.",
        version: "1.0.0",
        inputs: [
          { key: "wallets", type: "json", label: "Wallet List JSON" },
          {
            key: "selected_resources",
            type: "array",
            label: "Resources to Score",
          },
        ],
        outputs: [],
        runtime: "typescript",
        dependencies: [{ key: "onchain-data" }],
      }),
    ])

    const { searchAlgorithms } = await loadAlgorithmsModule()

    expect(searchAlgorithms("token")).toEqual([
      {
        id: "token_value_over_time",
        title: "Token Value Over Time",
        category: "Activity",
        summary: "Scores held token value.",
        description: "Measures holdings over time.",
        duration: "4–8 min",
        inputSummary: "2 inputs",
        level: "Intermediate",
        kind: "standalone",
        inputs: [
          { key: "wallets", type: "json", label: "Wallet List JSON" },
          {
            key: "selected_resources",
            type: "array",
            label: "Resources to Score",
          },
        ],
        dependencyLabels: ["On-chain data"],
      },
    ])
  })
})
