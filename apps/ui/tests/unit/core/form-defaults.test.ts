import { describe, expect, it } from "vitest"
import { getDefaultValues } from "@/core/form-defaults"
import type { FormSchema } from "@/core/schema-builder"

function schemaWith(inputs: FormSchema["inputs"]): FormSchema {
  return {
    key: "preset_demo",
    name: "Demo",
    category: "Engagement",
    description: "Demo.",
    version: "1.0.0",
    inputs,
    outputs: [],
  }
}

describe("getDefaultValues", () => {
  it("prefers user defaults and normalizes numeric strings", () => {
    const defaults = getDefaultValues(
      schemaWith([
        { key: "threshold", label: "Threshold", type: "number", default: 3 },
        { key: "window", label: "Window", type: "integer" },
      ]),
      { threshold: "1,5" }
    )

    expect(defaults.threshold).toBe(1.5)
    expect(defaults.window).toBe("")
  })

  it("uses definition defaults when no user default exists", () => {
    const defaults = getDefaultValues(
      schemaWith([
        { key: "threshold", label: "Threshold", type: "number", default: 3 },
        { key: "enabled", label: "Enabled", type: "boolean" },
      ])
    )

    expect(defaults.threshold).toBe(3)
    expect(defaults.enabled).toBe(false)
  })

  it("starts resource selectors and sub-algorithms empty", () => {
    const defaults = getDefaultValues(
      schemaWith([
        {
          key: "selected_resources",
          label: "Resources",
          type: "array",
          widget: "resource_selector",
        },
        { key: "sub_algorithms", label: "Children", type: "sub_algorithm" },
      ])
    )

    expect(defaults.selected_resources).toEqual([])
    expect(defaults.sub_algorithms).toEqual([])
  })

  it("seeds repeater arrays with minItems default rows", () => {
    const defaults = getDefaultValues(
      schemaWith([
        {
          key: "rows",
          label: "Rows",
          type: "array",
          minItems: 2,
          itemProperties: [
            { key: "chain", label: "Chain", type: "string", default: "eth" },
            { key: "amount", label: "Amount", type: "number" },
          ],
        },
      ])
    )

    expect(defaults.rows).toEqual([
      { chain: "eth", amount: "" },
      { chain: "eth", amount: "" },
    ])
  })

  it("leaves optional scalar fields undefined and required ones empty", () => {
    const defaults = getDefaultValues(
      schemaWith([
        { key: "label", label: "Label", type: "text", required: false },
        { key: "title", label: "Title", type: "text", required: true },
      ])
    )

    expect(defaults.label).toBeUndefined()
    expect(defaults.title).toBe("")
  })
})
