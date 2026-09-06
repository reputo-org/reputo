// @vitest-environment jsdom
import { zodResolver } from "@hookform/resolvers/zod"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useForm } from "react-hook-form"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { Form } from "@/components/ui/form"
import { CommunityConnectionField } from "@/core/fields/community-connection-field"
import { CommunityResourcesField } from "@/core/fields/community-resources-field"
import { buildZodSchema, type FormInput } from "@/core/schema-builder"

const {
  mockUseCommunityConnections,
  mockUseCommunityResources,
  mockUseCommunityLiveUpdates,
  refetchResources,
} = vi.hoisted(() => ({
  mockUseCommunityConnections: vi.fn(),
  mockUseCommunityResources: vi.fn(),
  mockUseCommunityLiveUpdates: vi.fn(),
  refetchResources: vi.fn(),
}))

vi.mock("@/lib/api/hooks", () => ({
  useCommunityConnections: mockUseCommunityConnections,
  useCommunityResources: mockUseCommunityResources,
}))

vi.mock("@/lib/api/use-community-events", () => ({
  useCommunityLiveUpdates: mockUseCommunityLiveUpdates,
}))

const connection = (overrides: Record<string, unknown> = {}) => ({
  id: "conn-1",
  platform: "discord",
  externalId: "guild-1",
  name: "SNET",
  status: "active",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  ...overrides,
})

const CONNECTION_INPUT: FormInput = {
  key: "community_connection_id",
  label: "Discord server",
  type: "text",
  widget: "community_connection",
  platform: "discord",
  required: true,
}

const RESOURCES_INPUT: FormInput = {
  key: "resources",
  label: "Channels",
  type: "array",
  widget: "community_resources",
  itemType: "string",
  dependsOn: "community_connection_id",
  minItems: 1,
  required: true,
}

const CHANNELS = [
  { id: "c1", name: "general", kind: "text", readable: true },
  { id: "c2", name: "dev-forum", kind: "forum", readable: true },
  {
    id: "c3",
    name: "staff",
    kind: "text",
    readable: false,
    accessIssue: "missing_view_channel",
  },
]

function TestForm({
  defaultValues,
  children,
}: {
  defaultValues: Record<string, unknown>
  children: (control: any) => React.ReactNode
}) {
  const schema = {
    key: "discord_engagement",
    name: "Discord Engagement",
    category: "Engagement",
    description: "",
    version: "1.0.0",
    inputs: [CONNECTION_INPUT, RESOURCES_INPUT],
    outputs: [],
  }
  const form = useForm({
    resolver: zodResolver(buildZodSchema(schema as never) as never),
    defaultValues,
    mode: "onChange",
  })
  return <Form {...form}>{children(form.control)}</Form>
}

function renderResources(defaultValues: Record<string, unknown>) {
  return render(
    <TestForm defaultValues={defaultValues}>
      {(control) => (
        <CommunityResourcesField input={RESOURCES_INPUT} control={control} />
      )}
    </TestForm>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseCommunityConnections.mockReturnValue({
    data: [
      connection(),
      connection({ id: "conn-2", name: "Broken", status: "broken" }),
      connection({ id: "conn-3", name: "Hub", platform: "github" }),
    ],
    isLoading: false,
  })
  mockUseCommunityResources.mockReturnValue({
    data: CHANNELS,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: refetchResources,
  })
  mockUseCommunityLiveUpdates.mockReturnValue({
    connected: true,
    realtime: {
      feeds: { discord: "live", github: "live", mattermost: "live" },
    },
  })
})

describe("CommunityConnectionField", () => {
  it("offers only active connections of the widget's platform", async () => {
    const user = userEvent.setup()
    render(
      <TestForm defaultValues={{ community_connection_id: "", resources: [] }}>
        {(control) => (
          <CommunityConnectionField
            input={CONNECTION_INPUT}
            control={control}
          />
        )}
      </TestForm>
    )

    await user.click(screen.getByRole("combobox"))

    expect(await screen.findByText("SNET")).toBeInTheDocument()
    expect(screen.queryByText("Broken")).not.toBeInTheDocument()
    expect(screen.queryByText("Hub")).not.toBeInTheDocument()
    expect(mockUseCommunityLiveUpdates).toHaveBeenCalled()
  })

  it("keeps a stored id visible as unavailable when it no longer qualifies", async () => {
    const user = userEvent.setup()
    render(
      <TestForm
        defaultValues={{ community_connection_id: "conn-gone", resources: [] }}
      >
        {(control) => (
          <CommunityConnectionField
            input={CONNECTION_INPUT}
            control={control}
          />
        )}
      </TestForm>
    )

    await user.click(screen.getByRole("combobox"))

    const matches = await screen.findAllByText(
      "Unavailable connection (conn-gone)"
    )
    // Rendered in the trigger's value and as a selectable item.
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it("points at the Communities page when nothing is connected", () => {
    mockUseCommunityConnections.mockReturnValue({ data: [], isLoading: false })
    render(
      <TestForm defaultValues={{ community_connection_id: "", resources: [] }}>
        {(control) => (
          <CommunityConnectionField
            input={CONNECTION_INPUT}
            control={control}
          />
        )}
      </TestForm>
    )

    expect(
      screen.getByText(/No active discord connection yet/)
    ).toBeInTheDocument()
  })
})

describe("CommunityResourcesField", () => {
  it("shows a placeholder and keeps the stream closed until a connection is chosen", () => {
    renderResources({ community_connection_id: "", resources: [] })

    expect(
      screen.getByText("Select a connection first to list its channels.")
    ).toBeInTheDocument()
    expect(mockUseCommunityResources).toHaveBeenCalledWith("", false)
    expect(mockUseCommunityLiveUpdates).toHaveBeenCalledWith({ enabled: false })
  })

  it("lists every channel with its read verdict and toggles selections", async () => {
    const user = userEvent.setup()
    renderResources({ community_connection_id: "conn-1", resources: [] })

    expect(mockUseCommunityResources).toHaveBeenCalledWith("conn-1", true)
    expect(mockUseCommunityLiveUpdates).toHaveBeenCalledWith({ enabled: true })
    expect(screen.getByText("2 of 3 channels readable")).toBeInTheDocument()
    expect(screen.getByText(/No access · 1/)).toBeInTheDocument()

    await user.click(screen.getByRole("checkbox", { name: "#general" }))
    expect(screen.getByText("1 selected")).toBeInTheDocument()
    expect(screen.getByRole("checkbox", { name: "#general" })).toBeChecked()

    await user.click(screen.getByRole("checkbox", { name: "#general" }))
    expect(screen.getByText("0 selected")).toBeInTheDocument()
  })

  it("locks a channel the bot cannot read and explains what to grant", () => {
    renderResources({ community_connection_id: "conn-1", resources: [] })

    const staff = screen.getByRole("checkbox", { name: "#staff" })
    expect(staff).toBeDisabled()
    expect(screen.getByText("Can't view")).toBeInTheDocument()
    expect(
      screen.getByText(/The bot lacks View Channel here/)
    ).toBeInTheDocument()
    expect(
      screen.getByText(/A channel is readable when the Reputo role has/)
    ).toBeInTheDocument()
  })

  it("selects every readable channel at once and clears the selection", async () => {
    const user = userEvent.setup()
    renderResources({ community_connection_id: "conn-1", resources: [] })

    await user.click(
      screen.getByRole("button", { name: "Select all readable" })
    )

    expect(screen.getByText("2 selected")).toBeInTheDocument()
    expect(screen.getByRole("checkbox", { name: "#general" })).toBeChecked()
    expect(screen.getByRole("checkbox", { name: "#dev-forum" })).toBeChecked()
    expect(screen.getByRole("checkbox", { name: "#staff" })).not.toBeChecked()
    expect(
      screen.getByRole("button", { name: "Select all readable" })
    ).toBeDisabled()

    await user.click(screen.getByRole("button", { name: "Clear" }))
    expect(screen.getByText("0 selected")).toBeInTheDocument()
  })

  it("filters the list by search without touching the selection", async () => {
    const user = userEvent.setup()
    renderResources({ community_connection_id: "conn-1", resources: ["c1"] })

    await user.type(
      screen.getByRole("textbox", { name: "Search channels" }),
      "forum"
    )

    await waitFor(() =>
      expect(
        screen.queryByRole("checkbox", { name: "#general" })
      ).not.toBeInTheDocument()
    )
    expect(
      screen.getByRole("checkbox", { name: "#dev-forum" })
    ).toBeInTheDocument()
    expect(screen.getByText("1 selected")).toBeInTheDocument()

    await user.clear(screen.getByRole("textbox", { name: "Search channels" }))
    await user.type(
      screen.getByRole("textbox", { name: "Search channels" }),
      "zzz"
    )
    expect(
      await screen.findByText('No channels match "zzz".')
    ).toBeInTheDocument()
  })

  it("labels repositories by name without the channel `#` prefix and hides the kind", () => {
    mockUseCommunityResources.mockReturnValue({
      data: [
        { id: "9001", name: "snet/reputo", kind: "repository", readable: true },
      ],
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: refetchResources,
    })
    renderResources({ community_connection_id: "conn-3", resources: [] })

    expect(
      screen.getByRole("checkbox", { name: "snet/reputo" })
    ).toBeInTheDocument()
    expect(screen.queryByText("#snet/reputo")).not.toBeInTheDocument()
    expect(screen.queryByText("repository")).not.toBeInTheDocument()
  })

  it("flags a stored selection the bot can no longer read and removes it on request", async () => {
    const user = userEvent.setup()
    renderResources({
      community_connection_id: "conn-1",
      resources: ["c1", "c3"],
    })

    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent("The bot cannot read #staff")
    expect(screen.getByRole("checkbox", { name: "#staff" })).toBeChecked()
    expect(screen.getByRole("checkbox", { name: "#staff" })).not.toBeDisabled()

    await user.click(
      within(alert).getByRole("button", { name: "Remove unreadable" })
    )

    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(screen.getByText("1 selected")).toBeInTheDocument()
  })

  it("shows stored ids the connection no longer lists as removable entries", async () => {
    const user = userEvent.setup()
    renderResources({
      community_connection_id: "conn-1",
      resources: ["c1", "deleted-channel"],
    })

    expect(screen.getByText(/No longer listed · 1/)).toBeInTheDocument()
    expect(screen.getByText("deleted-channel")).toBeInTheDocument()

    await user.click(
      screen.getByRole("button", { name: "Remove deleted-channel" })
    )

    expect(screen.queryByText("deleted-channel")).not.toBeInTheDocument()
    expect(screen.getByText("1 selected")).toBeInTheDocument()
  })

  it("refetches on demand and reports a failed listing with a retry", async () => {
    const user = userEvent.setup()
    mockUseCommunityResources.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      isFetching: false,
      refetch: refetchResources,
    })
    renderResources({ community_connection_id: "conn-1", resources: [] })

    expect(
      screen.getByText("The channels could not be loaded.")
    ).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Try again" }))
    await user.click(screen.getByRole("button", { name: "Refresh channels" }))

    expect(refetchResources).toHaveBeenCalledTimes(2)
  })
})
