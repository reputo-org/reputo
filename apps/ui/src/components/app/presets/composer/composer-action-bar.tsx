"use client"

import { useFormContext, useWatch } from "react-hook-form"
import { Button } from "@/components/ui/button"
import { useFormUpload } from "@/core/form-context"
import type { FormSchema } from "@/core/schema-builder"
import { computeFieldReadiness } from "./composer-readiness"

interface ComposerActionBarProps {
  schema: FormSchema
  submitLabel: string
  onCancel: () => void
}

/** Mobile submit bar; the review panel covers `lg` and up. */
export function ComposerActionBar({
  schema,
  submitLabel,
  onCancel,
}: ComposerActionBarProps) {
  const { control, formState } = useFormContext()
  const { isUploading } = useFormUpload()

  const watchedValues = useWatch({ control })

  const readiness = computeFieldReadiness(
    schema.inputs,
    watchedValues,
    formState.errors
  )
  const remaining = readiness.filter((item) => item.status !== "done").length

  const isSubmitDisabled =
    formState.isSubmitting || isUploading || !formState.isValid || remaining > 0

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur lg:hidden">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-6 py-3">
        <span className="text-muted-foreground min-w-0 truncate text-sm">
          {isUploading
            ? "Uploading files…"
            : remaining > 0
              ? `${remaining} required field${remaining === 1 ? "" : "s"} left`
              : "Ready to save"}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={isSubmitDisabled}>
            {formState.isSubmitting ? "Saving…" : submitLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
