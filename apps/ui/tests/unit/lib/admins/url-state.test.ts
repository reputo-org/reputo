import { describe, expect, it } from "vitest"
import {
  ADMIN_QUERY_DEFAULTS,
  adminQueryToSearchParams,
  parseAdminQueryParams,
} from "../../../../src/lib/admins/url-state"

describe("admin URL state", () => {
  it("falls back to defaults when no params are provided", () => {
    const parsed = parseAdminQueryParams(new URLSearchParams())

    expect(parsed.status).toBe(ADMIN_QUERY_DEFAULTS.status)
    expect(parsed.sortField).toBe(ADMIN_QUERY_DEFAULTS.sortField)
    expect(parsed.sortOrder).toBe(ADMIN_QUERY_DEFAULTS.sortOrder)
    expect(parsed.page).toBe(ADMIN_QUERY_DEFAULTS.page)
    expect(parsed.limit).toBe(ADMIN_QUERY_DEFAULTS.limit)
    expect(parsed.q).toBeUndefined()
    expect(parsed.role).toBeUndefined()
    expect(parsed.provider).toBeUndefined()
  })

  it("ignores invalid enum values and falls back to defaults", () => {
    const parsed = parseAdminQueryParams(
      new URLSearchParams(
        "provider=fake&role=hacker&status=zombie&sortField=foo&sortOrder=bar"
      )
    )

    expect(parsed.provider).toBeUndefined()
    expect(parsed.role).toBeUndefined()
    expect(parsed.status).toBe(ADMIN_QUERY_DEFAULTS.status)
    expect(parsed.sortField).toBe(ADMIN_QUERY_DEFAULTS.sortField)
    expect(parsed.sortOrder).toBe(ADMIN_QUERY_DEFAULTS.sortOrder)
  })

  it("round-trips non-default values through serialize/deserialize", () => {
    const original = {
      provider: "deep-id" as const,
      role: "admin" as const,
      status: "revoked" as const,
      q: "alpha",
      sortField: "invitedAt" as const,
      sortOrder: "desc" as const,
      page: 3,
      limit: 50,
    }

    const serialized = adminQueryToSearchParams(original)
    const parsed = parseAdminQueryParams(serialized)

    expect(parsed).toEqual(original)
  })

  it("omits default values from serialized output", () => {
    const serialized = adminQueryToSearchParams({
      status: ADMIN_QUERY_DEFAULTS.status,
      sortField: ADMIN_QUERY_DEFAULTS.sortField,
      sortOrder: ADMIN_QUERY_DEFAULTS.sortOrder,
      page: ADMIN_QUERY_DEFAULTS.page,
      limit: ADMIN_QUERY_DEFAULTS.limit,
    })

    expect(serialized.toString()).toBe("")
  })
})
