"use client"

import { ExternalLink } from "lucide-react"
import Image from "next/image"
import { useId } from "react"
import type { Control } from "react-hook-form"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import {
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { cn } from "@/lib/utils"
import { getChainMeta } from "../chain-token-metadata"
import type { FormInput } from "../schema-builder"
import {
  buildResourceSelectorPanels,
  normalizeResourceSelections,
  type ResourceSelectorRowViewModel,
  sortResourceSelections,
} from "./resource-selector-field.utils"

interface ResourceSelectorFieldProps {
  input: FormInput
  control: Control<any>
}

function ResourceIcon({ url, label }: { url: string; label: string }) {
  return (
    <Image
      src={url}
      alt=""
      title={label}
      width={20}
      height={20}
      className="rounded-full shrink-0"
      unoptimized
    />
  )
}

/**
 * One catalog entry. The checkbox is the only control for the row — the
 * label spans the whole entry so the entire row stays clickable without a
 * second, redundant tab stop.
 */
function ResourceRow({
  row,
  fieldId,
  onToggle,
}: {
  row: ResourceSelectorRowViewModel
  fieldId: string
  onToggle: (checked: boolean) => void
}) {
  const checkboxId = `${fieldId}-${row.key}`

  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-md border px-2.5 py-2 transition-colors",
        row.selected
          ? "border-primary/60 bg-primary/5"
          : "border-border hover:border-border/80 hover:bg-accent/20"
      )}
    >
      <Checkbox
        id={checkboxId}
        checked={row.selected}
        onCheckedChange={(value) => onToggle(value === true)}
        className="mt-0.5"
      />

      <label
        htmlFor={checkboxId}
        className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5"
        title={row.description}
      >
        {row.iconUrl && (
          <span className="mt-0.5">
            <ResourceIcon url={row.iconUrl} label={row.label} />
          </span>
        )}
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">{row.label}</span>
            <Badge
              variant={row.kind === "token" ? "secondary" : "outline"}
              className="shrink-0 rounded-full px-2 text-[10px] capitalize"
            >
              {row.kindLabel}
            </Badge>
          </span>
          <code className="text-muted-foreground block truncate font-mono text-xs">
            {row.shortIdentifier}
          </code>
        </span>
      </label>

      {row.explorer.href && (
        <a
          href={row.explorer.href}
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground hover:text-foreground mt-0.5 inline-flex shrink-0 items-center gap-1 text-xs"
          title={row.explorer.title}
          aria-label={row.explorer.ariaLabel}
        >
          <ExternalLink className="size-3" aria-hidden="true" />
          <span className="sr-only md:not-sr-only">{row.explorer.label}</span>
        </a>
      )}
    </div>
  )
}

export function ResourceSelectorField({
  input,
  control,
}: ResourceSelectorFieldProps) {
  const fieldId = useId()
  const catalog = input.resourceCatalog

  if (!catalog) {
    return null
  }

  return (
    <FormField
      control={control}
      name={input.key}
      render={({ field }) => {
        const selections = sortResourceSelections(
          normalizeResourceSelections(field.value),
          catalog
        )
        const panels = buildResourceSelectorPanels({
          catalog,
          selections,
          getChainIconUrl: (chainKey) => getChainMeta(chainKey)?.iconUrl,
        })

        const toggleSelection = (
          chainKey: string,
          resourceKey: string,
          checked: boolean
        ) => {
          const selectionKey = `${chainKey}:${resourceKey}`
          const nextSelections = checked
            ? [...selections, { chain: chainKey, resource_key: resourceKey }]
            : selections.filter(
                (selection) =>
                  `${selection.chain}:${selection.resource_key}` !==
                  selectionKey
              )

          field.onChange(sortResourceSelections(nextSelections, catalog))
        }

        return (
          <FormItem className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <FormLabel>
                  {input.label}
                  {input.required !== false && (
                    <span className="text-destructive ml-1">*</span>
                  )}
                </FormLabel>
                {input.description && (
                  <FormDescription>{input.description}</FormDescription>
                )}
              </div>

              <Badge variant="secondary" className="shrink-0 rounded-full">
                {selections.length} selected
              </Badge>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {panels.map((panel) => (
                <fieldset
                  key={panel.key}
                  className="overflow-hidden rounded-lg border"
                >
                  <legend className="sr-only">{panel.label}</legend>
                  <div
                    className="flex items-baseline justify-between border-b bg-muted/40 px-3 py-2"
                    aria-hidden="true"
                  >
                    <h3 className="text-sm font-semibold">{panel.label}</h3>
                    <span className="text-muted-foreground text-xs">
                      {panel.supportedCount} supported
                    </span>
                  </div>

                  <div className="space-y-1.5 p-2">
                    {panel.rows.map((row) => (
                      <ResourceRow
                        key={row.key}
                        row={row}
                        fieldId={fieldId}
                        onToggle={(checked) =>
                          toggleSelection(
                            row.chainKey,
                            row.resourceKey,
                            checked
                          )
                        }
                      />
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>

            <FormMessage />
          </FormItem>
        )
      }}
    />
  )
}
