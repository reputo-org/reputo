"use client"

import { useFormContext } from "react-hook-form"
import { SubAlgorithmComposerField } from "@/core/fields"
import type { InputGroup } from "@/core/preset-groups"
import { renderScalarField } from "@/core/render-field"
import type { FormInput, FormSchema } from "@/core/schema-builder"

interface ComposerFieldsProps {
  schema: FormSchema
  groups: InputGroup[]
}

function FieldAnchor({
  input,
  children,
}: {
  input: FormInput
  children: React.ReactNode
}) {
  return (
    <div id={`preset-field-${input.key}`} className="scroll-mt-24">
      {children}
    </div>
  )
}

/**
 * The composer's left column: algorithm inputs in titled sections, then a
 * Details section with the preset name and description.
 */
export function ComposerFields({ schema, groups }: ComposerFieldsProps) {
  const { control } = useFormContext()

  const detailInputs = schema.inputs.filter(
    (input) => input.key === "name" || input.key === "description"
  )

  const renderInput = (input: FormInput) => {
    if (input.type === "sub_algorithm") {
      return (
        <FieldAnchor key={input.key} input={input}>
          <SubAlgorithmComposerField
            input={input}
            control={control}
            scoringCopy={schema.description}
            normalization={schema.normalization}
          />
        </FieldAnchor>
      )
    }

    return (
      <FieldAnchor key={input.key} input={input}>
        {renderScalarField(input, control)}
      </FieldAnchor>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {groups.map((group) => (
        <section
          key={group.id}
          className="rounded-xl border bg-card p-5 shadow-xs"
        >
          <div className="mb-4">
            <h2 className="text-base font-semibold">{group.title}</h2>
            {group.description && (
              <p className="text-muted-foreground text-sm">
                {group.description}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-5">
            {group.inputs.map(renderInput)}
          </div>
        </section>
      ))}

      <section className="rounded-xl border bg-card p-5 shadow-xs">
        <div className="mb-4">
          <h2 className="text-base font-semibold">Details</h2>
          <p className="text-muted-foreground text-sm">
            How this preset appears in the presets list.
          </p>
        </div>
        <div className="flex flex-col gap-5">
          {detailInputs.map(renderInput)}
        </div>
      </section>
    </div>
  )
}
