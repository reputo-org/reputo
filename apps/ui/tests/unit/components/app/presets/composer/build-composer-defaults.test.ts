import { describe, expect, it } from "vitest"
import { buildComposerDefaults } from "@/components/app/presets/composer/build-composer-defaults"
import type { Algorithm } from "@/core/algorithms"
import type { FormSchema } from "@/core/schema-builder"
import type { AlgorithmPresetResponseDto } from "@/lib/api/types"

const algorithm: Algorithm = {
  id: "demo",
  title: "Demo",
  category: "Engagement",
  summary: "Demo.",
  description: "Demo.",
  duration: "~1 min",
  inputSummary: "4 configurable inputs",
  level: "Beginner",
  kind: "standalone",
  inputs: [
    { key: "threshold", type: "number", label: "Threshold" },
    { key: "votes", type: "csv", label: "Votes CSV" },
    { key: "selected_resources", type: "array", label: "Resources" },
    { key: "sub_algorithms", type: "sub_algorithm", label: "Sub-Algorithms" },
  ],
  dependencyLabels: [],
}

const schema: FormSchema = {
  key: "preset_demo",
  name: "Create Preset: Demo",
  category: "Engagement",
  description: "Demo.",
  version: "1.0.0",
  inputs: [
    { key: "threshold", label: "Threshold", type: "number", default: 5 },
    { key: "votes", label: "Votes CSV", type: "csv", required: true },
    {
      key: "selected_resources",
      label: "Resources",
      type: "array",
      widget: "resource_selector",
      required: true,
    },
    {
      key: "sub_algorithms",
      label: "Sub-Algorithms",
      type: "sub_algorithm",
      required: true,
    },
    { key: "name", label: "Preset Name", type: "text", required: true },
    { key: "description", label: "Description", type: "text", required: true },
  ],
  outputs: [],
}

const preset: AlgorithmPresetResponseDto = {
  _id: "p1",
  key: "demo",
  version: "1.0.0",
  name: "Stored preset",
  description: "Stored description",
  inputs: [
    { key: "threshold", value: "2,5" },
    { key: "votes", value: "uploads/votes.csv" },
    { key: "selected_resources", value: [{ chain: "ethereum" }] },
    {
      key: "sub_algorithms",
      value: [
        {
          algorithm_key: "voting_engagement",
          algorithm_version: "1.0.0",
          weight: 2,
          inputs: [],
        },
      ],
    },
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} as AlgorithmPresetResponseDto

describe("buildComposerDefaults", () => {
  it("starts from definition defaults with a provided name", () => {
    const defaults = buildComposerDefaults({
      schema,
      algorithm,
      name: "Suggested name",
      description: "Suggested description",
    })

    expect(defaults.name).toBe("Suggested name")
    expect(defaults.description).toBe("Suggested description")
    expect(defaults.threshold).toBe(5)
    expect(defaults.votes).toBe("")
    expect(defaults.selected_resources).toEqual([])
    expect(defaults.sub_algorithms).toEqual([])
  })

  it("prefills stored preset values, normalizing numerics", () => {
    const defaults = buildComposerDefaults({
      schema,
      algorithm,
      preset,
      description: "Suggested description",
    })

    // A stored description beats the suggested one.
    expect(defaults.name).toBe("Stored preset")
    expect(defaults.description).toBe("Stored description")
    expect(defaults.threshold).toBe(2.5)
    expect(defaults.votes).toBe("uploads/votes.csv")
    expect(defaults.selected_resources).toEqual([{ chain: "ethereum" }])
    expect(defaults.sub_algorithms).toEqual([
      {
        algorithm_key: "voting_engagement",
        algorithm_version: "1.0.0",
        weight: 2,
        inputs: [],
      },
    ])
  })

  it("lets a name override beat the stored name (duplicate flow)", () => {
    const defaults = buildComposerDefaults({
      schema,
      algorithm,
      preset,
      name: "Stored preset (copy)",
    })

    expect(defaults.name).toBe("Stored preset (copy)")
    expect(defaults.description).toBe("Stored description")
  })

  it("ignores stored inputs that the algorithm no longer declares", () => {
    const stale = {
      ...preset,
      inputs: [...preset.inputs, { key: "removed_input", value: 1 }],
    }

    const defaults = buildComposerDefaults({
      schema,
      algorithm,
      preset: stale,
    })

    expect("removed_input" in defaults).toBe(false)
  })
})
