import { defineConfig } from 'vitest/config';

type VitestConfig = Awaited<Exclude<Parameters<typeof defineConfig>[0], (...args: never[]) => unknown>>;

const sharedCoverageExcludes = [
  '**/coverage/**',
  '**/dist/**',
  '**/node_modules/**',
  '**/.next/**',
  '**/*.d.ts',
  'src/**/index.ts',
  '**/vitest.config*.ts',
  'vitest.base.ts',
];

export function extendCoverageExcludes(extraExcludes: string[] = []): string[] {
  return [...new Set([...sharedCoverageExcludes, ...extraExcludes])];
}

interface SharedVitestConfigOptions {
  name?: string;
  include?: string[];
  coverageInclude?: string[];
  coverageExclude?: string[];
  environment?: 'node' | 'jsdom';
  setupFiles?: string[];
  testTimeout?: number;
  hookTimeout?: number;
  resolve?: VitestConfig['resolve'];
  plugins?: VitestConfig['plugins'];
}

export function createVitestConfig({
  name,
  include = ['tests/**/*.test.ts'],
  coverageInclude = ['src/**/*.ts'],
  coverageExclude = [],
  environment = 'node',
  setupFiles,
  testTimeout,
  hookTimeout,
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
      testTimeout,
      hookTimeout,
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
