import { describe, expect, it } from 'vitest';
import { iterateUsers } from '../../../src/resources/users/api.js';
import { DEFAULT_CONFIG } from '../../../src/shared/types/api-config.js';
import { createMockRequester } from '../../utils/mock-helpers.js';

const DID = 'did:sub:aaaaaaaaaaaaaaaaaaaaaaaa';

function usersResponse() {
  return { statusCode: 200, headers: {}, data: { [DID]: { scopes: ['api'] } } };
}

function pageSizeOf(call: unknown[]): unknown {
  return (call[2] as { params: Record<string, unknown> }).params.pageSize;
}

describe('iterateUsers page size', () => {
  it('defaults to DeepID’s 100 maximum, which rejects anything larger', async () => {
    expect(DEFAULT_CONFIG.defaultPageSize).toBe(100);

    const requester = createMockRequester({ defaultPageSize: DEFAULT_CONFIG.defaultPageSize });
    requester.mockRequest.mockResolvedValue(usersResponse());

    for await (const _page of iterateUsers(requester)) {
      // drain the single page
    }

    expect(pageSizeOf(requester.mockRequest.mock.calls[0])).toBe(100);
  });

  it('lets the caller override it per call', async () => {
    const requester = createMockRequester();
    requester.mockRequest.mockResolvedValue(usersResponse());

    for await (const _page of iterateUsers(requester, { pageSize: 25 })) {
      // drain the single page
    }

    expect(pageSizeOf(requester.mockRequest.mock.calls[0])).toBe(25);
  });
});
