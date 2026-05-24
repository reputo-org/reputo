import pino from 'pino';

/**
 * Create a shared Pino logger instance with redaction for sensitive headers.
 * Pass `level` from the consuming app's validated env (defaults to 'info').
 */
export function createLogger(level: string = 'info'): pino.Logger {
  return pino({
    level,
    redact: {
      paths: ['headers.authentication-key', 'headers["authentication-key"]'],
      censor: '[REDACTED]',
    },
  });
}
