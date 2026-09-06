import { describe, expect, it } from "vitest"
import { getRequiredCommunityPlatform } from "@/core/community-requirements"

describe("getRequiredCommunityPlatform", () => {
  it("reads the platform from each community engagement definition", () => {
    expect(getRequiredCommunityPlatform("discord_engagement")).toBe("discord")
    expect(getRequiredCommunityPlatform("github_engagement")).toBe("github")
    expect(getRequiredCommunityPlatform("mattermost_engagement")).toBe(
      "mattermost"
    )
  })

  it("returns undefined for algorithms without a community connection input", () => {
    expect(getRequiredCommunityPlatform("custom_score")).toBeUndefined()
    expect(getRequiredCommunityPlatform("voting_engagement")).toBeUndefined()
  })

  it("returns undefined for unknown keys and versions", () => {
    expect(getRequiredCommunityPlatform("no_such_algorithm")).toBeUndefined()
    expect(
      getRequiredCommunityPlatform("discord_engagement", "99.0.0")
    ).toBeUndefined()
  })
})
