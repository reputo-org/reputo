"use client"

import type { ReactElement } from "react"
import type { Control } from "react-hook-form"
import {
  BooleanField,
  CommunityConnectionField,
  CommunityResourcesField,
  CSVField,
  DateField,
  EnumField,
  JSONField,
  NumberField,
  RepeaterField,
  ResourceSelectorField,
  SelectField,
  TextField,
} from "./fields"
import type { FormInput } from "./schema-builder"

/**
 * Renders a scalar form field for a given FormInput.
 *
 * Does not support the `sub_algorithm` type (callers must render the
 * sub-algorithm composer themselves to avoid circular imports).
 *
 * The `input.key` is used as the react-hook-form field name. Callers may
 * override the form field path by passing a FormInput whose `key` is a
 * dotted path (e.g. `"sub_algorithms.0.inputs.0.value"`).
 */
export function renderScalarField(
  input: FormInput,
  control: Control<any>
): ReactElement | null {
  const commonProps = { input, control }

  switch (input.type) {
    case "text":
      if (input.widget === "community_connection") {
        return <CommunityConnectionField key={input.key} {...commonProps} />
      }
      return <TextField key={input.key} {...commonProps} />
    case "number":
    case "integer":
      return <NumberField key={input.key} {...commonProps} />
    case "boolean":
      return <BooleanField key={input.key} {...commonProps} />
    case "enum":
      return <EnumField key={input.key} {...commonProps} />
    case "select":
      return <SelectField key={input.key} {...commonProps} />
    case "csv":
      return <CSVField key={input.key} {...commonProps} />
    case "json":
      return <JSONField key={input.key} {...commonProps} />
    case "date":
      return <DateField key={input.key} {...commonProps} />
    case "array":
      if (input.widget === "resource_selector") {
        return <ResourceSelectorField key={input.key} {...commonProps} />
      }
      if (input.widget === "community_resources") {
        return <CommunityResourcesField key={input.key} {...commonProps} />
      }
      return <RepeaterField key={input.key} {...commonProps} />
    default:
      return null
  }
}
