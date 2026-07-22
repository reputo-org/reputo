import type { z } from 'zod';
import { type ContractIssue, DeepIdContractError } from '../errors/index.js';

function toContractIssues(error: z.ZodError): ContractIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)',
    message: issue.message,
  }));
}

/**
 * Parses `value` with `schema` and throws a {@link DeepIdContractError} on
 * mismatch. The error carries paths and expected shapes only, so scores,
 * ciphertexts, and tokens never leak into messages or logs.
 */
export function parseWithContract<T>(schema: z.ZodType<T>, value: unknown, context: string): T {
  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }
  const issues = toContractIssues(result.error);
  const summary = issues
    .slice(0, 3)
    .map((issue) => `${issue.path}: ${issue.message}`)
    .join('; ');
  const suffix = issues.length > 3 ? `; +${issues.length - 3} more` : '';
  throw new DeepIdContractError(`${context}: ${summary}${suffix}`, issues);
}
