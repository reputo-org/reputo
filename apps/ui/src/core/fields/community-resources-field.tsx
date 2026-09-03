"use client"

import { Lock, RefreshCw, Search, TriangleAlert, X } from "lucide-react"
import { useId, useState } from "react"
import type { Control } from "react-hook-form"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { useCommunityConnections, useCommunityResources } from "@/lib/api/hooks"
import { useCommunityLiveUpdates } from "@/lib/api/use-community-events"
import {
  describeAccessIssue,
  RESOURCE_ACCESS_RULE,
} from "@/lib/community/platforms"
import { cn } from "@/lib/utils"
import type { FormInput } from "../schema-builder"
import {
  buildResourcePickerModel,
  normalizeResourceSelection,
  type ResourcePickerRow,
} from "./community-resources-field.utils"
import { InlineMarkdown } from "./inline-markdown"
import { useDependentInputValue } from "./use-dependent-input-value"

interface CommunityResourcesFieldProps {
  input: FormInput
  control: Control<any>
}

/** Channel kinds are worth a word; "repository" would only repeat the label. */
const KIND_LABEL: Partial<Record<ResourcePickerRow["kind"], string>> = {
  text: "text",
  announcement: "announcement",
  forum: "forum",
}

/**
 * One resource. The checkbox is the only control; the label spans the row so
 * the whole entry is clickable. An unreadable resource cannot be selected —
 * only deselected, if a stored preset still names it — and says what blocks
 * the bot right under its name.
 */
function ResourceRow({
  row,
  fieldId,
  onToggle,
}: {
  row: ResourcePickerRow
  fieldId: string
  onToggle: (checked: boolean) => void
}) {
  const checkboxId = `${fieldId}-${row.id}`
  const issue = row.readable ? undefined : describeAccessIssue(row.accessIssue)
  const kindLabel = KIND_LABEL[row.kind]

  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-md border px-2.5 py-1.5 transition-colors",
        row.selected
          ? "border-primary/60 bg-primary/5"
          : "border-transparent hover:bg-accent/40",
        !row.readable && "text-muted-foreground"
      )}
    >
      <Checkbox
        id={checkboxId}
        aria-label={row.label}
        checked={row.selected}
        disabled={!row.readable && !row.selected}
        onCheckedChange={(value) => onToggle(value === true)}
        className="mt-0.5"
      />
      <label
        htmlFor={checkboxId}
        className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5"
      >
        <span className="flex min-w-0 items-center gap-2">
          {issue && <Lock className="size-3.5 shrink-0" aria-hidden="true" />}
          <span
            className={cn(
              "truncate text-sm",
              row.readable ? "text-foreground" : "font-normal"
            )}
          >
            {row.label}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {issue && (
              <Badge
                variant="outline"
                className="rounded-full px-2 text-[10px] font-normal"
              >
                {issue.label}
              </Badge>
            )}
            {kindLabel && (
              <span className="text-muted-foreground text-xs">{kindLabel}</span>
            )}
          </span>
        </span>
        {issue && (
          <span className="text-muted-foreground block text-xs leading-snug">
            {issue.description}
          </span>
        )}
      </label>
    </div>
  )
}

function SectionHeading({
  icon,
  children,
}: {
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="text-muted-foreground mt-2 flex items-center gap-1.5 px-1 pt-1 pb-1.5 text-xs font-medium">
      {icon}
      {children}
    </div>
  )
}

/**
 * Definition-driven picker of a connection's resources (Discord channels,
 * GitHub repositories, Mattermost channels): an always-open, searchable list
 * with select-all, so the whole community is visible at once. Every resource
 * carries the platform's read verdict — an unreadable one is shown locked,
 * with the missing permission named — and the list stays live: the events
 * stream refetches it when a probe sees the access change.
 *
 * The resource list follows the `dependsOn` connection input; until a
 * connection is chosen the picker shows a placeholder. Stored ids the
 * connection no longer lists stay visible as removable entries.
 */
export function CommunityResourcesField({
  input,
  control,
}: CommunityResourcesFieldProps) {
  const fieldId = useId()
  const [search, setSearch] = useState("")
  const dependencyValue = useDependentInputValue(
    input.key,
    input.dependsOn,
    control
  )
  const connectionId =
    typeof dependencyValue === "string" ? dependencyValue : ""
  const hasConnection = connectionId !== ""

  useCommunityLiveUpdates({ enabled: hasConnection })
  const { data: connections } = useCommunityConnections({
    enabled: hasConnection,
  })
  const connection = connections?.find(
    (candidate) => candidate.id === connectionId
  )
  const {
    data: resources,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useCommunityResources(connectionId, hasConnection)

  const noun = input.label.toLowerCase()

  return (
    <FormField
      control={control}
      name={input.key}
      render={({ field }) => {
        const selected = normalizeResourceSelection(field.value)
        const model = buildResourcePickerModel({
          resources: resources ?? [],
          selected,
          search,
        })
        const setSelection = (ids: string[]) => field.onChange(ids)
        const toggle = (id: string, checked: boolean) =>
          setSelection(
            checked
              ? [...selected.filter((value) => value !== id), id]
              : selected.filter((value) => value !== id)
          )
        const allReadableSelected =
          model.readableIds.length > 0 &&
          model.readableIds.every((id) => selected.includes(id))
        const listEmpty =
          model.readable.length === 0 && model.unreadable.length === 0

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
                  <FormDescription>
                    <InlineMarkdown>{input.description}</InlineMarkdown>
                  </FormDescription>
                )}
              </div>
              <Badge
                variant="secondary"
                className="shrink-0 rounded-full tabular-nums"
              >
                {selected.length} selected
              </Badge>
            </div>

            {!hasConnection ? (
              <div className="text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-sm">
                Select a connection first to list its {noun}.
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border">
                <div className="bg-muted/40 flex flex-wrap items-center gap-2 border-b px-2.5 py-2">
                  <div className="relative min-w-40 flex-1">
                    <Search
                      className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
                      aria-hidden="true"
                    />
                    <Input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder={`Search ${noun}…`}
                      aria-label={`Search ${noun}`}
                      className="h-8 bg-background pl-8"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8"
                    disabled={
                      model.readableIds.length === 0 || allReadableSelected
                    }
                    onClick={() =>
                      setSelection([
                        ...selected,
                        ...model.readableIds.filter(
                          (id) => !selected.includes(id)
                        ),
                      ])
                    }
                  >
                    Select all readable
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8"
                    disabled={selected.length === 0}
                    onClick={() => setSelection([])}
                  >
                    Clear
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={`Refresh ${noun}`}
                    disabled={isFetching}
                    onClick={() => refetch()}
                  >
                    <RefreshCw
                      className={cn("size-4", isFetching && "animate-spin")}
                      aria-hidden="true"
                    />
                  </Button>
                </div>

                <div className="max-h-80 overflow-y-auto p-1.5">
                  {isLoading ? (
                    <div
                      className="space-y-1.5 p-1"
                      role="status"
                      aria-label={`Loading ${noun}`}
                    >
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-2/3" />
                    </div>
                  ) : isError ? (
                    <div className="text-muted-foreground flex flex-col items-center gap-2 px-4 py-6 text-center text-sm">
                      The {noun} could not be loaded.
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => refetch()}
                      >
                        Try again
                      </Button>
                    </div>
                  ) : listEmpty ? (
                    <p className="text-muted-foreground px-4 py-6 text-center text-sm">
                      {model.counts.total === 0
                        ? `This connection lists no ${noun}.`
                        : `No ${noun} match "${search.trim()}".`}
                    </p>
                  ) : (
                    <>
                      {model.readable.length > 0 && (
                        <div className="space-y-0.5">
                          {model.readable.map((row) => (
                            <ResourceRow
                              key={row.id}
                              row={row}
                              fieldId={fieldId}
                              onToggle={(checked) => toggle(row.id, checked)}
                            />
                          ))}
                        </div>
                      )}
                      {model.unreadable.length > 0 && (
                        <div>
                          <SectionHeading
                            icon={
                              <Lock className="size-3.5" aria-hidden="true" />
                            }
                          >
                            No access · {model.unreadable.length}
                          </SectionHeading>
                          <div className="space-y-0.5">
                            {model.unreadable.map((row) => (
                              <ResourceRow
                                key={row.id}
                                row={row}
                                fieldId={fieldId}
                                onToggle={(checked) => toggle(row.id, checked)}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {model.unavailable.length > 0 && (
                    <div>
                      <SectionHeading
                        icon={
                          <TriangleAlert
                            className="size-3.5"
                            aria-hidden="true"
                          />
                        }
                      >
                        No longer listed · {model.unavailable.length}
                      </SectionHeading>
                      <div className="space-y-0.5">
                        {model.unavailable.map((id) => (
                          <div
                            key={id}
                            className="text-muted-foreground flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm"
                          >
                            <code className="truncate font-mono text-xs">
                              {id}
                            </code>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="ml-auto size-6"
                              aria-label={`Remove ${id}`}
                              onClick={() => toggle(id, false)}
                            >
                              <X className="size-3.5" aria-hidden="true" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {!isLoading && !isError && (
                  <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t px-2.5 py-2 text-xs">
                    <span className="tabular-nums">
                      {model.counts.readable} of {model.counts.total} {noun}{" "}
                      readable
                    </span>
                    {connection && (
                      <span className="min-w-0">
                        {RESOURCE_ACCESS_RULE[connection.platform]}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {model.selectedUnreadable.length > 0 && (
              <Alert variant="destructive">
                <TriangleAlert aria-hidden="true" />
                <AlertDescription>
                  <p>
                    The bot cannot read{" "}
                    {model.selectedUnreadable
                      .map((row) => row.label)
                      .join(", ")}
                    . Fix its access on the platform, or remove{" "}
                    {model.selectedUnreadable.length === 1 ? "it" : "them"} —
                    the preset cannot be saved until then.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setSelection(
                        selected.filter(
                          (id) =>
                            !model.selectedUnreadable.some(
                              (row) => row.id === id
                            )
                        )
                      )
                    }
                  >
                    Remove unreadable
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            <FormMessage />
          </FormItem>
        )
      }}
    />
  )
}
