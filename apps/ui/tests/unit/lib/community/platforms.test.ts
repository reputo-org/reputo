import { describe, expect, it } from "vitest"
import type { CommunityConnectionStatus } from "@/lib/api/types"
import {
  COMMUNITY_PLATFORMS,
  canDisconnect,
  canRecheck,
  describeAccessIssue,
  describeConnectOutcome,
  describeStatus,
  needsReconnect,
  RESOURCE_ACCESS_RULE,
} from "@/lib/community/platforms"

const ALL_STATUSES: CommunityConnectionStatus[] = [
  "pending",
  "active",
  "degraded",
  "broken",
  "disconnected",
]

describe("COMMUNITY_PLATFORMS", () => {
  it("offers every platform with a shipped connect flow", () => {
    const available = COMMUNITY_PLATFORMS.filter((entry) => entry.available)

    expect(available.map((entry) => entry.id)).toEqual([
      "discord",
      "github",
      "mattermost",
    ])
  })
})

describe("describeStatus", () => {
  it("labels every lifecycle state", () => {
    for (const status of ALL_STATUSES) {
      const meta = describeStatus(status)
      expect(meta.label).toBeTruthy()
      expect(meta.description).toBeTruthy()
    }
  })

  it("assigns each state the tone its severity implies", () => {
    const toneOf = (status: CommunityConnectionStatus) =>
      describeStatus(status).tone

    expect(toneOf("active")).toBe("positive")
    expect(toneOf("degraded")).toBe("warning")
    expect(toneOf("broken")).toBe("critical")
    expect(toneOf("pending")).toBe("neutral")
    expect(toneOf("disconnected")).toBe("neutral")
  })
})

describe("connection actions", () => {
  it("allows a re-check and a disconnect on everything except a disconnected connection", () => {
    for (const status of ALL_STATUSES) {
      expect(canRecheck(status)).toBe(status !== "disconnected")
      expect(canDisconnect(status)).toBe(status !== "disconnected")
    }
  })

  it("offers a reconnect only for the states an admin cannot clear by re-checking", () => {
    const reconnectable = ALL_STATUSES.filter(needsReconnect)

    expect(reconnectable).toEqual(["broken", "disconnected"])
  })
})

describe("describeConnectOutcome", () => {
  it("returns nothing without redirect parameters", () => {
    expect(describeConnectOutcome({})).toBeNull()
    expect(describeConnectOutcome({ connected: null, error: null })).toBeNull()
  })

  it("names the connected platform on success", () => {
    expect(describeConnectOutcome({ connected: "discord" })).toEqual({
      kind: "success",
      message: "Discord connected.",
    })
  })

  it("explains each error category the API redirects with", () => {
    const categories = [
      "declined",
      "approval_required",
      "invalid_state",
      "auth_failed",
      "permission_denied",
      "not_found",
      "rate_limited",
      "network_error",
      "upstream_error",
      "contract_violation",
    ]

    for (const error of categories) {
      const outcome = describeConnectOutcome({ error })
      expect(outcome?.kind).toBe("error")
      expect(outcome?.message).not.toBe(
        "The connection attempt did not finish."
      )
    }
  })

  it("names what the admin must re-grant on the platform that failed", () => {
    expect(
      describeConnectOutcome({
        error: "permission_denied",
        platform: "discord",
      })?.message
    ).toContain("View Channels and Read Message History")
    expect(
      describeConnectOutcome({ error: "permission_denied", platform: "github" })
        ?.message
    ).toContain("GitHub App")
    expect(
      describeConnectOutcome({ error: "rate_limited", platform: "github" })
    ).toEqual(describeConnectOutcome({ error: "rate_limited" }))
  })

  it("falls back to a generic message for an unknown category", () => {
    expect(describeConnectOutcome({ error: "something_new" })).toEqual({
      kind: "error",
      message: "The connection attempt did not finish.",
    })
  })
})

describe("describeAccessIssue", () => {
  it("names what blocks the bot and what the admin changes, for every issue", () => {
    for (const issue of [
      "missing_view_channel",
      "missing_read_history",
      "issues_disabled",
      "not_member",
    ] as const) {
      const meta = describeAccessIssue(issue)
      expect(meta.label).not.toBe("No access")
      expect(meta.description.length).toBeGreaterThan(20)
    }
    expect(describeAccessIssue("missing_view_channel").description).toContain(
      "View Channel"
    )
    expect(describeAccessIssue("issues_disabled").description).toContain(
      "Issues"
    )
  })

  it("falls back to a generic verdict for an unknown or missing issue", () => {
    expect(describeAccessIssue(undefined).label).toBe("No access")
    expect(describeAccessIssue("something_new" as never).label).toBe(
      "No access"
    )
  })

  it("states the readability rule of every platform", () => {
    for (const platform of ["discord", "github", "mattermost"] as const) {
      expect(RESOURCE_ACCESS_RULE[platform]).toMatch(/readable when/)
    }
  })
})
