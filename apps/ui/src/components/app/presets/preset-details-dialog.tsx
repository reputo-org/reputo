"use client"

import {
  type AlgorithmDefinition,
  type ArrayIoItem,
  getAlgorithmDefinition,
  getResourceCatalog,
} from "@reputo/reputation-algorithms"
import { ExternalLink } from "lucide-react"
import Image from "next/image"
import { useMemo } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { getChainMeta, getTargetMeta } from "@/core/chain-token-metadata"
import type { AlgorithmPresetResponseDto } from "@/lib/api/types"
import { FileDisplay } from "../file-display"

interface PresetDetailsDialogProps {
  isOpen: boolean
  onClose: () => void
  preset: AlgorithmPresetResponseDto | null
}

function isStorageKey(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false
  return value.includes("/") || value.startsWith("uploads/")
}

function toTitleCase(str: string): string {
  return str
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
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
          <div key={`${idx}-${String(item)}`} className="text-sm font-medium">
            {typeof item === "object" && item
              ? JSON.stringify(item)
              : String(item)}
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
            <div key={`${idx}-${String(item)}`} className="text-sm font-medium">
              {String(item)}
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

  const properties = definitionInput?.item?.properties ?? []
  const propLabels = new Map(properties.map((p) => [p.key, p.label ?? p.key]))

  return (
    <div className="space-y-1.5">
      {value.map((item, idx) => {
        const itemKey =
          typeof item === "object" && item
            ? Object.values(item as Record<string, unknown>).join("-")
            : String(item)

        if (typeof item !== "object" || !item) {
          return (
            <div key={itemKey} className="text-sm font-medium">
              {String(item)}
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
                chainMeta?.label ?? targetMeta?.label ?? String(v)
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

export function PresetDetailsDialog({
  isOpen,
  onClose,
  preset,
}: PresetDetailsDialogProps) {
  const algorithmDefinition = useMemo(() => {
    if (!preset) return null
    try {
      const definitionJson = getAlgorithmDefinition({
        key: preset.key,
        version: preset.version,
      })
      return JSON.parse(definitionJson) as AlgorithmDefinition
    } catch (error) {
      console.warn(`Could not fetch definition for ${preset.key}:`, error)
      return null
    }
  }, [preset])

  const inputLabels = useMemo(() => {
    const labels: Record<string, string> = {}
    if (algorithmDefinition?.inputs) {
      for (const input of algorithmDefinition.inputs) {
        labels[input.key] = input.label || toTitleCase(input.key)
      }
    }
    return labels
  }, [algorithmDefinition])

  const getLabel = (key: string): string => {
    return inputLabels[key] || toTitleCase(key)
  }

  const getDefinitionInput = (key: string) =>
    algorithmDefinition?.inputs.find((i) => i.key === key)

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>{preset?.name || "Preset details"}</DialogTitle>
          <DialogDescription>
            {preset?.description || "Saved inputs for this algorithm."}
          </DialogDescription>
        </DialogHeader>

        {preset && (
          <div className="flex-1 overflow-y-auto space-y-4 pr-1">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Algorithm</span>
                <span className="font-medium">{toTitleCase(preset.key)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Version</span>
                <span className="font-medium">{preset.version}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created</span>
                <span className="font-medium">
                  {new Date(preset.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Updated</span>
                <span className="font-medium">
                  {new Date(preset.updatedAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              </div>
            </div>

            <div className="border-t" />

            <div>
              <h3 className="text-sm font-medium mb-2">Inputs</h3>
              <div className="rounded-lg border divide-y">
                {preset.inputs.map((input) => {
                  if (Array.isArray(input.value)) {
                    const defInput = getDefinitionInput(input.key)
                    return (
                      <div key={input.key} className="px-3 py-2 space-y-1.5">
                        <span className="text-sm text-muted-foreground">
                          {getLabel(input.key)}
                        </span>
                        <ArrayValueDisplay
                          value={input.value}
                          definition={algorithmDefinition ?? undefined}
                          definitionInput={
                            defInput?.type === "array"
                              ? (defInput as ArrayIoItem)
                              : undefined
                          }
                        />
                      </div>
                    )
                  }

                  if (isStorageKey(input.value)) {
                    return (
                      <div key={input.key} className="p-2.5">
                        <FileDisplay
                          label={getLabel(input.key)}
                          storageKey={input.value}
                        />
                      </div>
                    )
                  }

                  return (
                    <div
                      key={input.key}
                      className="flex items-center justify-between px-3 py-2"
                    >
                      <span className="text-sm text-muted-foreground">
                        {getLabel(input.key)}
                      </span>
                      <span className="text-sm font-medium">
                        {String(input.value)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="flex-shrink-0 pt-4 border-t">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
