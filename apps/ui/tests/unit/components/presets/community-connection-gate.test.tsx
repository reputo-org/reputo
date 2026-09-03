// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { CommunityConnectionGate } from "@/components/app/presets/composer/community-connection-gate"
import type { Algorithm } from "@/core/algorithms"

const useCommunityConnections = vi.fn()
const refetch = vi.fn()

vi.mock("@/lib/api/hooks", () => ({
  useCommunityConnections: (options?: unknown) =>
    useCommunityConnections(options),
}))

const useCommunityLiveUpdates = vi.fn((_options?: { enabled?: boolean }) => ({
  connected: true,
  watchIntervalMs: 30_000,
}))

vi.mock("@/lib/api/use-community-events", () => ({
  useCommunityLiveUpdates: (options?: { enabled?: boolean }) =>
    useCommunityLiveUpdates(options),
}))

const discordAlgo = {
  id: "discord_engagement",
  title: "Discord engagement",
} as Algorithm

const votingAlgo = {
  id: "voting_engagement",
  title: "Voting engagement",
} as Algorithm

function renderGate(algo: Algorithm) {
  return render(
    <CommunityConnectionGate algo={algo}>
      <div>the composer</div>
    </CommunityConnectionGate>
  )
}

describe("CommunityConnectionGate", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useCommunityConnections.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch,
    })
  })

  it("keeps the events stream closed for algorithms without a community requirement", () => {
    renderGate(votingAlgo)

    expect(useCommunityLiveUpdates).toHaveBeenCalledWith({ enabled: false })
  })

  it("follows live connection changes while gating a community algorithm", () => {
    renderGate(discordAlgo)

    expect(useCommunityLiveUpdates).toHaveBeenCalledWith({ enabled: true })
  })

  it("passes through for algorithms without a community requirement", () => {
    renderGate(votingAlgo)

    expect(screen.getByText("the composer")).toBeInTheDocument()
  })

  it("passes through when an active connection for the platform exists", () => {
    useCommunityConnections.mockReturnValue({
      data: [{ id: "c1", platform: "discord", status: "active" }],
      isLoading: false,
      isError: false,
      refetch,
    })

    renderGate(discordAlgo)

    expect(screen.getByText("the composer")).toBeInTheDocument()
  })

  it("never blocks on a failed connections read", () => {
    useCommunityConnections.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    })

    renderGate(discordAlgo)

    expect(screen.getByText("the composer")).toBeInTheDocument()
  })

  it("blocks with a connect-first screen when nothing is connected", () => {
    renderGate(discordAlgo)

    expect(screen.queryByText("the composer")).not.toBeInTheDocument()
    expect(
      screen.getByText(/connect a discord community first/i)
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: /connect discord/i })
    ).toHaveAttribute("href", "/community")
    expect(
      screen.getByRole("link", { name: /back to presets/i })
    ).toHaveAttribute(
      "href",
      "/dashboard/algorithms/discord_engagement?tab=presets"
    )
  })

  it("shows the fix-it variant when connections exist but none is active", () => {
    useCommunityConnections.mockReturnValue({
      data: [
        {
          id: "c1",
          platform: "discord",
          status: "broken",
          statusReason: "The platform rejected Reputo's credentials.",
        },
      ],
      isLoading: false,
      isError: false,
      refetch,
    })

    renderGate(discordAlgo)

    expect(
      screen.getByText(/your discord connection needs attention/i)
    ).toBeInTheDocument()
    expect(
      screen.getByText(/rejected Reputo's credentials/i)
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: /open communities page/i })
    ).toHaveAttribute("href", "/community")
  })

  it("refreshes the connections on demand", async () => {
    const user = userEvent.setup()
    renderGate(discordAlgo)

    await user.click(screen.getByRole("button", { name: /refresh/i }))

    expect(refetch).toHaveBeenCalledOnce()
  })

  it("ignores active connections of another platform", () => {
    useCommunityConnections.mockReturnValue({
      data: [{ id: "c1", platform: "github", status: "active" }],
      isLoading: false,
      isError: false,
      refetch,
    })

    renderGate(discordAlgo)

    expect(screen.queryByText("the composer")).not.toBeInTheDocument()
  })
})
