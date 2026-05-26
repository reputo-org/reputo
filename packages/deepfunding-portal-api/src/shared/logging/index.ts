import pino from 'pino';

/**
 * Pino logger with redaction for the upstream API key header. Pass `level`
 * from the consuming app's validated env (defaults to 'info').
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
