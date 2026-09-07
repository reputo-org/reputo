import { BadRequestException } from '@nestjs/common';

export class InvalidIdException extends BadRequestException {
  constructor(id?: string) {
    const message = id ? `The ID is not valid: ${id}.` : 'The ID is not valid.';
    super(message);
  }
}
