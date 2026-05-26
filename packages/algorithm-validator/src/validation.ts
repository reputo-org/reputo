import { z } from 'zod/v4';
import type {
  AlgorithmDefinition,
  ArrayIoItem,
  CsvIoItem,
  JsonIoItem,
  ObjectPropertyParam,
  ResourceCatalog,
  SubAlgorithmIoItem,
  ValidationResult,
} from './types/index.js';

/**
 * @example
 * ```typescript
 * const definition: AlgorithmDefinition = {
 *   key: 'voting_engagement',
 *   name: 'Voting Engagement',
 *   category: 'Engagement',
 *   description: 'Calculates engagement',
 *   version: '1.0.0',
 *   inputs: [
 *     {
 *       key: 'votes',
 *       label: 'Votes CSV',
 *       type: 'csv',
 *       csv: {
 *         hasHeader: true,
 *         delimiter: ',',
 *         columns: [
 *           { key: 'user_id', type: 'string', required: true }
 *         ]
 *       }
 *     }
 *   ],
 *   outputs: [],
 *   runtime: { taskQueue: 'default', activity: 'calculateVotingEngagement' }
 * }
 *
 * const result = validatePayload(definition, { votes: 'storage-key-123' })
 * if (result.success) {
 *   console.log('Valid:', result.data)
 * } else {
 *   console.error('Errors:', result.errors)
 * }
 * ```
 */
export function validatePayload(definition: AlgorithmDefinition, payload: unknown): ValidationResult {
  try {
    const zodSchema = buildZodSchema(definition);
    const result = zodSchema.safeParse(payload);

    if (result.success) {
      const conditionalOptionErrors = validateConditionalOptionConstraints(definition.inputs, result.data);
      const resourceSelectorErrors = validateResourceSelectorConstraints(definition.inputs, result.data);
      if (conditionalOptionErrors.length > 0 || resourceSelectorErrors.length > 0) {
        return {
          success: false,
          errors: [...conditionalOptionErrors, ...resourceSelectorErrors],
        };
      }

      return {
        success: true,
        data: result.data,
      };
    }
    return {
      success: false,
      errors: result.error.issues.map((err) => ({
        field: err.path.join('.'),
        message: err.message,
        code: err.code,
      })),
    };
  } catch (error) {
    return {
      success: false,
      errors: [
        {
          field: '_schema',
          message: `Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
    };
  }
}

export function buildZodSchema(definition: AlgorithmDefinition): z.ZodObject<Record<string, z.ZodType>> {
  const shape: Record<string, z.ZodType> = {};

  for (const input of definition.inputs) {
    shape[input.key] = buildFieldSchema(input, input.label ?? input.key);
  }

  return z.object(shape);
}

// biome-ignore lint/suspicious/noExplicitAny: Input type varies between AlgorithmDefinition and FormSchema
function buildFieldSchema(input: any, label: string): z.ZodType {
  let schema: z.ZodType;

  switch (input.type) {
    case 'csv': {
      const isBrowser =
        typeof globalThis !== 'undefined' && typeof (globalThis as { window?: unknown }).window !== 'undefined';

      if (!isBrowser) {
        schema = z.string().min(1, `${label} is required`);
      } else {
        schema = z.union([buildCSVSchema(input.csv, label), z.string().min(1, `${label} is required`)]);
      }
      break;
    }

    case 'json': {
      const jsonInput = input as JsonIoItem;
      const isBrowser =
        typeof globalThis !== 'undefined' && typeof (globalThis as { window?: unknown }).window !== 'undefined';

      if (!isBrowser) {
        schema = z.string().min(1, `${label} is required`);
      } else {
        schema = z.union([buildJSONSchema(jsonInput.json, label), z.string().min(1, `${label} is required`)]);
      }
      break;
    }

    case 'number':
    case 'integer':
    case 'slider': {
      let numSchema = z.number({
        error: `${label} must be a valid number`,
      });

      if (input.min !== undefined) {
        numSchema = numSchema.min(input.min, `${label} must be at least ${input.min}`);
      }
      if (input.max !== undefined) {
        numSchema = numSchema.max(input.max, `${label} must be at most ${input.max}`);
      }
      if (input.type === 'integer') {
        numSchema = numSchema.int(`${label} must be a whole number`);
      }

      const preprocessedSchema = z.preprocess(
        (val) => {
          if (val === '' || val === null || val === undefined) {
            return undefined;
          }
          if (typeof val === 'number') {
            return val;
          }
          if (typeof val === 'string') {
            const num = parseFloat(val);
            return Number.isNaN(num) ? undefined : num;
          }
          return val;
        },
        input.required === false ? numSchema.optional() : numSchema,
      );

      if (input.required !== false) {
        schema = z
          .preprocess((val) => {
            if (val === '' || val === null || val === undefined) {
              return undefined;
            }
            if (typeof val === 'number') {
              return val;
            }
            if (typeof val === 'string') {
              const num = parseFloat(val);
              return Number.isNaN(num) ? undefined : num;
            }
            return val;
          }, numSchema)
          .refine((val) => val !== undefined, {
            message: `${label} is required`,
          });
      } else {
        schema = preprocessedSchema;
      }
      break;
    }

    case 'boolean': {
      const boolSchema = z.boolean();
      schema = input.required === false ? boolSchema.optional() : boolSchema;
      break;
    }

    case 'text':
    case 'string': {
      let strSchema = z.string().trim();

      if (input.required !== false) {
        strSchema = strSchema.min(1, `${label} is required`);
      }

      if (typeof input.minLength === 'number') {
        strSchema = strSchema.min(input.minLength, `${label} must be at least ${input.minLength} characters`);
      }
      if (typeof input.maxLength === 'number') {
        strSchema = strSchema.max(input.maxLength, `${label} must be at most ${input.maxLength} characters`);
      }

      if (input.enum && input.enum.length > 0) {
        const allowedValues = input.enum as [string, ...string[]];
        schema = z.enum(allowedValues, { error: `${label} must be one of: ${allowedValues.join(', ')}` });
      } else {
        schema = input.required === false ? strSchema.optional() : strSchema;
      }
      break;
    }

    case 'array': {
      const arrayInput = input as ArrayIoItem;
      const itemProps = getArrayItemProperties(arrayInput, input);
      let arrSchema = z.array(buildObjectSchema(itemProps, label));
      arrSchema = applyArrayConstraints({
        schema: arrSchema,
        label,
        minItems: arrayInput.minItems ?? input.minItems,
        uniqueBy: Array.isArray(arrayInput.uniqueBy)
          ? arrayInput.uniqueBy
          : Array.isArray(input.uniqueBy)
            ? input.uniqueBy
            : [],
        itemProps,
      });
      schema = arrayInput.required === false ? arrSchema.optional() : arrSchema;
      break;
    }

    case 'sub_algorithm': {
      const subAlgorithmInput = input as SubAlgorithmIoItem;
      let arrSchema = z.array(buildSubAlgorithmEntrySchema(label));
      if (subAlgorithmInput.minItems !== undefined) {
        arrSchema = arrSchema.min(
          subAlgorithmInput.minItems,
          `${label} must have at least ${subAlgorithmInput.minItems} item(s)`,
        );
      }
      if (subAlgorithmInput.maxItems !== undefined) {
        arrSchema = arrSchema.max(
          subAlgorithmInput.maxItems,
          `${label} must have at most ${subAlgorithmInput.maxItems} item(s)`,
        );
      }
      schema = subAlgorithmInput.required === false ? arrSchema.optional() : arrSchema;
      break;
    }

    default:
      schema = z.string();
  }

  return schema;
}

function buildSubAlgorithmEntrySchema(label: string): z.ZodType {
  return z.object({
    algorithm_key: z.string().trim().min(1, `${label} algorithm key is required`),
    algorithm_version: z.string().trim().min(1, `${label} algorithm version is required`),
    weight: z.preprocess(
      (value) => {
        if (value === '' || value === null || value === undefined) {
          return undefined;
        }
        if (typeof value === 'number') {
          return value;
        }
        if (typeof value === 'string') {
          const parsed = Number(value);
          return Number.isNaN(parsed) ? undefined : parsed;
        }
        return value;
      },
      z.number({ error: `${label} weight must be a valid number` }).gt(0, `${label} weight must be greater than 0`),
    ),
    inputs: z.array(
      z.object({
        key: z.string().min(1, 'Input key is required'),
        value: z.unknown().refine((value) => value !== undefined && value !== null, {
          message: 'Input value is required',
        }),
      }),
    ),
  });
}

function buildObjectPropertySchema(prop: ObjectPropertyParam): z.ZodType {
  const propLabel = prop.label ?? prop.key;

  if ('enum' in prop && prop.enum && prop.enum.length > 0) {
    const allowed = prop.enum as [string, ...string[]];
    const enumSchema = z.enum(allowed, { error: `${propLabel} must be one of: ${allowed.join(', ')}` });
    return prop.required === false ? enumSchema.optional() : enumSchema;
  }

  switch (prop.type) {
    case 'string': {
      let s = z.string().trim();
      if (prop.required !== false) {
        s = s.min(1, `${propLabel} is required`);
      }
      return prop.required === false ? s.optional() : s;
    }
    case 'number':
    case 'integer': {
      let n = z.number({ error: `${propLabel} must be a valid number` });
      if (prop.type === 'integer') {
        n = n.int(`${propLabel} must be a whole number`);
      }
      const preprocessed = z.preprocess(
        (value) => {
          if (value === '' || value === null || value === undefined) {
            return undefined;
          }
          if (typeof value === 'number') {
            return value;
          }
          if (typeof value === 'string') {
            const parsed = Number(value);
            return Number.isNaN(parsed) ? undefined : parsed;
          }
          return value;
        },
        prop.required === false ? n.optional() : n,
      );

      return prop.required === false
        ? preprocessed
        : preprocessed.refine((value) => value !== undefined, {
            message: `${propLabel} is required`,
          });
    }
    case 'array': {
      const itemProps = getArrayItemProperties(prop);
      let arrSchema = z.array(buildObjectSchema(itemProps, propLabel));
      arrSchema = applyArrayConstraints({
        schema: arrSchema,
        label: propLabel,
        minItems: prop.minItems,
        uniqueBy: prop.uniqueBy ?? [],
        itemProps,
      });
      return prop.required === false ? arrSchema.optional() : arrSchema;
    }
    default:
      return z.string();
  }
}

function getArrayItemProperties(
  arrayLike: { item?: { properties?: ObjectPropertyParam[] } },
  formSchemaLike?: { itemProperties?: ObjectPropertyParam[] },
): ObjectPropertyParam[] {
  return arrayLike.item?.properties ?? formSchemaLike?.itemProperties ?? [];
}

function buildObjectSchema(itemProps: ObjectPropertyParam[], parentLabel: string): z.ZodType<Record<string, unknown>> {
  const objectShape: Record<string, z.ZodType> = {};
  for (const prop of itemProps) {
    objectShape[prop.key] = buildObjectPropertySchema(prop);
  }

  void parentLabel;
  return z.object(objectShape);
}

function applyArrayConstraints(params: {
  schema: z.ZodArray<z.ZodType<Record<string, unknown>>>;
  label: string;
  minItems?: number;
  uniqueBy: string[];
  itemProps: ObjectPropertyParam[];
}): z.ZodArray<z.ZodType<Record<string, unknown>>> {
  let schema = params.schema;

  if (params.minItems !== undefined) {
    schema = schema.min(params.minItems, `${params.label} must have at least ${params.minItems} item(s)`);
  }

  const hasUniquenessKeys =
    params.uniqueBy.length > 0 && params.uniqueBy.every((key) => params.itemProps.some((prop) => prop.key === key));
  if (!hasUniquenessKeys) {
    return schema;
  }

  return schema.refine(
    (items) => {
      const seen = new Set<string>();
      for (const item of items as Array<Record<string, unknown>>) {
        const compositeKey = params.uniqueBy.map((key) => String(item[key] ?? '')).join('\u0000');
        if (seen.has(compositeKey)) {
          return false;
        }
        seen.add(compositeKey);
      }
      return true;
    },
    { message: `${params.label} must not contain duplicate ${params.uniqueBy.join(' + ')} combinations` },
  );
}

function validateResourceSelectorConstraints(
  inputs: unknown[],
  payload: Record<string, unknown>,
): NonNullable<ValidationResult['errors']> {
  const errors: NonNullable<ValidationResult['errors']> = [];

  for (const input of inputs) {
    if (!isRecord(input) || typeof input.key !== 'string') {
      continue;
    }

    errors.push(
      ...validateResourceSelectorFieldConstraints({
        field: input,
        value: payload[input.key],
        fieldPath: input.key,
      }),
    );
  }

  return errors;
}

function validateResourceSelectorFieldConstraints(params: {
  field: Record<string, unknown>;
  value: unknown;
  fieldPath: string;
}): NonNullable<ValidationResult['errors']> {
  const catalog = getFieldResourceCatalog(params.field);
  if (!catalog || !Array.isArray(params.value)) {
    return [];
  }

  const errors: NonNullable<ValidationResult['errors']> = [];

  for (let index = 0; index < params.value.length; index++) {
    const item = params.value[index];
    if (!isRecord(item)) {
      continue;
    }

    const chainKey = typeof item.chain === 'string' ? item.chain.trim() : '';
    const resourceKey = typeof item.resource_key === 'string' ? item.resource_key.trim() : '';

    if (chainKey === '' || resourceKey === '') {
      continue;
    }

    const chain = catalog.chains.find((candidate) => candidate.key === chainKey);
    if (!chain) {
      errors.push({
        field: `${params.fieldPath}.${index}.chain`,
        message: 'Chain must match the resource selector catalog',
        code: 'invalid_value',
      });
      continue;
    }

    const resource = chain.resources.find((candidate) => candidate.key === resourceKey);
    if (!resource) {
      errors.push({
        field: `${params.fieldPath}.${index}.resource_key`,
        message: 'Resource must match the selected chain',
        code: 'invalid_value',
      });
    }
  }

  return errors;
}

function validateConditionalOptionConstraints(
  inputs: unknown[],
  payload: Record<string, unknown>,
): NonNullable<ValidationResult['errors']> {
  const errors: NonNullable<ValidationResult['errors']> = [];

  for (const input of inputs) {
    if (!isRecord(input) || typeof input.key !== 'string') {
      continue;
    }

    errors.push(
      ...validateFieldOptionConstraints({
        field: input,
        value: payload[input.key],
        fieldPath: input.key,
        context: isRecord(payload) ? payload : {},
      }),
    );
  }

  return errors;
}

function validateFieldOptionConstraints(params: {
  field: Record<string, unknown>;
  value: unknown;
  fieldPath: string;
  context: Record<string, unknown>;
}): NonNullable<ValidationResult['errors']> {
  const errors: NonNullable<ValidationResult['errors']> = [];
  const fieldType = params.field.type;

  if (fieldType === 'array') {
    const itemProps = getArrayItemProperties(
      params.field as { item?: { properties?: ObjectPropertyParam[] } },
      params.field as { itemProperties?: ObjectPropertyParam[] },
    );

    if (!Array.isArray(params.value)) {
      return errors;
    }

    for (let index = 0; index < params.value.length; index++) {
      const item = params.value[index];
      if (!isRecord(item)) {
        continue;
      }

      const nextContext = {
        ...params.context,
        ...item,
      };

      for (const prop of itemProps) {
        errors.push(
          ...validateFieldOptionConstraints({
            field: prop as unknown as Record<string, unknown>,
            value: item[prop.key],
            fieldPath: `${params.fieldPath}.${index}.${prop.key}`,
            context: nextContext,
          }),
        );
      }
    }

    return errors;
  }

  const options = getFieldOptions(params.field);
  if (!options || typeof params.value !== 'string' || params.value.trim() === '') {
    return errors;
  }

  const hasConditionalOptions = options.some((option) => option.filterBy !== undefined || option.filters !== undefined);
  if (!hasConditionalOptions) {
    return errors;
  }

  const matchingOptions = options.filter((option) => optionMatchesContext(option, params.field, params.context));
  const isCurrentValueAllowed = matchingOptions.some((option) => option.value === params.value);
  if (isCurrentValueAllowed) {
    return errors;
  }

  errors.push({
    field: params.fieldPath,
    message: `${String(params.field.label ?? params.field.key)} must match the current selection context`,
    code: 'invalid_value',
  });

  return errors;
}

function getFieldOptions(
  field: Record<string, unknown>,
): Array<{ value: string; label: string; filterBy?: string; filters?: Record<string, string> }> | undefined {
  const uiHint = isRecord(field.uiHint) ? field.uiHint : undefined;
  const rawOptions = uiHint?.options ?? field.options;
  if (!Array.isArray(rawOptions)) {
    return undefined;
  }

  return rawOptions.filter(isRecord).flatMap((option) => {
    if (typeof option.value !== 'string' || typeof option.label !== 'string') {
      return [];
    }

    const filters = isRecord(option.filters)
      ? Object.fromEntries(
          Object.entries(option.filters).filter(
            (entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string',
          ),
        )
      : undefined;

    return [
      {
        value: option.value,
        label: option.label,
        filterBy: typeof option.filterBy === 'string' ? option.filterBy : undefined,
        filters,
      },
    ];
  });
}

function getFieldResourceCatalog(field: Record<string, unknown>): ResourceCatalog | undefined {
  const uiHint = isRecord(field.uiHint) ? field.uiHint : undefined;
  const rawCatalog = uiHint?.resourceCatalog ?? field.resourceCatalog;
  if (!isRecord(rawCatalog) || !Array.isArray(rawCatalog.chains)) {
    return undefined;
  }

  const chains: ResourceCatalog['chains'] = rawCatalog.chains.filter(isRecord).flatMap((chain) => {
    if (typeof chain.key !== 'string' || typeof chain.label !== 'string' || !Array.isArray(chain.resources)) {
      return [];
    }

    const resources: ResourceCatalog['chains'][number]['resources'] = chain.resources
      .filter(isRecord)
      .flatMap((resource) => {
        if (
          typeof resource.key !== 'string' ||
          typeof resource.label !== 'string' ||
          typeof resource.kind !== 'string' ||
          typeof resource.identifier !== 'string' ||
          typeof resource.tokenIdentifier !== 'string' ||
          typeof resource.tokenKey !== 'string'
        ) {
          return [];
        }

        const kind = resource.kind === 'contract' ? 'contract' : 'token';

        return [
          {
            key: resource.key,
            label: resource.label,
            description: typeof resource.description === 'string' ? resource.description : undefined,
            kind,
            identifier: resource.identifier,
            tokenIdentifier: resource.tokenIdentifier,
            tokenKey: resource.tokenKey,
            parentResourceKey: typeof resource.parentResourceKey === 'string' ? resource.parentResourceKey : undefined,
            explorerUrl: typeof resource.explorerUrl === 'string' ? resource.explorerUrl : undefined,
            explorerLabel: typeof resource.explorerLabel === 'string' ? resource.explorerLabel : undefined,
            iconUrl: typeof resource.iconUrl === 'string' ? resource.iconUrl : undefined,
          },
        ];
      });

    return [
      {
        key: chain.key,
        label: chain.label,
        resources,
      },
    ];
  });

  return { chains };
}

function optionMatchesContext(
  option: { filterBy?: string; filters?: Record<string, string> },
  field: Record<string, unknown>,
  context: Record<string, unknown>,
): boolean {
  if (option.filters && Object.keys(option.filters).length > 0) {
    return Object.entries(option.filters).every(([key, value]) => String(context[key] ?? '') === value);
  }

  if (option.filterBy === undefined) {
    return true;
  }

  const uiHint = isRecord(field.uiHint) ? field.uiHint : undefined;
  const dependsOn = uiHint?.dependsOn ?? field.dependsOn;
  const dependencyKeys = Array.isArray(dependsOn)
    ? dependsOn.filter((value): value is string => typeof value === 'string')
    : typeof dependsOn === 'string'
      ? [dependsOn]
      : ['chain'];

  const dependencyKey = dependencyKeys[0];
  return String(context[dependencyKey] ?? '') === option.filterBy;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function buildCSVSchema(csvConfig: CsvIoItem['csv'], label: string): z.ZodType {
  return buildUploadedFileSchema({
    label,
    maxBytes: csvConfig.maxBytes,
    isValidFileType: (file) => file.type === 'text/csv' || file.type === 'text/plain' || file.name.endsWith('.csv'),
    invalidTypeMessage: `${label} must be a CSV file`,
  });
}

function buildJSONSchema(jsonConfig: JsonIoItem['json'], label: string): z.ZodType {
  return buildUploadedFileSchema({
    label,
    maxBytes: jsonConfig?.maxBytes,
    isValidFileType: (file) => file.type === 'application/json' || file.name.endsWith('.json'),
    invalidTypeMessage: `${label} must be a JSON file`,
  });
}

function buildUploadedFileSchema(input: {
  label: string;
  maxBytes?: number;
  isValidFileType: (file: File) => boolean;
  invalidTypeMessage: string;
}): z.ZodType {
  return z
    .instanceof(File, { message: `${input.label} must be a file` })
    .refine((file) => input.isValidFileType(file), {
      message: input.invalidTypeMessage,
    })
    .refine((file) => input.maxBytes === undefined || file.size <= input.maxBytes, {
      message: `${input.label} must be smaller than ${input.maxBytes !== undefined ? input.maxBytes / 1024 / 1024 : 0}MB`,
    });
}

export type InferSchemaType = z.infer<ReturnType<typeof buildZodSchema>>;
