import { describe, expect, it } from "vitest"
import {
  formatDateTime,
  formatRelativeFromNow,
} from "../../../../src/lib/admins/format"

describe("formatDateTime", () => {
  it("returns an em-dash for null or undefined", () => {
    expect(formatDateTime(null)).toBe("—")
    expect(formatDateTime(undefined)).toBe("—")
  })

  it("returns the input string for unparseable dates", () => {
    expect(formatDateTime("not-a-date")).toBe("not-a-date")
  })

  it("formats valid dates as locale-aware strings", () => {
    const formatted = formatDateTime("2026-05-25T10:00:00Z")
    expect(formatted).not.toBe("—")
    expect(formatted).not.toBe("2026-05-25T10:00:00Z")
  })
})

describe("formatRelativeFromNow", () => {
  const now = new Date("2026-05-25T12:00:00Z")

  it("returns 'Never' for null or undefined", () => {
    expect(formatRelativeFromNow(null, now)).toBe("Never")
    expect(formatRelativeFromNow(undefined, now)).toBe("Never")
  })

  it("returns the input string for unparseable dates", () => {
    expect(formatRelativeFromNow("not-a-date", now)).toBe("not-a-date")
  })

  it("formats a recent past date in seconds or minutes", () => {
    const result = formatRelativeFromNow("2026-05-25T11:59:30Z", now)
    expect(result).toMatch(/second|now/i)
  })

  it("formats a past date in days", () => {
    const result = formatRelativeFromNow("2026-05-20T12:00:00Z", now)
    expect(result).toMatch(/day/)
  })

  it("formats a past date in years", () => {
    const result = formatRelativeFromNow("2020-01-01T00:00:00Z", now)
    expect(result).toMatch(/year/)
  })

  it("formats a future date positively", () => {
    const result = formatRelativeFromNow("2026-05-26T12:00:00Z", now)
    expect(result).toMatch(/day|hour|tomorrow/i)
  })
})
