/**
 * Client-side admin email validation.
 *
 * Mirrors the HTML5 `type=email` semantics (non-empty + a basic
 * `local@domain.tld` shape). The API performs the canonical check; this gate
 * exists to short-circuit obviously invalid input before a round trip.
 */

export type AdminEmailValidation =
  | { ok: true; email: string }
  | { ok: false; reason: "empty" | "invalid_format" }

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateAdminEmail(raw: string): AdminEmailValidation {
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    return { ok: false, reason: "empty" }
  }
  if (!EMAIL_PATTERN.test(trimmed)) {
    return { ok: false, reason: "invalid_format" }
  }
  return { ok: true, email: trimmed.toLowerCase() }
}

export function describeAdminEmailError(
  reason: "empty" | "invalid_format"
): string {
  return reason === "empty"
    ? "Enter an email address."
    : "Enter a valid email address (name@domain.tld)."
}
