import type { AccessRole } from "@/lib/auth/auth-context"

/**
 * Pure decision logic for {@link RoleGate}. Split out from the React
 * component so it can be unit-tested without rendering.
 */

export type RoleGateDecision =
  | { kind: "wait" }
  | { kind: "redirect"; href: string }
  | { kind: "allow" }

export interface RoleGateInputs {
  loading: boolean
  authenticated: boolean
  role: AccessRole | undefined
  requiredRole: AccessRole
  /** Where to send unauthenticated visitors. Defaults to `/login`. */
  loginHref?: string
  /** Where to send authenticated users with the wrong role. Defaults to `/dashboard`. */
  forbiddenHref?: string
}

export function decideRoleGate(input: RoleGateInputs): RoleGateDecision {
  const loginHref = input.loginHref ?? "/login"
  const forbiddenHref = input.forbiddenHref ?? "/dashboard"

  if (input.loading) return { kind: "wait" }
  if (!input.authenticated) return { kind: "redirect", href: loginHref }
  if (input.role !== input.requiredRole) {
    return { kind: "redirect", href: forbiddenHref }
  }
  return { kind: "allow" }
}
