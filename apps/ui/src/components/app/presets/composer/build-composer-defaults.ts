import type { Algorithm } from "@/core/algorithms"
import { getDefaultValues } from "@/core/form-defaults"
import type { FormSchema } from "@/core/schema-builder"
import type { AlgorithmPresetResponseDto } from "@/lib/api/types"
import { normalizeNumericPresetValue } from "../preset-payload"

/**
 * Form default values for the composer. Without a source preset the form
 * starts from definition defaults plus the suggested name and description;
 * with one (edit or duplicate) the preset's stored values win.
 */
export function buildComposerDefaults(args: {
  schema: FormSchema
  algorithm: Algorithm
  preset?: AlgorithmPresetResponseDto | null
  /** Overrides the source preset's name (e.g. "<name> (copy)"). */
  name?: string
  /** Used only when the source preset has no description. */
  description?: string
}): Record<string, unknown> {
  const { schema, algorithm, preset, name, description } = args
  const userDefaults: Record<string, unknown> = {}

  if (name !== undefined) {
    userDefaults.name = name
  }
  if (description !== undefined) {
    userDefaults.description = description
  }

  if (preset) {
    if (name === undefined && preset.name) {
      userDefaults.name = preset.name
    }
    if (preset.description) {
      userDefaults.description = preset.description
    }

    preset.inputs.forEach((presetInput) => {
      const raw = presetInput.value
      const algoInput = algorithm.inputs.find(
        (input) => input.key === presetInput.key
      )
      if (!algoInput) {
        return
      }
      if (algoInput.type === "array" && Array.isArray(raw)) {
        userDefaults[presetInput.key] = raw
      } else if (algoInput.type === "sub_algorithm" && Array.isArray(raw)) {
        userDefaults[presetInput.key] = raw
      } else {
        const isNumeric = ["number", "integer"].includes(algoInput.type)
        userDefaults[presetInput.key] = isNumeric
          ? normalizeNumericPresetValue(raw)
          : raw
      }
    })
  }

  return getDefaultValues(schema, userDefaults)
}
