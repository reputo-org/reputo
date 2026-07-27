// @vitest-environment jsdom
import { zodResolver } from "@hookform/resolvers/zod"
import type { AlgorithmDefinition } from "@reputo/reputation-algorithms"
import { getAlgorithmDefinition } from "@reputo/reputation-algorithms"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useForm } from "react-hook-form"
import { describe, expect, it } from "vitest"
import { Form } from "@/components/ui/form"
import { SubAlgorithmComposerField } from "@/core/fields"
import { FormUploadProvider } from "@/core/form-context"
import { buildZodSchema, type FormInput } from "@/core/schema-builder"

const definition = JSON.parse(
  getAlgorithmDefinition({ key: "custom_score", version: "1.0.0" })
) as AlgorithmDefinition

const subAlgorithmsInput: FormInput = {
  key: "sub_algorithms",
  label: "Sub-Algorithms",
  type: "sub_algorithm",
  required: true,
  minItems: 1,
  addButtonLabel: "Add sub-algorithm",
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

  it("shows an empty state and adds pre-assigned cards through the picker", async () => {
    const user = userEvent.setup()
    renderComposerForm([])

    expect(screen.getByText(/no sub-algorithms yet/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save preset" })).toBeDisabled()

    await user.click(screen.getByRole("button", { name: "Add sub-algorithm" }))
    const votingItem = await screen.findByRole("menuitem", {
      name: /voting engagement/i,
    })
    // The picker shows a summary under the algorithm name.
    expect(votingItem).toHaveTextContent(/voting history/i)
    await user.click(votingItem)

    expect(screen.queryByText(/no sub-algorithms yet/i)).not.toBeInTheDocument()
    expect(screen.getByText("Voting Engagement")).toBeInTheDocument()
    expect(screen.getByText("v1.0.0")).toBeInTheDocument()
    expect(screen.getByLabelText("Weight of sub-algorithm 1")).toHaveValue(1)
    // A single child owns 100% of the score.
    expect(screen.getByText("100%")).toBeInTheDocument()

    // Already-added algorithms disappear from the picker.
    await user.click(screen.getByRole("button", { name: "Add sub-algorithm" }))
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
      screen.getByRole("button", { name: "Remove sub-algorithm 2" })
    )
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Remove sub-algorithm 2" })
      ).not.toBeInTheDocument()
    )

    // The last card can be removed too; the empty state returns.
    await user.click(
      screen.getByRole("button", { name: "Remove sub-algorithm 1" })
    )
    expect(
      await screen.findByText(/no sub-algorithms yet/i)
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save preset" })).toBeDisabled()
  })

  it("surfaces the shared validator weight rules as accessible errors", async () => {
    const user = userEvent.setup()
    renderComposerForm()

    const weight = screen.getByLabelText("Weight of sub-algorithm 1")

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
})
