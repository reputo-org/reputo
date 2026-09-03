// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { CommunityConnections } from "@/components/community/community-connections"
import type { CommunityConnectionDto } from "@/lib/api/types"
import type { CommunityLiveState } from "@/lib/api/use-community-events"

const useCommunityConnections = vi.fn()
const useCommunityLiveUpdates = vi.fn<() => CommunityLiveState>(() => ({
  connected: true,
  watchIntervalMs: 30_000,
}))

vi.mock("@/lib/api/use-community-events", () => ({
  useCommunityLiveUpdates: () => useCommunityLiveUpdates(),
}))

vi.mock("@/lib/api/hooks", () => ({
  useCommunityConnections: () => useCommunityConnections(),
  useRecheckCommunityConnection: () => ({
    isPending: false,
    variables: undefined,
    mutateAsync: vi.fn(),
  }),
  useDisconnectCommunityConnection: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useValidateMattermostConnection: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useConnectMattermostConnection: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
}))

const connection = (
  overrides: Partial<CommunityConnectionDto> = {}
): CommunityConnectionDto => ({
  id: "01940000-0000-7000-8000-000000000000",
  platform: "discord",
  externalId: "974492421130127923",
  name: "SingularityNET",
  status: "active",
  createdAt: "2026-08-26T10:00:00.000Z",
  updatedAt: "2026-08-26T10:00:00.000Z",
  ...overrides,
})

const refetch = vi.fn()

function renderWith(state: {
  data?: CommunityConnectionDto[]
  isLoading?: boolean
  isError?: boolean
}) {
  useCommunityConnections.mockReturnValue({
    data: state.data,
    isLoading: state.isLoading ?? false,
    isError: state.isError ?? false,
    refetch,
  })
  render(<CommunityConnections />)
}

describe("CommunityConnections", () => {
  beforeEach(() => vi.clearAllMocks())

  it("shows a spinner while the connections load", () => {
    renderWith({ isLoading: true })

    expect(screen.getByLabelText("Loading connections")).toBeInTheDocument()
  })

  it("shows an error state with a retry action when the query failed", async () => {
    const user = userEvent.setup()
    renderWith({ isError: true })

    expect(
      screen.getByText("Connections could not be loaded")
    ).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /try again/i }))
    expect(refetch).toHaveBeenCalledOnce()
  })

  it("renders one section per platform with its brand mark", () => {
    renderWith({ data: [] })

    for (const label of ["Discord", "GitHub", "Mattermost"]) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    // Every mark is an inline SVG path — Mattermost included, not a
    // placeholder icon.
    for (const label of ["Discord", "GitHub", "Mattermost"]) {
      const mark = document.querySelector(`svg[aria-label='${label}']`)
      expect(mark?.querySelector("path")).toBeInTheDocument()
    }
  })

  it("offers one primary action per connectable platform when nothing is connected", () => {
    renderWith({ data: [] })

    expect(screen.getByText("No server connected yet.")).toBeInTheDocument()
    expect(
      screen.getByText("No organization connected yet.")
    ).toBeInTheDocument()
    expect(screen.getByText("No team connected yet.")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /Connect Discord/ })
    ).toBeEnabled()
    expect(screen.getByRole("button", { name: /Connect GitHub/ })).toBeEnabled()
    expect(
      screen.getByRole("button", { name: /Connect Mattermost/ })
    ).toBeEnabled()
    expect(screen.queryByText("Coming soon")).not.toBeInTheDocument()
  })

  it("lists a connection with its status and switches the card action to a secondary one", () => {
    renderWith({ data: [connection()] })

    expect(screen.getByText("SingularityNET")).toBeInTheDocument()
    expect(screen.getByText("Active")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /Add another server/ })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /Connect Discord/ })
    ).not.toBeInTheDocument()
  })

  it("collapses per-connection actions into one menu button", () => {
    renderWith({ data: [connection()] })

    expect(
      screen.getByRole("button", { name: "Actions for SingularityNET" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /^Re-check$/ })
    ).not.toBeInTheDocument()
  })

  it("attaches the remedy to the failure reason on a broken connection", () => {
    renderWith({
      data: [
        connection({
          status: "broken",
          statusReason: "The platform rejected the bot credentials.",
        }),
      ],
    })

    expect(screen.getByText("Broken")).toBeInTheDocument()
    expect(
      screen.getByText("The platform rejected the bot credentials.")
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeEnabled()
  })

  it("keeps a disconnected connection visible and actionable", () => {
    renderWith({ data: [connection({ status: "disconnected" })] })

    expect(screen.getByText("Disconnected")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Actions for SingularityNET" })
    ).toBeEnabled()
  })

  it("reports when the status was last confirmed, so a stale Active is visible as stale", () => {
    renderWith({
      data: [
        connection({
          lastCheckedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        }),
      ],
    })

    expect(screen.getByText(/Checked /)).toBeInTheDocument()
  })

  it("falls back to the connection time when the platform has never been checked", () => {
    renderWith({ data: [connection({ lastCheckedAt: undefined })] })

    expect(screen.getByText(/Connected /)).toBeInTheDocument()
  })

  it("says the page is live and how often connections are re-checked", () => {
    renderWith({ data: [connection()] })

    expect(screen.getByRole("status")).toHaveTextContent(
      /Live — every connection is re-checked every 30 s/
    )
  })

  it("says it is reconnecting and polling while the stream is down", () => {
    useCommunityLiveUpdates.mockReturnValue({
      connected: false,
      watchIntervalMs: undefined,
    })
    renderWith({ data: [connection()] })

    expect(screen.getByRole("status")).toHaveTextContent(/Reconnecting/)
  })

  it("shows how many channels the bot can read once it is shut out of some", () => {
    renderWith({
      data: [
        connection({
          metadata: { resourceCount: 12, readableResourceCount: 10 },
        }),
      ],
    })

    expect(screen.getByText(/10 of 12 channels readable/)).toBeInTheDocument()
  })

  it("shows the community avatar and probe metadata on a row", () => {
    renderWith({
      data: [
        connection({
          metadata: {
            avatarUrl: "https://cdn.discordapp.com/icons/974/a1.png?size=128",
            memberCount: 1874,
            resourceCount: 12,
          },
        }),
      ],
    })

    const avatar = document.querySelector("img[src^='https://cdn.discordapp']")
    expect(avatar).toBeInTheDocument()
    expect(screen.getByText(/1,874 members/)).toBeInTheDocument()
    expect(screen.getByText(/12 channels/)).toBeInTheDocument()
    expect(screen.getByText(/974492421130127923/)).toBeInTheDocument()
  })

  it("falls back to the letter tile when the avatar fails to load", () => {
    renderWith({
      data: [
        connection({
          metadata: {
            avatarUrl: "https://cdn.discordapp.com/icons/broken.png",
          },
        }),
      ],
    })

    const avatar = document.querySelector(
      "img[src^='https://cdn.discordapp']"
    ) as HTMLImageElement
    fireEvent.error(avatar)

    expect(document.querySelector("img")).not.toBeInTheDocument()
    expect(screen.getByText("S")).toBeInTheDocument()
  })

  it("keeps the toolbar hidden at small connection counts", () => {
    renderWith({ data: [connection()] })

    expect(
      screen.queryByLabelText("Search connections")
    ).not.toBeInTheDocument()
  })

  it("searches and filters once the list grows past the threshold", async () => {
    const user = userEvent.setup()
    const many = Array.from({ length: 7 }, (_, index) =>
      connection({
        id: `01940000-0000-7000-8000-00000000000${index}`,
        name: index === 0 ? "AGI House" : `Guild ${index}`,
        status: index === 1 ? "broken" : "active",
      })
    )
    renderWith({ data: many })

    const search = screen.getByLabelText("Search connections")
    await user.type(search, "agi")

    expect(screen.getByText("AGI House")).toBeInTheDocument()
    expect(screen.queryByText("Guild 2")).not.toBeInTheDocument()

    await user.clear(search)
    await user.type(search, "zzz-no-such-name")
    expect(screen.getByText("No connections match.")).toBeInTheDocument()

    await user.clear(search)
    await user.click(screen.getByLabelText("Filter by status"))
    await user.click(screen.getByRole("option", { name: "Needs attention" }))

    expect(screen.getByText("Guild 1")).toBeInTheDocument()
    expect(screen.queryByText("AGI House")).not.toBeInTheDocument()
  })
})
