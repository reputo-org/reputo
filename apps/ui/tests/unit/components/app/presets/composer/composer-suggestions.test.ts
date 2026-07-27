import { describe, expect, it } from "vitest"
import {
  duplicatePresetName,
  suggestPresetDescription,
  suggestPresetName,
} from "@/components/app/presets/composer/composer-suggestions"

describe("suggestPresetName", () => {
  it("combines the algorithm title with the current date", () => {
    expect(
      suggestPresetName("Voting Engagement", new Date("2026-07-27T12:00:00Z"))
    ).toBe("Voting Engagement preset — Jul 27")
  })

  it("clamps to 100 characters", () => {
    const name = suggestPresetName(
      "A".repeat(120),
      new Date("2026-07-27T12:00:00Z")
    )
    expect(name).toHaveLength(100)
  })
})

describe("duplicatePresetName", () => {
  it("appends (copy) to the source name", () => {
    expect(duplicatePresetName("My Preset")).toBe("My Preset (copy)")
  })

  it("falls back when the source has no name", () => {
    expect(duplicatePresetName(undefined)).toBe("Preset (copy)")
    expect(duplicatePresetName("   ")).toBe("Preset (copy)")
  })

  it("clamps to 100 characters", () => {
    expect(duplicatePresetName("B".repeat(120))).toHaveLength(100)
  })
})

describe("suggestPresetDescription", () => {
  it("uses the algorithm summary", () => {
    expect(
      suggestPresetDescription({
        algorithmTitle: "Voting Engagement",
        algorithmSummary:
          "Scores each user by how widely their wallets' voting history uses the full rating scale.",
      })
    ).toBe(
      "Scores each user by how widely their wallets' voting history uses the full rating scale."
    )
  })

  it("falls back when the summary is missing or too short for the API", () => {
    expect(suggestPresetDescription({ algorithmTitle: "Custom Score" })).toBe(
      "Default Custom Score configuration."
    )
    expect(
      suggestPresetDescription({
        algorithmTitle: "Custom Score",
        algorithmSummary: "Short.",
      })
    ).toBe("Default Custom Score configuration.")
  })

  it("clamps an over-long summary to the API maximum", () => {
    const description = suggestPresetDescription({
      algorithmTitle: "Custom Score",
      algorithmSummary: "S".repeat(600),
    })
    expect(description).toHaveLength(500)
    expect(description.endsWith("…")).toBe(true)
  })
})
