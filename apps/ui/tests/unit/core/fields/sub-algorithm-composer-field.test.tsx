// @vitest-environment jsdom
import type { AlgorithmDefinition } from "@reputo/reputation-algorithms"
import { getAlgorithmDefinition } from "@reputo/reputation-algorithms"
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { ReputoForm } from "@/core/reputo-form"

const definition = JSON.parse(
  getAlgorithmDefinition({ key: "custom_score", version: "1.0.0" })
) as AlgorithmDefinition

interface ComposerRow {
  algorithm_key: string
  algorithm_version: string
  weight: number | string
  inputs: Array<{ key: string; value: unknown }>
}

const emptyRow: ComposerRow = {
  algorithm_key: "",
  algorithm_version: "",
  weight: 1,
  inputs: [],
}

function renderComposerForm(rows: ComposerRow[] = [emptyRow]) {
  return render(
    <ReputoForm
      schema={definition}
      onSubmit={() => undefined}
      submitLabel="Save preset"
      defaultValues={{ sub_algorithms: rows }}
    />
  )
}

describe("SubAlgorithmComposerField", () => {
  it("surfaces the registry-sourced scoring explanation before save", async () => {
    const user = userEvent.setup()
    renderComposerForm()

    const methodLine = screen.getByText(/current normalization method/i)
    expect(methodLine).toHaveTextContent("Observed min–max")
    expect(methodLine).toHaveTextContent(/target range 0–100/)

    const trigger = screen.getByRole("button", { name: /how scoring works/i })
    expect(trigger).toHaveAttribute("aria-expanded", "false")
    await user.click(trigger)
    expect(trigger).toHaveAttribute("aria-expanded", "true")

    expect(
      screen.getByRole("heading", { name: "How it works" })
    ).toBeInTheDocument()

    // Native child submission: zeros exist only inside a child's own cohort,
    // and Reputo never fills in rows DeepID did not unify.
    const nativeSubmission = screen.getByText(
      /only for a no-result user inside that child's own native cohort/
    )
    expect(nativeSubmission).toHaveTextContent(
      /does not synthesize missing child rows after DeepID unifies users/
    )

    // Complete-user intersection: absent unified fields exclude the user.
    const intersection = screen.getByText(
      /an encrypted value for every selected child/
    )
    expect(intersection).toHaveTextContent(/receives no final score/)
    expect(intersection).toHaveTextContent(/not an absent field/)

    // Normalization phase: active method, observed bounds, equal-bounds rule.
    const normalizationCopy = screen.getByText(
      /Normalization is a configurable phase/
    )
    expect(normalizationCopy).toHaveTextContent(
      /current default method, observed min–max/
    )
    expect(normalizationCopy).toHaveTextContent(
      /using that child's own observed minimum and maximum/
    )
    expect(normalizationCopy).toHaveTextContent(
      /observed bounds are equal, every accepted score for that child normalizes to 0/
    )

    // Weighting and aggregation phases.
    expect(
      screen.getByText(
        /Every child weight must be a finite number greater than 0/
      )
    ).toBeInTheDocument()
    expect(screen.getByText(/weighted sum ÷ total weight/)).toBeInTheDocument()
  })

  it("renders weight as the only row-level numeric input, without range fields or a drag handle", async () => {
    const user = userEvent.setup()
    renderComposerForm()

    await user.click(
      screen.getByRole("button", { name: "Expand sub-algorithm 1" })
    )

    const numericInputs = screen.getAllByRole("spinbutton")
    expect(numericInputs).toHaveLength(1)
    expect(screen.getByLabelText("Weight")).toBe(numericInputs[0])

    expect(screen.queryByLabelText(/source (min|max)/i)).not.toBeInTheDocument()
    expect(
      screen.queryByLabelText(/observed (min|max)/i)
    ).not.toBeInTheDocument()
    expect(
      screen.queryByLabelText(/(minimum|maximum) score/i)
    ).not.toBeInTheDocument()

    // No reorder affordance exists, so no grip icon is rendered.
    expect(document.querySelector("svg.lucide-chevron-down")).not.toBeNull()
    expect(document.querySelector("svg.lucide-grip-vertical")).toBeNull()
  })

  it("keeps add, edit, and remove accessible", async () => {
    const user = userEvent.setup()
    renderComposerForm()

    expect(
      screen.getByRole("button", { name: "Remove sub-algorithm 1" })
    ).toBeDisabled()

    await user.click(screen.getByRole("button", { name: "Add sub-algorithm" }))

    const secondRowToggle = await screen.findByRole("button", {
      name: "Collapse sub-algorithm 2",
    })
    expect(secondRowToggle).toHaveAttribute("aria-expanded", "true")
    expect(
      screen.getByRole("button", { name: "Remove sub-algorithm 1" })
    ).toBeEnabled()

    await user.click(screen.getByRole("combobox", { name: "Algorithm" }))
    await user.click(screen.getByRole("option", { name: /voting engagement/i }))

    expect(await screen.findByText("v1.0.0")).toBeInTheDocument()
    expect(
      within(secondRowToggle).getByText("Voting Engagement")
    ).toBeInTheDocument()

    await user.click(
      screen.getByRole("button", { name: "Remove sub-algorithm 2" })
    )
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /sub-algorithm 2/i })
      ).not.toBeInTheDocument()
    )
  })

  it("surfaces the shared validator weight rules as accessible errors", async () => {
    const user = userEvent.setup()
    renderComposerForm()

    await user.click(
      screen.getByRole("button", { name: "Expand sub-algorithm 1" })
    )
    const weight = screen.getByLabelText("Weight")

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
  })
})
