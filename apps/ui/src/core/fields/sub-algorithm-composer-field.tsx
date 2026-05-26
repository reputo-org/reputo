"use client"

import type { AlgorithmDefinition } from "@reputo/reputation-algorithms"
import { ChevronDown, GripVertical, Plus, Trash2 } from "lucide-react"
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
  FormControl,
  FormDescription,
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
  getSelectableChildAlgorithms,
  safeGetDefinition,
  safeGetVersions,
} from "./sub-algorithm-composer-field.utils"

interface SubAlgorithmComposerFieldProps {
  input: FormInput
  control: Control<any>
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
}: SubAlgorithmComposerFieldProps) {
  const fieldName = input.key
  const { fields, append, remove } = useFieldArray({ control, name: fieldName })

  const childOptions = useMemo(() => getSelectableChildAlgorithms(), [])
  const sharedInputKeys = useMemo(
    () => input.sharedInputKeys ?? [],
    [input.sharedInputKeys]
  )
  const minItems = input.minItems ?? 1

  const rowValues =
    (useWatch({ control, name: fieldName }) as RowValue[] | undefined) ?? []

  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleAddRow = () => {
    append({
      algorithm_key: "",
      algorithm_version: "",
      weight: 1,
      inputs: [],
    })
    setPendingExpand(true)
  }

  const [pendingExpand, setPendingExpand] = useState(false)
  useEffect(() => {
    if (!pendingExpand) return
    const last = fields[fields.length - 1]
    if (!last) {
      setPendingExpand(false)
      return
    }
    setExpandedIds((prev) => {
      if (prev.has(last.id)) return prev
      const next = new Set(prev)
      next.add(last.id)
      return next
    })
    setPendingExpand(false)
  }, [fields, pendingExpand])

  const selectedKeysByIndex = rowValues.map((row) => row?.algorithm_key ?? "")

  return (
    <FormItem>
      <FormLabel>
        {input.label}
        {input.required !== false && (
          <span className="text-destructive ml-1">*</span>
        )}
      </FormLabel>

      {input.description && (
        <FormDescription>{input.description}</FormDescription>
      )}

      <div className="space-y-2">
        {fields.map((field, index) => {
          const row = rowValues[index]
          const takenByOthers = selectedKeysByIndex
            .filter((key, keyIndex) => keyIndex !== index && key)
            .filter((key): key is string => Boolean(key))

          return (
            <SubAlgorithmRow
              key={field.id}
              index={index}
              rowPrefix={`${fieldName}.${index}`}
              control={control}
              childOptions={childOptions}
              sharedInputKeys={sharedInputKeys}
              canRemove={fields.length > minItems}
              onRemove={() => {
                remove(index)
                setExpandedIds((prev) => {
                  if (!prev.has(field.id)) return prev
                  const next = new Set(prev)
                  next.delete(field.id)
                  return next
                })
              }}
              expanded={expandedIds.has(field.id)}
              onToggle={() => toggleExpanded(field.id)}
              takenByOthers={takenByOthers}
              rowSummary={row}
            />
          )
        })}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-3"
        onClick={handleAddRow}
        disabled={
          childOptions.length > 0 &&
          rowValues.filter((r) => r?.algorithm_key).length >=
            childOptions.length
        }
      >
        <Plus className="mr-2 size-4" />
        {input.addButtonLabel ?? "Add sub-algorithm"}
      </Button>

      <FormField
        control={control}
        name={fieldName}
        render={() => <FormMessage />}
      />
    </FormItem>
  )
}

interface SubAlgorithmRowProps {
  index: number
  rowPrefix: string
  control: Control<any>
  childOptions: ChildAlgorithmOption[]
  sharedInputKeys: ReadonlyArray<string>
  canRemove: boolean
  onRemove: () => void
  expanded: boolean
  onToggle: () => void
  takenByOthers: string[]
  rowSummary: RowValue | undefined
}

function SubAlgorithmRow({
  index,
  rowPrefix,
  control,
  childOptions,
  sharedInputKeys,
  canRemove,
  onRemove,
  expanded,
  onToggle,
  takenByOthers,
  rowSummary,
}: SubAlgorithmRowProps) {
  const { setValue } = useFormContext()
  const selectedKey = rowSummary?.algorithm_key ?? ""
  const selectedVersion = rowSummary?.algorithm_version ?? ""

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
      setValue(`${rowPrefix}.algorithm_version`, latest, {
        shouldDirty: true,
        shouldValidate: true,
      })
    }
  }, [availableVersions, rowPrefix, selectedKey, selectedVersion, setValue])

  const { getValues } = useFormContext()

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
      shouldDirty: true,
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

  const takenByOthersSet = useMemo(
    () => new Set(takenByOthers),
    [takenByOthers]
  )

  const weightValue = rowSummary?.weight
  const weightDisplay =
    typeof weightValue === "number" && Number.isFinite(weightValue)
      ? weightValue
      : typeof weightValue === "string" && weightValue !== ""
        ? weightValue
        : null

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
            className="flex flex-1 items-center gap-2 text-left hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            aria-label={`${expanded ? "Collapse" : "Expand"} sub-algorithm ${index + 1}`}
            aria-expanded={expanded}
          >
            <GripVertical
              className="size-4 text-muted-foreground shrink-0"
              aria-hidden="true"
            />
            <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
              {index + 1}
            </span>
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span
                className={cn(
                  "truncate text-sm",
                  selectedLabel ? "font-medium" : "text-muted-foreground italic"
                )}
              >
                {selectedLabel ?? "Unassigned sub-algorithm"}
              </span>
              {selectedVersion && (
                <Badge variant="secondary" className="shrink-0 text-[10px]">
                  v{selectedVersion}
                </Badge>
              )}
              {weightDisplay !== null && (
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  × {weightDisplay}
                </Badge>
              )}
            </span>
            <ChevronDown
              className={cn(
                "size-4 text-muted-foreground transition-transform shrink-0",
                expanded && "rotate-180"
              )}
              aria-hidden="true"
            />
          </button>
        </CollapsibleTrigger>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
          disabled={!canRemove}
          onClick={onRemove}
          aria-label={`Remove sub-algorithm ${index + 1}`}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      <CollapsibleContent>
        <div className="border-t px-3 py-3 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField
              control={control}
              name={`${rowPrefix}.algorithm_key`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">Algorithm</FormLabel>
                  <Select
                    onValueChange={(value) => {
                      field.onChange(value)
                      setValue(`${rowPrefix}.algorithm_version`, "", {
                        shouldDirty: true,
                        shouldValidate: true,
                      })
                    }}
                    value={field.value ?? ""}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select algorithm" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {childOptions.map((option) => {
                        const takenElsewhere = takenByOthersSet.has(option.key)
                        return (
                          <SelectItem
                            key={option.key}
                            value={option.key}
                            disabled={takenElsewhere}
                          >
                            <span className="flex items-center gap-2">
                              <span>{option.label}</span>
                              {takenElsewhere && (
                                <span className="text-[10px] text-muted-foreground">
                                  (already added)
                                </span>
                              )}
                            </span>
                          </SelectItem>
                        )
                      })}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={control}
              name={`${rowPrefix}.algorithm_version`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">Version</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value ?? ""}
                    disabled={!selectedKey || availableVersions.length === 0}
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

            <FormField
              control={control}
              name={`${rowPrefix}.weight`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">Weight</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="any"
                      min="0"
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
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {childDefinition && childFormFields.length > 0 && (
            <div className="flex flex-col gap-3 pl-3 border-l-2 border-border">
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
