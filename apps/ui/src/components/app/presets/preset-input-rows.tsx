"use client"

import {
  type AlgorithmDefinition,
  type ArrayIoItem,
  getResourceCatalog,
} from "@reputo/reputation-algorithms"
import { ExternalLink } from "lucide-react"
import Image from "next/image"
import { Badge } from "@/components/ui/badge"
import { getChainMeta, getTargetMeta } from "@/core/chain-token-metadata"
import {
  computeWeightShares,
  formatSharePercent,
  safeGetDefinition,
} from "@/core/fields/sub-algorithm-composer-field.utils"
import { FileDisplay } from "../file-display"

export interface PresetInputEntry {
  key: string
  value?: unknown
}

export function toTitleCase(str: string): string {
  return str
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function isStorageKey(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false
  return value.includes("/") || value.startsWith("uploads/")
}

/** Renders any leaf value; objects and arrays fall back to JSON, never "[object Object]". */
function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "—"
  }
  if (typeof value === "object") {
    return JSON.stringify(value)
  }
  return String(value)
}

function MetaIcon({ url, label }: { url: string; label: string }) {
  return (
    <Image
      src={url}
      alt={label}
      width={16}
      height={16}
      className="rounded-full shrink-0 inline-block"
      unoptimized
    />
  )
}

function isResourceSelectionItem(
  value: unknown
): value is { chain: string; resource_key: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "chain" in value &&
    "resource_key" in value &&
    typeof (value as { chain?: unknown }).chain === "string" &&
    typeof (value as { resource_key?: unknown }).resource_key === "string"
  )
}

function ResourceSelectorValueDisplay({
  value,
  definition,
  definitionInput,
}: {
  value: unknown[]
  definition: AlgorithmDefinition
  definitionInput: ArrayIoItem
}) {
  const catalog = getResourceCatalog({
    definition,
    inputKey: definitionInput.key,
  })

  if (!catalog) {
    return (
      <div className="space-y-1.5">
        {value.map((item, idx) => (
          <div
            key={`${idx}-${formatValue(item)}`}
            className="text-sm font-medium"
          >
            {formatValue(item)}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      {value.map((item, idx) => {
        if (!isResourceSelectionItem(item)) {
          return (
            <div
              key={`${idx}-${formatValue(item)}`}
              className="text-sm font-medium"
            >
              {formatValue(item)}
            </div>
          )
        }

        const chain = catalog.chains.find(
          (candidate) => candidate.key === item.chain
        )
        const resource = chain?.resources.find(
          (candidate) => candidate.key === item.resource_key
        )

        return (
          <div
            key={`${item.chain}:${item.resource_key}`}
            className="rounded border bg-muted/30 p-2 text-sm"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">
                {chain?.label ?? toTitleCase(item.chain)}
              </span>
              <span className="text-muted-foreground">/</span>
              {resource?.iconUrl && (
                <MetaIcon
                  url={resource.iconUrl}
                  label={resource.label ?? item.resource_key}
                />
              )}
              <span className="font-medium">
                {resource?.label ?? item.resource_key}
              </span>
              {resource?.kind && (
                <Badge
                  variant={resource.kind === "token" ? "secondary" : "outline"}
                  className="capitalize"
                >
                  {resource.kind}
                </Badge>
              )}
              {resource?.explorerUrl && (
                <a
                  href={resource.explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                >
                  <span>{resource.explorerLabel ?? "Explorer"}</span>
                  <ExternalLink className="size-3.5" />
                </a>
              )}
            </div>
            {resource?.identifier && (
              <p className="text-muted-foreground mt-1 break-all font-mono text-xs">
                {resource.identifier}
              </p>
            )}
            {resource?.description && (
              <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                {resource.description}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ArrayValueDisplay({
  value,
  definition,
  definitionInput,
}: {
  value: unknown[]
  definition?: AlgorithmDefinition
  definitionInput?: ArrayIoItem
}) {
  if (definition && definitionInput?.uiHint?.widget === "resource_selector") {
    return (
      <ResourceSelectorValueDisplay
        value={value}
        definition={definition}
        definitionInput={definitionInput}
      />
    )
  }

  if (value.length === 0) {
    return <div className="text-sm font-medium">—</div>
  }

  const properties =
    definitionInput?.item && "properties" in definitionInput.item
      ? definitionInput.item.properties
      : []
  const propLabels = new Map(properties.map((p) => [p.key, p.label ?? p.key]))

  return (
    <div className="space-y-1.5">
      {value.map((item, idx) => {
        const itemKey =
          typeof item === "object" && item
            ? `${idx}-${Object.values(item as Record<string, unknown>)
                .map(formatValue)
                .join("-")}`
            : `${idx}-${formatValue(item)}`

        if (typeof item !== "object" || !item) {
          return (
            <div key={itemKey} className="text-sm font-medium">
              {formatValue(item)}
            </div>
          )
        }

        const entries = Object.entries(item as Record<string, unknown>)
        return (
          <div
            key={itemKey}
            className="flex flex-wrap gap-x-4 gap-y-1 p-2 rounded border bg-muted/30 text-sm"
          >
            {entries.map(([k, v]) => {
              const chain = (item as Record<string, unknown>).chain
              const chainMeta =
                k === "chain" ? getChainMeta(String(v)) : undefined
              const targetMeta =
                (k === "target_identifier" || k === "asset_identifier") && chain
                  ? getTargetMeta(String(chain), String(v))
                  : undefined

              const displayLabel =
                chainMeta?.label ?? targetMeta?.label ?? formatValue(v)
              const iconUrl = chainMeta?.iconUrl ?? targetMeta?.iconUrl

              return (
                <div key={k} className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">
                    {propLabels.get(k) ?? toTitleCase(k)}:
                  </span>
                  {iconUrl && <MetaIcon url={iconUrl} label={displayLabel} />}
                  <span className="font-medium">{displayLabel}</span>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

interface SubAlgorithmEntry {
  algorithm_key?: unknown
  algorithm_version?: unknown
  weight?: unknown
  inputs?: unknown
}

function isSubAlgorithmEntry(value: unknown): value is SubAlgorithmEntry {
  return typeof value === "object" && value !== null && "algorithm_key" in value
}

function toInputEntries(value: unknown): PresetInputEntry[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter(
    (entry): entry is PresetInputEntry =>
      typeof entry === "object" && entry !== null && "key" in entry
  )
}

/**
 * Child algorithms of a combined preset. Each row resolves against the child's
 * own definition so its inputs read the same as they do on its own preset.
 */
function SubAlgorithmValueDisplay({ value }: { value: unknown[] }) {
  const shares = computeWeightShares(
    value.map((entry) =>
      isSubAlgorithmEntry(entry)
        ? { weight: entry.weight as number | string | null | undefined }
        : undefined
    )
  )

  if (value.length === 0) {
    return <div className="text-sm font-medium">—</div>
  }

  return (
    <div className="space-y-2">
      {value.map((entry, idx) => {
        if (!isSubAlgorithmEntry(entry)) {
          return (
            <div
              key={`${idx}-${formatValue(entry)}`}
              className="rounded border bg-muted/30 p-2 text-sm font-medium"
            >
              {formatValue(entry)}
            </div>
          )
        }

        const childKey = String(entry.algorithm_key ?? "")
        const childVersion = String(entry.algorithm_version ?? "")
        const childDefinition = childKey
          ? safeGetDefinition(childKey, childVersion)
          : null
        const childInputs = toInputEntries(entry.inputs)

        return (
          <div
            key={`${childKey}-${childVersion}`}
            className="rounded-lg border bg-muted/30"
          >
            <div className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="text-muted-foreground text-xs tabular-nums">
                {idx + 1}
              </span>
              <span className="text-sm font-medium">
                {childDefinition?.name ||
                  toTitleCase(childKey) ||
                  "Unknown algorithm"}
              </span>
              {childVersion && (
                <Badge variant="outline" className="font-mono text-[10px]">
                  v{childVersion}
                </Badge>
              )}
              <span className="ml-auto flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Weight</span>
                <span className="font-medium">{formatValue(entry.weight)}</span>
                <Badge variant="secondary" className="font-mono">
                  {formatSharePercent(shares[idx]?.sharePercent ?? null)}
                </Badge>
              </span>
            </div>
            {childInputs.length > 0 && (
              <div className="border-t bg-background/60">
                <PresetInputRows
                  inputs={childInputs}
                  definition={childDefinition}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** One row per input, labelled and formatted from the algorithm definition. */
export function PresetInputRows({
  inputs,
  definition,
}: {
  inputs: PresetInputEntry[]
  definition: AlgorithmDefinition | null
}) {
  const getDefinitionInput = (key: string) =>
    definition?.inputs.find((input) => input.key === key)

  return (
    <div className="divide-y">
      {inputs.map((input) => {
        const definitionInput = getDefinitionInput(input.key)
        const label = definitionInput?.label || toTitleCase(input.key)

        if (definitionInput?.type === "sub_algorithm") {
          return (
            <div key={input.key} className="px-3 py-2 space-y-1.5">
              <span className="text-sm text-muted-foreground">{label}</span>
              <SubAlgorithmValueDisplay
                value={Array.isArray(input.value) ? input.value : []}
              />
            </div>
          )
        }

        if (Array.isArray(input.value)) {
          return (
            <div key={input.key} className="px-3 py-2 space-y-1.5">
              <span className="text-sm text-muted-foreground">{label}</span>
              <ArrayValueDisplay
                value={input.value}
                definition={definition ?? undefined}
                definitionInput={
                  definitionInput?.type === "array"
                    ? (definitionInput as ArrayIoItem)
                    : undefined
                }
              />
            </div>
          )
        }

        if (isStorageKey(input.value)) {
          return (
            <div key={input.key} className="p-2.5">
              <FileDisplay label={label} storageKey={input.value} />
            </div>
          )
        }

        return (
          <div
            key={input.key}
            className="flex items-center justify-between gap-4 px-3 py-2"
          >
            <span className="text-sm text-muted-foreground">{label}</span>
            <span className="text-sm font-medium break-all text-right">
              {formatValue(input.value)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
