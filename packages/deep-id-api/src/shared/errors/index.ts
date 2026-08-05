/** Error bodies are short DeepID error JSON; the cap guards against HTML error pages. */
const BODY_SNIPPET_LENGTH = 200;

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly statusText: string,
    public readonly body?: string,
  ) {
    const snippet = body && body.trim().length > 0 ? ` — ${body.trim().slice(0, BODY_SNIPPET_LENGTH)}` : '';
    super(`HTTP ${statusCode}: ${statusText}${snippet}`);
    this.name = 'HttpError';
  }
}

/** One flattened validation issue inside a {@link DeepIdContractError}. */
export interface ContractIssue {
  /** Dot-joined path into the offending value, or `(root)`. */
  path: string;
  message: string;
}

/**
 * A request payload or DeepID response that breaks the documented contract —
 * an invalid score entry, malformed SEAL metadata, an off-origin metadata URL,
 * an unknown encryption status. Not retryable: the caller must fix the payload
 * or treat the run as failed. Messages and issues describe paths and expected
 * shapes only; they never contain scores, ciphertexts, tokens, or bodies.
 */
export class DeepIdContractError extends Error {
  constructor(
    message: string,
    public readonly issues: readonly ContractIssue[] = [],
  ) {
    super(message);
    this.name = 'DeepIdContractError';
  }
}
