"use client"

import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Circle,
  Database,
} from "lucide-react"
import { useMemo, useState } from "react"
import { useFormContext, useWatch } from "react-hook-form"
import ReactMarkdown from "react-markdown"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import type { Algorithm } from "@/core/algorithms"
import {
  computeWeightShares,
  formatSharePercent,
  getSelectableChildAlgorithms,
} from "@/core/fields/sub-algorithm-composer-field.utils"
import { useFormUpload } from "@/core/form-context"
import type { FormSchema } from "@/core/schema-builder"
import { cn } from "@/lib/utils"
import {
  buildDisableReasons,
  computeFieldReadiness,
  describeUploadingField,
  type FieldReadiness,
} from "./composer-readiness"

interface ComposerReviewPanelProps {
  algo: Algorithm
  schema: FormSchema
  generalErrors: string[]
  submitLabel: string
  onCancel: () => void
}

const STATUS_TEXT: Record<FieldReadiness["status"], string> = {
  done: "done",
  missing: "still needed",
  error: "needs attention",
}

/** Skips decorative controls (docs disclosures) and hidden file inputs. */
function isUsefulFocusTarget(element: HTMLElement): boolean {
  if (element.closest("[data-composer-skip-focus]")) {
    return false
  }
  if (element instanceof HTMLInputElement && element.type === "file") {
    return false
  }
  return element.offsetParent !== null || element.tagName === "BODY"
}

function focusField(key: string) {
  const anchor = document.getElementById(`preset-field-${key}`)
  if (!anchor) {
    return
  }
  anchor.scrollIntoView({ behavior: "smooth", block: "start" })

  const candidates = Array.from(
    anchor.querySelectorAll<HTMLElement>(
      'input, textarea, [role="combobox"], [role="checkbox"], button'
    )
  )
  candidates.find(isUsefulFocusTarget)?.focus({ preventScroll: true })
}

function ReadinessRow({ item }: { item: FieldReadiness }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => focusField(item.key)}
        aria-label={`${item.label} — ${STATUS_TEXT[item.status]}`}
        className="hover:bg-accent/40 flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm"
      >
        {item.status === "done" ? (
          <CheckCircle2
            className="size-4 shrink-0 text-emerald-500"
            aria-hidden="true"
          />
        ) : item.status === "error" ? (
          <AlertCircle
            className="text-destructive size-4 shrink-0"
            aria-hidden="true"
          />
        ) : (
          <Circle
            className="text-muted-foreground/50 size-4 shrink-0"
            aria-hidden="true"
          />
        )}
        <span
          className={cn(
            "min-w-0 truncate",
            item.status === "done" && "text-muted-foreground"
          )}
        >
          {item.label}
        </span>
      </button>
    </li>
  )
}

function WeightSharesBlock({ subAlgorithmKey }: { subAlgorithmKey: string }) {
  const { control } = useFormContext()
  const rows =
    (useWatch({ control, name: subAlgorithmKey }) as
      | Array<{ algorithm_key?: string; weight?: number | string }>
      | undefined) ?? []
  const childOptions = useMemo(() => getSelectableChildAlgorithms(), [])

  if (rows.length === 0) {
    return null
  }

  const shares = computeWeightShares(rows)

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Score shares</h3>
      <ul className="space-y-1.5">
        {rows.map((row, index) => {
          const label = row.algorithm_key
            ? (childOptions.find((option) => option.key === row.algorithm_key)
                ?.label ?? row.algorithm_key)
            : `Child algorithm ${index + 1}`
          const share = shares[index]?.sharePercent ?? null
          return (
            <li key={`${row.algorithm_key ?? "row"}-${index}`}>
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="min-w-0 truncate">{label}</span>
                <span className="text-muted-foreground shrink-0 font-mono">
                  {formatSharePercent(share)}
                </span>
              </div>
              <div className="bg-muted mt-1 h-1.5 overflow-hidden rounded-full">
                <div
                  className="bg-primary h-full rounded-full transition-all"
                  style={{ width: `${share ?? 0}%` }}
                />
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * The composer's right column: algorithm context plus a live readiness
 * checklist and the submit controls. Hidden below `lg` (the action bar
 * takes over there).
 */
export function ComposerReviewPanel({
  algo,
  schema,
  generalErrors,
  submitLabel,
  onCancel,
}: ComposerReviewPanelProps) {
  const { control, formState } = useFormContext()
  const { isUploading, uploadingFields } = useFormUpload()
  const [aboutOpen, setAboutOpen] = useState(false)

  const watchedValues = useWatch({ control })

  const readiness = computeFieldReadiness(
    schema.inputs,
    watchedValues,
    formState.errors
  )

  const uploadingLabels = uploadingFields.map((key) =>
    describeUploadingField(key, schema.inputs)
  )

  const reasons = buildDisableReasons({
    readiness,
    uploadingLabels,
    isSubmitting: formState.isSubmitting,
  })

  const isSubmitDisabled =
    formState.isSubmitting ||
    isUploading ||
    !formState.isValid ||
    readiness.some((item) => item.status !== "done")

  const subAlgorithmInput = schema.inputs.find(
    (input) => input.type === "sub_algorithm"
  )

  return (
    <aside className="hidden min-w-0 lg:block">
      <div className="lg:sticky lg:top-20 flex flex-col gap-4">
        <section className="rounded-xl border bg-card p-4 shadow-xs">
          <h2 className="text-sm font-semibold">About {algo.title}</h2>
          <p className="text-muted-foreground mt-1 text-sm">{algo.summary}</p>

          {algo.dependencyLabels.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {algo.dependencyLabels.map((label) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-1.5 rounded-md bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                  title="Source of data used by this algorithm"
                >
                  <Database className="size-3" />
                  {label}
                </span>
              ))}
            </div>
          )}

          {schema.outputs.length > 0 && (
            <div className="mt-3 space-y-1.5">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Outputs
              </h3>
              <ul className="space-y-1">
                {schema.outputs.map((output: any) => (
                  <li
                    key={output.key}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <span className="min-w-0 truncate">
                      {output.label ?? output.key}
                    </span>
                    <Badge
                      variant="outline"
                      className="shrink-0 font-mono text-[10px] uppercase"
                    >
                      {output.type}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Collapsible open={aboutOpen} onOpenChange={setAboutOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="text-primary mt-3 inline-flex items-center gap-1 text-xs font-medium hover:underline"
              >
                How it works
                <ChevronDown
                  className={cn(
                    "size-3.5 transition-transform",
                    aboutOpen && "rotate-180"
                  )}
                  aria-hidden="true"
                />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="prose prose-sm dark:prose-invert mt-2 max-h-72 max-w-none overflow-y-auto rounded-md border bg-muted/30 p-3 prose-headings:mt-3 prose-headings:mb-1.5 prose-headings:text-sm prose-p:my-1.5 prose-ul:my-1.5 prose-li:my-0.5">
                <ReactMarkdown>{algo.description}</ReactMarkdown>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </section>

        <section className="rounded-xl border bg-card p-4 shadow-xs">
          <h2 className="text-sm font-semibold">Checklist</h2>
          <ul className="mt-2 space-y-0.5">
            {readiness.map((item) => (
              <ReadinessRow key={item.key} item={item} />
            ))}
          </ul>

          {subAlgorithmInput && (
            <div className="mt-4 border-t pt-3">
              <WeightSharesBlock subAlgorithmKey={subAlgorithmInput.key} />
            </div>
          )}

          {generalErrors.length > 0 && (
            <Alert variant="destructive" className="mt-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {generalErrors.map((message) => (
                  <div key={message}>{message}</div>
                ))}
              </AlertDescription>
            </Alert>
          )}

          <div className="mt-4 flex flex-col gap-2">
            <Button type="submit" disabled={isSubmitDisabled}>
              {formState.isSubmitting
                ? "Saving…"
                : isUploading
                  ? "Uploading…"
                  : submitLabel}
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            {reasons.length > 0 && (
              <ul className="text-muted-foreground list-disc space-y-0.5 pl-4 text-xs">
                {reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </aside>
  )
}
