import { describe, expect, it } from "vitest"
import { getAlgorithmById } from "../../../src/core/algorithms"
import { getDefaultValues } from "../../../src/core/form-defaults"
import {
  buildSchemaFromAlgorithm,
  buildZodSchema,
} from "../../../src/core/schema-builder"

/** Built from the real registry: the definition-driven path end to end. */
const algorithm = getAlgorithmById("discord_engagement")
if (!algorithm) throw new Error("discord_engagement missing from the registry")
const schema = buildSchemaFromAlgorithm(algorithm)

describe("schema-builder community widgets (real discord_engagement definition)", () => {
  it("carries the community_connection widget and platform through to the form input", () => {
    const input = schema.inputs.find(
      (candidate) => candidate.key === "community_connection_id"
    )

    expect(input).toMatchObject({
      type: "text",
      widget: "community_connection",
      platform: "discord",
      required: true,
    })
  })

  it("carries the community_resources widget, string item type, and dependsOn", () => {
    const input = schema.inputs.find(
      (candidate) => candidate.key === "resources"
    )

    expect(input).toMatchObject({
      type: "array",
      widget: "community_resources",
      itemType: "string",
      dependsOn: "community_connection_id",
      minItems: 1,
    })
  })

  it("exposes the lookback presets and the recommended weights preset", () => {
    const lookback = schema.inputs.find(
      (candidate) => candidate.key === "lookback_days"
    )
    expect(lookback).toMatchObject({
      type: "integer",
      min: 1,
      max: 183,
      default: 90,
      presets: [7, 30, 90, 183],
    })

    const activities = schema.inputs.find(
      (candidate) => candidate.key === "activities"
    )
    expect(activities?.widget).toBe("repeater")
    expect(activities?.uniqueBy).toEqual(["activity"])
    expect(activities?.arrayPresets?.[0]).toMatchObject({
      label: "Recommended weights",
    })
    expect(activities?.arrayPresets?.[0].value).toHaveLength(6)
  })

  it("defaults resources to an empty id list", () => {
    const defaults = getDefaultValues(schema)

    expect(defaults.resources).toEqual([])
    expect(defaults.community_connection_id).toBe("")
    expect(defaults.lookback_days).toBe(90)
  })

  it("validates the payload: string resource ids, positive points, caps of at least 1", () => {
    const zodSchema = buildZodSchema(schema as never)
    const valid = {
      community_connection_id: "01990000-0000-7000-8000-000000000001",
      resources: ["c1", "c2"],
      lookback_days: 90,
      activities: [{ activity: "message", points: 1, daily_cap: 25 }],
      name: "My preset",
      description: "A synthetic preset used in tests.",
    }

    expect(zodSchema.safeParse(valid).success).toBe(true)
    expect(zodSchema.safeParse({ ...valid, resources: [] }).success).toBe(false)
    expect(
      zodSchema.safeParse({ ...valid, resources: ["c1", "c1"] }).success
    ).toBe(false)
    expect(zodSchema.safeParse({ ...valid, resources: [42] }).success).toBe(
      false
    )

    const zeroWeight = zodSchema.safeParse({
      ...valid,
      activities: [{ activity: "message", points: 0, daily_cap: 25 }],
    })
    expect(zeroWeight.success).toBe(false)
    expect(
      JSON.stringify(zeroWeight.success ? [] : zeroWeight.error.issues)
    ).toContain("greater than 0")

    expect(
      zodSchema.safeParse({
        ...valid,
        activities: [{ activity: "message", points: 1, daily_cap: 0 }],
      }).success
    ).toBe(false)
  })
})
