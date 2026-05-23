import { randomUUID } from 'node:crypto';

// Random UUID v7-shaped string for negative-path tests. `crypto.randomUUID()`
// generates UUID v4 (`4XXX` in position 13). Flipping the version nibble to
// `7` keeps the variant byte and overall format valid, which is all
// `ParseUUIDPipe({ version: '7' })` checks before reaching the database.
export function randomUUIDv7(): string {
  const u = randomUUID();
  return `${u.slice(0, 14)}7${u.slice(15)}`;
}
