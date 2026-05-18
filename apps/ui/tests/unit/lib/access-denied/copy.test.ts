import { describe, expect, it } from "vitest"
import {
  normaliseReason,
  resolveAccessDeniedCopy,
} from "../../../../src/lib/access-denied/copy"

describe("normaliseReason", () => {
  it("returns the reason verbatim when it is a known value", () => {
    expect(normaliseReason("not_allowlisted")).toBe("not_allowlisted")
    expect(normaliseReason("email_unverified")).toBe("email_unverified")
    expect(normaliseReason("revoked")).toBe("revoked")
    expect(normaliseReason("consent_denied")).toBe("consent_denied")
  })

  it("returns 'unknown' for missing, empty, or unrecognised values", () => {
    expect(normaliseReason(undefined)).toBe("unknown")
    expect(normaliseReason(null)).toBe("unknown")
    expect(normaliseReason("")).toBe("unknown")
    expect(normaliseReason("hacked")).toBe("unknown")
    expect(normaliseReason(123)).toBe("unknown")
  })
})

describe("resolveAccessDeniedCopy", () => {
  const RETRY = {
    label: "Back to sign in",
    href: "/login",
  } as const

  it.each([
    ["not_allowlisted", ["Access ", { italic: "restricted" }, "."]],
    ["email_unverified", ["Email ", { italic: "not verified" }, "."]],
    ["revoked", ["Access ", { italic: "revoked" }, "."]],
    ["consent_denied", ["Sign-in ", { italic: "cancelled" }, "."]],
  ] as const)("maps %s to its parted title with a retry CTA", (reason, expectedParts) => {
    const copy = resolveAccessDeniedCopy(reason)

    expect(copy.reason).toBe(reason)
    expect(copy.titleParts).toEqual(expectedParts)
    expect(copy.cta).toEqual(RETRY)
  })

  it("uses the generic default copy for missing or unknown reasons", () => {
    const missing = resolveAccessDeniedCopy(undefined)
    const unknown = resolveAccessDeniedCopy("totally-made-up")

    for (const copy of [missing, unknown]) {
      expect(copy.reason).toBe("unknown")
      expect(copy.titleParts).toEqual(["Access ", { italic: "denied" }, "."])
      expect(copy.cta).toEqual(RETRY)
    }
  })
})
