import type { FieldErrors } from "react-hook-form"
import { safeGetDefinition } from "@/core/fields/sub-algorithm-composer-field.utils"
import type { FormInput } from "@/core/schema-builder"

export type ReadinessStatus = "done" | "missing" | "error"

export interface FieldReadiness {
  key: string
  label: string
  status: ReadinessStatus
}

interface SubAlgorithmEntry {
  algorithm_key?: unknown
  algorithm_version?: unknown
  inputs?: Array<{ key?: unknown; value?: unknown }>
}

function isValueFilled(value: unknown): boolean {
  if (value === undefined || value === null || value === "") {
    return false
  }
  if (value instanceof File) {
    return false
  }
  if (Array.isArray(value)) {
    return value.length > 0
  }
  return true
}

/**
 * A composed child is ready when it names an algorithm and every required
 * input of that child's definition has a value. Child inputs live inside
 * the parent field, so the checklist has to look at them here.
 */
function isSubAlgorithmEntryReady(entry: unknown): boolean {
  if (typeof entry !== "object" || entry === null) {
    return false
  }

  const row = entry as SubAlgorithmEntry
  if (typeof row.algorithm_key !== "string" || row.algorithm_key === "") {
    return false
  }
  if (
    typeof row.algorithm_version !== "string" ||
    row.algorithm_version === ""
  ) {
    return false
  }

  const definition = safeGetDefinition(row.algorithm_key, row.algorithm_version)
  if (!definition) {
    // Unknown child: fall back to the shape check only.
    return true
  }

  const valuesByKey = new Map(
    (row.inputs ?? []).map((item) => [item?.key, item?.value])
  )

  return definition.inputs.every((input) => {
    // CSV inputs carry no `required` flag; they are always required.
    if ("required" in input && input.required === false) {
      return true
    }
    if (!valuesByKey.has(input.key)) {
      // Not synced into the row yet; the composer fills it on mount.
      return false
    }
    return isValueFilled(valuesByKey.get(input.key))
  })
}

function hasRequiredValue(input: FormInput, value: unknown): boolean {
  if (value === undefined || value === null || value === "") {
    return false
  }
  if (
    (input.type === "csv" || input.type === "json") &&
    value instanceof File
  ) {
    return false
  }
  if (input.type === "array" && Array.isArray(value)) {
    return value.length >= (input.minItems ?? 1)
  }
  if (input.type === "sub_algorithm") {
    if (!Array.isArray(value)) return false
    if (value.length < (input.minItems ?? 1)) return false
    return value.every(isSubAlgorithmEntryReady)
  }
  return true
}

/**
 * Per-field readiness for the review checklist: every required field plus
 * any field currently carrying a validation error. An error wins over a
 * missing/done verdict.
 */
export function computeFieldReadiness(
  inputs: ReadonlyArray<FormInput>,
  values: Record<string, unknown> | undefined,
  errors: FieldErrors | undefined
): FieldReadiness[] {
  const readiness: FieldReadiness[] = []

  for (const input of inputs) {
    const required = input.required !== false
    const hasError = Boolean(errors?.[input.key])

    if (!required && !hasError) {
      continue
    }

    const status: ReadinessStatus = hasError
      ? "error"
      : hasRequiredValue(input, values?.[input.key])
        ? "done"
        : "missing"

    readiness.push({ key: input.key, label: input.label, status })
  }

  return readiness
}

/**
 * Human label for an uploading field. Child uploads inside a composer row
 * report a dotted path (`sub_algorithms.0.inputs.1.value`), so those fall
 * back to the parent input's label.
 */
export function describeUploadingField(
  fieldKey: string,
  inputs: ReadonlyArray<FormInput>
): string {
  const [rootKey] = fieldKey.split(".")
  const input = inputs.find((candidate) => candidate.key === rootKey)

  if (!input) {
    return "file"
  }

  return fieldKey === input.key ? input.label : `${input.label} file`
}

const MAX_LISTED_REASONS = 4

/** Human-readable reasons the submit button is disabled, capped for display. */
export function buildDisableReasons(args: {
  readiness: ReadonlyArray<FieldReadiness>
  uploadingLabels: ReadonlyArray<string>
  isSubmitting: boolean
}): string[] {
  if (args.isSubmitting) {
    return []
  }

  const reasons: string[] = []

  for (const label of args.uploadingLabels) {
    reasons.push(`Uploading ${label}…`)
  }

  for (const item of args.readiness) {
    if (item.status === "missing") {
      reasons.push(`${item.label} is missing`)
    } else if (item.status === "error") {
      reasons.push(`${item.label} needs attention`)
    }
  }

  if (reasons.length > MAX_LISTED_REASONS) {
    const hidden = reasons.length - MAX_LISTED_REASONS
    return [...reasons.slice(0, MAX_LISTED_REASONS), `…and ${hidden} more`]
  }

  return reasons
}
