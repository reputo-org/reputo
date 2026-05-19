/**
 * Redact an email for logs at warn level or below. Returns a value safe to log
 * for security monitoring without leaking the full address of unauthenticated
 * or denied callers. Audit logs that intentionally capture admin identity
 * should keep the original value.
 */
export function redactEmail(email: string | undefined): string | undefined {
  if (!email) {
    return undefined;
  }

  const atIndex = email.indexOf('@');

  if (atIndex <= 0) {
    return '***';
  }

  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);
  const head = local[0] ?? '';

  return `${head}***@${domain}`;
}
