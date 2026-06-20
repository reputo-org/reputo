import type { AlgorithmDefinition } from "@reputo/reputation-algorithms"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Algorithm } from "../../../src/core/algorithms"
import {
  buildAlgorithmInputFormFields,
  buildSchemaFromAlgorithm,
} from "../../../src/core/schema-builder"

const { mockGetAlgorithmDefinition } = vi.hoisted(() => ({
  mockGetAlgorithmDefinition: vi.fn(),
}))

vi.mock("@reputo/reputation-algorithms", () => ({
  getAlgorithmDefinition: mockGetAlgorithmDefinition,
}))

const algorithm: Algorithm = {
  id: "voting_engagement",
  title: "Voting Engagement",
  category: "Engagement",
  summary: "Scores voting diversity.",
  description: "Calculates voting engagement from a vote file.",
  duration: "~2-5 min",
  inputSummary: "2 configurable inputs",
  level: "Intermediate",
  kind: "standalone",
  inputs: [
    { key: "wallets", type: "json", label: "Wallet Addresses JSON" },
    { key: "votes_csv", type: "csv", label: "Votes CSV" },
    { key: "threshold", type: "number", label: "Threshold" },
    { key: "include_inactive", type: "boolean", label: "Include Inactive" },
    { key: "label", type: "string", label: "Display Label" },
  ],
  dependencyLabels: [],
}

const definition: AlgorithmDefinition = {
  key: "voting_engagement",
  name: "Voting Engagement",
  category: "Engagement",
  summary: "Scores voting diversity.",
  description: "Calculates voting engagement from a vote file.",
  version: "1.0.0",
  inputs: [
    {
      key: "wallets",
      label: "Wallet Addresses JSON",
      type: "json",
      required: true,
      description: "Wallet addresses grouped by chain.",
      json: {
        maxBytes: 5242880,
        schema: "wallet_address_map",
        rootKey: "wallets",
        allowedChains: ["ethereum", "cardano"],
      },
    },
    {
      key: "votes_csv",
      label: "Votes CSV",
      type: "csv",
      csv: {
        hasHeader: true,
        delimiter: ";",
        maxRows: 1000,
        maxBytes: 2048,
        columns: [
          {
            key: "user_id",
            type: "integer",
            aliases: ["User ID"],
            required: true,
          },
        ],
      },
    },
    {
      key: "threshold",
      label: "Threshold",
      type: "number",
      min: 0,
      max: 10,
      step: 0.5,
      default: 3,
      uiHint: { widget: "slider" },
      description: "The minimum score threshold.",
    },
    {
      key: "include_inactive",
      label: "Include Inactive",
      type: "boolean",
      default: true,
      required: false,
      description: "Whether to include inactive voters.",
    },
    {
      key: "label",
      label: "Display Label",
      type: "string",
      required: false,
      description: "Custom label shown in exports.",
    },
  ],
  outputs: [
    { key: "scores", label: "Scores", type: "csv", csv: { columns: [] } },
  ],
  runtime: "typescript",
}

describe("buildSchemaFromAlgorithm", () => {
  beforeEach(() => {
    mockGetAlgorithmDefinition.mockReset()
  })

  it("builds metadata fields and maps rich algorithm definitions into form inputs", () => {
    mockGetAlgorithmDefinition.mockReturnValue(JSON.stringify(definition))

    const result = buildSchemaFromAlgorithm(algorithm, "2.0.0")

    expect(result.key).toBe("preset_voting_engagement")
    expect(result.version).toBe("2.0.0")
    expect(result.outputs).toEqual(definition.outputs)
    expect(result.inputs.slice(0, 4).map((input) => input.key)).toEqual([
      "key",
      "version",
      "name",
      "description",
    ])
    expect(result.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "wallets",
          type: "json",
          description: "Wallet addresses grouped by chain.",
          required: true,
          json: {
            maxBytes: 5242880,
            schema: "wallet_address_map",
            rootKey: "wallets",
            allowedChains: ["ethereum", "cardano"],
          },
        }),
        expect.objectContaining({
          key: "votes_csv",
          type: "csv",
          csv: expect.objectContaining({
            delimiter: ";",
            maxRows: 1000,
            maxBytes: 2048,
            columns: [
              expect.objectContaining({
                key: "user_id",
                type: "number",
                aliases: ["User ID"],
              }),
            ],
          }),
        }),
        expect.objectContaining({
          key: "threshold",
          type: "slider",
          min: 0,
          max: 10,
          step: 0.5,
          default: 3,
          description: "The minimum score threshold.",
        }),
        expect.objectContaining({
          key: "include_inactive",
          type: "boolean",
          default: true,
          required: false,
        }),
        expect.objectContaining({
          key: "label",
          type: "text",
          description: "Custom label shown in exports.",
          required: false,
        }),
      ])
    )
  })

  it("falls back to defaults when the full definition cannot be loaded", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    mockGetAlgorithmDefinition.mockImplementation(() => {
      throw new Error("missing definition")
    })

    const result = buildSchemaFromAlgorithm(algorithm)

    expect(result.outputs).toEqual([])
    expect(result.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "wallets",
          type: "json",
          required: true,
          json: undefined,
        }),
        expect.objectContaining({
          key: "votes_csv",
          type: "csv",
          csv: expect.objectContaining({
            hasHeader: true,
            delimiter: ",",
            columns: [],
          }),
        }),
        expect.objectContaining({
          key: "threshold",
          type: "number",
          required: true,
        }),
      ])
    )
    expect(warnSpy).toHaveBeenCalledWith(
      "Could not fetch full definition for voting_engagement:",
      expect.any(Error)
    )
  })

  it("maps definition-driven resource selectors into form inputs", () => {
    const resourceSelectorAlgorithm: Algorithm = {
      id: "token_value_over_time",
      title: "Token Value Over Time",
      category: "Activity",
      summary: "Tracks held token value.",
      description: "Measures holdings over time.",
      duration: "~2-5 min",
      inputSummary: "2 configurable inputs",
      level: "Intermediate",
      kind: "standalone",
      inputs: [
        {
          key: "selected_resources",
          type: "array",
          label: "Resources to Include",
        },
      ],
      dependencyLabels: [],
    }

    mockGetAlgorithmDefinition.mockReturnValue(
      JSON.stringify({
        key: "token_value_over_time",
        name: "Token Value Over Time",
        category: "Activity",
        summary: "Tracks held token value.",
        description: "Measures holdings over time.",
        version: "1.0.0",
        inputs: [
          {
            key: "selected_resources",
            label: "Resources to Include",
            description: "Add chain groups and nested resources.",
            type: "array",
            minItems: 1,
            required: true,
            uniqueBy: ["chain", "resource_key"],
            uiHint: {
              widget: "resource_selector",
              resourceCatalog: {
                chains: [
                  {
                    key: "ethereum",
                    label: "Ethereum",
                    resources: [
                      {
                        key: "fet_token",
                        label: "FET",
                        kind: "token",
                        identifier: "0xaaa",
                        tokenIdentifier: "0xaaa",
                        tokenKey: "fet",
                      },
                      {
                        key: "fet_staking_1",
                        label: "FET Staking",
                        kind: "contract",
                        identifier: "0xbbb",
                        tokenIdentifier: "0xaaa",
                        tokenKey: "fet",
                        parentResourceKey: "fet_token",
                      },
                    ],
                  },
                  {
                    key: "cardano",
                    label: "Cardano",
                    resources: [
                      {
                        key: "fet_token",
                        label: "FET",
                        kind: "token",
                        identifier: "asset1",
                        tokenIdentifier: "asset1",
                        tokenKey: "fet",
                      },
                    ],
                  },
                ],
              },
            },
            item: {
              type: "object",
              properties: [
                {
                  key: "chain",
                  label: "Chain",
                  description: "Blockchain network.",
                  type: "string",
                  required: true,
                  enum: ["ethereum", "cardano"],
                  uiHint: {
                    widget: "select",
                    options: [
                      { value: "ethereum", label: "Ethereum" },
                      { value: "cardano", label: "Cardano" },
                    ],
                  },
                },
                {
                  key: "resource_key",
                  label: "Resource",
                  description: "Selected resource.",
                  type: "string",
                  required: true,
                  uiHint: {
                    widget: "select",
                    dependsOn: "chain",
                    options: [
                      {
                        value: "fet_token",
                        label: "FET",
                        filterBy: "ethereum",
                      },
                      {
                        value: "fet_staking_1",
                        label: "FET Staking",
                        filterBy: "ethereum",
                      },
                      {
                        value: "fet_token",
                        label: "FET",
                        filterBy: "cardano",
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
        outputs: [],
        runtime: "typescript",
      } satisfies AlgorithmDefinition)
    )

    const result = buildSchemaFromAlgorithm(resourceSelectorAlgorithm, "1.0.0")
    const selectedResources = result.inputs.find(
      (input) => input.key === "selected_resources"
    )

    expect(selectedResources).toMatchObject({
      type: "array",
      widget: "resource_selector",
      uniqueBy: ["chain", "resource_key"],
    })
    expect(selectedResources?.resourceCatalog?.chains[0]).toMatchObject({
      key: "ethereum",
      resources: [
        {
          key: "fet_token",
          kind: "token",
        },
        {
          key: "fet_staking_1",
          kind: "contract",
        },
      ],
    })

    const chainProperty = selectedResources?.itemProperties?.[0]
    const resourceKeyProperty = selectedResources?.itemProperties?.[1]

    expect(chainProperty).toMatchObject({
      key: "chain",
      type: "select",
    })
    expect(resourceKeyProperty).toMatchObject({
      key: "resource_key",
      type: "select",
      dependsOn: "chain",
    })
    expect(resourceKeyProperty?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: "fet_staking_1",
          filterBy: "ethereum",
        }),
      ])
    )
  })

  it("maps sub_algorithm inputs into composer form fields", () => {
    const customScore: Algorithm = {
      id: "custom_score",
      title: "Custom Algorithm",
      category: "Custom",
      summary: "Combines sub-algorithms.",
      description: "Combines sub-algorithms into a composite score.",
      duration: "~2-5 min",
      inputSummary: "2 configurable inputs",
      level: "Intermediate",
      kind: "combined",
      inputs: [
        { key: "sub_ids", type: "json", label: "SubID Input (JSON)" },
        {
          key: "sub_algorithms",
          type: "sub_algorithm",
          label: "Sub-Algorithms",
        },
      ],
      dependencyLabels: [],
    }

    mockGetAlgorithmDefinition.mockReturnValue(
      JSON.stringify({
        key: "custom_score",
        name: "Custom Algorithm",
        kind: "combined",
        category: "Custom",
        summary: "Combines sub-algorithms.",
        description: "Combines sub-algorithms into a composite score.",
        version: "1.0.0",
        inputs: [
          {
            key: "sub_ids",
            label: "SubID Input (JSON)",
            type: "json",
            required: true,
          },
          {
            key: "sub_algorithms",
            label: "Sub-Algorithms",
            description: "Pick child algorithms that share the SubID input.",
            type: "sub_algorithm",
            required: true,
            minItems: 1,
            sharedInputKeys: ["sub_ids"],
            uiHint: {
              widget: "sub_algorithm_composer",
              addButtonLabel: "Add sub-algorithm",
            },
          },
        ],
        outputs: [],
        runtime: "typescript",
      } satisfies AlgorithmDefinition)
    )

    const result = buildSchemaFromAlgorithm(customScore, "1.0.0")
    const subAlgorithms = result.inputs.find(
      (input) => input.key === "sub_algorithms"
    )

    expect(subAlgorithms).toMatchObject({
      key: "sub_algorithms",
      type: "sub_algorithm",
      widget: "sub_algorithm_composer",
      required: true,
      minItems: 1,
      sharedInputKeys: ["sub_ids"],
      addButtonLabel: "Add sub-algorithm",
    })
  })
})

describe("buildAlgorithmInputFormFields", () => {
  it("builds form fields from a definition and excludes shared keys", () => {
    const def: AlgorithmDefinition = {
      key: "voting_engagement",
      name: "Voting Engagement",
      category: "Engagement",
      summary: "Scores voting diversity.",
      description: "Calculates voting engagement from a vote file.",
      version: "1.0.0",
      inputs: [
        {
          key: "sub_ids",
          label: "SubID Input (JSON)",
          type: "json",
          required: true,
        },
        {
          key: "votes",
          label: "Votes CSV",
          type: "csv",
          csv: {
            hasHeader: true,
            delimiter: ",",
            columns: [{ key: "id", type: "string", required: true }],
          },
        },
      ],
      outputs: [],
      runtime: "typescript",
    }

    const fields = buildAlgorithmInputFormFields(def, ["sub_ids"])

    expect(fields).toHaveLength(1)
    expect(fields[0]).toMatchObject({
      key: "votes",
      type: "csv",
      label: "Votes CSV",
    })
  })
})
