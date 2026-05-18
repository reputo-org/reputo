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
    [
      "not_allowlisted",
      "Access restricted",
      "Your account isn't on the Reputo allowlist. Contact an administrator if you believe this is an error.",
    ],
    [
      "email_unverified",
      "Email not verified",
      "Verify your email with your identity provider, then sign in again.",
    ],
    [
      "revoked",
      "Access revoked",
      "Your access to Reputo has been revoked. Contact an administrator if you need it restored.",
    ],
    [
      "consent_denied",
      "Sign-in cancelled",
      "You declined the permissions Reputo needs to sign you in. Try again to continue.",
    ],
  ] as const)("maps %s to its title, subtitle, and retry CTA", (reason, expectedTitle, expectedSubtitle) => {
    const copy = resolveAccessDeniedCopy(reason)

    expect(copy.reason).toBe(reason)
    expect(copy.title).toBe(expectedTitle)
    expect(copy.subtitle).toBe(expectedSubtitle)
    expect(copy.cta).toEqual(RETRY)
  })

  it("uses the generic default copy for missing or unknown reasons", () => {
    const missing = resolveAccessDeniedCopy(undefined)
    const unknown = resolveAccessDeniedCopy("totally-made-up")

    for (const copy of [missing, unknown]) {
      expect(copy.reason).toBe("unknown")
      expect(copy.title).toBe("Access denied")
      expect(copy.subtitle).toBe(
        "We couldn't sign you in. Please try again, or contact an administrator."
      )
      expect(copy.cta).toEqual(RETRY)
    }
  })
})
