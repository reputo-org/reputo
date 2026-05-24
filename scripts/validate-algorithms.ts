#!/usr/bin/env tsx

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MONOREPO_ROOT = join(__dirname, '..');

const REPUTATION_ALGORITHMS_PATH = join(MONOREPO_ROOT, 'packages', 'reputation-algorithms');
const WORKFLOWS_PATH = join(MONOREPO_ROOT, 'apps', 'workflows');

const REGISTRY_PATH = join(REPUTATION_ALGORITHMS_PATH, 'src', 'registry');
const ALGORITHMS_DIR = join(WORKFLOWS_PATH, 'src', 'activities', 'typescript', 'algorithms');
const ALGORITHMS_INDEX = join(ALGORITHMS_DIR, 'index.ts');
const DISPATCHER_PATH = join(WORKFLOWS_PATH, 'src', 'activities', 'typescript', 'dispatchAlgorithm.activity.ts');

function toKebabCase(key: string): string {
  return key.replace(/_/g, '-');
}

function toPascalCase(key: string): string {
  return key
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

interface AlgorithmDefinitionInfo {
  key: string;
  versions: string[];
  runtime: string | null;
}

interface RegistryDiscoveryResult {
  algorithms: Map<string, AlgorithmDefinitionInfo>;
  jsonErrors: string[];
}

function discoverRegistryAlgorithms(): RegistryDiscoveryResult {
  const algorithms = new Map<string, AlgorithmDefinitionInfo>();
  const jsonErrors: string[] = [];

  if (!existsSync(REGISTRY_PATH)) {
    console.error(`✗ Registry path not found: ${REGISTRY_PATH}`);
    return { algorithms, jsonErrors };
  }

  const entries = readdirSync(REGISTRY_PATH);

  for (const entry of entries) {
    const entryPath = join(REGISTRY_PATH, entry);

    if (!statSync(entryPath).isDirectory()) {
      continue;
    }

    if (entry.startsWith('.') || entry === 'index.gen.ts') {
      continue;
    }

    const versions: string[] = [];
    let runtime: string | null = null;

    const versionFiles = readdirSync(entryPath).filter((f) => f.endsWith('.json'));

    for (const versionFile of versionFiles) {
      const version = versionFile.replace('.json', '');
      const filePath = join(entryPath, versionFile);

      try {
        const content = readFileSync(filePath, 'utf8');
        const definition = JSON.parse(content);

        versions.push(version);

        if (definition.runtime) {
          runtime =
            typeof definition.runtime === 'string' ? definition.runtime : definition.runtime.type || 'typescript';
        }
      } catch (error) {
        const errorMessage =
          error instanceof SyntaxError ? error.message : error instanceof Error ? error.message : String(error);

        jsonErrors.push(`Invalid JSON in ${filePath}: ${errorMessage}`);
      }
    }

    if (versions.length > 0) {
      algorithms.set(entry, {
        key: entry,
        versions: versions.sort(),
        runtime: runtime || 'typescript',
      });
    }
  }

  return { algorithms, jsonErrors };
}

function discoverAlgorithmDirectories(): Set<string> {
  const algorithms = new Set<string>();

  if (!existsSync(ALGORITHMS_DIR)) {
    console.error(`✗ Algorithms directory not found: ${ALGORITHMS_DIR}`);
    return algorithms;
  }

  const entries = readdirSync(ALGORITHMS_DIR);

  for (const entry of entries) {
    const entryPath = join(ALGORITHMS_DIR, entry);

    if (!statSync(entryPath).isDirectory()) {
      continue;
    }

    const computePath = join(entryPath, 'compute.ts');
    if (existsSync(computePath)) {
      algorithms.add(entry);
    }
  }

  return algorithms;
}

function discoverAlgorithmExports(): Set<string> {
  const exports = new Set<string>();

  if (!existsSync(ALGORITHMS_INDEX)) {
    console.error(`✗ Algorithms index not found: ${ALGORITHMS_INDEX}`);
    return exports;
  }

  const content = readFileSync(ALGORITHMS_INDEX, 'utf8');

  const exportPattern = /export\s+\{\s*\w+\s*\}\s+from\s+['"]\.\/([^'"/]+)\/index\.js['"]/g;
  const matches = content.matchAll(exportPattern);

  for (const match of matches) {
    const algorithmDir = match[1];
    if (algorithmDir) {
      exports.add(algorithmDir);
    }
  }

  return exports;
}

function discoverDispatcherRegistry(): Set<string> {
  const registered = new Set<string>();

  if (!existsSync(DISPATCHER_PATH)) {
    console.error(`✗ Dispatcher not found: ${DISPATCHER_PATH}`);
    return registered;
  }

  const content = readFileSync(DISPATCHER_PATH, 'utf8');

  const registryMatch = content.match(/const registry: Record<string, AlgorithmComputeFunction> = \{([^}]*)\}/s);

  if (!registryMatch) {
    console.error('✗ Could not find registry object in dispatcher');
    return registered;
  }

  const registryContent = registryMatch[1];
  const entryPattern = /(\w+)\s*:/g;
  const matches = registryContent.matchAll(entryPattern);

  for (const match of matches) {
    const algorithmKey = match[1];
    if (algorithmKey) {
      registered.add(algorithmKey);
    }
  }

  return registered;
}

interface ValidationReport {
  errors: string[];
  warnings: string[];
  info: string[];
}

function validateAlgorithms(): ValidationReport {
  const report: ValidationReport = {
    errors: [],
    warnings: [],
    info: [],
  };

  const discoveryResult = discoverRegistryAlgorithms();
  const registryAlgorithms = discoveryResult.algorithms;
  const jsonErrors = discoveryResult.jsonErrors;
  const algorithmDirs = discoverAlgorithmDirectories();
  const algorithmExports = discoverAlgorithmExports();
  const dispatcherRegistry = discoverDispatcherRegistry();

  report.errors.push(...jsonErrors);

  report.info.push(`Found ${registryAlgorithms.size} algorithm definition(s) in registry`);
  report.info.push(`Found ${algorithmDirs.size} algorithm directory/directories in workflows`);
  report.info.push(`Found ${algorithmExports.size} algorithm export(s) in index`);
  report.info.push(`Found ${dispatcherRegistry.size} algorithm(s) registered in dispatcher`);

  for (const [key, info] of registryAlgorithms) {
    if (info.runtime !== 'typescript') {
      report.info.push(`Algorithm "${key}" uses runtime "${info.runtime}" - skipping TypeScript validation`);
      continue;
    }

    const kebabName = toKebabCase(key);
    const pascalName = toPascalCase(key);
    const functionName = `compute${pascalName}`;

    if (!algorithmDirs.has(kebabName)) {
      report.errors.push(
        `Missing algorithm implementation for "${key}" (expected: algorithms/${kebabName}/compute.ts)`,
      );
    }

    if (!algorithmExports.has(kebabName)) {
      report.errors.push(`Missing algorithm export for "${key}" (expected export from: ./${kebabName}/index.js)`);
    }

    if (!dispatcherRegistry.has(key)) {
      report.errors.push(`Missing dispatcher registration for "${key}" (expected: ${key}: ${functionName})`);
    }
  }

  for (const algorithmDir of algorithmDirs) {
    const snakeKey = algorithmDir.replace(/-/g, '_');

    const hasDefinition = registryAlgorithms.has(snakeKey);

    if (!hasDefinition) {
      report.warnings.push(`Algorithm directory "${algorithmDir}" has no corresponding algorithm definition`);
    }
  }

  for (const exportDir of algorithmExports) {
    if (!algorithmDirs.has(exportDir)) {
      report.errors.push(`Exported algorithm "${exportDir}" has no corresponding directory`);
    }
  }

  for (const registeredKey of dispatcherRegistry) {
    if (!registryAlgorithms.has(registeredKey)) {
      report.warnings.push(`Registered algorithm "${registeredKey}" has no corresponding algorithm definition`);
    }
  }

  return report;
}

function printReport(report: ValidationReport): void {
  console.log('Algorithm Validation Report');
  console.log('===========================');
  console.log('');

  for (const info of report.info) {
    console.log(`ℹ ${info}`);
  }
  console.log('');

  if (report.errors.length > 0) {
    console.log('Errors:');
    for (const error of report.errors) {
      console.log(`  ✗ ${error}`);
    }
    console.log('');
  }

  if (report.warnings.length > 0) {
    console.log('Warnings:');
    for (const warning of report.warnings) {
      console.log(`  ⚠ ${warning}`);
    }
    console.log('');
  }

  if (report.errors.length === 0 && report.warnings.length === 0) {
    console.log('✅ All algorithms and activities are in sync!');
  } else if (report.errors.length === 0) {
    console.log(`✅ No errors found (${report.warnings.length} warning(s))`);
  } else {
    console.log(`❌ Found ${report.errors.length} error(s) and ${report.warnings.length} warning(s)`);
  }
}

function printUsage(): void {
  console.log('Usage: pnpm algorithm:validate');
  console.log('');
  console.log('Validates that algorithm definitions and activities are in sync.');
  console.log('');
  console.log('This script performs cross-package sync validation:');
  console.log('  - JSON syntax validity of algorithm definition files');
  console.log('  - Every algorithm definition has a corresponding algorithm directory');
  console.log('  - Every algorithm is registered in the dispatcher');
  console.log('  - Every algorithm is exported in the algorithms index');
  console.log('  - Every algorithm directory has a corresponding definition (warning)');
  console.log('');
  console.log('Note: For registry integrity validation (JSON schema, key/version');
  console.log('      matching, duplicates), run: pnpm --filter @reputo/reputation-algorithms registry:validate');
  console.log('');
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  const report = validateAlgorithms();
  printReport(report);

  if (report.errors.length > 0) {
    process.exit(1);
  }
}

main();
