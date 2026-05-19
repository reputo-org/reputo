import { describe, expect, it } from "vitest"
import { decideRoleGate } from "../../../../src/lib/auth/role-gate"

describe("decideRoleGate", () => {
  it("waits while the session bootstrap is loading", () => {
    expect(
      decideRoleGate({
        loading: true,
        authenticated: false,
        role: undefined,
        requiredRole: "owner",
      })
    ).toEqual({ kind: "wait" })
  })

  it("redirects unauthenticated visitors to /login by default", () => {
    expect(
      decideRoleGate({
        loading: false,
        authenticated: false,
        role: undefined,
        requiredRole: "owner",
      })
    ).toEqual({ kind: "redirect", href: "/login" })
  })

  it("honours a custom loginHref override", () => {
    expect(
      decideRoleGate({
        loading: false,
        authenticated: false,
        role: undefined,
        requiredRole: "owner",
        loginHref: "/access-denied?reason=not_allowlisted",
      })
    ).toEqual({
      kind: "redirect",
      href: "/access-denied?reason=not_allowlisted",
    })
  })

  it("redirects authenticated users with the wrong role to /dashboard by default", () => {
    expect(
      decideRoleGate({
        loading: false,
        authenticated: true,
        role: "admin",
        requiredRole: "owner",
      })
    ).toEqual({ kind: "redirect", href: "/dashboard" })
  })

  it("honours a custom forbiddenHref override", () => {
    expect(
      decideRoleGate({
        loading: false,
        authenticated: true,
        role: "admin",
        requiredRole: "owner",
        forbiddenHref: "/dashboard?denied=admins",
      })
    ).toEqual({ kind: "redirect", href: "/dashboard?denied=admins" })
  })

  it("redirects when role is missing (e.g. mid-bootstrap drop)", () => {
    expect(
      decideRoleGate({
        loading: false,
        authenticated: true,
        role: undefined,
        requiredRole: "owner",
      })
    ).toEqual({ kind: "redirect", href: "/dashboard" })
  })

  it("allows the user when authenticated with the matching role", () => {
    expect(
      decideRoleGate({
        loading: false,
        authenticated: true,
        role: "owner",
        requiredRole: "owner",
      })
    ).toEqual({ kind: "allow" })
  })

  it("treats role mismatch strictly: admin cannot reach an owner-only page", () => {
    expect(
      decideRoleGate({
        loading: false,
        authenticated: true,
        role: "admin",
        requiredRole: "owner",
      }).kind
    ).toBe("redirect")
  })
})
