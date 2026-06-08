// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { InputTypeBadge } from "@/components/app/input-type-badge"

describe("InputTypeBadge", () => {
  it("renders the label for a file-type input", () => {
    render(<InputTypeBadge type="csv" label="CSV upload" />)

    expect(screen.getByText("CSV upload")).toBeInTheDocument()
  })

  it("renders the label for a non-file input", () => {
    render(<InputTypeBadge type="address" label="Wallet address" />)

    expect(screen.getByText("Wallet address")).toBeInTheDocument()
  })
})
