import { afterAll, beforeAll } from 'vitest';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
});

afterAll(() => {});
