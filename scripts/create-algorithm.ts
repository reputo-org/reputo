#!/usr/bin/env tsx

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAlgorithmTemplate } from '../packages/reputation-algorithms/src/shared/utils/templates.js';
import { validateKey, validateVersion } from '../packages/reputation-algorithms/src/shared/utils/validation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MONOREPO_ROOT = join(__dirname, '..');

const REPUTATION_ALGORITHMS_PATH = join(MONOREPO_ROOT, 'packages', 'reputation-algorithms');
const WORKFLOWS_PATH = join(MONOREPO_ROOT, 'apps', 'workflows');

function toKebabCase(key: string): string {
  return key.replace(/_/g, '-');
}

function toPascalCase(key: string): string {
  return key
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

interface CreateDefinitionResult {
  filePath: string;
  created: boolean;
}

function createAlgorithmDefinition(key: string, version: string): CreateDefinitionResult {
  const registryPath = join(REPUTATION_ALGORITHMS_PATH, 'src', 'registry');
  const keyDir = join(registryPath, key);
  const filePath = join(keyDir, `${version}.json`);

  if (existsSync(filePath)) {
    throw new Error(`Algorithm definition already exists: ${filePath}`);
  }

  mkdirSync(keyDir, { recursive: true });

  const template = createAlgorithmTemplate(key, version);
  const content = JSON.stringify(template, null, 4);

  writeFileSync(filePath, `${content}\n`, 'utf-8');

  return { filePath, created: true };
}

interface CreateActivityResult {
  algorithmDir: string;
  computeFile: string;
  indexFile: string;
  dispatcherUpdated: boolean;
  algorithmsIndexUpdated: boolean;
}

function generateComputeScaffold(algorithmKey: string): string {
  const pascalName = toPascalCase(algorithmKey);
  const functionName = `compute${pascalName}`;

  return `import { generateKey, type Storage } from '@reputo/storage'
import { Context } from '@temporalio/activity'
import { parse } from 'csv-parse/sync'
import { stringify } from 'csv-stringify/sync'

import config from '../../../../config/index.js'
import type { AlgorithmResult, Snapshot } from '../../../../shared/types/index.js'
import { getInputValue } from '../../../../shared/utils/algorithm-input.utils.js'

/**
 * Computes ${algorithmKey.replace(/_/g, ' ')} scores.
 *
 * @param snapshot - Snapshot document with algorithm configuration
 * @param storage - Storage client for file operations
 * @returns Algorithm result with output file locations
 */
export async function ${functionName}(
    snapshot: Snapshot,
    storage: Storage
): Promise<AlgorithmResult> {
    const snapshotId = String((snapshot as unknown as { _id: string })._id)
    const {
        key: algorithmKey,
        version: algorithmVersion,
        inputs,
    } = snapshot.algorithmPresetFrozen
    const logger = Context.current().log

    logger.info('Starting ${algorithmKey} algorithm', {
        snapshotId,
        algorithmKey,
        algorithmVersion,
    })

    const { bucket } = config.storage

    // TODO: Get input file location from inputs
    // const inputKey = getInputValue(inputs, 'input_data')
    // logger.debug('Resolved input location', { inputKey })

    // TODO: Download and parse input data
    // const buffer = await storage.getObject({ bucket, key: inputKey })
    // const csvText = buffer.toString('utf8')
    // const rows = parse(csvText, {
    //     columns: true,
    //     skip_empty_lines: true,
    //     trim: true,
    // })

    // TODO: Implement algorithm logic
    const results: Array<{ id: string; score: number }> = []

    logger.info('Computed ${algorithmKey} scores', {
        resultCount: results.length,
    })

    const outputCsv = stringify(results, {
        header: true,
        columns: ['id', 'score'],
    })

    const outputKey = generateKey('snapshot', snapshotId, \`\${algorithmKey}.csv\`)
    await storage.putObject({
        bucket,
        key: outputKey,
        body: outputCsv,
        contentType: 'text/csv',
    })

    logger.info('Uploaded ${algorithmKey} results', { outputKey })

    return {
        outputs: {
            result: outputKey,
        },
    }
}
`;
}

function generateIndexScaffold(algorithmKey: string): string {
  const pascalName = toPascalCase(algorithmKey);
  const functionName = `compute${pascalName}`;

  return `export { ${functionName} } from './compute.js';
`;
}

function updateDispatcher(algorithmKey: string): boolean {
  const dispatcherPath = join(WORKFLOWS_PATH, 'src', 'activities', 'typescript', 'dispatchAlgorithm.activity.ts');

  if (!existsSync(dispatcherPath)) {
    throw new Error(`Dispatcher file not found: ${dispatcherPath}`);
  }

  const content = readFileSync(dispatcherPath, 'utf-8');
  const kebabName = toKebabCase(algorithmKey);
  const pascalName = toPascalCase(algorithmKey);
  const functionName = `compute${pascalName}`;

  if (content.includes(`${algorithmKey}:`)) {
    return false;
  }

  const importLine = `import { ${functionName} } from './algorithms/${kebabName}/compute.js'`;
  const lastImportMatch = content.match(/^import .* from ['"]\.\/algorithms\/.*['"]$/gm);

  let updatedContent: string;
  if (lastImportMatch && lastImportMatch.length > 0) {
    const lastImport = lastImportMatch[lastImportMatch.length - 1];
    updatedContent = content.replace(lastImport, `${lastImport}\n${importLine}`);
  } else {
    const importsEndMatch = content.match(/^import .* from ['"][^'"]+['"]$/gm);
    if (importsEndMatch && importsEndMatch.length > 0) {
      const lastImport = importsEndMatch[importsEndMatch.length - 1];
      updatedContent = content.replace(lastImport, `${lastImport}\n${importLine}`);
    } else {
      throw new Error('Could not find import statements in dispatcher');
    }
  }

  const registryMatch = updatedContent.match(/const registry: Record<string, AlgorithmComputeFunction> = \{([^}]*)\}/);
  if (!registryMatch) {
    throw new Error('Could not find registry object in dispatcher');
  }

  const registryContent = registryMatch[1];
  const entries = registryContent
    .trim()
    .split(',')
    .filter((e) => e.trim());
  const lastEntry = entries[entries.length - 1];

  if (lastEntry) {
    const newEntry = `    ${algorithmKey}: ${functionName},`;
    updatedContent = updatedContent.replace(
      registryMatch[0],
      registryMatch[0].replace(lastEntry, `${lastEntry}\n${newEntry}`),
    );
  }

  writeFileSync(dispatcherPath, updatedContent, 'utf-8');
  return true;
}

function updateAlgorithmsIndex(algorithmKey: string): boolean {
  const indexPath = join(WORKFLOWS_PATH, 'src', 'activities', 'typescript', 'algorithms', 'index.ts');

  const kebabName = toKebabCase(algorithmKey);
  const pascalName = toPascalCase(algorithmKey);
  const functionName = `compute${pascalName}`;
  const exportLine = `export { ${functionName} } from './${kebabName}/index.js';`;

  if (!existsSync(indexPath)) {
    writeFileSync(indexPath, `${exportLine}\n`, 'utf-8');
    return true;
  }

  const content = readFileSync(indexPath, 'utf-8');

  if (content.includes(exportLine)) {
    return false;
  }

  const updatedContent = `${content.trimEnd()}\n${exportLine}\n`;
  writeFileSync(indexPath, updatedContent, 'utf-8');
  return true;
}

function createTypescriptActivityScaffold(algorithmKey: string): CreateActivityResult {
  const algorithmsDir = join(WORKFLOWS_PATH, 'src', 'activities', 'typescript', 'algorithms');
  const kebabName = toKebabCase(algorithmKey);
  const algorithmDir = join(algorithmsDir, kebabName);
  const computeFile = join(algorithmDir, 'compute.ts');
  const indexFile = join(algorithmDir, 'index.ts');

  if (existsSync(algorithmDir)) {
    throw new Error(`Algorithm directory already exists: ${algorithmDir}`);
  }

  mkdirSync(algorithmDir, { recursive: true });

  const computeContent = generateComputeScaffold(algorithmKey);
  writeFileSync(computeFile, computeContent, 'utf-8');

  const indexContent = generateIndexScaffold(algorithmKey);
  writeFileSync(indexFile, indexContent, 'utf-8');

  const dispatcherUpdated = updateDispatcher(algorithmKey);

  const algorithmsIndexUpdated = updateAlgorithmsIndex(algorithmKey);

  return {
    algorithmDir,
    computeFile,
    indexFile,
    dispatcherUpdated,
    algorithmsIndexUpdated,
  };
}

interface PreflightResult {
  canProceed: boolean;
  errors: string[];
  warnings: string[];
}

function runPreflightChecks(key: string, version: string): PreflightResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const definitionPath = join(REPUTATION_ALGORITHMS_PATH, 'src', 'registry', key, `${version}.json`);
  if (existsSync(definitionPath)) {
    errors.push(`Algorithm definition already exists: ${definitionPath}`);
  }

  const kebabName = toKebabCase(key);
  const activityPath = join(WORKFLOWS_PATH, 'src', 'activities', 'typescript', 'algorithms', kebabName);
  if (existsSync(activityPath)) {
    errors.push(`Activity directory already exists: ${activityPath}`);
  }

  if (!existsSync(REPUTATION_ALGORITHMS_PATH)) {
    errors.push(`Package not found: ${REPUTATION_ALGORITHMS_PATH}`);
  }

  if (!existsSync(WORKFLOWS_PATH)) {
    errors.push(`Package not found: ${WORKFLOWS_PATH}`);
  }

  return {
    canProceed: errors.length === 0,
    errors,
    warnings,
  };
}

function printUsage(): void {
  console.log('Usage: pnpm algorithm:create <key> <version>');
  console.log('');
  console.log('Creates both an algorithm definition and activity scaffold.');
  console.log('');
  console.log('Arguments:');
  console.log('  key      Algorithm key in snake_case (e.g., voting_engagement)');
  console.log('  version  Semantic version (e.g., 1.0.0)');
  console.log('');
  console.log('Examples:');
  console.log('  pnpm algorithm:create voting_engagement 1.0.0');
  console.log('  pnpm algorithm:create proposal_engagement 2.1.0');
  console.log('  pnpm algorithm:create contribution_score 1.0.0-beta');
  console.log('');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  if (args.length !== 2) {
    console.error('✗ Error: Both key and version are required');
    console.error('');
    printUsage();
    process.exit(1);
  }

  const [key, version] = args;

  if (!key || !version) {
    console.error('✗ Error: Both key and version are required');
    console.error('');
    printUsage();
    process.exit(1);
  }

  const keyValidation = validateKey(key);
  const versionValidation = validateVersion(version);

  const allErrors = [...keyValidation.errors, ...versionValidation.errors];
  if (allErrors.length > 0) {
    console.error('✗ Validation failed:');
    for (const error of allErrors) {
      console.error(`  - ${error}`);
    }
    console.error('');
    console.error('Examples: voting_engagement, proposal_engagement, contribution_score');
    process.exit(1);
  }

  const preflight = runPreflightChecks(key, version);
  if (!preflight.canProceed) {
    console.error('✗ Pre-flight checks failed:');
    for (const error of preflight.errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }

  console.log('Creating algorithm...');
  console.log('');

  try {
    const definitionResult = createAlgorithmDefinition(key, version);
    console.log(`✓ Created algorithm definition:`);
    console.log(`    ${definitionResult.filePath}`);
  } catch (error) {
    console.error(`✗ Failed to create algorithm definition: ${(error as Error).message}`);
    process.exit(1);
  }

  try {
    const activityResult = createTypescriptActivityScaffold(key);
    console.log(`✓ Created activity scaffold:`);
    console.log(`    ${activityResult.computeFile}`);
    console.log(`    ${activityResult.indexFile}`);

    if (activityResult.dispatcherUpdated) {
      console.log(`✓ Updated dispatcher registry`);
    }

    if (activityResult.algorithmsIndexUpdated) {
      console.log(`✓ Updated algorithms index`);
    }
  } catch (error) {
    console.error(`✗ Failed to create activity scaffold: ${(error as Error).message}`);
    process.exit(1);
  }

  console.log('');
  console.log('✅ Algorithm created successfully!');
  console.log('');
  console.log('Next steps:');
  console.log(`  1. Edit the algorithm definition to define inputs/outputs:`);
  console.log(`     packages/reputation-algorithms/src/registry/${key}/${version}.json`);
  console.log('');
  console.log(`  2. Implement the algorithm logic in the activity:`);
  console.log(`     apps/workflows/src/activities/typescript/algorithms/${toKebabCase(key)}/compute.ts`);
  console.log('');
  console.log('  3. Build and validate:');
  console.log('     pnpm --filter @reputo/reputation-algorithms registry:validate');
  console.log('     pnpm --filter @reputo/workflows build');
  console.log('');
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
