"use client"

import { type Control, useWatch } from "react-hook-form"

const CHILD_VALUE_PATTERN = /^(.*)\.inputs\.\d+\.value$/

/**
 * Current value of the definition input a field `dependsOn`, resolved for both
 * form shapes: at the root the dependency is a plain field name, while inside a
 * sub-algorithm child row inputs are positional (`sub_algorithms.0.inputs.N.value`),
 * so the sibling is found by its definition key in the row's `inputs` array.
 */
export function useDependentInputValue(
  fieldKey: string,
  dependsOn: string | string[] | undefined,
  control: Control<any>
): unknown {
  const dependencyKey = Array.isArray(dependsOn) ? dependsOn[0] : dependsOn
  const childMatch = CHILD_VALUE_PATTERN.exec(fieldKey)
  const watchName = childMatch
    ? `${childMatch[1]}.inputs`
    : (dependencyKey ?? fieldKey)
  const watched = useWatch({ control, name: watchName })

  if (dependencyKey === undefined) return undefined
  if (!childMatch) return watched

  const rows = Array.isArray(watched)
    ? (watched as Array<{ key?: string; value?: unknown }>)
    : []
  return rows.find((row) => row?.key === dependencyKey)?.value
}
