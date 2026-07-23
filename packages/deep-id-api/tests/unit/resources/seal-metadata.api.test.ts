import { describe, expect, it } from 'vitest';
import { getSealMetadata, resolveSealMetadataUrl } from '../../../src/resources/seal-metadata/api.js';
import { DeepIdContractError } from '../../../src/shared/errors/index.js';
import { createMockRequester, TEST_CONFIG } from '../../utils/mock-helpers.js';

const APP_ORIGIN = 'https://app.test.deep-id.ai';
const METADATA_PATH = '/v1/.well-known/seal-metadata/1c9e4a2f-7b0d-4f4e-9a2b-3c5d6e7f8a9b';

const VALID_METADATA = {
  id: '1c9e4a2f-7b0d-4f4e-9a2b-3c5d6e7f8a9b',
  schemeType: 'ckks',
  securityLevel: 128,
  polyModulusDegree: 8192,
  coeffModulusBitSizes: [60, 40, 60],
  scale: 2 ** 40,
  encryptionParameters: 'c2VyaWFsaXplZC1wYXJhbXM=',
};

function metadataResponse(data: unknown, statusCode = 200) {
  return { statusCode, headers: {}, data };
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

describe('resolveSealMetadataUrl', () => {
  it('resolves a relative URL against the app origin and keeps the query string', () => {
    expect(resolveSealMetadataUrl(TEST_CONFIG.appBaseUrl, METADATA_PATH).toString()).toBe(
      `${APP_ORIGIN}${METADATA_PATH}`,
    );
    expect(resolveSealMetadataUrl(TEST_CONFIG.appBaseUrl, '/v1/meta?version=2').toString()).toBe(
      `${APP_ORIGIN}/v1/meta?version=2`,
    );
  });

  it('accepts an absolute URL on the app origin', () => {
    expect(resolveSealMetadataUrl(TEST_CONFIG.appBaseUrl, `${APP_ORIGIN}${METADATA_PATH}`).toString()).toBe(
      `${APP_ORIGIN}${METADATA_PATH}`,
    );
  });

  it('rejects an absolute URL on another origin', () => {
    expect(() => resolveSealMetadataUrl(TEST_CONFIG.appBaseUrl, 'https://evil.example/meta')).toThrow(
      DeepIdContractError,
    );
  });

  it('rejects a protocol-relative URL on another host', () => {
    expect(() => resolveSealMetadataUrl(TEST_CONFIG.appBaseUrl, '//evil.example/meta')).toThrow(DeepIdContractError);
  });

  it('rejects a non-HTTP scheme', () => {
    expect(() => resolveSealMetadataUrl(TEST_CONFIG.appBaseUrl, 'javascript:alert(1)')).toThrow(DeepIdContractError);
  });

  it('rejects an empty or blank URL', () => {
    expect(() => resolveSealMetadataUrl(TEST_CONFIG.appBaseUrl, '')).toThrow(DeepIdContractError);
    expect(() => resolveSealMetadataUrl(TEST_CONFIG.appBaseUrl, '   ')).toThrow(DeepIdContractError);
  });
});

describe('getSealMetadata', () => {
  it('GETs the resolved metadata URL and returns the validated document', async () => {
    const requester = createMockRequester();
    requester.mockRequest.mockResolvedValue(metadataResponse({ ...VALID_METADATA, extra: 'ignored' }));

    const metadata = await getSealMetadata(requester, METADATA_PATH);

    expect(requester.mockRequest).toHaveBeenCalledWith('GET', `${APP_ORIGIN}${METADATA_PATH}`);
    expect(metadata).toEqual(VALID_METADATA);
    expect(metadata.scale).toBe(2 ** 40);
  });

  it('rejects an off-origin URL without sending any request', async () => {
    const requester = createMockRequester();

    await expect(getSealMetadata(requester, 'https://evil.example/meta')).rejects.toBeInstanceOf(DeepIdContractError);
    expect(requester.mockRequest).not.toHaveBeenCalled();
  });

  it('rejects a redirect instead of following it', async () => {
    const requester = createMockRequester();
    requester.mockRequest.mockResolvedValue({
      statusCode: 302,
      headers: { location: 'https://evil.example/meta' },
      data: undefined,
    });

    await expect(getSealMetadata(requester, METADATA_PATH)).rejects.toThrow(/redirected/);
  });

  it('rejects an unexpected non-200 success status', async () => {
    const requester = createMockRequester();
    requester.mockRequest.mockResolvedValue(metadataResponse(undefined, 204));

    await expect(getSealMetadata(requester, METADATA_PATH)).rejects.toThrow(/unexpected HTTP 204/);
  });

  it('rejects a missing or empty document', async () => {
    const requester = createMockRequester();
    requester.mockRequest.mockResolvedValue(metadataResponse(undefined));

    await expect(getSealMetadata(requester, METADATA_PATH)).rejects.toBeInstanceOf(DeepIdContractError);
  });

  it('rejects an unsupported scheme type', async () => {
    const requester = createMockRequester();
    requester.mockRequest.mockResolvedValue(metadataResponse({ ...VALID_METADATA, schemeType: 'bfv' }));

    const error = await captureError(() => getSealMetadata(requester, METADATA_PATH));
    expect(error.issues.some((issue) => issue.path === 'schemeType')).toBe(true);
  });

  it('does not coerce a string scale into a number', async () => {
    const requester = createMockRequester();
    requester.mockRequest.mockResolvedValue(metadataResponse({ ...VALID_METADATA, scale: '1099511627776' }));

    const error = await captureError(() => getSealMetadata(requester, METADATA_PATH));
    expect(error.issues.some((issue) => issue.path === 'scale')).toBe(true);
  });

  it('rejects a document with a missing field', async () => {
    const { encryptionParameters: _omitted, ...withoutParameters } = VALID_METADATA;
    const requester = createMockRequester();
    requester.mockRequest.mockResolvedValue(metadataResponse(withoutParameters));

    const error = await captureError(() => getSealMetadata(requester, METADATA_PATH));
    expect(error.issues.some((issue) => issue.path === 'encryptionParameters')).toBe(true);
  });
});
