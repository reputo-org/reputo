import {
  type AlgorithmDefinition,
  getAlgorithmDefinition,
  getAlgorithmDefinitionKeys,
} from "@reputo/reputation-algorithms"
import { describe, expect, it } from "vitest"
import { getInputGroups } from "@/core/preset-groups"
import type { FormInput } from "@/core/schema-builder"

function toFormInputs(definition: AlgorithmDefinition): FormInput[] {
  return definition.inputs.map((input) => ({
    key: input.key,
    label: input.label ?? input.key,
    type: input.type,
  }))
}

describe("getInputGroups", () => {
  it("covers every input of every registry algorithm", () => {
    for (const key of getAlgorithmDefinitionKeys()) {
      const definition = JSON.parse(
        getAlgorithmDefinition({ key })
      ) as AlgorithmDefinition
      const inputs = toFormInputs(definition)

      const groups = getInputGroups(key, inputs)
      const groupedKeys = groups.flatMap((group) =>
        group.inputs.map((input) => input.key)
      )

      expect(groupedKeys.sort()).toEqual(
        inputs.map((input) => input.key).sort()
      )
      expect(groups.length).toBeGreaterThan(0)
    }
  })

  it("excludes the details fields from configuration groups", () => {
    const groups = getInputGroups("proposal_engagement", [
      {
        key: "funded_concluded_reward_weight",
        label: "Reward",
        type: "number",
      },
      { key: "name", label: "Preset Name", type: "text" },
      { key: "description", label: "Description", type: "text" },
    ])

    const keys = groups.flatMap((group) => group.inputs.map((i) => i.key))
    expect(keys).toEqual(["funded_concluded_reward_weight"])
  })

  it("falls back to a single configuration group for unknown algorithms", () => {
    const inputs: FormInput[] = [
      { key: "a", label: "A", type: "text" },
      { key: "b", label: "B", type: "number" },
    ]

    expect(getInputGroups("unknown_algorithm", inputs)).toEqual([
      { id: "configuration", title: "Configuration", inputs },
    ])
  })

  it("appends unmapped keys to the last group", () => {
    const groups = getInputGroups("custom_score", [
      { key: "sub_algorithms", label: "Sub-Algorithms", type: "sub_algorithm" },
      { key: "brand_new_input", label: "Brand New", type: "text" },
    ])

    const lastGroup = groups[groups.length - 1]
    expect(lastGroup.inputs.map((input) => input.key)).toContain(
      "brand_new_input"
    )
  })
})
