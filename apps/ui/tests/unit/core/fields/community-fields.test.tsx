// @vitest-environment jsdom
import { zodResolver } from "@hookform/resolvers/zod"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useForm } from "react-hook-form"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { Form } from "@/components/ui/form"
import { CommunityConnectionField } from "@/core/fields/community-connection-field"
import { CommunityResourcesField } from "@/core/fields/community-resources-field"
import { buildZodSchema, type FormInput } from "@/core/schema-builder"

const { mockUseCommunityConnections, mockUseCommunityResources } = vi.hoisted(
  () => ({
    mockUseCommunityConnections: vi.fn(),
    mockUseCommunityResources: vi.fn(),
  })
)

vi.mock("@/lib/api/hooks", () => ({
  useCommunityConnections: mockUseCommunityConnections,
  useCommunityResources: mockUseCommunityResources,
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
    data: [
      { id: "c1", name: "general", kind: "text" },
      { id: "c2", name: "dev-forum", kind: "forum" },
    ],
    isLoading: false,
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
  it("stays disabled until the connection input has a value", () => {
    render(
      <TestForm defaultValues={{ community_connection_id: "", resources: [] }}>
        {(control) => (
          <CommunityResourcesField input={RESOURCES_INPUT} control={control} />
        )}
      </TestForm>
    )

    expect(screen.getByRole("combobox", { name: /Channels/ })).toBeDisabled()
    expect(mockUseCommunityResources).toHaveBeenCalledWith("", false)
  })

  it("lists the connection's channels with search and toggles selections", async () => {
    const user = userEvent.setup()
    render(
      <TestForm
        defaultValues={{ community_connection_id: "conn-1", resources: [] }}
      >
        {(control) => (
          <CommunityResourcesField input={RESOURCES_INPUT} control={control} />
        )}
      </TestForm>
    )

    expect(mockUseCommunityResources).toHaveBeenCalledWith("conn-1", true)

    await user.click(screen.getByRole("combobox", { name: /Channels/ }))
    await user.type(screen.getByPlaceholderText("Search channels…"), "gen")
    await waitFor(() =>
      expect(screen.queryByText("#dev-forum")).not.toBeInTheDocument()
    )

    await user.click(screen.getByText("#general"))
    expect(screen.getByText("1 selected")).toBeInTheDocument()
  })

  it("labels repositories by name without the channel `#` prefix", async () => {
    const user = userEvent.setup()
    mockUseCommunityResources.mockReturnValue({
      data: [{ id: "9001", name: "snet/reputo", kind: "repository" }],
      isLoading: false,
    })
    render(
      <TestForm
        defaultValues={{ community_connection_id: "conn-3", resources: [] }}
      >
        {(control) => (
          <CommunityResourcesField input={RESOURCES_INPUT} control={control} />
        )}
      </TestForm>
    )

    await user.click(screen.getByRole("combobox", { name: /Channels/ }))

    expect(await screen.findByText("snet/reputo")).toBeInTheDocument()
    expect(screen.queryByText("#snet/reputo")).not.toBeInTheDocument()
  })

  it("shows stored ids the connection no longer lists as removable raw-id badges", async () => {
    const user = userEvent.setup()
    render(
      <TestForm
        defaultValues={{
          community_connection_id: "conn-1",
          resources: ["c1", "deleted-channel"],
        }}
      >
        {(control) => (
          <CommunityResourcesField input={RESOURCES_INPUT} control={control} />
        )}
      </TestForm>
    )

    expect(screen.getByText("#general")).toBeInTheDocument()
    expect(screen.getByText("deleted-channel")).toBeInTheDocument()

    await user.click(
      screen.getByRole("button", { name: "Remove deleted-channel" })
    )
    expect(screen.queryByText("deleted-channel")).not.toBeInTheDocument()
  })
})
