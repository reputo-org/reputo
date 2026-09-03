// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useForm } from "react-hook-form"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { Form } from "@/components/ui/form"
import { CommunityConnectionField } from "@/core/fields"
import type { FormInput } from "@/core/schema-builder"

const useCommunityConnections = vi.fn()
const refetch = vi.fn()

vi.mock("@/lib/api/hooks", () => ({
  useCommunityConnections: () => useCommunityConnections(),
}))

vi.mock("@/lib/api/use-community-events", () => ({
  useCommunityLiveUpdates: () => ({
    connected: true,
    realtime: {
      feeds: { discord: "live", github: "live", mattermost: "live" },
      fallbackIntervalMs: 30_000,
    },
  }),
}))

const connectionInput: FormInput = {
  key: "community_connection_id",
  label: "Discord server",
  type: "text",
  required: true,
  widget: "community_connection",
  platform: "discord",
}

function TestForm({ value = "" }: { value?: string }) {
  const form = useForm<any>({
    defaultValues: { community_connection_id: value },
  })

  return (
    <Form {...form}>
      <form>
        <CommunityConnectionField
          input={connectionInput}
          control={form.control}
        />
      </form>
    </Form>
  )
}

describe("CommunityConnectionField", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useCommunityConnections.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch,
    })
  })

  it("offers only active connections of the widget's platform", () => {
    useCommunityConnections.mockReturnValue({
      data: [
        { id: "c1", platform: "discord", status: "active", name: "SNET" },
        { id: "c2", platform: "discord", status: "broken", name: "Broken" },
        { id: "c3", platform: "github", status: "active", name: "Org" },
      ],
      isLoading: false,
      isError: false,
      refetch,
    })

    render(<TestForm />)

    expect(screen.getByRole("combobox")).not.toBeDisabled()
    expect(
      screen.queryByText(/no active discord connection yet/i)
    ).not.toBeInTheDocument()
  })

  it("links to the Communities page when nothing is connected", () => {
    render(<TestForm />)

    expect(screen.getByRole("combobox")).toBeDisabled()
    expect(
      screen.getByText(/no active discord connection yet/i)
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: /communities page/i })
    ).toHaveAttribute("href", "/community")
  })

  it("names the broken state when connections exist but none is active", () => {
    useCommunityConnections.mockReturnValue({
      data: [{ id: "c2", platform: "discord", status: "broken", name: "SNET" }],
      isLoading: false,
      isError: false,
      refetch,
    })

    render(<TestForm />)

    expect(
      screen.getByText(/your discord connection is broken/i)
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: /communities page/i })
    ).toBeInTheDocument()
  })

  it("separates a failed read from an empty account", async () => {
    useCommunityConnections.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    })
    const user = userEvent.setup()

    render(<TestForm />)

    expect(screen.getByText(/could not load connections/i)).toBeInTheDocument()
    expect(
      screen.queryByText(/no active discord connection yet/i)
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /retry/i }))
    expect(refetch).toHaveBeenCalledOnce()
  })

  it("explains a stored connection that is no longer active", () => {
    useCommunityConnections.mockReturnValue({
      data: [{ id: "c2", platform: "discord", status: "broken", name: "SNET" }],
      isLoading: false,
      isError: false,
      refetch,
    })

    render(<TestForm value="c2" />)

    expect(
      screen.getByText(/this preset points at SNET, which is broken/i)
    ).toBeInTheDocument()
    expect(screen.getByRole("combobox")).not.toBeDisabled()
  })

  it("explains a stored connection that no longer exists", () => {
    render(<TestForm value="gone-id" />)

    expect(
      screen.getByText(/points at a connection that no longer exists/i)
    ).toBeInTheDocument()
  })
})
