/**
 * Reason → copy mapping for the public `/access-denied` route.
 *
 * The API redirects rejected users here with a `?reason=` query string.
 * Unknown / missing values fall through to a generic message so the page
 * never 404s on a value the backend may add later.
 */

export type AccessDeniedReason =
  | "not_allowlisted"
  | "email_unverified"
  | "revoked"
  | "consent_denied"
  | "unknown"

export interface AccessDeniedCta {
  label: string
  href: string
}

export interface AccessDeniedCopy {
  reason: AccessDeniedReason
  title: string
  /** Short explanatory message rendered between the title and the CTA. */
  subtitle: string
  cta: AccessDeniedCta
}

const KNOWN_REASONS: ReadonlySet<AccessDeniedReason> = new Set([
  "not_allowlisted",
  "email_unverified",
  "revoked",
  "consent_denied",
])

export function normaliseReason(input: unknown): AccessDeniedReason {
  if (typeof input !== "string") return "unknown"
  return KNOWN_REASONS.has(input as AccessDeniedReason)
    ? (input as AccessDeniedReason)
    : "unknown"
}

const RETRY_CTA: AccessDeniedCta = {
  label: "Back to sign in",
  href: "/login",
}

export function resolveAccessDeniedCopy(rawReason: unknown): AccessDeniedCopy {
  const reason = normaliseReason(rawReason)

  switch (reason) {
    case "not_allowlisted":
      return {
        reason,
        title: "Access restricted",
        subtitle:
          "Your account isn't on the Reputo allowlist. Contact an administrator if you believe this is an error.",
        cta: RETRY_CTA,
      }
    case "email_unverified":
      return {
        reason,
        title: "Email not verified",
        subtitle:
          "Verify your email with your identity provider, then sign in again.",
        cta: RETRY_CTA,
      }
    case "revoked":
      return {
        reason,
        title: "Access revoked",
        subtitle:
          "Your access to Reputo has been revoked. Contact an administrator if you need it restored.",
        cta: RETRY_CTA,
      }
    case "consent_denied":
      return {
        reason,
        title: "Sign-in cancelled",
        subtitle:
          "You declined the permissions Reputo needs to sign you in. Try again to continue.",
        cta: RETRY_CTA,
      }
    default:
      return {
        reason: "unknown",
        title: "Access denied",
        subtitle:
          "We couldn't sign you in. Please try again, or contact an administrator.",
        cta: RETRY_CTA,
      }
  }
}
