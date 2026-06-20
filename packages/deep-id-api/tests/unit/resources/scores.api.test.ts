import { describe, expect, it } from 'vitest';
import { postScores } from '../../../src/resources/scores/api.js';
import { createMockRequester } from '../../utils/mock-helpers.js';

describe('postScores', () => {
  it('POSTs to /v1/clients/scores with the score map as the JSON body', async () => {
    const requester = createMockRequester();
    requester.mockRequest.mockResolvedValue({
      statusCode: 200,
      headers: {},
      data: { status: { ok: 1, failed: 0 }, results: {} },
    });

    const scores = {
      'did:plc:abc123abc123abc123abc123': {
        score: 70,
        type: 'contribution_score' as const,
        timestamp: '2026-06-12T10:00:00Z',
      },
    };
    const result = await postScores(requester, scores);

    expect(result.status.ok).toBe(1);
    expect(requester.mockRequest).toHaveBeenCalledWith('POST', '/v1/clients/scores', {
      body: JSON.stringify(scores),
      contentType: 'application/json',
    });
  });
});
