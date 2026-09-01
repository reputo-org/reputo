"use client"

import { ExternalLink, Plus, Trash2 } from "lucide-react"
import Image from "next/image"
import {
  type Control,
  useFieldArray,
  useFormContext,
  useWatch,
} from "react-hook-form"
import { badgeVariants } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { getChainMeta, getTargetMeta } from "../chain-token-metadata"
import type {
  ArrayPreset,
  FormInput,
  FormInputProperty,
  SelectOption,
} from "../schema-builder"
import { InlineMarkdown } from "./inline-markdown"

interface RepeaterFieldProps {
  input: FormInput
  control: Control<any>
}

interface RepeaterLikeInput {
  key: string
  label: string
  type: "array"
  description?: string
  required?: boolean
  minItems?: number
  uniqueBy?: string[]
  addButtonLabel?: string
  itemProperties?: FormInputProperty[]
  arrayPresets?: ArrayPreset[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function OptionIcon({ url, label }: { url: string; label: string }) {
  return (
    <Image
      src={url}
      alt={label}
      width={20}
      height={20}
      className="rounded-full shrink-0"
      unoptimized
    />
  )
}

function getDependencyKeys(prop: FormInputProperty): string[] {
  if (Array.isArray(prop.dependsOn)) {
    return prop.dependsOn
  }

  return typeof prop.dependsOn === "string" ? [prop.dependsOn] : []
}

function optionMatchesContext(
  prop: FormInputProperty,
  option: SelectOption,
  rowContextValues?: Record<string, unknown>
): boolean {
  if (option.filters && Object.keys(option.filters).length > 0) {
    return Object.entries(option.filters).every(
      ([key, value]) => String(rowContextValues?.[key] ?? "") === value
    )
  }

  if (option.filterBy == null) {
    return true
  }

  const dependencyKeys = getDependencyKeys(prop)
  const dependencyKey = dependencyKeys[0] ?? "chain"
  return String(rowContextValues?.[dependencyKey] ?? "") === option.filterBy
}

function getVisibleOptions(
  prop: FormInputProperty,
  rowContextValues?: Record<string, unknown>
): SelectOption[] {
  return (prop.options ?? []).filter((option) =>
    optionMatchesContext(prop, option, rowContextValues)
  )
}

function getIconForProperty(
  prop: FormInputProperty,
  value: string,
  rowContextValues?: Record<string, unknown>
): string | undefined {
  if (prop.key === "chain") {
    return getChainMeta(value)?.iconUrl
  }

  if (
    (prop.key === "asset_identifier" ||
      prop.key === "target_identifier" ||
      prop.key === "address") &&
    rowContextValues?.chain
  ) {
    return getTargetMeta(String(rowContextValues.chain), value)?.iconUrl
  }

  return undefined
}

function buildUniqueKey(
  values: Record<string, unknown>,
  uniqueBy?: string[]
): string | null {
  if (!uniqueBy || uniqueBy.length === 0) {
    return null
  }

  const parts: string[] = []
  for (const key of uniqueBy) {
    const value = values[key]
    if (value == null || value === "") {
      return null
    }
    parts.push(String(value))
  }

  return parts.join("\u0000")
}

function buildOptionUniqueKey(params: {
  rowContextValues?: Record<string, unknown>
  uniqueBy?: string[]
  currentPropKey: string
  optionValue: string
}): string | null {
  if (!params.rowContextValues) {
    return null
  }

  return buildUniqueKey(
    {
      ...params.rowContextValues,
      [params.currentPropKey]: params.optionValue,
    },
    params.uniqueBy
  )
}

function buildDefaultValueForProperty(prop: FormInputProperty): unknown {
  if (prop.type === "array") {
    const minItems = prop.minItems ?? 1
    return Array.from({ length: minItems }, () =>
      buildDefaultRow(prop.itemProperties ?? [])
    )
  }

  return prop.default ?? ""
}

function buildDefaultRow(
  properties: FormInputProperty[]
): Record<string, unknown> {
  const row: Record<string, unknown> = {}

  for (const prop of properties) {
    row[prop.key] = buildDefaultValueForProperty(prop)
  }

  return row
}

function getSelectedUniqueKeysInOtherRows(
  values: Array<Record<string, unknown>> | undefined,
  rowIndex: number,
  uniqueBy?: string[]
): Set<string> {
  if (!Array.isArray(values)) return new Set()

  const set = new Set<string>()
  for (let i = 0; i < values.length; i++) {
    if (i === rowIndex) continue
    const row = values[i]
    const uniqueKey = buildUniqueKey(row, uniqueBy)
    if (uniqueKey != null) {
      set.add(uniqueKey)
    }
  }
  return set
}

function PropertyField({
  prop,
  fieldPrefix,
  control,
  rowContextValues,
  onDependentChange,
  selectedUniqueKeysInOtherRows,
  uniqueBy,
}: {
  prop: FormInputProperty
  fieldPrefix: string
  control: Control<any>
  rowContextValues?: Record<string, unknown>
  onDependentChange?: (key: string) => void
  selectedUniqueKeysInOtherRows?: Set<string>
  uniqueBy?: string[]
}) {
  const fieldName = `${fieldPrefix}.${prop.key}`

  if (prop.type === "array" && prop.itemProperties) {
    return (
      <NestedRepeaterField
        input={prop}
        control={control}
        fieldName={fieldName}
        ancestorValues={rowContextValues}
      />
    )
  }

  if (prop.type === "select" && prop.options) {
    const visibleOptions = getVisibleOptions(prop, rowContextValues)

    return (
      <FormField
        control={control}
        name={fieldName}
        render={({ field }) => (
          <FormItem className="flex-1">
            <FormLabel className="text-xs">
              {prop.label}
              {prop.required !== false && (
                <span className="text-destructive ml-0.5">*</span>
              )}
            </FormLabel>
            <Select
              onValueChange={(val) => {
                field.onChange(val)
                onDependentChange?.(prop.key)
              }}
              value={field.value ?? ""}
            >
              <FormControl>
                <SelectTrigger className="w-full">
                  <SelectValue
                    placeholder={`Select ${prop.label.toLowerCase()}`}
                  >
                    {field.value &&
                      (() => {
                        const selected = prop.options?.find(
                          (option) => option.value === field.value
                        )
                        const icon = getIconForProperty(
                          prop,
                          field.value,
                          rowContextValues
                        )
                        if (!selected) return field.value
                        const content = (
                          <span className="flex items-center gap-2">
                            {icon && (
                              <OptionIcon url={icon} label={selected.label} />
                            )}
                            {selected.label}
                          </span>
                        )

                        if (
                          prop.key === "asset_identifier" ||
                          prop.key === "target_identifier" ||
                          prop.key === "address"
                        ) {
                          return (
                            <Tooltip>
                              <TooltipTrigger asChild>{content}</TooltipTrigger>
                              <TooltipContent side="bottom">
                                <span className="font-mono break-all">
                                  {field.value}
                                </span>
                              </TooltipContent>
                            </Tooltip>
                          )
                        }

                        return content
                      })()}
                  </SelectValue>
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {visibleOptions.map((option) => {
                  const icon = getIconForProperty(
                    prop,
                    option.value,
                    rowContextValues
                  )
                  const uniqueKey = buildOptionUniqueKey({
                    rowContextValues,
                    uniqueBy,
                    currentPropKey: prop.key,
                    optionValue: option.value,
                  })
                  const disabled =
                    uniqueKey != null &&
                    (selectedUniqueKeysInOtherRows?.has(uniqueKey) ?? false)

                  return (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                      disabled={disabled}
                    >
                      <span
                        className="flex items-center gap-2"
                        title={
                          prop.key === "asset_identifier" ||
                          prop.key === "target_identifier" ||
                          prop.key === "address"
                            ? option.value
                            : undefined
                        }
                      >
                        {icon && <OptionIcon url={icon} label={option.label} />}
                        {option.label}
                        {disabled && " (already added)"}
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
    )
  }

  return (
    <FormField
      control={control}
      name={fieldName}
      render={({ field }) => (
        <FormItem className="flex-1">
          <FormLabel className="text-xs">
            {prop.label}
            {prop.required !== false && (
              <span className="text-destructive ml-0.5">*</span>
            )}
          </FormLabel>
          <FormControl>
            <Input
              placeholder={prop.description || prop.label}
              {...field}
              value={field.value ?? ""}
              onChange={(event) => {
                field.onChange(event)
                onDependentChange?.(prop.key)
              }}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

function RepeaterRow({
  index,
  fieldPrefix,
  properties,
  control,
  canRemove,
  onRemove,
  selectedUniqueKeysInOtherRows,
  uniqueBy,
  ancestorValues,
}: {
  index: number
  fieldPrefix: string
  properties: FormInputProperty[]
  control: Control<any>
  canRemove: boolean
  onRemove: () => void
  selectedUniqueKeysInOtherRows?: Set<string>
  uniqueBy?: string[]
  ancestorValues?: Record<string, unknown>
}) {
  const { setValue } = useFormContext()
  const rowValues = useWatch({ control, name: fieldPrefix }) as
    | Record<string, unknown>
    | undefined
  const rowContextValues = {
    ...(ancestorValues ?? {}),
    ...(rowValues ?? {}),
  }

  const dependencyMap = new Map<string, FormInputProperty[]>()
  for (const prop of properties) {
    for (const dependencyKey of getDependencyKeys(prop)) {
      const deps = dependencyMap.get(dependencyKey) ?? []
      deps.push(prop)
      dependencyMap.set(dependencyKey, deps)
    }
  }

  const handleDependentChange = (changedKey: string) => {
    const dependents = dependencyMap.get(changedKey)
    if (!dependents) return

    for (const dependent of dependents) {
      setValue(
        `${fieldPrefix}.${dependent.key}`,
        buildDefaultValueForProperty(dependent),
        {
          shouldDirty: true,
          shouldValidate: true,
        }
      )
    }
  }

  const selectedChain =
    rowContextValues.chain != null ? String(rowContextValues.chain) : undefined
  const selectedTarget =
    rowContextValues.target_identifier != null &&
    rowContextValues.target_identifier !== ""
      ? String(rowContextValues.target_identifier)
      : rowContextValues.asset_identifier != null &&
          rowContextValues.asset_identifier !== ""
        ? String(rowContextValues.asset_identifier)
        : rowContextValues.address != null && rowContextValues.address !== ""
          ? String(rowContextValues.address)
          : undefined
  const targetMeta =
    selectedChain && selectedTarget
      ? getTargetMeta(selectedChain, selectedTarget)
      : undefined

  const inlineProperties = properties.filter((prop) => prop.type !== "array")
  const nestedProperties = properties.filter((prop) => prop.type === "array")

  return (
    <div className="flex flex-col gap-3 p-3 rounded-lg border bg-muted/30">
      <div className="flex items-start gap-3">
        <div className="flex-1 flex flex-col gap-3">
          {inlineProperties.length > 0 && (
            <div className="flex items-end gap-3">
              {inlineProperties.map((prop) => (
                <PropertyField
                  key={prop.key}
                  prop={prop}
                  fieldPrefix={fieldPrefix}
                  control={control}
                  rowContextValues={rowContextValues}
                  onDependentChange={handleDependentChange}
                  selectedUniqueKeysInOtherRows={selectedUniqueKeysInOtherRows}
                  uniqueBy={uniqueBy}
                />
              ))}
            </div>
          )}

          {nestedProperties.map((prop) => (
            <PropertyField
              key={prop.key}
              prop={prop}
              fieldPrefix={fieldPrefix}
              control={control}
              rowContextValues={rowContextValues}
              onDependentChange={handleDependentChange}
              selectedUniqueKeysInOtherRows={selectedUniqueKeysInOtherRows}
              uniqueBy={uniqueBy}
            />
          ))}
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0 text-muted-foreground hover:text-destructive"
          disabled={!canRemove}
          onClick={onRemove}
          aria-label={`Remove row ${index + 1}`}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      {targetMeta?.explorerUrl && (
        <a
          href={targetMeta.explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 w-fit text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ExternalLink className="size-3" />
          View on {targetMeta.explorerName}
        </a>
      )}
    </div>
  )
}

function RepeaterFieldBase({
  input,
  control,
  fieldName,
  ancestorValues,
}: {
  input: RepeaterLikeInput
  control: Control<any>
  fieldName: string
  ancestorValues?: Record<string, unknown>
}) {
  const properties = input.itemProperties ?? []
  const minItems = input.minItems ?? 0
  const uniqueBy = input.uniqueBy

  const values = useWatch({ control, name: fieldName }) as
    | Array<Record<string, unknown>>
    | undefined

  const { fields, append, remove, replace } = useFieldArray({
    control,
    name: fieldName,
  })

  return (
    <FormItem>
      <FormLabel>
        {input.label}
        {input.required !== false && (
          <span className="text-destructive ml-1">*</span>
        )}
      </FormLabel>

      {input.description && (
        <FormDescription>
          <InlineMarkdown>{input.description}</InlineMarkdown>
        </FormDescription>
      )}

      {input.arrayPresets && input.arrayPresets.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mt-1">
          {input.arrayPresets.map((preset) => {
            const chains = preset.value
              .map((row) =>
                isRecord(row) && typeof row.chain === "string" ? row.chain : ""
              )
              .filter(Boolean)
              .join(", ")

            return (
              <Tooltip key={preset.label}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className={
                      badgeVariants({ variant: "secondary" }) +
                      " cursor-pointer hover:opacity-80 transition-opacity"
                    }
                    onClick={() => replace(preset.value)}
                  >
                    {preset.label}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <span>
                    {chains
                      ? `Fills ${preset.label} on ${chains}`
                      : `Applies ${preset.value.length} preconfigured row${
                          preset.value.length === 1 ? "" : "s"
                        }`}
                  </span>
                </TooltipContent>
              </Tooltip>
            )
          })}
        </div>
      )}

      <div className="space-y-2">
        {fields.map((field, index) => (
          <RepeaterRow
            key={field.id}
            index={index}
            fieldPrefix={`${fieldName}.${index}`}
            properties={properties}
            control={control}
            canRemove={fields.length > minItems}
            onRemove={() => remove(index)}
            selectedUniqueKeysInOtherRows={getSelectedUniqueKeysInOtherRows(
              values,
              index,
              uniqueBy
            )}
            uniqueBy={uniqueBy}
            ancestorValues={ancestorValues}
          />
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-2"
        onClick={() => append(buildDefaultRow(properties))}
      >
        <Plus className="mr-2 size-4" />
        {input.addButtonLabel ?? "Add item"}
      </Button>

      <FormField
        control={control}
        name={fieldName}
        render={() => <FormMessage />}
      />
    </FormItem>
  )
}

function NestedRepeaterField({
  input,
  control,
  fieldName,
  ancestorValues,
}: {
  input: FormInputProperty
  control: Control<any>
  fieldName: string
  ancestorValues?: Record<string, unknown>
}) {
  if (input.type !== "array" || !input.itemProperties) {
    return null
  }

  return (
    <RepeaterFieldBase
      input={{
        key: input.key,
        label: input.label,
        type: "array",
        description: input.description,
        required: input.required,
        minItems: input.minItems,
        uniqueBy: input.uniqueBy,
        addButtonLabel: input.addButtonLabel,
        itemProperties: input.itemProperties,
        arrayPresets: input.arrayPresets,
      }}
      control={control}
      fieldName={fieldName}
      ancestorValues={ancestorValues}
    />
  )
}

export function RepeaterField({ input, control }: RepeaterFieldProps) {
  return (
    <RepeaterFieldBase
      input={{
        key: input.key,
        label: input.label,
        type: "array",
        description: input.description,
        required: input.required,
        minItems: input.minItems,
        uniqueBy: input.uniqueBy as string[] | undefined,
        addButtonLabel: input.addButtonLabel,
        itemProperties: input.itemProperties,
        arrayPresets: input.arrayPresets,
      }}
      control={control}
      fieldName={input.key}
    />
  )
}
