// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CSVViewer } from "@/components/app/csv/csv-viewer"

function mockFetchText(csv: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      body: null,
      text: async () => csv,
    } as unknown as Response)
  )
}

function mockFetchError(status: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: false, status } as Response)
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("CSVViewer", () => {
  it("parses and renders rows once the file loads", async () => {
    mockFetchText("name,score\nalice,10\nbob,20")

    render(<CSVViewer href="/preview.csv" />)

    expect(await screen.findByText("alice")).toBeInTheDocument()
    expect(screen.getByText("name")).toBeInTheDocument()
    expect(screen.getByText("score")).toBeInTheDocument()
    expect(screen.getByText("bob")).toBeInTheDocument()
  })

  it("filters rows by the search query", async () => {
    mockFetchText("name,score\nalice,10\nbob,20")
    const user = userEvent.setup()

    render(<CSVViewer href="/preview.csv" />)
    await screen.findByText("alice")

    await user.type(screen.getByPlaceholderText(/search/i), "alice")

    expect(screen.queryByText("bob")).not.toBeInTheDocument()
    expect(screen.getAllByRole("row")).toHaveLength(2)
  })

  it("sorts numerically when a column header is clicked", async () => {
    mockFetchText("name,score\nbob,20\nalice,10")
    const user = userEvent.setup()

    render(<CSVViewer href="/preview.csv" />)
    await screen.findByText("bob")

    await user.click(screen.getByText("score"))

    const firstDataRow = screen.getAllByRole("row")[1]
    expect(within(firstDataRow).getByText("alice")).toBeInTheDocument()
  })

  it("surfaces an error when the fetch fails", async () => {
    mockFetchError(500)

    render(<CSVViewer href="/preview.csv" />)

    expect(await screen.findByText(/Failed to load CSV/)).toBeInTheDocument()
    expect(screen.getByText(/500/)).toBeInTheDocument()
  })

  it("shows an empty state for a header-only file", async () => {
    mockFetchText("name,score")

    render(<CSVViewer href="/preview.csv" />)

    expect(await screen.findByText("No rows found")).toBeInTheDocument()
  })

  it("paginates large files", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => String(i + 1)).join("\n")
    mockFetchText(`id\n${rows}`)
    const user = userEvent.setup()

    render(<CSVViewer href="/preview.csv" pageSize={10} />)
    expect(await screen.findByText(/Page 1 \/ 3/)).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Next" }))

    expect(screen.getByText(/Page 2 \/ 3/)).toBeInTheDocument()
  })
})
