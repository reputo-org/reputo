import { describe, expect, it } from "vitest"
import {
  describeAdminEmailError,
  validateAdminEmail,
} from "../../../../src/lib/admins/validate-email"

describe("validateAdminEmail", () => {
  it("accepts a well-formed email and lowercases it", () => {
    expect(validateAdminEmail("Person@Example.COM")).toEqual({
      ok: true,
      email: "person@example.com",
    })
  })

  it("trims surrounding whitespace before validating", () => {
    expect(validateAdminEmail("  alice@example.com  ")).toEqual({
      ok: true,
      email: "alice@example.com",
    })
  })

  it("flags empty input", () => {
    expect(validateAdminEmail("")).toEqual({ ok: false, reason: "empty" })
    expect(validateAdminEmail("   ")).toEqual({
      ok: false,
      reason: "empty",
    })
  })

  it("flags malformed addresses", () => {
    for (const bad of [
      "not-an-email",
      "missing-at.example.com",
      "no-domain@",
      "@no-local.example",
      "two@@example.com",
      "spaces in@example.com",
      "alice@nodot",
    ]) {
      expect(validateAdminEmail(bad)).toEqual({
        ok: false,
        reason: "invalid_format",
      })
    }
  })
})

describe("describeAdminEmailError", () => {
  it("provides distinct copy for each failure reason", () => {
    expect(describeAdminEmailError("empty")).toMatch(/Enter an email/i)
    expect(describeAdminEmailError("invalid_format")).toMatch(
      /valid email address/i
    )
  })
})
