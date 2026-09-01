import { BadRequestException, NotFoundException } from '@nestjs/common';
import { validateAlgorithmPreset } from '@reputo/algorithm-validator';
import {
  type AlgorithmDefinition,
  type CsvIoItem,
  getAlgorithmDefinition,
  type JsonIoItem,
} from '@reputo/reputation-algorithms';
import type { StorageMetadata } from '@reputo/storage';
import type { StorageService } from '../../storage/storage.service';
import { StorageInputValidationException } from '../exceptions';

export interface AlgorithmInputValue {
  key: string;
  value?: unknown;
}

/**
 * Community-input checks that need live data (connection rows, platform
 * resource listings). Injected by callers so this util stays free of module
 * dependencies; runs only after the shared validator accepted the payload.
 */
export interface CommunityInputValidation {
  validate(
    definition: AlgorithmDefinition,
    inputs: ReadonlyArray<AlgorithmInputValue>,
  ): Promise<Array<{ field: string; message: string }>>;
}

function getStorageInputFileLabel(input: CsvIoItem | JsonIoItem): string {
  return input.label ?? input.key;
}

function isCsvMetadata(metadata: StorageMetadata): boolean {
  const normalizedContentType = metadata.contentType.toLowerCase();
  if (normalizedContentType === 'application/json') {
    return false;
  }
  return (
    metadata.ext.toLowerCase() === 'csv' ||
    normalizedContentType === 'text/csv' ||
    normalizedContentType === 'text/plain'
  );
}

function isJsonMetadata(metadata: StorageMetadata): boolean {
  const normalizedContentType = metadata.contentType.toLowerCase();
  if (normalizedContentType === 'text/csv') {
    return false;
  }
  return metadata.ext.toLowerCase() === 'json' || normalizedContentType === 'application/json';
}

function validateStorageMetadata(
  metadata: StorageMetadata,
  input: CsvIoItem | JsonIoItem,
  storageMaxSizeBytes: number,
  storageContentTypeAllowlist: string,
): string[] {
  const errors: string[] = [];
  const allowedTypes = storageContentTypeAllowlist.split(',').map((type) => type.trim());
  const label = getStorageInputFileLabel(input);

  if (!allowedTypes.includes(metadata.contentType)) {
    errors.push(`Invalid content type: ${metadata.contentType}. Allowed types: ${allowedTypes.join(', ')}`);
  }

  if (metadata.size > storageMaxSizeBytes) {
    errors.push(`File size ${metadata.size} bytes exceeds API limit of ${storageMaxSizeBytes} bytes`);
  }

  if (input.type === 'csv') {
    if (!isCsvMetadata(metadata)) {
      errors.push(`${label} must be a CSV file`);
    }
    if (input.csv.maxBytes !== undefined && metadata.size > input.csv.maxBytes) {
      errors.push(`File size ${metadata.size} bytes exceeds algorithm limit of ${input.csv.maxBytes} bytes`);
    }
  }

  if (input.type === 'json') {
    if (!isJsonMetadata(metadata)) {
      errors.push(`${label} must be a JSON file`);
    }
    if (input.json?.maxBytes !== undefined && metadata.size > input.json.maxBytes) {
      errors.push(`File size ${metadata.size} bytes exceeds algorithm limit of ${input.json.maxBytes} bytes`);
    }
  }

  return errors;
}

export function getAlgorithmDefinitionOrThrow(key: string, version: string): AlgorithmDefinition {
  try {
    const algorithmDefinition = getAlgorithmDefinition({ key, version });
    return JSON.parse(algorithmDefinition) as AlgorithmDefinition;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) {
      throw new NotFoundException(`Algorithm definition not found: ${key}@${version}`);
    }
    throw error;
  }
}

export function buildAlgorithmPayload(inputs: ReadonlyArray<AlgorithmInputValue>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  for (const input of inputs) {
    payload[input.key] = input.value;
  }

  return payload;
}

export async function validateAlgorithmInputs(params: {
  definition: AlgorithmDefinition;
  inputs: ReadonlyArray<AlgorithmInputValue>;
  storageService: StorageService;
  storageMaxSizeBytes: number;
  storageContentTypeAllowlist: string;
  communityValidation?: CommunityInputValidation;
}): Promise<void> {
  const fileContentCache = new Map<string, Buffer>();

  const validationResult = await validateAlgorithmPreset({
    definition: params.definition,
    preset: {
      key: params.definition.key,
      version: params.definition.version,
      inputs: params.inputs,
    },
    resolveNestedDefinition: async ({ algorithmKey, algorithmVersion }) =>
      getAlgorithmDefinitionOrThrow(algorithmKey, algorithmVersion),
    resolveInputContent: async ({ input, value }) => {
      if (typeof value === 'string' && value.trim() !== '') {
        const cached = fileContentCache.get(value);
        if (cached) {
          return cached;
        }

        const metadata = await params.storageService.getObjectMetadata(value);
        const inputErrors = validateStorageMetadata(
          metadata,
          input,
          params.storageMaxSizeBytes,
          params.storageContentTypeAllowlist,
        );

        if (inputErrors.length > 0) {
          throw new AggregateError(inputErrors.map((message) => new Error(message)));
        }

        const content = await params.storageService.getObject(value);
        fileContentCache.set(value, content);
        return content;
      }

      return value;
    },
  });

  if (validationResult.success) {
    if (params.communityValidation) {
      const communityErrors = await params.communityValidation.validate(params.definition, params.inputs);
      if (communityErrors.length > 0) {
        throw new BadRequestException({
          message: 'Invalid algorithm inputs',
          errors: communityErrors,
        });
      }
    }
    return;
  }

  const storageValidationErrors = new Map<string, string[]>();
  const requestValidationErrors: Array<{ field: string; message: string; code?: string }> = [];

  for (const error of validationResult.errors ?? []) {
    if (error.source === 'file' || error.source === 'rule') {
      const messages = storageValidationErrors.get(error.field) ?? [];
      messages.push(error.message);
      storageValidationErrors.set(error.field, messages);
      continue;
    }

    requestValidationErrors.push({
      field: error.field,
      message: error.message,
      code: error.code,
    });
  }

  if (requestValidationErrors.length > 0) {
    throw new BadRequestException({
      message: 'Invalid algorithm inputs',
      errors: requestValidationErrors,
    });
  }

  if (storageValidationErrors.size > 0) {
    throw new StorageInputValidationException(
      [...storageValidationErrors.entries()].map(([inputKey, errors]) => ({
        inputKey,
        errors,
      })),
    );
  }
}
