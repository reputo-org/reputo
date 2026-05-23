import { z } from 'zod';

/**
 * Options for {@link generateEnvExample}.
 */
export interface GenerateEnvExampleOptions {
  /** Optional header rendered above the first variable (e.g. `# === auto-generated ===`). */
  header?: string;
  /** Trailing newline appended after the last line. Defaults to `true`. */
  trailingNewline?: boolean;
}

interface UnwrappedField {
  isOptional: boolean;
  defaultValue: unknown;
  description: string | undefined;
}

const WRAPPER_TYPES = new Set(['optional', 'nullable', 'default', 'prefault', 'catch', 'pipe', 'readonly']);

interface ZodInternalDef {
  type?: string;
  innerType?: { _zod?: { def?: ZodInternalDef }; description?: string };
  defaultValue?: unknown;
  // Zod 4 `pipe` uses `in`/`out` for the two sides of the pipeline.
  in?: { _zod?: { def?: ZodInternalDef }; description?: string };
  out?: { _zod?: { def?: ZodInternalDef }; description?: string };
}

interface ZodSchemaInternals {
  _zod?: { def?: ZodInternalDef };
  description?: string;
}

function getDef(schema: ZodSchemaInternals): ZodInternalDef | undefined {
  return schema._zod?.def;
}

/**
 * Walk wrapper schemas (optional / default / nullable / pipe) and collect
 * the resolved `isOptional` + `defaultValue` + first non-empty `description`.
 *
 * Description is collected from the outermost wrapper that has one — apps
 * typically `.describe()` on the wrapper, not the inner type.
 */
function unwrap(field: ZodSchemaInternals): UnwrappedField {
  let current: ZodSchemaInternals | undefined = field;
  let isOptional = false;
  let defaultValue: unknown;
  let description: string | undefined = field.description;

  while (current) {
    const def = getDef(current);
    const type = def?.type;
    if (!type || !WRAPPER_TYPES.has(type)) {
      break;
    }
    if (type === 'optional' || type === 'nullable') {
      isOptional = true;
    }
    if ((type === 'default' || type === 'prefault') && defaultValue === undefined) {
      defaultValue =
        typeof def?.defaultValue === 'function' ? (def.defaultValue as () => unknown)() : def?.defaultValue;
    }
    const next: ZodSchemaInternals | undefined =
      def?.innerType ?? (type === 'pipe' ? (def?.out ?? def?.in) : undefined);
    if (!next) break;
    if (!description && next.description) {
      description = next.description;
    }
    current = next;
  }

  return { isOptional, defaultValue, description };
}

/**
 * Effects-wrapped objects (`.refine()` / `.superRefine()`) hide the inner
 * object behind a wrapper. Unwrap one layer to recover the shape.
 *
 * Returns `undefined` if the schema isn't an object or doesn't expose a shape.
 */
function resolveObjectShape(schema: z.ZodType): Record<string, z.ZodType> | undefined {
  if (schema instanceof z.ZodObject) {
    return schema.shape as Record<string, z.ZodType>;
  }
  const def = getDef(schema as unknown as ZodSchemaInternals);
  const inner = def?.innerType ?? (def?.type === 'pipe' ? def?.in : undefined);
  if (inner) {
    return resolveObjectShape(inner as unknown as z.ZodType);
  }
  return undefined;
}

function formatDefault(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/**
 * Emit a `.env.example`-shaped string from a Zod object schema.
 *
 * Each field becomes a `# description` line (if present) followed by
 * `KEY=value`. Required fields render as `KEY=`; defaulted fields render
 * with the default value; pure optionals render commented-out.
 *
 * Used by the MS9 CI drift check (separate task) to diff against the
 * committed `envs.example` files.
 *
 * @throws {TypeError} If `schema` is not an object schema.
 */
export function generateEnvExample(schema: z.ZodType, options: GenerateEnvExampleOptions = {}): string {
  const shape = resolveObjectShape(schema);
  if (!shape) {
    throw new TypeError('generateEnvExample expects a z.object schema (or a wrapped one).');
  }

  const lines: string[] = [];
  if (options.header) {
    lines.push(options.header, '');
  }

  const keys = Object.keys(shape);
  keys.forEach((key, index) => {
    const field = shape[key];
    if (!field) return;
    const { isOptional, defaultValue, description } = unwrap(field as unknown as ZodSchemaInternals);
    if (description) {
      lines.push(`# ${description}`);
    }
    const value = formatDefault(defaultValue);
    if (isOptional && defaultValue === undefined) {
      lines.push(`# ${key}=`);
    } else {
      lines.push(`${key}=${value}`);
    }
    if (index < keys.length - 1) {
      lines.push('');
    }
  });

  const out = lines.join('\n');
  return options.trailingNewline === false ? out : `${out}\n`;
}
