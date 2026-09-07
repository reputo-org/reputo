import { BadRequestException, NotFoundException } from '@nestjs/common';

export function throwInvalidIdError(id: string, entity?: string): never {
  const message = entity ? `The ${entity} ID is not valid: ${id}.` : `The ID is not valid: ${id}.`;
  throw new BadRequestException(message);
}

export function throwNotFoundError(id: string, entity: string): never {
  throw new NotFoundException(`The ${entity} with ID ${id} was not found.`);
}
