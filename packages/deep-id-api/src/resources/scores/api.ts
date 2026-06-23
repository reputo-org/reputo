import type { DeepIdRequester } from '../../api/client.js';
import { endpoints } from '../../api/endpoints.js';
import type { PostScoresRequest, PostScoresResponse } from './types.js';

/**
 * Posts scores via `POST /v1/clients/scores`. The call is synchronous and
 * returns `200` even when some users fail — inspect `status.failed` and each
 * per-user `message` in the result.
 */
export async function postScores(requester: DeepIdRequester, scores: PostScoresRequest): Promise<PostScoresResponse> {
  const response = await requester.request<PostScoresResponse>('POST', endpoints.clientsScores(), {
    body: JSON.stringify(scores),
    contentType: 'application/json',
  });
  return response.data;
}
