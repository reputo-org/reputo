import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DownloadDto, UploadDto, VerifyUploadDto } from '../../../src/storage/dto';
import { StorageController } from '../../../src/storage/storage.controller';
import { StorageService } from '../../../src/storage/storage.service';

describe('StorageController', () => {
  let controller: StorageController;
  let mockService: StorageService;

  beforeEach(() => {
    vi.clearAllMocks();

    mockService = {
      presignPut: vi.fn(),
      verifyUpload: vi.fn(),
      presignGet: vi.fn(),
    } as unknown as StorageService;

    controller = new StorageController(mockService);
  });

  describe('upload', () => {
    it('should delegate to service.presignPut with the provided DTO', async () => {
      const uploadDto: UploadDto = {
        filename: 'votes.csv',
        contentType: 'text/csv',
      };

      const mockPresignedUpload = {
        key: 'uploads/1699123456/votes.csv',
        url: 'https://s3.amazonaws.com/presigned-url',
        expiresIn: 3600,
      };

      mockService.presignPut = vi.fn().mockResolvedValue(mockPresignedUpload);

      const result = await controller.upload(uploadDto);

      expect(mockService.presignPut).toHaveBeenCalledOnce();
      expect(mockService.presignPut).toHaveBeenCalledWith(uploadDto.filename, uploadDto.contentType);
      expect(result).toBe(mockPresignedUpload);
    });

    it('should handle text/plain content type', async () => {
      const uploadDto: UploadDto = {
        filename: 'notes.txt',
        contentType: 'text/plain',
      };

      const mockPresignedUpload = {
        key: 'uploads/1699123457/notes.txt',
        url: 'https://s3.amazonaws.com/presigned-url',
        expiresIn: 3600,
      };

      mockService.presignPut = vi.fn().mockResolvedValue(mockPresignedUpload);

      const result = await controller.upload(uploadDto);

      expect(mockService.presignPut).toHaveBeenCalledWith('notes.txt', 'text/plain');
      expect(result).toBe(mockPresignedUpload);
    });
  });

  describe('verifyUpload', () => {
    it('should delegate to service.verifyUpload with the provided DTO', async () => {
      const verifyDto: VerifyUploadDto = {
        key: 'uploads/1699123456/votes.csv',
      };

      const mockMetadata = {
        key: verifyDto.key,
        metadata: {
          filename: 'votes.csv',
          ext: 'csv',
          size: 1024,
          contentType: 'text/csv',
          timestamp: 1699123456,
        },
      };

      mockService.verifyUpload = vi.fn().mockResolvedValue(mockMetadata);

      const result = await controller.verifyUpload(verifyDto);

      expect(mockService.verifyUpload).toHaveBeenCalledOnce();
      expect(mockService.verifyUpload).toHaveBeenCalledWith(verifyDto.key);
      expect(result).toBe(mockMetadata);
    });

    it('should handle different file keys', async () => {
      const verifyDto: VerifyUploadDto = {
        key: 'uploads/1699123457/different-file.txt',
      };

      const mockMetadata = {
        key: verifyDto.key,
        metadata: {
          filename: 'different-file.txt',
          ext: 'txt',
          size: 2048,
          contentType: 'text/plain',
          timestamp: 1699123457,
        },
      };

      mockService.verifyUpload = vi.fn().mockResolvedValue(mockMetadata);

      const result = await controller.verifyUpload(verifyDto);

      expect(mockService.verifyUpload).toHaveBeenCalledWith('uploads/1699123457/different-file.txt');
      expect(result).toBe(mockMetadata);
    });
  });

  describe('signDownload', () => {
    it('should delegate to service.presignGet with the provided DTO', async () => {
      const downloadDto: DownloadDto = {
        key: 'uploads/1699123456/votes.csv',
      };

      const mockPresignedDownload = {
        url: 'https://s3.amazonaws.com/presigned-download-url',
        expiresIn: 900,
        metadata: {
          filename: 'votes.csv',
          ext: 'csv',
          size: 1024,
          contentType: 'text/csv',
          timestamp: 1699123456,
        },
      };

      mockService.presignGet = vi.fn().mockResolvedValue(mockPresignedDownload);

      const result = await controller.download(downloadDto);

      expect(mockService.presignGet).toHaveBeenCalledOnce();
      expect(mockService.presignGet).toHaveBeenCalledWith(downloadDto.key);
      expect(result).toBe(mockPresignedDownload);
    });

    it('should handle different file keys', async () => {
      const downloadDto: DownloadDto = {
        key: 'uploads/1699123458/archived-file.csv',
      };

      const mockPresignedDownload = {
        url: 'https://s3.amazonaws.com/presigned-download-url-2',
        expiresIn: 900,
        metadata: {
          filename: 'archived-file.csv',
          ext: 'csv',
          size: 4096,
          contentType: 'text/csv',
          timestamp: 1699123458,
        },
      };

      mockService.presignGet = vi.fn().mockResolvedValue(mockPresignedDownload);

      const result = await controller.download(downloadDto);

      expect(mockService.presignGet).toHaveBeenCalledWith('uploads/1699123458/archived-file.csv');
      expect(result).toBe(mockPresignedDownload);
    });
  });
});
