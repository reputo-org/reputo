import pino from 'pino';

/**
 * Pino logger that redacts the credentials Reputo sends to DeepID (the
 * `Authorization` header carries either the Basic client secret on the token
 * request or the bearer token on `/v1` calls). Pass `level` from the consuming
 * app's validated env (defaults to 'info').
 */
export function createLogger(level: string = 'info'): pino.Logger {
  return pino({
    level,
    redact: {
      paths: ['headers.authorization', 'headers.Authorization', 'headers["authorization"]'],
      censor: '[REDACTED]',
    },
  });
}
