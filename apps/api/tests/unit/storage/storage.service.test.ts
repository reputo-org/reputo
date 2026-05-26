import type { S3Client } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FileTooLargeException,
  HeadObjectFailedException,
  InvalidContentTypeException,
  ObjectNotFoundException,
} from '../../../src/shared/exceptions';
import { StorageService } from '../../../src/storage/storage.service';

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(),
  PutObjectCommand: vi.fn(),
  GetObjectCommand: vi.fn(),
  HeadObjectCommand: vi.fn(),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(),
}));

describe('StorageService', () => {
  let service: StorageService;
  let mockS3Client: S3Client;
  let mockConfigService: ConfigService;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockS3Client = {
      send: vi.fn(),
    } as unknown as S3Client;

    mockConfigService = {
      get: vi.fn((key: string) => {
        const config: Record<string, string | number> = {
          'storage.bucket': 'test-bucket',
          'storage.presignPutTtl': 3600,
          'storage.presignGetTtl': 900,
          'storage.maxSizeBytes': 10485760,
          'storage.contentTypeAllowlist': 'text/csv,text/plain,application/json',
        };
        return config[key];
      }),
    } as unknown as ConfigService;

    service = new StorageService(mockS3Client, mockConfigService);
  });

  describe('presignPut', () => {
    it('should generate presigned upload URL with valid content type', async () => {
      const filename = 'votes.csv';
      const contentType = 'text/csv';
      const mockUrl = 'https://s3.amazonaws.com/presigned-put-url';

      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
      vi.mocked(getSignedUrl).mockResolvedValue(mockUrl);

      const result = await service.presignPut(filename, contentType);

      expect(result).toHaveProperty('key');
      expect(result).toHaveProperty('url');
      expect(result).toHaveProperty('expiresIn');
      expect(result.url).toBe(mockUrl);
      expect(result.expiresIn).toBe(3600);
      expect(result.key).toMatch(/^uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/votes\.csv$/);
      expect(getSignedUrl).toHaveBeenCalledOnce();
    });

    it('should generate presigned upload URL for text/plain', async () => {
      const filename = 'notes.txt';
      const contentType = 'text/plain';
      const mockUrl = 'https://s3.amazonaws.com/presigned-put-url-txt';

      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
      vi.mocked(getSignedUrl).mockResolvedValue(mockUrl);

      const result = await service.presignPut(filename, contentType);

      expect(result.url).toBe(mockUrl);
      expect(result.expiresIn).toBe(3600);
      expect(result.key).toMatch(/^uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/notes\.txt$/);
    });

    it('should generate presigned upload URL for application/json', async () => {
      const filename = 'wallets.json';
      const contentType = 'application/json';
      const mockUrl = 'https://s3.amazonaws.com/presigned-put-url-json';

      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
      vi.mocked(getSignedUrl).mockResolvedValue(mockUrl);

      const result = await service.presignPut(filename, contentType);

      expect(result.url).toBe(mockUrl);
      expect(result.expiresIn).toBe(3600);
      expect(result.key).toMatch(/^uploads\/[0-9a-f-]+\/wallets\.json$/);
    });

    it('should use filename as-is in key', async () => {
      const filename = 'my file with spaces.csv';
      const contentType = 'text/csv';
      const mockUrl = 'https://s3.amazonaws.com/presigned-put-url';

      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
      vi.mocked(getSignedUrl).mockResolvedValue(mockUrl);

      const result = await service.presignPut(filename, contentType);

      expect(result.key).toMatch(
        /^uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/my file with spaces\.csv$/,
      );
    });

    it('should throw InvalidContentTypeException for disallowed content type', async () => {
      const filename = 'document.pdf';
      const contentType = 'application/pdf';

      const promise = service.presignPut(filename, contentType);

      await expect(promise).rejects.toBeInstanceOf(InvalidContentTypeException);
      await expect(promise).rejects.toThrow(/contentType not allowed/i);
    });

    it('should throw InvalidContentTypeException for empty content type', async () => {
      const filename = 'file.csv';
      const contentType = '';

      const promise = service.presignPut(filename, contentType);

      await expect(promise).rejects.toBeInstanceOf(InvalidContentTypeException);
    });
  });

  describe('verifyUpload', () => {
    it('should return metadata when object exists and is valid', async () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      const key = `uploads/${uuid}/test-file.csv`;
      const mockHeadResponse = {
        ContentLength: 5242880,
        ContentType: 'text/csv',
      };

      mockS3Client.send = vi.fn().mockResolvedValue(mockHeadResponse);

      const result = await service.verifyUpload(key);

      expect(mockS3Client.send).toHaveBeenCalledOnce();
      expect(result.key).toBe(key);
      expect(result.metadata.filename).toBe('test-file.csv');
      expect(result.metadata.ext).toBe('csv');
      expect(result.metadata.size).toBe(5242880);
      expect(result.metadata.contentType).toBe('text/csv');
      expect(result.metadata.timestamp).toBeGreaterThan(0);
    });

    it('should handle text/plain content type', async () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      const key = `uploads/${uuid}/test-file.txt`;
      const mockHeadResponse = {
        ContentLength: 1024,
        ContentType: 'text/plain',
      };

      mockS3Client.send = vi.fn().mockResolvedValue(mockHeadResponse);

      const result = await service.verifyUpload(key);

      expect(result.key).toBe(key);
      expect(result.metadata.filename).toBe('test-file.txt');
      expect(result.metadata.ext).toBe('txt');
      expect(result.metadata.size).toBe(1024);
      expect(result.metadata.contentType).toBe('text/plain');
      expect(result.metadata.timestamp).toBeGreaterThan(0);
    });

    it('should handle application/json content type', async () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      const key = `uploads/${uuid}/wallets.json`;
      const mockHeadResponse = {
        ContentLength: 2048,
        ContentType: 'application/json',
      };

      mockS3Client.send = vi.fn().mockResolvedValue(mockHeadResponse);

      const result = await service.verifyUpload(key);

      expect(result.key).toBe(key);
      expect(result.metadata.filename).toBe('wallets.json');
      expect(result.metadata.ext).toBe('json');
      expect(result.metadata.size).toBe(2048);
      expect(result.metadata.contentType).toBe('application/json');
      expect(result.metadata.timestamp).toBeGreaterThan(0);
    });

    it('should throw ObjectNotFoundException when object does not exist (404)', async () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      const key = `uploads/${uuid}/non-existent.csv`;
      const mockError = {
        name: 'NotFound',
        message: 'Not Found',
        $metadata: {
          httpStatusCode: 404,
        },
      } as Error & {
        name?: string;
        $metadata?: { httpStatusCode?: number };
      };

      mockS3Client.send = vi.fn().mockRejectedValue(mockError);

      const promise = service.verifyUpload(key);

      await expect(promise).rejects.toBeInstanceOf(ObjectNotFoundException);
      await expect(promise).rejects.toThrow(/object not found/i);
    });

    it('should throw ObjectNotFoundException when error name is NotFound', async () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      const key = `uploads/${uuid}/missing.csv`;
      const mockError = {
        name: 'NotFound',
        message: 'The specified key does not exist',
      } as Error & { name?: string };

      mockS3Client.send = vi.fn().mockRejectedValue(mockError);

      const promise = service.verifyUpload(key);

      await expect(promise).rejects.toBeInstanceOf(ObjectNotFoundException);
    });

    it('should throw FileTooLargeException when file exceeds maxSizeBytes', async () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      const key = `uploads/${uuid}/large-file.csv`;
      const mockHeadResponse = {
        ContentLength: 20971520,
        ContentType: 'text/csv',
      };

      mockS3Client.send = vi.fn().mockResolvedValue(mockHeadResponse);

      const promise = service.verifyUpload(key);

      await expect(promise).rejects.toBeInstanceOf(FileTooLargeException);
      await expect(promise).rejects.toThrow(/file too large/i);
    });

    it('should throw InvalidContentTypeException when content type not allowed', async () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      const key = `uploads/${uuid}/file.csv`;
      const mockHeadResponse = {
        ContentLength: 1024,
        ContentType: 'application/pdf',
      };

      mockS3Client.send = vi.fn().mockResolvedValue(mockHeadResponse);

      const promise = service.verifyUpload(key);

      await expect(promise).rejects.toBeInstanceOf(InvalidContentTypeException);
      await expect(promise).rejects.toThrow(/contentType not allowed/i);
    });

    it('should throw HeadObjectFailedException on other S3 errors', async () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      const key = `uploads/${uuid}/error-file.csv`;
      const mockError = {
        name: 'InternalError',
        message: 'Internal Server Error',
        $metadata: {
          httpStatusCode: 500,
        },
      };

      mockS3Client.send = vi.fn().mockRejectedValue(mockError);

      const promise = service.verifyUpload(key);

      await expect(promise).rejects.toBeInstanceOf(HeadObjectFailedException);
      await expect(promise).rejects.toThrow(/Failed to check object metadata/i);
    });

    it('should default to 0 size when ContentLength is undefined', async () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      const key = `uploads/${uuid}/file.csv`;
      const mockHeadResponse = {
        ContentType: 'text/csv',
      };

      mockS3Client.send = vi.fn().mockResolvedValue(mockHeadResponse);

      const result = await service.verifyUpload(key);

      expect(result.metadata.size).toBe(0);
    });

    it('should default to application/octet-stream when ContentType is undefined', async () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      const key = `uploads/${uuid}/file.csv`;
      const mockHeadResponse = {
        ContentLength: 1024,
      };

      mockS3Client.send = vi.fn().mockResolvedValue(mockHeadResponse);

      const promise = service.verifyUpload(key);

      await expect(promise).rejects.toBeInstanceOf(InvalidContentTypeException);
    });
  });

  describe('presignGet', () => {
    it('should generate presigned download URL when object exists', async () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      const key = `uploads/${uuid}/file.csv`;
      const mockHeadResponse = {
        ContentLength: 1024,
        ContentType: 'text/csv',
      };
      const mockUrl = 'https://s3.amazonaws.com/presigned-get-url';

      mockS3Client.send = vi.fn().mockResolvedValue(mockHeadResponse);

      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
      vi.mocked(getSignedUrl).mockResolvedValue(mockUrl);

      const result = await service.presignGet(key);

      expect(mockS3Client.send).toHaveBeenCalledOnce();
      expect(result.url).toBe(mockUrl);
      expect(result.expiresIn).toBe(900);
      expect(result.metadata.filename).toBe('file.csv');
      expect(result.metadata.ext).toBe('csv');
      expect(result.metadata.size).toBe(1024);
      expect(result.metadata.contentType).toBe('text/csv');
      expect(result.metadata.timestamp).toBeGreaterThan(0);
      expect(getSignedUrl).toHaveBeenCalledOnce();
    });

    it('should verify object exists before generating download URL', async () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      const key = `uploads/${uuid}/verified-file.txt`;
      const mockHeadResponse = {
        ContentLength: 2048,
        ContentType: 'text/plain',
      };
      const mockUrl = 'https://s3.amazonaws.com/presigned-get-url-2';

      mockS3Client.send = vi.fn().mockResolvedValue(mockHeadResponse);

      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
      vi.mocked(getSignedUrl).mockResolvedValue(mockUrl);

      const result = await service.presignGet(key);

      expect(result.url).toBe(mockUrl);
      expect(result.expiresIn).toBe(900);
      expect(result.metadata.filename).toBe('verified-file.txt');
      expect(result.metadata.ext).toBe('txt');
      expect(result.metadata.size).toBe(2048);
      expect(result.metadata.contentType).toBe('text/plain');
      expect(result.metadata.timestamp).toBeGreaterThan(0);
    });

    it('should throw ObjectNotFoundException when object does not exist (404)', async () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      const key = `uploads/${uuid}/missing-file.csv`;
      const mockError = {
        name: 'NotFound',
        message: 'Not Found',
        $metadata: {
          httpStatusCode: 404,
        },
      } as Error & {
        name?: string;
        $metadata?: { httpStatusCode?: number };
      };

      mockS3Client.send = vi.fn().mockRejectedValue(mockError);

      const promise = service.presignGet(key);

      await expect(promise).rejects.toBeInstanceOf(ObjectNotFoundException);
      await expect(promise).rejects.toThrow(/object not found/i);
    });

    it('should throw ObjectNotFoundException when error name is NotFound', async () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      const key = `uploads/${uuid}/not-found.csv`;
      const mockError = {
        name: 'NotFound',
      } as Error & { name?: string };

      mockS3Client.send = vi.fn().mockRejectedValue(mockError);

      const promise = service.presignGet(key);

      await expect(promise).rejects.toBeInstanceOf(ObjectNotFoundException);
    });

    it('should throw HeadObjectFailedException on other S3 errors', async () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      const key = `uploads/${uuid}/error-file.csv`;
      const mockError = {
        name: 'ServiceUnavailable',
        message: 'Service is temporarily unavailable',
        $metadata: {
          httpStatusCode: 503,
        },
      };

      mockS3Client.send = vi.fn().mockRejectedValue(mockError);

      const promise = service.presignGet(key);

      await expect(promise).rejects.toBeInstanceOf(HeadObjectFailedException);
      await expect(promise).rejects.toThrow(/Failed to check object metadata/i);
    });

    it('should throw HeadObjectFailedException on network errors', async () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      const key = `uploads/${uuid}/network-error.csv`;
      const mockError = new Error('Network timeout');

      mockS3Client.send = vi.fn().mockRejectedValue(mockError);

      const promise = service.presignGet(key);

      await expect(promise).rejects.toBeInstanceOf(HeadObjectFailedException);
    });
  });
});
