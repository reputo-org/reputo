// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { CommunityConnections } from "@/components/community/community-connections"
import type { CommunityConnectionDto } from "@/lib/api/types"

const useCommunityConnections = vi.fn()

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

function renderWith(state: {
  data?: CommunityConnectionDto[]
  isLoading?: boolean
  isError?: boolean
}) {
  useCommunityConnections.mockReturnValue({
    data: state.data,
    isLoading: state.isLoading ?? false,
    isError: state.isError ?? false,
  })
  render(<CommunityConnections />)
}

describe("CommunityConnections", () => {
  beforeEach(() => vi.clearAllMocks())

  it("shows a spinner while the connections load", () => {
    renderWith({ isLoading: true })

    expect(screen.getByLabelText("Loading connections")).toBeInTheDocument()
  })

  it("shows an error state when the query failed", () => {
    renderWith({ isError: true })

    expect(
      screen.getByText("Connections could not be loaded")
    ).toBeInTheDocument()
  })

  it("renders one card per platform", () => {
    renderWith({ data: [] })

    for (const label of ["Discord", "GitHub", "Mattermost"]) {
      expect(screen.getByText(label)).toBeInTheDocument()
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

    expect(screen.getByText(/^Checked /)).toBeInTheDocument()
  })

  it("falls back to the connection time when the platform has never been checked", () => {
    renderWith({ data: [connection({ lastCheckedAt: undefined })] })

    expect(screen.getByText(/^Connected /)).toBeInTheDocument()
  })
})
