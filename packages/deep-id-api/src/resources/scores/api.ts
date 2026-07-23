import type { DeepIdRequester } from '../../api/client.js';
import { endpoints } from '../../api/endpoints.js';
import { parseWithContract } from '../../shared/validation/index.js';
import { postScoresRequestSchema, postScoresResponseSchema } from './schemas.js';
import type { PostScoresRequest, PostScoresResponse } from './types.js';

function readRequestId(headers: Record<string, string | string[] | undefined>): string | undefined {
  const header = headers['x-request-id'];
  const value = Array.isArray(header) ? header[0] : header;
  return value && value.length > 0 ? value : undefined;
}

/**
 * Posts scores via `POST /v1/clients/scores`. The entry map is validated
 * before anything is sent (invalid discriminators, mixed `score`/`ciphertext`
 * entries, and non-finite scores throw `DeepIdContractError`) and is
 * serialized exactly as passed — a plaintext `0` stays `0` and the caller's
 * run timestamp is never replaced, so bounded HTTP and Temporal retries of the
 * same map are idempotent on the DeepID side. The call is synchronous and
 * returns `200` even when some users fail — inspect `status.failed` and each
 * per-user `message` in the result.
 */
export async function postScores(requester: DeepIdRequester, scores: PostScoresRequest): Promise<PostScoresResponse> {
  parseWithContract(postScoresRequestSchema, scores, 'invalid POST /v1/clients/scores payload');

  const response = await requester.request<unknown>('POST', endpoints.clientsScores(), {
    body: JSON.stringify(scores),
    contentType: 'application/json',
  });

  const parsed = parseWithContract(
    postScoresResponseSchema,
    response.data,
    'malformed POST /v1/clients/scores response',
  );
  const requestId = readRequestId(response.headers);
  return requestId === undefined ? parsed : { ...parsed, requestId };
}
