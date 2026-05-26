import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020Module from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { ValidationError } from '../errors/index.js';
import type { ValidationErrorDetail, ValidationResult } from '../types/index.js';

type CjsModule<T> = T & { default?: T };
const Ajv2020 = (Ajv2020Module as CjsModule<typeof Ajv2020Module>).default ?? Ajv2020Module;
const addFormats = (addFormatsModule as CjsModule<typeof addFormatsModule>).default ?? addFormatsModule;
type Ajv2020Instance = InstanceType<typeof Ajv2020>;

export function validateKey(key: string): ValidationResult {
  const errors: string[] = [];

  if (!key || key.length < 2) {
    errors.push('Key must be at least 2 characters long');
  }

  const pattern = /^[a-z][a-z0-9_]*$/;
  if (!pattern.test(key)) {
    errors.push(
      'Key must be snake_case, start with a letter, and contain only lowercase letters, numbers, and underscores',
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

export function validateVersion(version: string): ValidationResult {
  const errors: string[] = [];

  if (!version) {
    errors.push('Version is required');
  }

  const pattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/;
  if (!pattern.test(version)) {
    errors.push('Version must be a valid semantic version (e.g., 1.0.0, 2.1.3-beta, 3.0.0+build.123)');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

export interface ParsedSemVer {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: string;
  readonly build: string;
}

function parseSemVer(version: string): ParsedSemVer {
  const regex = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-.]+))?(?:\+([0-9A-Za-z-.]+))?$/;
  const match = version.match(regex);

  if (!match) {
    throw new Error(`Invalid semantic version: ${version}`);
  }

  return {
    major: Number.parseInt(match[1] || '0', 10),
    minor: Number.parseInt(match[2] || '0', 10),
    patch: Number.parseInt(match[3] || '0', 10),
    prerelease: match[4] || '',
    build: match[5] || '',
  };
}

export function compareSemVer(a: string, b: string): number {
  const aParsed = parseSemVer(a);
  const bParsed = parseSemVer(b);

  if (aParsed.major !== bParsed.major) return aParsed.major - bParsed.major;
  if (aParsed.minor !== bParsed.minor) return aParsed.minor - bParsed.minor;
  if (aParsed.patch !== bParsed.patch) return aParsed.patch - bParsed.patch;

  if (aParsed.prerelease && !bParsed.prerelease) return -1;
  if (!aParsed.prerelease && bParsed.prerelease) return 1;

  if (aParsed.prerelease !== bParsed.prerelease) {
    return aParsed.prerelease < bParsed.prerelease ? -1 : 1;
  }

  return 0;
}

const DEFAULT_SCHEMA_PATH = '../schema/algorithm-definition.schema.json';

export class AlgorithmValidator {
  private readonly ajv: Ajv2020Instance;
  private validateAlgorithm: ReturnType<Ajv2020Instance['compile']> | null = null;

  constructor(schema?: Record<string, unknown>) {
    this.ajv = new Ajv2020({
      allErrors: true,
      verbose: true,
      strict: true,
      strictRequired: false,
      allowUnionTypes: true,
      validateFormats: true,
    });

    addFormats(this.ajv);

    if (schema) {
      this.loadSchema(schema);
    }
  }

  loadSchema(schema: Record<string, unknown>): void {
    this.ajv.addSchema(schema, 'algorithm-definition');
    this.validateAlgorithm = this.ajv.compile(schema);
  }

  validate(definition: unknown): {
    isValid: boolean;
    errors: ValidationErrorDetail[];
  } {
    if (!this.validateAlgorithm) {
      throw new Error('Schema not loaded. Call loadSchema() first.');
    }

    const isValid = this.validateAlgorithm(definition);

    if (isValid) {
      return { isValid: true, errors: [] };
    }

    const errors: ValidationErrorDetail[] = (this.validateAlgorithm.errors || []).map(
      (e: { instancePath: string; message?: string; keyword: string; params?: Record<string, unknown> }) => ({
        instancePath: e.instancePath,
        message: e.message || undefined,
        keyword: e.keyword,
        params: e.params || {},
      }),
    );

    return { isValid: false, errors };
  }

  validateAndThrow(definition: unknown, filePath = 'runtime'): unknown {
    const result = this.validate(definition);

    if (!result.isValid) {
      const data = definition as Record<string, unknown>;
      throw new ValidationError(
        filePath,
        result.errors,
        data?.key as string | undefined,
        data?.version as string | undefined,
      );
    }

    return definition;
  }

  getAjv(): Ajv2020Instance {
    return this.ajv;
  }
}

function loadAlgorithmSchema(): Record<string, unknown> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const resolvedPath = join(__dirname, DEFAULT_SCHEMA_PATH);

  try {
    const schemaContent = readFileSync(resolvedPath, 'utf-8');
    return JSON.parse(schemaContent);
  } catch (error) {
    throw new Error(
      `Failed to load schema from ${resolvedPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function createValidatorWithSchema(): AlgorithmValidator {
  const schema = loadAlgorithmSchema();
  return new AlgorithmValidator(schema);
}
