import type { AlgorithmDefinition } from "@reputo/reputation-algorithms"
import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockGetAlgorithmDefinition,
  mockGetAlgorithmDefinitionKeys,
  mockGetAlgorithmDefinitionVersions,
} = vi.hoisted(() => ({
  mockGetAlgorithmDefinition: vi.fn(),
  mockGetAlgorithmDefinitionKeys: vi.fn(),
  mockGetAlgorithmDefinitionVersions: vi.fn(),
}))

vi.mock("@reputo/reputation-algorithms", () => ({
  getAlgorithmDefinition: mockGetAlgorithmDefinition,
  getAlgorithmDefinitionKeys: mockGetAlgorithmDefinitionKeys,
  getAlgorithmDefinitionVersions: mockGetAlgorithmDefinitionVersions,
}))

import {
  buildChildInputsArray,
  computeWeightShares,
  describeNormalization,
  formatSharePercent,
  getSelectableChildAlgorithms,
} from "../../../../src/core/fields/sub-algorithm-composer-field.utils"

describe("sub-algorithm composer helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("lists only standalone child algorithms and sorts them by label", () => {
    mockGetAlgorithmDefinitionKeys.mockReturnValue([
      "custom_score",
      "voting_engagement",
      "proposal_engagement",
    ])
    mockGetAlgorithmDefinitionVersions.mockImplementation((key: string) => {
      if (key === "proposal_engagement") {
        return ["0.9.0", "1.0.0"]
      }

      return ["1.0.0"]
    })
    mockGetAlgorithmDefinition.mockImplementation(({ key, version }) => {
      const definition: AlgorithmDefinition =
        key === "custom_score"
          ? {
              key,
              name: "Custom Algorithm",
              kind: "combined",
              category: "Custom",
              summary: "Combined root algorithm.",
              description: "Combined root algorithm.",
              version,
              inputs: [],
              outputs: [],
              runtime: "typescript",
            }
          : {
              key,
              name:
                key === "proposal_engagement"
                  ? "Proposal Engagement"
                  : "Voting Engagement",
              kind: "standalone",
              category: "Engagement",
              summary: "Standalone child algorithm.",
              description: "Standalone child algorithm.",
              version,
              inputs: [],
              outputs: [],
              runtime: "typescript",
            }

      return JSON.stringify(definition)
    })

    expect(getSelectableChildAlgorithms()).toEqual([
      {
        key: "proposal_engagement",
        label: "Proposal Engagement",
        summary: "Standalone child algorithm.",
        latestVersion: "1.0.0",
      },
      {
        key: "voting_engagement",
        label: "Voting Engagement",
        summary: "Standalone child algorithm.",
        latestVersion: "1.0.0",
      },
    ])
    expect(mockGetAlgorithmDefinition).toHaveBeenCalledWith({
      key: "proposal_engagement",
      version: "1.0.0",
    })
  })

  it("computes weight shares and excludes invalid weights", () => {
    expect(
      computeWeightShares([{ weight: 1 }, { weight: 3 }]).map(
        (share) => share.sharePercent
      )
    ).toEqual([25, 75])

    expect(
      computeWeightShares([{ weight: "1,5" }, { weight: "1.5" }]).map(
        (share) => share.sharePercent
      )
    ).toEqual([50, 50])

    // Invalid entries get no share; valid ones still split the total.
    expect(
      computeWeightShares([
        { weight: "" },
        { weight: 0 },
        { weight: -2 },
        { weight: 2 },
        undefined,
      ]).map((share) => share.sharePercent)
    ).toEqual([null, null, null, 100, null])

    // A non-finite total invalidates every share.
    expect(
      computeWeightShares([
        { weight: Number.MAX_VALUE },
        { weight: Number.MAX_VALUE },
      ]).map((share) => share.sharePercent)
    ).toEqual([null, null])

    expect(computeWeightShares([])).toEqual([])
  })

  it("formats share percentages for display", () => {
    expect(formatSharePercent(null)).toBe("—")
    expect(formatSharePercent(0.4)).toBe("<1%")
    expect(formatSharePercent(25)).toBe("25%")
    expect(formatSharePercent(66.6)).toBe("67%")
  })

  it("builds child input rows without inherited keys and preserves defaults", () => {
    const definition: AlgorithmDefinition = {
      key: "token_value_over_time",
      name: "Token Value Over Time",
      kind: "standalone",
      category: "Activity",
      summary: "Tracks token value.",
      description: "Tracks token value.",
      version: "1.0.0",
      inputs: [
        {
          key: "wallets",
          label: "Wallets",
          type: "json",
          required: true,
        },
        {
          key: "normalize_scores",
          label: "Normalize Scores",
          type: "boolean",
          required: true,
        },
        {
          key: "lookback_window_days",
          label: "Lookback Window",
          type: "number",
          required: true,
          default: 90,
        },
        {
          key: "votes",
          label: "Votes",
          type: "csv",
          csv: {
            columns: [{ key: "id", type: "number", required: true }],
          },
        },
      ],
      outputs: [],
      runtime: "typescript",
    }

    expect(buildChildInputsArray(definition, ["wallets"])).toEqual([
      {
        key: "normalize_scores",
        value: false,
      },
      {
        key: "lookback_window_days",
        value: 90,
      },
      {
        key: "votes",
        value: "",
      },
    ])
  })

  it("defaults normalization display to observed min-max over [0, 100]", () => {
    expect(describeNormalization(undefined)).toEqual({
      methodLabel: "Observed min–max",
      targetMin: 0,
      targetMax: 100,
    })
    expect(describeNormalization(null)).toEqual({
      methodLabel: "Observed min–max",
      targetMin: 0,
      targetMax: 100,
    })
  })

  it("describes the active normalization method from definition metadata", () => {
    expect(
      describeNormalization({
        method: "observed_min_max",
        targetMin: 0,
        targetMax: 100,
      })
    ).toEqual({
      methodLabel: "Observed min–max",
      targetMin: 0,
      targetMax: 100,
    })
  })

  it("falls back to a readable label for future methods", () => {
    expect(
      describeNormalization({
        method: "z_score" as never,
        targetMin: -3,
        targetMax: 3,
      })
    ).toEqual({
      methodLabel: "z score",
      targetMin: -3,
      targetMax: 3,
    })
  })
})
