// @vitest-environment jsdom
import { zodResolver } from "@hookform/resolvers/zod"
import type { AlgorithmDefinition } from "@reputo/reputation-algorithms"
import { getAlgorithmDefinition } from "@reputo/reputation-algorithms"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useForm } from "react-hook-form"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { Form } from "@/components/ui/form"
import { SubAlgorithmComposerField } from "@/core/fields"
import { FormUploadProvider } from "@/core/form-context"
import { buildZodSchema, type FormInput } from "@/core/schema-builder"

const useCommunityConnections = vi.fn()

vi.mock("@/lib/api/hooks", () => ({
  useCommunityConnections: (options?: unknown) =>
    useCommunityConnections(options),
  useCommunityResources: () => ({
    data: [],
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
}))

vi.mock("@/lib/api/use-community-events", () => ({
  useCommunityLiveUpdates: () => ({ connected: true, watchIntervalMs: 30_000 }),
}))

/** Every platform active by default, so community children stay selectable. */
const ALL_PLATFORMS_ACTIVE = ["discord", "github", "mattermost"].map(
  (platform) => ({ id: `conn-${platform}`, platform, status: "active" })
)

beforeEach(() => {
  useCommunityConnections.mockReturnValue({
    data: ALL_PLATFORMS_ACTIVE,
    isLoading: false,
    isError: false,
  })
})

const definition = JSON.parse(
  getAlgorithmDefinition({ key: "custom_score", version: "1.0.0" })
) as AlgorithmDefinition

const subAlgorithmsInput: FormInput = {
  key: "sub_algorithms",
  label: "Child algorithms",
  type: "sub_algorithm",
  required: true,
  minItems: 1,
  addButtonLabel: "Add algorithm",
}

interface ComposerRow {
  algorithm_key: string
  algorithm_version: string
  weight: number | string
  inputs: Array<{ key: string; value: unknown }>
}

const votingRow: ComposerRow = {
  algorithm_key: "voting_engagement",
  algorithm_version: "1.0.0",
  weight: 1,
  inputs: [],
}

function TestForm({ rows }: { rows: ComposerRow[] }) {
  const form = useForm<any>({
    resolver: zodResolver(buildZodSchema(definition) as never),
    defaultValues: { sub_algorithms: rows },
    mode: "onChange",
    reValidateMode: "onChange",
  })

  return (
    <FormUploadProvider>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(() => undefined)}>
          <SubAlgorithmComposerField
            input={subAlgorithmsInput}
            control={form.control}
            scoringCopy={definition.description}
            normalization={definition.normalization}
          />
          <button type="submit" disabled={!form.formState.isValid}>
            Save preset
          </button>
        </form>
      </Form>
    </FormUploadProvider>
  )
}

function renderComposerForm(rows: ComposerRow[] = [votingRow]) {
  return render(<TestForm rows={rows} />)
}

describe("SubAlgorithmComposerField", () => {
  it("surfaces the registry-sourced scoring explanation before save", async () => {
    const user = userEvent.setup()
    renderComposerForm([])

    const methodLine = screen.getByText(/normalization:/i)
    expect(methodLine).toHaveTextContent("Observed min–max")
    expect(methodLine).toHaveTextContent(/range 0–100/i)

    const trigger = screen.getByRole("button", {
      name: /how scores are combined/i,
    })
    expect(trigger).toHaveAttribute("aria-expanded", "false")
    await user.click(trigger)
    expect(trigger).toHaveAttribute("aria-expanded", "true")

    expect(
      screen.getByRole("heading", { name: "How it works" })
    ).toBeInTheDocument()

    const completeResults = screen.getByText(
      /receives a final score only when every selected algorithm has a result/
    )
    expect(completeResults).toHaveTextContent(
      /a score of 0 still counts as a result/i
    )

    const normalizationCopy = screen.getByText(
      /scaled to 0–100 using its observed minimum and maximum/
    )
    expect(normalizationCopy).toHaveTextContent(
      /if its minimum and maximum are equal, all its scaled scores are 0/i
    )

    expect(
      screen.getByText(/controls how much each algorithm affects/)
    ).toBeInTheDocument()
    expect(
      screen.getByText(/calculates a weighted average without decrypting/)
    ).toBeInTheDocument()
    expect(
      screen.getByText(/does not contain plaintext user scores/)
    ).toBeInTheDocument()
  })

  it("shows an empty state and adds pre-assigned cards through the picker", async () => {
    const user = userEvent.setup()
    renderComposerForm([])

    expect(screen.getByText(/no algorithms added/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save preset" })).toBeDisabled()

    await user.click(screen.getByRole("button", { name: "Add algorithm" }))
    const votingItem = await screen.findByRole("menuitem", {
      name: /voting engagement/i,
    })
    // The picker shows a summary under the algorithm name.
    expect(votingItem).toHaveTextContent(/wallet-linked votes/i)
    await user.click(votingItem)

    expect(screen.queryByText(/no algorithms added/i)).not.toBeInTheDocument()
    expect(screen.getByText("Voting Engagement")).toBeInTheDocument()
    expect(screen.getByText("v1.0.0")).toBeInTheDocument()
    expect(screen.getByLabelText("Weight for child algorithm 1")).toHaveValue(1)
    // A single child owns 100% of the score.
    expect(screen.getByText("100%")).toBeInTheDocument()

    // Already-added algorithms disappear from the picker.
    await user.click(screen.getByRole("button", { name: "Add algorithm" }))
    const menu = await screen.findByRole("menu")
    expect(
      screen.queryByRole("menuitem", { name: /voting engagement/i })
    ).not.toBeInTheDocument()
    expect(menu).toBeInTheDocument()
  })

  it("shows live share percentages and always allows removal", async () => {
    const user = userEvent.setup()
    renderComposerForm([
      votingRow,
      {
        algorithm_key: "proposal_engagement",
        algorithm_version: "1.0.0",
        weight: 3,
        inputs: [],
      },
    ])

    // Weights 1 and 3 split the score 25% / 75%.
    expect(await screen.findByText("25%")).toBeInTheDocument()
    expect(screen.getByText("75%")).toBeInTheDocument()

    await user.click(
      screen.getByRole("button", { name: "Remove child algorithm 2" })
    )
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Remove child algorithm 2" })
      ).not.toBeInTheDocument()
    )

    // The last card can be removed too; the empty state returns.
    await user.click(
      screen.getByRole("button", { name: "Remove child algorithm 1" })
    )
    expect(await screen.findByText(/no algorithms added/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save preset" })).toBeDisabled()
  })

  it("surfaces the shared validator weight rules as accessible errors", async () => {
    const user = userEvent.setup()
    renderComposerForm()

    const weight = screen.getByLabelText("Weight for child algorithm 1")

    await user.clear(weight)
    expect(
      await screen.findByText(/weight must be a valid number/i)
    ).toBeInTheDocument()

    await user.type(weight, "0")
    expect(
      await screen.findByText(/weight must be greater than 0/i)
    ).toBeInTheDocument()
    expect(weight).toHaveAttribute("aria-invalid", "true")
    expect(screen.getByRole("button", { name: "Save preset" })).toBeDisabled()
    // An invalid weight has no computable share.
    expect(screen.getByText("—")).toBeInTheDocument()

    fireEvent.change(weight, { target: { value: "-1" } })
    expect(
      await screen.findByText(/weight must be greater than 0/i)
    ).toBeInTheDocument()

    await user.clear(weight)
    await user.type(weight, "2.5")
    await waitFor(() => {
      expect(
        screen.queryByText(/weight must be greater than 0/i)
      ).not.toBeInTheDocument()
      expect(
        screen.queryByText(/weight must be a valid number/i)
      ).not.toBeInTheDocument()
    })
    expect(screen.getByText("100%")).toBeInTheDocument()
  })

  it("locks community children whose platform has no active connection", async () => {
    useCommunityConnections.mockReturnValue({
      data: [{ id: "conn-discord", platform: "discord", status: "active" }],
      isLoading: false,
      isError: false,
    })
    const user = userEvent.setup()
    renderComposerForm([votingRow])

    await user.click(screen.getByRole("button", { name: /add algorithm/i }))

    const mattermost = await screen.findByRole("menuitem", {
      name: /mattermost/i,
    })
    expect(mattermost).toHaveAttribute("aria-disabled", "true")
    expect(
      screen.getByText(/no active mattermost connection/i)
    ).toBeInTheDocument()

    const discord = screen.getByRole("menuitem", { name: /discord/i })
    expect(discord).not.toHaveAttribute("aria-disabled", "true")

    expect(
      screen.getByRole("menuitem", { name: /connect communities/i })
    ).toBeInTheDocument()
  })

  it("locks nothing while the connections query loads or fails", async () => {
    useCommunityConnections.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    })
    const user = userEvent.setup()
    renderComposerForm([votingRow])

    await user.click(screen.getByRole("button", { name: /add algorithm/i }))

    const mattermost = await screen.findByRole("menuitem", {
      name: /mattermost/i,
    })
    expect(mattermost).not.toHaveAttribute("aria-disabled", "true")
    expect(
      screen.queryByRole("menuitem", { name: /connect communities/i })
    ).not.toBeInTheDocument()
  })
})
