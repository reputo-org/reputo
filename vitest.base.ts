import { defineConfig } from 'vitest/config';

type VitestConfig = Awaited<Exclude<Parameters<typeof defineConfig>[0], (...args: never[]) => unknown>>;
type VitestTestConfig = NonNullable<VitestConfig['test']>;

const sharedCoverageExcludes = [
  '**/coverage/**',
  '**/dist/**',
  '**/node_modules/**',
  '**/.next/**',
  '**/*.d.ts',
  '**/index.ts',
  '**/index.gen.ts',
  '**/*.module.ts',
  '**/dto/**',
  '**/dtos/**',
  '**/entities/**',
  '**/types/**',
  '**/types.ts',
  '**/schemas/index.ts',
  '**/migrations/**',
  '**/vitest.config*.ts',
  '**/tests/**',
  'vitest.base.ts',
];

export function extendCoverageExcludes(extraExcludes: string[] = []): string[] {
  return [...new Set([...sharedCoverageExcludes, ...extraExcludes])];
}

const DEFAULT_INCLUDE = ['tests/**/*.test.ts', 'tests/**/*.test.tsx'];

const DEFAULT_TEST_TIMEOUT_MS = 15_000;
const DEFAULT_HOOK_TIMEOUT_MS = 60_000;

interface SharedVitestConfigOptions {
  name?: string;
  include?: string[];
  coverageInclude?: string[];
  coverageExclude?: string[];
  environment?: 'node' | 'jsdom';
  setupFiles?: string[];
  globalSetup?: string[];
  testTimeout?: number;
  hookTimeout?: number;
  poolOptions?: VitestTestConfig['poolOptions'];
  isolate?: boolean;
  fileParallelism?: boolean;
  resolve?: VitestConfig['resolve'];
  plugins?: VitestConfig['plugins'];
}

export function createVitestConfig({
  name,
  include = DEFAULT_INCLUDE,
  coverageInclude = ['src/**/*.ts', 'src/**/*.tsx'],
  coverageExclude = [],
  environment = 'node',
  setupFiles,
  globalSetup,
  testTimeout = DEFAULT_TEST_TIMEOUT_MS,
  hookTimeout = DEFAULT_HOOK_TIMEOUT_MS,
  poolOptions,
  isolate,
  fileParallelism,
  resolve,
  plugins,
}: SharedVitestConfigOptions = {}) {
  return defineConfig({
    plugins,
    resolve,
    test: {
      name,
      globals: true,
      environment,
      include,
      setupFiles,
      globalSetup,
      testTimeout,
      hookTimeout,
      poolOptions,
      isolate,
      fileParallelism,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html', 'lcov'],
        all: true,
        include: coverageInclude,
        exclude: extendCoverageExcludes(coverageExclude),
      },
    },
  });
}
