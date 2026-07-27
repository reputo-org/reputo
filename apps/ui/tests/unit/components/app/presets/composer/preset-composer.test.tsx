// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { PresetComposer } from "@/components/app/presets/composer/preset-composer"
import type { Algorithm } from "@/core/algorithms"

const { pushMock, createMutateAsync, updateMutateAsync, validateClientMock } =
  vi.hoisted(() => ({
    pushMock: vi.fn(),
    createMutateAsync: vi.fn(),
    updateMutateAsync: vi.fn(),
    validateClientMock: vi.fn(),
  }))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
  usePathname: () => "/dashboard/algorithms/proposal_engagement/presets/new",
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock("@/lib/api/hooks", () => ({
  useCreateAlgorithmPreset: () => ({
    mutateAsync: createMutateAsync,
    isPending: false,
  }),
  useUpdateAlgorithmPreset: () => ({
    mutateAsync: updateMutateAsync,
    isPending: false,
  }),
}))

vi.mock("@/components/app/presets/algorithm-client-validation", () => ({
  validateAlgorithmPresetClient: validateClientMock,
}))

const algo: Algorithm = {
  id: "proposal_engagement",
  title: "Proposal Engagement",
  category: "Engagement",
  summary: "Scores proposal owners.",
  description: "### What it does\nScores proposal owners.",
  duration: "~2-4 min",
  inputSummary: "4 configurable inputs",
  level: "Beginner",
  kind: "standalone",
  inputs: [
    {
      key: "funded_concluded_reward_weight",
      type: "number",
      label: "Funded Proposal Reward",
    },
    {
      key: "unfunded_penalty_weight",
      type: "number",
      label: "Unfunded Proposal Penalty",
    },
    {
      key: "engagement_window_months",
      type: "integer",
      label: "Lookback Window (Months)",
    },
    {
      key: "monthly_decay_rate_percent",
      type: "integer",
      label: "Monthly Decay Rate (%)",
    },
  ],
  dependencyLabels: ["DeepFunding Portal API"],
}

function submitButton() {
  return screen.getAllByRole("button", { name: "Create preset" })[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  validateClientMock.mockResolvedValue([])
  createMutateAsync.mockResolvedValue({ _id: "np1" })
})

describe("PresetComposer (create mode)", () => {
  it("renders grouped sections with Details last and a suggested name", () => {
    render(<PresetComposer algo={algo} mode="create" initialName="Suggested" />)

    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent ?? "")
    expect(headings).toContain("Rewards & penalties")
    expect(headings).toContain("Time window & decay")
    // Details is the last section of the fields column (the review panel
    // headings follow it in DOM order).
    expect(headings.indexOf("Details")).toBeGreaterThan(
      headings.indexOf("Time window & decay")
    )

    expect(screen.getByRole("textbox", { name: /preset name/i })).toHaveValue(
      "Suggested"
    )
    // Registry default for the lookback window (48 after the data fix).
    expect(
      screen.getByRole("textbox", { name: /lookback window/i })
    ).toHaveValue("48")
  })

  it("lists why submit is disabled and enables it once complete", async () => {
    const user = userEvent.setup()
    render(<PresetComposer algo={algo} mode="create" initialName="Suggested" />)

    expect(screen.getByText("Description is missing")).toBeInTheDocument()
    await waitFor(() => expect(submitButton()).toBeDisabled())

    await user.type(
      screen.getByRole("textbox", { name: /^description/i }),
      "A long enough description."
    )

    await waitFor(() => expect(submitButton()).toBeEnabled())
    expect(screen.queryByText("Description is missing")).not.toBeInTheDocument()
  })

  it("is ready to submit when every field has a default, description included", async () => {
    render(
      <PresetComposer
        algo={algo}
        mode="create"
        initialName="Suggested"
        initialDescription="Scores each Deep Funding Portal user from proposal outcomes."
      />
    )

    expect(screen.getByRole("textbox", { name: /^description/i })).toHaveValue(
      "Scores each Deep Funding Portal user from proposal outcomes."
    )
    await waitFor(() => expect(submitButton()).toBeEnabled())
    expect(screen.queryByText(/is missing/)).not.toBeInTheDocument()
  })

  it("submits the preset payload and navigates with the created id", async () => {
    const user = userEvent.setup()
    render(<PresetComposer algo={algo} mode="create" initialName="Suggested" />)

    await user.type(
      screen.getByRole("textbox", { name: /^description/i }),
      "A long enough description."
    )
    await waitFor(() => expect(submitButton()).toBeEnabled())
    await user.click(submitButton())

    await waitFor(() => expect(createMutateAsync).toHaveBeenCalledTimes(1))
    const payload = createMutateAsync.mock.calls[0][0]
    expect(payload).toMatchObject({
      key: "proposal_engagement",
      version: "1.0.0",
      name: "Suggested",
      description: "A long enough description.",
    })
    expect(payload.inputs).toEqual(
      expect.arrayContaining([
        { key: "engagement_window_months", value: 48 },
        { key: "funded_concluded_reward_weight", value: 1 },
      ])
    )

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith(
        "/dashboard/algorithms/proposal_engagement?tab=presets&created=np1"
      )
    )
  })

  it("maps API field errors inline and keeps general errors in the alert", async () => {
    const user = userEvent.setup()
    createMutateAsync.mockRejectedValue({
      response: {
        data: {
          errors: [
            {
              inputKey: "engagement_window_months",
              message: "Window too small",
            },
            { message: "Something exploded" },
          ],
        },
      },
    })

    render(<PresetComposer algo={algo} mode="create" initialName="Suggested" />)

    await user.type(
      screen.getByRole("textbox", { name: /^description/i }),
      "A long enough description."
    )
    await waitFor(() => expect(submitButton()).toBeEnabled())
    await user.click(submitButton())

    expect(await screen.findByText("Window too small")).toBeInTheDocument()
    // The general alert renders for both the desktop panel and mobile bar.
    expect(screen.getAllByText("Something exploded").length).toBeGreaterThan(0)
    expect(pushMock).not.toHaveBeenCalled()
  })

  it("asks before discarding edits, and leaves straight away when clean", async () => {
    const user = userEvent.setup()
    render(<PresetComposer algo={algo} mode="create" initialName="Suggested" />)

    const cancel = screen.getAllByRole("button", { name: "Cancel" })[0]

    // Nothing typed yet: cancelling navigates without a prompt.
    await user.click(cancel)
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    expect(pushMock).toHaveBeenCalledWith(
      "/dashboard/algorithms/proposal_engagement?tab=presets"
    )

    pushMock.mockClear()
    await user.type(
      screen.getByRole("textbox", { name: /^description/i }),
      "Edited."
    )
    await user.click(cancel)

    const dialog = await screen.findByRole("alertdialog")
    expect(dialog).toHaveTextContent(/discard changes/i)
    expect(pushMock).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole("button", { name: "Discard" }))
    expect(pushMock).toHaveBeenCalledWith(
      "/dashboard/algorithms/proposal_engagement?tab=presets"
    )
  })

  it("scrolls to a field from the readiness checklist", async () => {
    const user = userEvent.setup()
    const scrollSpy = vi.spyOn(Element.prototype, "scrollIntoView")

    render(<PresetComposer algo={algo} mode="create" initialName="Suggested" />)

    const checklist = screen.getByRole("heading", { name: "Checklist" })
      .parentElement as HTMLElement
    // The accessible name carries the status for screen readers.
    await user.click(
      within(checklist).getByRole("button", {
        name: /^Description — still needed$/,
      })
    )

    expect(scrollSpy).toHaveBeenCalled()
  })
})

describe("PresetComposer (edit mode)", () => {
  it("updates the preset and navigates with the updated id", async () => {
    const user = userEvent.setup()
    updateMutateAsync.mockResolvedValue({ _id: "p9" })

    render(
      <PresetComposer
        algo={algo}
        mode="edit"
        basePreset={
          {
            _id: "p9",
            key: "proposal_engagement",
            version: "1.0.0",
            name: "Stored name",
            description: "Stored description text",
            inputs: [
              { key: "funded_concluded_reward_weight", value: 2 },
              { key: "unfunded_penalty_weight", value: 1 },
              { key: "engagement_window_months", value: 24 },
              { key: "monthly_decay_rate_percent", value: 0 },
            ],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          } as never
        }
      />
    )

    expect(screen.getByRole("textbox", { name: /preset name/i })).toHaveValue(
      "Stored name"
    )
    expect(
      screen.getByRole("textbox", { name: /lookback window/i })
    ).toHaveValue("24")

    const saveButton = screen.getAllByRole("button", {
      name: "Save changes",
    })[0]
    await waitFor(() => expect(saveButton).toBeEnabled())
    await user.click(saveButton)

    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1))
    const { id, data } = updateMutateAsync.mock.calls[0][0]
    expect(id).toBe("p9")
    expect(data.name).toBe("Stored name")
    expect(data.inputs).toEqual(
      expect.arrayContaining([{ key: "engagement_window_months", value: 24 }])
    )

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith(
        "/dashboard/algorithms/proposal_engagement?tab=presets&updated=p9"
      )
    )
  })
})
