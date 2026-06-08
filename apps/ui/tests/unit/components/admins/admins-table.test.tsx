// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { AdminsTable } from "@/components/admins/admins-table"
import type {
  AdminListResponseDto,
  ListAdminsQueryParams,
} from "@/lib/api/types"

vi.mock("@/components/admins/admin-row-actions", () => ({
  AdminRowActions: () => null,
}))
vi.mock("@/components/admins/time-cell", () => ({ TimeCell: () => null }))
vi.mock("@/components/providers/provider-logo", () => ({
  ProviderLogo: () => null,
}))

const admins = [
  {
    email: "alice@example.com",
    provider: "google",
    role: "admin",
    revokedAt: null,
    lastSignInAt: "2024-01-01T00:00:00.000Z",
  },
  {
    email: "bob@example.com",
    provider: "github",
    role: "owner",
    revokedAt: "2024-02-01T00:00:00.000Z",
    lastSignInAt: null,
  },
]

const baseQuery: ListAdminsQueryParams = {
  page: 1,
  limit: 20,
  sortField: "email",
  sortOrder: "asc",
}

function renderTable(overrides: {
  data?: unknown
  isLoading?: boolean
  isError?: boolean
  query?: ListAdminsQueryParams
  onChange?: (next: Partial<ListAdminsQueryParams>) => void
}) {
  const onChange = overrides.onChange ?? vi.fn()
  render(
    <AdminsTable
      data={overrides.data as AdminListResponseDto | undefined}
      isLoading={overrides.isLoading ?? false}
      isError={overrides.isError ?? false}
      query={overrides.query ?? baseQuery}
      onChange={onChange}
    />
  )
  return { onChange }
}

describe("AdminsTable", () => {
  it("shows a loading indicator while fetching", () => {
    renderTable({ isLoading: true, data: undefined })

    expect(screen.getByText(/Loading/)).toBeInTheDocument()
  })

  it("shows an error message when the query failed", () => {
    renderTable({ isError: true, data: undefined })

    expect(screen.getByText(/Failed to load admins/)).toBeInTheDocument()
  })

  it("shows an empty message when there are no matches", () => {
    renderTable({
      data: { results: [], totalResults: 0, totalPages: 1 },
    })

    expect(
      screen.getByText(/No admins match these filters/)
    ).toBeInTheDocument()
  })

  it("renders a row per admin", () => {
    renderTable({
      data: { results: admins, totalResults: 2, totalPages: 1 },
    })

    expect(screen.getByText("alice@example.com")).toBeInTheDocument()
    expect(screen.getByText("bob@example.com")).toBeInTheDocument()
    expect(screen.getByText("owner")).toBeInTheDocument()
    expect(screen.getByText("Revoked")).toBeInTheDocument()
  })

  it("requests the next page and disables Previous on the first page", async () => {
    const { onChange } = renderTable({
      data: { results: admins, totalResults: 50, totalPages: 3 },
    })
    const user = userEvent.setup()

    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled()

    await user.click(screen.getByRole("button", { name: "Next page" }))

    expect(onChange).toHaveBeenCalledWith({ page: 2 })
  })

  it("changes the sort field when a sortable header is clicked", async () => {
    const { onChange } = renderTable({
      data: { results: admins, totalResults: 2, totalPages: 1 },
    })
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "Role" }))

    expect(onChange).toHaveBeenCalledWith({
      sortField: "role",
      sortOrder: "asc",
      page: 1,
    })
  })
})
