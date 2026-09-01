import {
  type AlgorithmDefinition,
  type AlgorithmNormalization,
  type ArrayIoItem,
  getAlgorithmDefinition,
  type JsonIoItem,
  type ResourceCatalog,
  type SubAlgorithmIoItem,
} from "@reputo/reputation-algorithms"
import type { Algorithm } from "./algorithms"

/** A preset that populates the entire array field with a fixed set of rows when applied. */
export interface ArrayPreset {
  label: string
  value: Array<Record<string, unknown>>
}

export interface SelectOption {
  value: string
  label: string
  /** When set, this option is shown only when the sibling `dependsOn` field equals this value. */
  filterBy?: string
  /** When set, all listed sibling or ancestor field values must match. */
  filters?: Record<string, string>
}

/** Property definition for nested object fields inside a repeater. */
export interface FormInputProperty {
  key: string
  label: string
  type: string
  widget?: string
  description?: string
  required?: boolean
  enum?: string[]
  default?: string | number
  /** Minimum allowed value for numeric properties */
  min?: number
  /** Maximum allowed value for numeric properties */
  max?: number
  /** When true, the value must be strictly greater than `min` */
  exclusiveMin?: boolean
  options?: SelectOption[]
  dependsOn?: string | string[]
  minItems?: number
  uniqueBy?: string[]
  addButtonLabel?: string
  itemProperties?: FormInputProperty[]
  arrayPresets?: ArrayPreset[]
  filterBy?: string
}

export interface FormInput {
  key: string
  label: string
  type: string
  widget?: string
  description?: string
  required?: boolean
  /** Render a slider alongside the numeric input (needs min and max) */
  sliderHint?: boolean
  /** Render a textarea instead of a single-line input */
  multiline?: boolean
  /** Keys that must stay unique together across repeater rows */
  uniqueBy?: string[]
  /** Suffix to display after the input (e.g. "days") */
  suffix?: string
  /** Preset quick-select values */
  presets?: number[]
  /** Min items for array fields */
  minItems?: number
  /** Add button label for repeater fields */
  addButtonLabel?: string
  /** Nested properties for array-of-object fields */
  itemProperties?: FormInputProperty[]
  /** Quick-fill presets for array fields */
  arrayPresets?: ArrayPreset[]
  /** Definition-driven resource selector catalog */
  resourceCatalog?: ResourceCatalog
  /** JSON validation config */
  json?: {
    maxBytes?: number
    schema?: string
    rootKey?: string
    allowedChains?: string[]
  }
  /** Options for select/enum fields */
  options?: SelectOption[]
  /** Key of sibling field this depends on */
  dependsOn?: string | string[]
  /** Max items for sub_algorithm composer */
  maxItems?: number
  /** Parent input keys that child algorithms inherit and must not redefine */
  sharedInputKeys?: string[]
  /** Community platform a `community_connection` widget offers connections for */
  platform?: string
  /** Array item type; "string" for bare id lists, "object" for row fields */
  itemType?: string
  [key: string]: any
}

export interface FormSchema {
  key: string
  name: string
  category: string
  description: string
  version: string
  /** Definition-level normalization metadata; absent values mean observed min-max */
  normalization?: AlgorithmNormalization
  inputs: FormInput[]
  outputs: any[]
}

/**
 * Builds a form schema from an Algorithm object.
 * Includes name, description, key, version, and all algorithm inputs.
 */
export function buildSchemaFromAlgorithm(
  algorithm: Algorithm,
  version: string = "1.0.0"
): FormSchema {
  let fullDefinition: AlgorithmDefinition | null = null
  try {
    const definitionJson = getAlgorithmDefinition({ key: algorithm.id })
    fullDefinition = JSON.parse(definitionJson) as AlgorithmDefinition
  } catch (error) {
    console.warn(`Could not fetch full definition for ${algorithm.id}:`, error)
  }

  const formInputs: FormInput[] = algorithm.inputs.map((algoInput) => {
    return transformInputToFormInput(algoInput, fullDefinition)
  })

  const nameInput: FormInput = {
    key: "name",
    label: "Preset name",
    type: "text",
    description: "Name shown in the presets list.",
    required: true,
    minLength: 3,
    maxLength: 100,
  }

  const descriptionInput: FormInput = {
    key: "description",
    label: "Description",
    type: "text",
    description: "Short note about this preset.",
    required: true,
    multiline: true,
    minLength: 10,
    maxLength: 500,
  }

  const outputs = fullDefinition?.outputs || []

  return {
    key: `preset_${algorithm.id}`,
    name: `Create preset: ${algorithm.title}`,
    category: algorithm.category,
    description: algorithm.description,
    version,
    normalization: fullDefinition?.normalization,
    inputs: [...formInputs, nameInput, descriptionInput],
    outputs,
  }
}

/**
 * Builds the algorithm input form fields for a given definition.
 * Excludes metadata fields (name, description, key, version) and any keys
 * listed in `excludeKeys`.
 */
export function buildAlgorithmInputFormFields(
  definition: AlgorithmDefinition,
  excludeKeys: ReadonlyArray<string> = []
): FormInput[] {
  return definition.inputs
    .filter((input) => !excludeKeys.includes(input.key))
    .map((input) =>
      transformInputToFormInput(
        {
          key: input.key,
          type: input.type,
          label: input.label ?? input.key,
        },
        definition
      )
    )
}

function transformInputToFormInput(
  algoInput: { key: string; type: string; label: string },
  fullDefinition: AlgorithmDefinition | null
): FormInput {
  const inputKey = algoInput.key

  const fullInput = fullDefinition?.inputs.find(
    (input) => input.key === inputKey || input.label === algoInput.label
  )

  const getNumericProps = () => {
    if (
      fullInput &&
      (fullInput.type === "number" || fullInput.type === "integer")
    ) {
      const numInput = fullInput as {
        min?: number
        max?: number
        step?: number
        default?: number
        required?: boolean
        uiHint?: {
          widget?: string
          suffix?: string
          presets?: number[]
        }
        description?: string
      }
      return {
        min: numInput.min,
        max: numInput.max,
        step: numInput.step,
        default: numInput.default,
        required: numInput.required !== false,
        uiHint: numInput.uiHint,
        description: numInput.description,
      }
    }
    return { required: true }
  }

  switch (algoInput.type) {
    case "csv": {
      const csvConfig =
        fullInput?.type === "csv" && fullInput.csv
          ? {
              hasHeader: fullInput.csv.hasHeader ?? true,
              delimiter: fullInput.csv.delimiter ?? ",",
              maxRows: fullInput.csv.maxRows,
              maxBytes: fullInput.csv.maxBytes,
              columns: fullInput.csv.columns.map((col) => ({
                key: col.key,
                type: col.type === "integer" ? "number" : col.type,
                aliases: col.aliases,
                description: col.description,
                required: col.required !== false,
                enum: col.enum?.map((e) => String(e)),
              })),
            }
          : {
              hasHeader: true,
              delimiter: ",",
              columns: [],
            }

      return {
        key: inputKey,
        label: algoInput.label,
        type: "csv",
        csv: csvConfig,
        required: true,
      }
    }

    case "json": {
      const jsonConfig =
        fullInput?.type === "json"
          ? {
              maxBytes: (fullInput as JsonIoItem).json?.maxBytes,
              schema: (fullInput as JsonIoItem).json?.schema,
              rootKey: (fullInput as JsonIoItem).json?.rootKey,
              allowedChains: (fullInput as JsonIoItem).json?.allowedChains,
            }
          : undefined

      return {
        key: inputKey,
        label: algoInput.label,
        type: "json",
        description: fullInput?.description,
        json: jsonConfig,
        required:
          fullInput && "required" in fullInput
            ? fullInput.required !== false
            : true,
      }
    }

    case "number":
    case "integer": {
      const numericProps = getNumericProps()

      const numericType =
        (fullInput as { type?: string })?.type === "integer" ||
        algoInput.type === "integer"
          ? "integer"
          : "number"
      return {
        key: inputKey,
        label: algoInput.label,
        type: numericType,
        description: numericProps.description,
        min: numericProps.min,
        max: numericProps.max,
        step: numericProps.step,
        default: numericProps.default,
        required: numericProps.required,
        sliderHint: numericProps.uiHint?.widget === "slider",
        suffix: numericProps.uiHint?.suffix,
        presets: numericProps.uiHint?.presets,
      }
    }

    case "boolean":
      return {
        key: inputKey,
        label: algoInput.label,
        type: "boolean",
        description: fullInput?.description,
        required:
          fullInput && "required" in fullInput
            ? fullInput.required !== false
            : true,
        default:
          fullInput && "default" in fullInput ? fullInput.default : false,
      }

    case "string": {
      const strInput = fullInput as {
        description?: string
        required?: boolean
        enum?: string[]
        uiHint?: {
          widget?: string
          options?: SelectOption[]
          dependsOn?: string
          platform?: string
        }
      } | null

      if (strInput?.uiHint?.widget === "select" && strInput.uiHint.options) {
        return {
          key: inputKey,
          label: algoInput.label,
          type: "select",
          description: strInput.description,
          required: strInput.required !== false,
          options: strInput.uiHint.options,
          dependsOn: strInput.uiHint.dependsOn,
          enum: strInput.enum,
        }
      }

      if (strInput?.uiHint?.widget === "community_connection") {
        return {
          key: inputKey,
          label: algoInput.label,
          type: "text",
          widget: "community_connection",
          platform: strInput.uiHint.platform,
          description: strInput.description,
          required: strInput.required !== false,
        }
      }

      return {
        key: inputKey,
        label: algoInput.label,
        type: "text",
        description: fullInput?.description,
        required:
          fullInput && "required" in fullInput
            ? fullInput.required !== false
            : true,
      }
    }

    case "sub_algorithm": {
      const subInput = fullInput as SubAlgorithmIoItem | null
      return {
        key: inputKey,
        label: algoInput.label,
        type: "sub_algorithm",
        widget: subInput?.uiHint?.widget ?? "sub_algorithm_composer",
        description: subInput?.description,
        required: subInput?.required !== false,
        minItems: subInput?.minItems,
        maxItems: subInput?.maxItems,
        sharedInputKeys: subInput?.sharedInputKeys,
        addButtonLabel: subInput?.uiHint?.addButtonLabel ?? "Add algorithm",
      }
    }

    case "array": {
      const arrayInput = fullInput as
        | (ArrayIoItem & { uniqueBy?: string[] })
        | null
      const itemProps =
        arrayInput?.item && "properties" in arrayInput.item
          ? arrayInput.item.properties
          : []

      return {
        key: inputKey,
        label: algoInput.label,
        type: "array",
        widget: arrayInput?.uiHint?.widget,
        description: arrayInput?.description,
        required: arrayInput?.required !== false,
        minItems: arrayInput?.minItems,
        uniqueBy: arrayInput?.uniqueBy,
        addButtonLabel: arrayInput?.uiHint?.addButtonLabel ?? "Add item",
        dependsOn: arrayInput?.uiHint?.dependsOn,
        arrayPresets: arrayInput?.uiHint?.presets,
        resourceCatalog: arrayInput?.uiHint?.resourceCatalog,
        itemType: arrayInput?.item?.type,
        itemProperties: itemProps.map(transformObjectPropertyToFormProperty),
      }
    }

    default:
      return {
        key: inputKey,
        label: algoInput.label,
        type: "text",
        required: true,
      }
  }
}

function transformObjectPropertyToFormProperty(prop: any): FormInputProperty {
  if (prop.type === "array") {
    return {
      key: prop.key,
      label: prop.label ?? prop.key,
      type: "array",
      widget: prop.uiHint?.widget,
      description: prop.description,
      required: prop.required !== false,
      minItems: prop.minItems,
      uniqueBy: prop.uniqueBy,
      addButtonLabel: prop.uiHint?.addButtonLabel ?? "Add item",
      arrayPresets: prop.uiHint?.presets,
      itemProperties: (prop.item?.properties ?? []).map(
        transformObjectPropertyToFormProperty
      ),
      dependsOn: prop.uiHint?.dependsOn,
    }
  }

  return {
    key: prop.key,
    label: prop.label ?? prop.key,
    widget: prop.uiHint?.widget,
    type:
      prop.uiHint?.widget === "select" && prop.uiHint.options
        ? "select"
        : prop.type,
    description: prop.description,
    required: prop.required !== false,
    enum: prop.enum,
    default: prop.default,
    min: prop.min,
    max: prop.max,
    exclusiveMin: prop.exclusiveMin,
    options: prop.uiHint?.options,
    dependsOn: prop.uiHint?.dependsOn,
  }
}

export {
  buildZodSchema,
  type InferSchemaType,
  validateCSVContent,
  validateJSONContent,
} from "@reputo/algorithm-validator"
