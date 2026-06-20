import type { AlgorithmDefinition } from "@reputo/reputation-algorithms"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const {
  createDownload,
  mockGetAlgorithmDefinition,
  mockValidateAlgorithmPreset,
} = vi.hoisted(() => ({
  createDownload: vi.fn(),
  mockGetAlgorithmDefinition: vi.fn(),
  mockValidateAlgorithmPreset: vi.fn(),
}))

vi.mock("@/lib/api/services", () => ({
  storageApi: {
    createDownload,
  },
}))

vi.mock("@reputo/algorithm-validator", () => ({
  validateAlgorithmPreset: mockValidateAlgorithmPreset,
}))

vi.mock("@reputo/reputation-algorithms", () => ({
  getAlgorithmDefinition: mockGetAlgorithmDefinition,
}))

import { validateAlgorithmPresetClient } from "../../../../../src/components/app/presets/algorithm-client-validation"

const combinedDefinition: AlgorithmDefinition = {
  key: "custom_score",
  name: "Custom Algorithm",
  kind: "combined",
  category: "Custom",
  summary: "Combines child algorithms.",
  description: "Combines child algorithms.",
  version: "1.0.0",
  inputs: [
    {
      key: "sub_ids",
      label: "Sub IDs",
      type: "json",
      required: true,
      json: {
        schema: "sub_id_input_map",
      },
    },
    {
      key: "sub_algorithms",
      label: "Sub Algorithms",
      type: "sub_algorithm",
      required: true,
      minItems: 1,
      sharedInputKeys: ["sub_ids"],
      uiHint: {
        widget: "sub_algorithm_composer",
      },
    },
  ],
  outputs: [],
  runtime: "typescript",
}

const childDefinition: AlgorithmDefinition = {
  key: "voting_engagement",
  name: "Voting Engagement",
  kind: "standalone",
  category: "Engagement",
  summary: "Scores votes.",
  description: "Scores votes.",
  version: "1.0.0",
  inputs: [
    {
      key: "sub_ids",
      label: "Sub IDs",
      type: "json",
      required: true,
      json: {
        schema: "sub_id_input_map",
      },
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

describe("algorithm client validation adapter", () => {
  beforeEach(() => {
    mockValidateAlgorithmPreset.mockReset()
    mockValidateAlgorithmPreset.mockResolvedValue({
      success: true,
      data: {
        preset: {},
        payload: {},
      },
    })
    mockGetAlgorithmDefinition.mockReset()
    mockGetAlgorithmDefinition.mockImplementation(({ key }) =>
      JSON.stringify(
        key === "custom_score" ? combinedDefinition : childDefinition
      )
    )
    createDownload.mockReset()
    createDownload.mockResolvedValue({
      url: "https://storage.example/uploads/sub_ids.json",
      expiresIn: 300,
      metadata: {
        filename: "sub_ids.json",
        ext: "json",
        size: 10,
        contentType: "application/json",
        timestamp: 1,
      },
    })
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => '{"SubID-1":{}}',
      })
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("delegates nested validation to the shared validator package with resolvers", async () => {
    await expect(
      validateAlgorithmPresetClient({
        key: "custom_score",
        version: "1.0.0",
        inputs: [
          {
            key: "sub_ids",
            value: "uploads/sub_ids.json",
          },
          {
            key: "sub_algorithms",
            value: [
              {
                algorithm_key: "voting_engagement",
                algorithm_version: "1.0.0",
                weight: 1,
                inputs: [{ key: "votes", value: "uploads/votes.csv" }],
              },
            ],
          },
        ],
      })
    ).resolves.toEqual([])

    expect(mockValidateAlgorithmPreset).toHaveBeenCalledOnce()

    const call = mockValidateAlgorithmPreset.mock.calls[0]?.[0]
    expect(call.definition).toEqual(combinedDefinition)
    expect(call.preset).toEqual({
      key: "custom_score",
      version: "1.0.0",
      inputs: [
        {
          key: "sub_ids",
          value: "uploads/sub_ids.json",
        },
        {
          key: "sub_algorithms",
          value: [
            {
              algorithm_key: "voting_engagement",
              algorithm_version: "1.0.0",
              weight: 1,
              inputs: [{ key: "votes", value: "uploads/votes.csv" }],
            },
          ],
        },
      ],
      name: undefined,
      description: undefined,
    })

    await expect(
      call.resolveNestedDefinition({
        algorithmKey: "voting_engagement",
        algorithmVersion: "1.0.0",
      })
    ).resolves.toEqual(childDefinition)

    await expect(
      call.resolveInputContent({
        input: combinedDefinition.inputs[0],
        value: "uploads/sub_ids.json",
      })
    ).resolves.toBe('{"SubID-1":{}}')

    expect(createDownload).toHaveBeenCalledWith({
      key: "uploads/sub_ids.json",
    })
    expect(fetch).toHaveBeenCalledWith(
      "https://storage.example/uploads/sub_ids.json"
    )
  })
})
