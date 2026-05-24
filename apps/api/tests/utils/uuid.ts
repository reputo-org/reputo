import { randomUUID } from 'node:crypto';

export function randomUUIDv7(): string {
  const u = randomUUID();
  return `${u.slice(0, 14)}7${u.slice(15)}`;
}
