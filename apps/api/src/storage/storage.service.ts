import type { S3Client } from '@aws-sdk/client-s3';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FileTooLargeError,
  HeadObjectFailedError,
  InvalidContentTypeError,
  ObjectNotFoundError,
  type PresignedDownload,
  type PresignedUpload,
  Storage,
  type StorageMetadata,
} from '@reputo/storage';
import {
  FileTooLargeException,
  HeadObjectFailedException,
  InvalidContentTypeException,
  ObjectNotFoundException,
} from '../shared/exceptions';
import { S3_CLIENT } from './providers';

@Injectable()
export class StorageService {
  private readonly storage: Storage;
  private readonly bucket: string;
  private readonly presignPutTtl: number;
  private readonly presignGetTtl: number;
  private readonly maxSizeBytes: number;
  private readonly contentTypeAllowlist: string[];

  constructor(@Inject(S3_CLIENT) s3Client: S3Client, configService: ConfigService) {
    this.storage = new Storage(s3Client);

    this.bucket = configService.get<string>('storage.bucket') as string;
    this.presignPutTtl = configService.get<number>('storage.presignPutTtl') as number;
    this.presignGetTtl = configService.get<number>('storage.presignGetTtl') as number;
    this.maxSizeBytes = configService.get<number>('storage.maxSizeBytes') as number;
    this.contentTypeAllowlist = (configService.get<string>('storage.contentTypeAllowlist') as string)
      .split(',')
      .map((s) => s.trim());
  }

  async presignPut(filename: string, contentType: string): Promise<PresignedUpload> {
    try {
      return await this.storage.presignPut({
        bucket: this.bucket,
        filename,
        contentType,
        ttl: this.presignPutTtl,
        maxSizeBytes: this.maxSizeBytes,
        contentTypeAllowlist: this.contentTypeAllowlist,
      });
    } catch (error) {
      this.handleStorageError(error);
    }
  }

  async verify(key: string): Promise<{ key: string; metadata: StorageMetadata }> {
    try {
      return await this.storage.verify({
        bucket: this.bucket,
        key,
        maxSizeBytes: this.maxSizeBytes,
        contentTypeAllowlist: this.contentTypeAllowlist,
      });
    } catch (error) {
      this.handleStorageError(error);
    }
  }

  verifyUpload(key: string): Promise<{ key: string; metadata: StorageMetadata }> {
    return this.verify(key);
  }

  async presignGet(key: string): Promise<PresignedDownload> {
    try {
      return await this.storage.presignGet({
        bucket: this.bucket,
        key,
        ttl: this.presignGetTtl,
      });
    } catch (error) {
      this.handleStorageError(error);
    }
  }

  async getObjectMetadata(key: string): Promise<StorageMetadata> {
    try {
      const result = await this.storage.verify({
        bucket: this.bucket,
        key,
        maxSizeBytes: this.maxSizeBytes,
        contentTypeAllowlist: this.contentTypeAllowlist,
      });
      return result.metadata;
    } catch (error) {
      this.handleStorageError(error);
    }
  }

  async getObject(key: string): Promise<Buffer> {
    try {
      return await this.storage.getObject({
        bucket: this.bucket,
        key,
      });
    } catch (error) {
      this.handleStorageError(error);
    }
  }

  async deleteObject(key: string): Promise<void> {
    try {
      await this.storage.deleteObject({
        bucket: this.bucket,
        key,
      });
    } catch (error) {
      this.handleStorageError(error);
    }
  }

  async listObjectsByPrefix(prefix: string): Promise<string[]> {
    try {
      return await this.storage.listObjectsByPrefix({
        bucket: this.bucket,
        prefix,
      });
    } catch (error) {
      this.handleStorageError(error);
    }
  }

  async deleteObjects(keys: string[]): Promise<{ deleted: string[]; errors: Array<{ key: string; message: string }> }> {
    try {
      return await this.storage.deleteObjects({
        bucket: this.bucket,
        keys,
      });
    } catch (error) {
      this.handleStorageError(error);
    }
  }

  private handleStorageError(error: unknown): never {
    if (error instanceof FileTooLargeError) {
      throw new FileTooLargeException(error.maxSizeBytes);
    }
    if (error instanceof InvalidContentTypeError) {
      throw new InvalidContentTypeException(error.contentType, error.allowedTypes);
    }
    if (error instanceof ObjectNotFoundError) {
      throw new ObjectNotFoundException();
    }
    if (error instanceof HeadObjectFailedError) {
      throw new HeadObjectFailedException();
    }
    throw error;
  }
}
