// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useForm } from "react-hook-form"
import { describe, expect, it, vi } from "vitest"
import { Form } from "@/components/ui/form"
import { NumberField } from "@/core/fields"
import type { FormInput } from "@/core/schema-builder"

const input: FormInput = {
  key: "maturation_threshold_days",
  label: "Maturation Period (Days)",
  type: "integer",
  min: 1,
  max: 3650,
  step: 1,
  default: 90,
  required: true,
  sliderHint: false,
  suffix: "days",
}

function Harness({ onSubmit }: { onSubmit: (values: any) => void }) {
  const form = useForm<any>({
    defaultValues: { maturation_threshold_days: 90 },
    mode: "onChange",
  })

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <NumberField input={input} control={form.control} />
        <button type="submit">Save</button>
      </form>
    </Form>
  )
}

describe("NumberField", () => {
  it("submits the typed value when Enter is pressed without blurring", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)

    const field = screen.getByRole("textbox", { name: /maturation period/i })
    await user.clear(field)
    await user.type(field, "180")

    // Implicit submission: no blur happens first.
    await user.keyboard("{Enter}")

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      maturation_threshold_days: 180,
    })
  })

  it("rounds an integer field on blur", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)

    const field = screen.getByRole("textbox", { name: /maturation period/i })
    await user.clear(field)
    await user.type(field, "12.6")
    await user.tab()

    expect(field).toHaveValue("13")

    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      maturation_threshold_days: 13,
    })
  })

  it("clears the form value while the text is not a number", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)

    const field = screen.getByRole("textbox", { name: /maturation period/i })
    await user.clear(field)

    // A stale 90 must not survive an emptied field.
    await user.keyboard("{Enter}")
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      maturation_threshold_days: "",
    })
  })
})
