import { describe, expect, it } from 'vitest';
import { postScores } from '../../../src/resources/scores/api.js';
import type { PostScoresRequest } from '../../../src/resources/scores/types.js';
import { DeepIdContractError } from '../../../src/shared/errors/index.js';
import { createMockRequester } from '../../utils/mock-helpers.js';

const TS = '2026-06-12T10:00:00Z';
const DID_A = 'did:plc:abc123abc123abc123abc123';
const DID_B = 'did:sub:abc123abc123abc123abc123';
const CIPHERTEXT = 'c2VyaWFsaXplZC1ja2tzLXJlc3VsdA==';

function okResponse(
  overrides: Partial<{ headers: Record<string, string | string[]>; data: unknown; ok: number }> = {},
) {
  return {
    statusCode: 200,
    headers: overrides.headers ?? {},
    data: overrides.data ?? { status: { ok: overrides.ok ?? 1, failed: 0 }, results: {} },
  };
}

async function captureError(run: () => Promise<unknown>): Promise<DeepIdContractError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(DeepIdContractError);
    return error as DeepIdContractError;
  }
  throw new Error('expected the call to reject');
}

describe('postScores', () => {
  it('POSTs to /v1/clients/scores with the score map as the JSON body', async () => {
    const requester = createMockRequester();
    requester.mockRequest.mockResolvedValue(okResponse());

    const scores: PostScoresRequest = { [DID_A]: { score: 70, type: 'contribution_score', timestamp: TS } };
    const result = await postScores(requester, scores);

    expect(result.status.ok).toBe(1);
    expect(requester.mockRequest).toHaveBeenCalledWith('POST', '/v1/clients/scores', {
      body: JSON.stringify(scores),
      contentType: 'application/json',
    });
  });

  it('keeps a plaintext zero score in the serialized body', async () => {
    const requester = createMockRequester();
    requester.mockRequest.mockResolvedValue(okResponse());

    const scores: PostScoresRequest = { [DID_A]: { score: 0, type: 'proposal_engagement', timestamp: TS } };
    await postScores(requester, scores);

    const body = String((requester.mockRequest.mock.calls[0][2] as { body: string }).body);
    expect(body).toBe(JSON.stringify(scores));
    expect(body).toContain('"score":0');
  });

  it('accepts negative and fractional plaintext scores', async () => {
    const requester = createMockRequester();
    requester.mockRequest.mockResolvedValue(okResponse());

    await expect(
      postScores(requester, { [DID_A]: { score: -12.5, type: 'token_value_over_time', timestamp: TS } }),
    ).resolves.toBeDefined();
  });

  it('serializes an encrypted final entry exactly as passed', async () => {
    const requester = createMockRequester();
    requester.mockRequest.mockResolvedValue(okResponse());

    const scores: PostScoresRequest = {
      [DID_B]: { ciphertext: CIPHERTEXT, keyId: 'key-1', type: 'custom_score_encr', timestamp: TS },
    };
    await postScores(requester, scores);

    const body = String((requester.mockRequest.mock.calls[0][2] as { body: string }).body);
    expect(body).toBe(JSON.stringify(scores));
  });

  it('posts plaintext and encrypted entries in one map with one fixed run timestamp', async () => {
    const requester = createMockRequester();
    requester.mockRequest.mockResolvedValue(okResponse({ ok: 2 }));

    const scores: PostScoresRequest = {
      [DID_A]: { score: 0, type: 'voting_engagement', timestamp: TS },
      [DID_B]: { ciphertext: CIPHERTEXT, keyId: 'key-1', type: 'custom_score_encr', timestamp: TS },
    };
    await postScores(requester, scores);

    const body = String((requester.mockRequest.mock.calls[0][2] as { body: string }).body);
    const sent = JSON.parse(body) as PostScoresRequest;
    expect(sent).toEqual(scores);
    expect(Object.values(sent).map((entry) => entry.timestamp)).toEqual([TS, TS]);
  });

  it('exposes the x-request-id response header as requestId', async () => {
    const requester = createMockRequester();
    requester.mockRequest.mockResolvedValue(okResponse({ headers: { 'x-request-id': 'req-123' } }));

    const result = await postScores(requester, { [DID_A]: { score: 1, type: 'custom_score', timestamp: TS } });
    expect(result.requestId).toBe('req-123');
  });

  it('leaves requestId undefined when the header is absent', async () => {
    const requester = createMockRequester();
    requester.mockRequest.mockResolvedValue(okResponse());

    const result = await postScores(requester, { [DID_A]: { score: 1, type: 'custom_score', timestamp: TS } });
    expect(result.requestId).toBeUndefined();
  });

  it('returns typed per-DID OK and error results', async () => {
    const requester = createMockRequester();
    requester.mockRequest.mockResolvedValue(
      okResponse({
        data: {
          status: { ok: 1, failed: 1 },
          results: { [DID_A]: { message: 'OK' }, [DID_B]: { message: 'User not found' } },
        },
      }),
    );

    const result = await postScores(requester, {
      [DID_A]: { score: 1, type: 'voting_engagement', timestamp: TS },
    });
    expect(result.results[DID_A].message).toBe('OK');
    expect(result.results[DID_B].message).toBe('User not found');
  });
});

describe('postScores payload validation', () => {
  it('rejects a plaintext entry that also carries a ciphertext, without sending anything', async () => {
    const requester = createMockRequester();

    const error = await captureError(() =>
      postScores(requester, {
        [DID_A]: { score: 1, ciphertext: CIPHERTEXT, type: 'voting_engagement', timestamp: TS },
      } as unknown as PostScoresRequest),
    );
    expect(requester.mockRequest).not.toHaveBeenCalled();
    expect(error.message).not.toContain(CIPHERTEXT);
  });

  it('rejects an encrypted entry that also carries a score', async () => {
    const requester = createMockRequester();

    await expect(
      postScores(requester, {
        [DID_B]: { ciphertext: CIPHERTEXT, keyId: 'key-1', score: 5, type: 'custom_score_encr', timestamp: TS },
      } as unknown as PostScoresRequest),
    ).rejects.toBeInstanceOf(DeepIdContractError);
    expect(requester.mockRequest).not.toHaveBeenCalled();
  });

  it('rejects an unknown or missing type discriminator', async () => {
    const requester = createMockRequester();

    await expect(
      postScores(requester, {
        [DID_A]: { score: 1, type: 'bogus_type', timestamp: TS },
      } as unknown as PostScoresRequest),
    ).rejects.toBeInstanceOf(DeepIdContractError);
    await expect(
      postScores(requester, { [DID_A]: { score: 1, timestamp: TS } } as unknown as PostScoresRequest),
    ).rejects.toBeInstanceOf(DeepIdContractError);
  });

  it('rejects non-finite scores', async () => {
    const requester = createMockRequester();

    await expect(
      postScores(requester, { [DID_A]: { score: Number.NaN, type: 'custom_score', timestamp: TS } }),
    ).rejects.toBeInstanceOf(DeepIdContractError);
    await expect(
      postScores(requester, { [DID_A]: { score: Number.POSITIVE_INFINITY, type: 'custom_score', timestamp: TS } }),
    ).rejects.toBeInstanceOf(DeepIdContractError);
  });

  it('rejects an encrypted entry with an empty ciphertext or keyId', async () => {
    const requester = createMockRequester();

    await expect(
      postScores(requester, { [DID_B]: { ciphertext: '', keyId: 'key-1', type: 'custom_score_encr', timestamp: TS } }),
    ).rejects.toBeInstanceOf(DeepIdContractError);
    await expect(
      postScores(requester, {
        [DID_B]: { ciphertext: CIPHERTEXT, keyId: '', type: 'custom_score_encr', timestamp: TS },
      }),
    ).rejects.toBeInstanceOf(DeepIdContractError);
  });

  it('rejects a non-ISO or zone-less timestamp', async () => {
    const requester = createMockRequester();

    await expect(
      postScores(requester, { [DID_A]: { score: 1, type: 'custom_score', timestamp: 'yesterday' } }),
    ).rejects.toBeInstanceOf(DeepIdContractError);
    await expect(
      postScores(requester, { [DID_A]: { score: 1, type: 'custom_score', timestamp: '2026-06-12T10:00:00' } }),
    ).rejects.toBeInstanceOf(DeepIdContractError);
  });
});

describe('postScores response validation', () => {
  it('throws DeepIdContractError for a malformed response body', async () => {
    const requester = createMockRequester();
    requester.mockRequest.mockResolvedValue(okResponse({ data: { status: { ok: 1 } } }));

    await expect(postScores(requester, { [DID_A]: { score: 1, type: 'custom_score', timestamp: TS } })).rejects.toThrow(
      /malformed POST \/v1\/clients\/scores response/,
    );
  });
});
