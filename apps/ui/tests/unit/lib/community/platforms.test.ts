import { describe, expect, it } from "vitest"
import type { CommunityConnectionStatus } from "@/lib/api/types"
import {
  COMMUNITY_PLATFORMS,
  canDisconnect,
  canRecheck,
  describeConnectOutcome,
  describeStatus,
  needsReconnect,
} from "@/lib/community/platforms"

const ALL_STATUSES: CommunityConnectionStatus[] = [
  "pending",
  "active",
  "degraded",
  "broken",
  "disconnected",
]

describe("COMMUNITY_PLATFORMS", () => {
  it("offers Discord and marks GitHub and Mattermost as not yet available", () => {
    const available = COMMUNITY_PLATFORMS.filter((entry) => entry.available)
    const comingSoon = COMMUNITY_PLATFORMS.filter((entry) => !entry.available)

    expect(available.map((entry) => entry.id)).toEqual(["discord"])
    expect(comingSoon.map((entry) => entry.id)).toEqual([
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

  it("falls back to a generic message for an unknown category", () => {
    expect(describeConnectOutcome({ error: "something_new" })).toEqual({
      kind: "error",
      message: "The connection attempt did not finish.",
    })
  })
})
