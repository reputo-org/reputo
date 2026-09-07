import { BadRequestException, InternalServerErrorException, NotFoundException } from '@nestjs/common';

export class FileTooLargeException extends BadRequestException {
  constructor(maxSizeBytes: number) {
    const message = `The file is too large. The maximum size is ${maxSizeBytes} bytes.`;
    super(message);
  }
}

export class InvalidContentTypeException extends BadRequestException {
  constructor(contentType: string, allowedTypes: readonly string[]) {
    const message = `This file type is not supported: ${contentType}. Supported types: ${allowedTypes.join(', ')}.`;
    super(message);
  }
}

export class ObjectNotFoundException extends NotFoundException {
  constructor() {
    super('The file was not found.');
  }
}

export class HeadObjectFailedException extends InternalServerErrorException {
  constructor() {
    super('Could not check the file. Try again.');
  }
}

/**
 * Structured error for a specific storage input validation failure.
 */
export interface StorageInputValidationError {
  /** The input key from the algorithm definition */
  inputKey: string;
  /** Array of error messages for this input */
  errors: string[];
}

/**
 * Exception thrown when storage-backed algorithm input validation fails.
 * Collects all validation errors across metadata and content validation.
 */
export class StorageInputValidationException extends BadRequestException {
  constructor(errors: StorageInputValidationError[]) {
    super({
      message: 'One or more uploaded files are invalid.',
      errors,
    });
  }
}

/** @deprecated Use StorageInputValidationException instead. */
export class CSVValidationException extends StorageInputValidationException {}
