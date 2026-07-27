"use client"

import type {
  AlgorithmDefinition,
  AlgorithmNormalization,
} from "@reputo/reputation-algorithms"
import { ChevronDown, Plus, Trash2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import {
  type Control,
  useFieldArray,
  useFormContext,
  useWatch,
} from "react-hook-form"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { renderScalarField } from "../render-field"
import {
  buildAlgorithmInputFormFields,
  type FormInput,
} from "../schema-builder"
import {
  buildChildInputsArray,
  type ChildAlgorithmOption,
  computeWeightShares,
  formatSharePercent,
  getSelectableChildAlgorithms,
  safeGetDefinition,
  safeGetVersions,
} from "./sub-algorithm-composer-field.utils"
import { SubAlgorithmScoringExplanation } from "./sub-algorithm-scoring-explanation"

interface SubAlgorithmComposerFieldProps {
  input: FormInput
  control: Control<any>
  /** Canonical scoring copy from the parent algorithm definition (markdown). */
  scoringCopy?: string
  normalization?: AlgorithmNormalization | null
}

interface CachedDefinition {
  definition: AlgorithmDefinition
}

interface RowValue {
  algorithm_key?: string
  algorithm_version?: string
  weight?: number | string
}

export function SubAlgorithmComposerField({
  input,
  control,
  scoringCopy,
  normalization,
}: SubAlgorithmComposerFieldProps) {
  const fieldName = input.key
  const { fields, append, remove } = useFieldArray({ control, name: fieldName })

  const childOptions = useMemo(() => getSelectableChildAlgorithms(), [])
  const sharedInputKeys = useMemo(
    () => input.sharedInputKeys ?? [],
    [input.sharedInputKeys]
  )

  const rowValues =
    (useWatch({ control, name: fieldName }) as RowValue[] | undefined) ?? []

  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set())

  const toggleCollapsed = (id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const usedKeys = new Set(
    rowValues
      .map((row) => row?.algorithm_key)
      .filter((key): key is string => Boolean(key))
  )
  const remainingOptions = childOptions.filter(
    (option) => !usedKeys.has(option.key)
  )
  const maxItems = input.maxItems
  const atMaxItems = maxItems !== undefined && fields.length >= maxItems
  const addDisabled = remainingOptions.length === 0 || atMaxItems

  const handleAdd = (option: ChildAlgorithmOption) => {
    append({
      algorithm_key: option.key,
      algorithm_version: option.latestVersion,
      weight: 1,
      inputs: [],
    })
  }

  const shares = computeWeightShares(rowValues)

  return (
    <FormItem>
      <FormLabel>
        {input.label}
        {input.required !== false && (
          <span className="text-destructive ml-1">*</span>
        )}
      </FormLabel>

      {input.description && (
        <p className="text-muted-foreground text-sm">{input.description}</p>
      )}

      <SubAlgorithmScoringExplanation
        copy={scoringCopy}
        normalization={normalization}
      />

      {fields.length === 0 ? (
        <div className="rounded-lg border border-dashed px-4 py-8 text-center">
          <p className="text-muted-foreground text-sm">
            No algorithms added. Add at least one to build a custom score.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {fields.map((field, index) => (
            <SubAlgorithmCard
              key={field.id}
              index={index}
              rowPrefix={`${fieldName}.${index}`}
              control={control}
              childOptions={childOptions}
              sharedInputKeys={sharedInputKeys}
              onRemove={() => {
                remove(index)
                setCollapsedIds((prev) => {
                  if (!prev.has(field.id)) return prev
                  const next = new Set(prev)
                  next.delete(field.id)
                  return next
                })
              }}
              expanded={!collapsedIds.has(field.id)}
              onToggle={() => toggleCollapsed(field.id)}
              rowSummary={rowValues[index]}
              shareLabel={formatSharePercent(
                shares[index]?.sharePercent ?? null
              )}
            />
          ))}
        </div>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            disabled={addDisabled}
          >
            <Plus className="mr-2 size-4" />
            {input.addButtonLabel ?? "Add algorithm"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-80">
          {remainingOptions.map((option) => (
            <DropdownMenuItem
              key={option.key}
              onSelect={() => handleAdd(option)}
              className="flex flex-col items-start gap-0.5 py-2"
            >
              <span className="text-sm font-medium">{option.label}</span>
              {option.summary && (
                <span className="text-muted-foreground line-clamp-2 text-xs">
                  {option.summary}
                </span>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {remainingOptions.length === 0 && fields.length > 0 && (
        <p className="text-muted-foreground text-xs">
          You have added every available algorithm.
        </p>
      )}

      <FormField
        control={control}
        name={fieldName}
        render={() => <FormMessage />}
      />
    </FormItem>
  )
}

interface SubAlgorithmCardProps {
  index: number
  rowPrefix: string
  control: Control<any>
  childOptions: ChildAlgorithmOption[]
  sharedInputKeys: ReadonlyArray<string>
  onRemove: () => void
  expanded: boolean
  onToggle: () => void
  rowSummary: RowValue | undefined
  shareLabel: string
}

function SubAlgorithmCard({
  index,
  rowPrefix,
  control,
  childOptions,
  sharedInputKeys,
  onRemove,
  expanded,
  onToggle,
  rowSummary,
  shareLabel,
}: SubAlgorithmCardProps) {
  const { setValue, getValues, getFieldState, formState } = useFormContext()
  const selectedKey = rowSummary?.algorithm_key ?? ""
  const selectedVersion = rowSummary?.algorithm_version ?? ""
  const weightError = getFieldState(`${rowPrefix}.weight`, formState).error

  const availableVersions = useMemo(() => {
    if (!selectedKey) return []
    return safeGetVersions(selectedKey)
  }, [selectedKey])

  const childDefinition: CachedDefinition | null = useMemo(() => {
    if (!selectedKey || !selectedVersion) return null
    const definition = safeGetDefinition(selectedKey, selectedVersion)
    return definition ? { definition } : null
  }, [selectedKey, selectedVersion])

  useEffect(() => {
    if (!selectedKey) return
    if (selectedVersion && availableVersions.includes(selectedVersion)) return
    const latest = availableVersions[availableVersions.length - 1]
    if (latest) {
      // Normalization, not user intent — must not mark the form dirty.
      setValue(`${rowPrefix}.algorithm_version`, latest, {
        shouldValidate: true,
      })
    }
  }, [availableVersions, rowPrefix, selectedKey, selectedVersion, setValue])

  useEffect(() => {
    if (!childDefinition) {
      return
    }
    const expected = buildChildInputsArray(
      childDefinition.definition,
      sharedInputKeys
    )
    const raw = getValues(`${rowPrefix}.inputs`) as
      | Array<{ key?: string; value?: unknown }>
      | undefined
    const expectedKeys = expected.map((item) => item.key)
    const actualKeys = Array.isArray(raw)
      ? raw.map((item) => item?.key).filter(Boolean)
      : []
    const matches =
      expectedKeys.length === actualKeys.length &&
      expectedKeys.every((key, index) => key === actualKeys[index])
    if (matches) {
      return
    }
    const merged = expected.map((expectedItem) => {
      const existing = raw?.find((item) => item?.key === expectedItem.key)
      return existing && existing.value !== undefined
        ? { key: expectedItem.key, value: existing.value }
        : expectedItem
    })
    setValue(`${rowPrefix}.inputs`, merged, {
      shouldValidate: true,
    })
  }, [childDefinition, getValues, rowPrefix, setValue, sharedInputKeys])

  const childFormFields: FormInput[] = useMemo(() => {
    if (!childDefinition) return []
    return buildAlgorithmInputFormFields(
      childDefinition.definition,
      sharedInputKeys
    )
  }, [childDefinition, sharedInputKeys])

  const selectedLabel = useMemo(() => {
    if (!selectedKey) return null
    return (
      childOptions.find((option) => option.key === selectedKey)?.label ??
      selectedKey
    )
  }, [childOptions, selectedKey])

  return (
    <Collapsible
      open={expanded}
      onOpenChange={onToggle}
      className={cn(
        "rounded-lg border bg-card transition-colors",
        expanded && "border-primary/40 shadow-sm"
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`${expanded ? "Collapse" : "Expand"} child algorithm ${index + 1}`}
            aria-expanded={expanded}
          >
            <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
              {index + 1}
            </span>
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="truncate text-sm font-medium">
                {selectedLabel ?? "Child algorithm"}
              </span>
              {selectedVersion && (
                <Badge variant="secondary" className="shrink-0 text-[10px]">
                  v{selectedVersion}
                </Badge>
              )}
            </span>
            <ChevronDown
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                expanded && "rotate-180"
              )}
              aria-hidden="true"
            />
          </button>
        </CollapsibleTrigger>

        <div className="flex shrink-0 items-center gap-1.5">
          <FormField
            control={control}
            name={`${rowPrefix}.weight`}
            render={({ field, fieldState }) => (
              <Input
                type="number"
                step="any"
                value={field.value ?? ""}
                onChange={(event) => {
                  const raw = event.target.value
                  if (raw === "") {
                    field.onChange("")
                    return
                  }
                  const parsed = Number(raw.replace(",", "."))
                  field.onChange(Number.isFinite(parsed) ? parsed : raw)
                }}
                aria-label={`Weight for child algorithm ${index + 1}`}
                aria-invalid={fieldState.invalid}
                aria-errormessage={
                  fieldState.error ? `${rowPrefix}-weight-error` : undefined
                }
                className="h-8 w-20"
              />
            )}
          />
          <Badge
            variant="outline"
            className="w-12 shrink-0 justify-center font-mono text-[10px]"
            title="Share of the final score"
          >
            {shareLabel}
          </Badge>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={onRemove}
          aria-label={`Remove child algorithm ${index + 1}`}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      {weightError?.message && (
        <p
          id={`${rowPrefix}-weight-error`}
          className="text-destructive px-3 pb-2 text-xs"
        >
          {String(weightError.message)}
        </p>
      )}

      <CollapsibleContent>
        <div className="space-y-4 border-t px-3 py-3">
          {availableVersions.length > 1 && (
            <FormField
              control={control}
              name={`${rowPrefix}.algorithm_version`}
              render={({ field }) => (
                <FormItem className="max-w-48">
                  <FormLabel className="text-xs">Version</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value ?? ""}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select version" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {availableVersions.map((version) => (
                        <SelectItem key={version} value={version}>
                          {version}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          {childDefinition && childFormFields.length > 0 && (
            <div className="flex flex-col gap-4">
              {childFormFields.map((childField, childIndex) =>
                renderScalarField(
                  {
                    ...childField,
                    key: `${rowPrefix}.inputs.${childIndex}.value`,
                  },
                  control
                )
              )}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
