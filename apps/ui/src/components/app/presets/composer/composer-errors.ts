import { extractApiFieldErrors } from "../error-utils"

export type FieldErrorSetter = (
  name: string,
  error: { type: string; message: string }
) => void

interface ResolveOptions {
  formKeys: ReadonlySet<string>
  setError: FieldErrorSetter
  /** Current form values, used to resolve child-input error paths. */
  values?: Record<string, unknown>
}

/** Matches `<input>.<row>.inputs.<childInputKey>` from the shared validator. */
const NESTED_INPUT_PATTERN = /^([^.]+)\.(\d+)\.inputs\.(.+)$/

/**
 * Translates a validator error field into a react-hook-form path. Child
 * errors arrive keyed by the child's input key, while the form addresses
 * them positionally (`sub_algorithms.0.inputs.2.value`).
 */
export function resolveErrorPath(
  field: string,
  values: Record<string, unknown> | undefined,
  formKeys: ReadonlySet<string>
): string | null {
  if (field === "_general") {
    return null
  }

  if (formKeys.has(field)) {
    return field
  }

  const nested = NESTED_INPUT_PATTERN.exec(field)
  if (!nested) {
    // Row-level paths like `sub_algorithms.0.algorithm_key` are already
    // form paths as long as their root is a known field.
    const [root] = field.split(".")
    return formKeys.has(root) ? field : null
  }

  const [, rootKey, rowIndex, childInputKey] = nested
  if (!formKeys.has(rootKey)) {
    return null
  }

  const rows = values?.[rootKey]
  if (!Array.isArray(rows)) {
    return null
  }

  const row = rows[Number(rowIndex)] as
    | { inputs?: Array<{ key?: unknown }> }
    | undefined
  const childIndex = row?.inputs?.findIndex(
    (item) => item?.key === childInputKey
  )

  if (childIndex === undefined || childIndex < 0) {
    return null
  }

  return `${rootKey}.${rowIndex}.inputs.${childIndex}.value`
}

/**
 * Routes `{field, message}` errors onto matching form fields; returns the
 * messages that have no matching field (shown in the general error alert).
 */
export function applyFieldErrors(
  errors: ReadonlyArray<{ field: string; message: string }>,
  opts: ResolveOptions
): string[] {
  const general: string[] = []

  for (const error of errors) {
    const path = resolveErrorPath(error.field, opts.values, opts.formKeys)

    if (path) {
      opts.setError(path, { type: "server", message: error.message })
    } else {
      general.push(error.message)
    }
  }

  return [...new Set(general)]
}

/** `applyFieldErrors` over a raw API error. */
export function applyApiErrorsToForm(
  error: unknown,
  opts: ResolveOptions
): string[] {
  return applyFieldErrors(extractApiFieldErrors(error), opts)
}
