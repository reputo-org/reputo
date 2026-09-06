import type {
  CommunityResourceAccessIssue,
  CommunityResourceDto,
} from "@/lib/api/types"

export interface ResourcePickerRow {
  id: string
  /** Channels keep Discord's `#` convention; repositories show their full name. */
  label: string
  kind: CommunityResourceDto["kind"]
  readable: boolean
  accessIssue?: CommunityResourceAccessIssue
  selected: boolean
}

export interface ResourcePickerCounts {
  total: number
  readable: number
  selected: number
}

export interface ResourcePickerModel {
  /** Readable resources matching the search, in the listing's order. */
  readable: ResourcePickerRow[]
  /** Unreadable resources matching the search, in the listing's order. */
  unreadable: ResourcePickerRow[]
  /** Selected ids the connection no longer lists — a deleted channel, a removed repository. */
  unavailable: string[]
  /** Selected resources the bot cannot read right now. */
  selectedUnreadable: ResourcePickerRow[]
  /** Ids of every readable resource, search aside — what "select all" yields. */
  readableIds: string[]
  counts: ResourcePickerCounts
}

export function displayResourceName(resource: {
  name: string
  kind: string
}): string {
  return resource.kind === "repository" ? resource.name : `#${resource.name}`
}

/** A stored value is a list of ids; anything else reads as nothing selected. */
export function normalizeResourceSelection(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

function matches(row: ResourcePickerRow, search: string): boolean {
  if (search === "") return true
  return (
    row.label.toLowerCase().includes(search) ||
    row.id.toLowerCase().includes(search)
  )
}

export function buildResourcePickerModel(args: {
  resources: readonly CommunityResourceDto[]
  selected: readonly string[]
  search: string
}): ResourcePickerModel {
  const selectedIds = new Set(args.selected)
  const search = args.search.trim().toLowerCase()

  const rows: ResourcePickerRow[] = args.resources.map((resource) => ({
    id: resource.id,
    label: displayResourceName(resource),
    kind: resource.kind,
    readable: resource.readable,
    accessIssue: resource.accessIssue,
    selected: selectedIds.has(resource.id),
  }))
  const listedIds = new Set(rows.map((row) => row.id))

  return {
    readable: rows.filter((row) => row.readable && matches(row, search)),
    unreadable: rows.filter((row) => !row.readable && matches(row, search)),
    unavailable: args.selected.filter((id) => !listedIds.has(id)),
    selectedUnreadable: rows.filter((row) => row.selected && !row.readable),
    readableIds: rows.filter((row) => row.readable).map((row) => row.id),
    counts: {
      total: rows.length,
      readable: rows.filter((row) => row.readable).length,
      selected: args.selected.length,
    },
  }
}
