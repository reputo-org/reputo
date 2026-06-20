export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly statusText: string,
    public readonly body?: string,
  ) {
    super(`HTTP ${statusCode}: ${statusText}`);
    this.name = 'HttpError';
  }
}
