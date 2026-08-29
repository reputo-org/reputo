import type { AlgorithmDefinition } from "@reputo/reputation-algorithms"
import type { FormSchema } from "./schema-builder"

const isNumericType = (type: unknown) => type === "number" || type === "integer"

const normalizeNumeric = (value: unknown): unknown => {
  if (typeof value !== "string") return value
  const trimmed = value.trim()
  if (trimmed === "") return ""
  const normalized = trimmed.replace(",", ".")
  const n = Number(normalized)
  return Number.isFinite(n) ? n : value
}

const buildArrayDefaultRow = (
  itemProps: Array<{
    key: string
    type?: string
    default?: unknown
    minItems?: number
    itemProperties?: Array<any>
  }>
): Record<string, unknown> => {
  const row: Record<string, unknown> = {}
  for (const prop of itemProps) {
    if (prop.type === "array") {
      const minItems = prop.minItems ?? 1
      row[prop.key] = Array.from({ length: minItems }, () =>
        buildArrayDefaultRow(prop.itemProperties ?? [])
      )
    } else {
      row[prop.key] = prop.default ?? ""
    }
  }
  return row
}

/**
 * Builds react-hook-form default values for a form schema: user-provided
 * defaults win, then definition defaults, then per-type empty values.
 * `sub_algorithm` starts empty — entries are only created via the picker.
 */
export function getDefaultValues(
  schema: FormSchema | AlgorithmDefinition,
  userDefaults: Record<string, any> = {}
): Record<string, any> {
  const defaults: Record<string, any> = {}

  schema.inputs.forEach((input) => {
    if (userDefaults[input.key] !== undefined) {
      const raw = userDefaults[input.key]
      defaults[input.key] = isNumericType(input.type)
        ? normalizeNumeric(raw)
        : raw
    } else if ("default" in input && input.default !== undefined) {
      defaults[input.key] = isNumericType(input.type)
        ? normalizeNumeric(input.default)
        : input.default
    } else {
      const isRequired = "required" in input ? input.required !== false : true
      switch (input.type) {
        case "boolean":
          defaults[input.key] = false
          break
        case "number":
        case "integer":
          defaults[input.key] = ""
          break
        case "array": {
          if (
            (input as any).widget === "resource_selector" ||
            (input as any).widget === "community_resources" ||
            (input as any).itemType === "string"
          ) {
            defaults[input.key] = []
            break
          }

          const itemProps = (input as any).itemProperties as
            | Array<{ key: string; default?: unknown }>
            | undefined
          const minItems = (input as any).minItems ?? 1
          defaults[input.key] = Array.from({ length: minItems }, () => ({
            ...buildArrayDefaultRow((itemProps as Array<any>) ?? []),
          }))
          break
        }
        case "sub_algorithm":
          defaults[input.key] = []
          break
        case "text":
        case "enum":
        case "select":
        case "date":
        case "csv":
        case "json":
          if (!isRequired) {
            defaults[input.key] = undefined
          } else {
            defaults[input.key] = ""
          }
          break
      }
    }
  })

  return defaults
}
