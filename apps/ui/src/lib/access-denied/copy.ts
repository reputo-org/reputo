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

/**
 * Title parts shaped for the Hero's italic-accent renderer. Strings render
 * as-is; `{ italic: "word" }` wraps the word in an `<em>` for the accent.
 */
export type TitlePart = string | { italic: string }

export interface AccessDeniedCopy {
  reason: AccessDeniedReason
  /** Title broken into parts so the Hero can render the italic accent. */
  titleParts: ReadonlyArray<TitlePart>
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
        titleParts: ["Access ", { italic: "restricted" }, "."],
        cta: RETRY_CTA,
      }
    case "email_unverified":
      return {
        reason,
        titleParts: ["Email ", { italic: "not verified" }, "."],
        cta: RETRY_CTA,
      }
    case "revoked":
      return {
        reason,
        titleParts: ["Access ", { italic: "revoked" }, "."],
        cta: RETRY_CTA,
      }
    case "consent_denied":
      return {
        reason,
        titleParts: ["Sign-in ", { italic: "cancelled" }, "."],
        cta: RETRY_CTA,
      }
    default:
      return {
        reason: "unknown",
        titleParts: ["Access ", { italic: "denied" }, "."],
        cta: RETRY_CTA,
      }
  }
}
