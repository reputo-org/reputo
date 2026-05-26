"use client"

import { ListFilter, Search, UserPlus, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { ProviderLogo } from "@/components/providers/provider-logo"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { getProviderLabel } from "@/lib/admins/providers"
import { ADMIN_QUERY_DEFAULTS } from "@/lib/admins/url-state"
import type {
  AdminAllowlistStatus,
  AdminRole,
  ListAdminsQueryParams,
  OAuthProviderId,
} from "@/lib/api/types"
import { OAUTH_PROVIDER_IDS } from "@/lib/api/types"

interface AdminsToolbarProps {
  query: ListAdminsQueryParams
  onChange: (next: Partial<ListAdminsQueryParams>) => void
  onAdd: () => void
}

const ANY_VALUE = "any"
const ROLE_OPTIONS: AdminRole[] = ["owner", "admin"]
const STATUS_OPTIONS: AdminAllowlistStatus[] = ["active", "revoked", "all"]

function roleLabel(role: AdminRole): string {
  return role === "owner" ? "Owner" : "Admin"
}

function statusLabel(status: AdminAllowlistStatus): string {
  if (status === "active") return "Active"
  if (status === "revoked") return "Revoked"
  return "All"
}

export function AdminsToolbar({ query, onChange, onAdd }: AdminsToolbarProps) {
  const [searchInput, setSearchInput] = useState(query.q ?? "")
  const onChangeRef = useRef(onChange)
  const queryRef = useRef(query)

  useEffect(() => {
    onChangeRef.current = onChange
    queryRef.current = query
  })

  useEffect(() => {
    setSearchInput(query.q ?? "")
  }, [query.q])

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const trimmed = searchInput.trim()
      const current = queryRef.current.q ?? ""
      if (trimmed !== current) {
        onChangeRef.current({ q: trimmed || undefined, page: 1 })
      }
    }, 300)
    return () => window.clearTimeout(handle)
  }, [searchInput])

  const status: AdminAllowlistStatus =
    query.status ?? ADMIN_QUERY_DEFAULTS.status
  const statusIsDefault = status === ADMIN_QUERY_DEFAULTS.status
  const searchOverridesStatus = Boolean(searchInput.trim()) && status !== "all"

  const activeFilterCount =
    (statusIsDefault ? 0 : 1) + (query.provider ? 1 : 0) + (query.role ? 1 : 0)

  const clearAll = () =>
    onChange({
      status: ADMIN_QUERY_DEFAULTS.status,
      provider: undefined,
      role: undefined,
      page: 1,
    })

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2"
          />
          <Input
            type="text"
            placeholder="Search email…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            className={
              searchInput ? "h-9 pl-8 pr-8 text-sm" : "h-9 pl-8 text-sm"
            }
            aria-label="Search admins by email"
          />
          {searchInput ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setSearchInput("")}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 absolute right-2 top-1/2 -translate-y-1/2 rounded-sm focus-visible:outline-none focus-visible:ring-[3px]"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>

        <FilterPopover
          query={query}
          onChange={onChange}
          activeCount={activeFilterCount}
          onClear={clearAll}
        />

        <Button type="button" size="sm" onClick={onAdd} className="h-9">
          <UserPlus className="mr-1.5 size-4" aria-hidden="true" />
          Add admin
        </Button>
      </div>

      {searchOverridesStatus ? (
        <p className="text-muted-foreground text-xs">
          Showing matches across all statuses while searching.
        </p>
      ) : null}

      {activeFilterCount > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {statusIsDefault ? null : (
            <FilterChip
              label={`Status: ${statusLabel(status)}`}
              onRemove={() =>
                onChange({ status: ADMIN_QUERY_DEFAULTS.status, page: 1 })
              }
            />
          )}
          {query.provider ? (
            <FilterChip
              label={`Provider: ${getProviderLabel(query.provider)}`}
              onRemove={() => onChange({ provider: undefined, page: 1 })}
            />
          ) : null}
          {query.role ? (
            <FilterChip
              label={`Role: ${roleLabel(query.role)}`}
              onRemove={() => onChange({ role: undefined, page: 1 })}
            />
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground h-6 px-2 text-xs"
            onClick={clearAll}
          >
            Clear
          </Button>
        </div>
      ) : null}
    </div>
  )
}

interface FilterPopoverProps {
  query: ListAdminsQueryParams
  onChange: (next: Partial<ListAdminsQueryParams>) => void
  activeCount: number
  onClear: () => void
}

function FilterPopover({
  query,
  onChange,
  activeCount,
  onClear,
}: FilterPopoverProps) {
  const status: AdminAllowlistStatus =
    query.status ?? ADMIN_QUERY_DEFAULTS.status

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="text-muted-foreground data-[state=open]:text-foreground h-9 border-dashed text-sm"
        >
          <ListFilter className="mr-1.5 size-4" aria-hidden="true" />
          Filter
          {activeCount > 0 ? (
            <Badge
              variant="secondary"
              className="ml-1.5 h-5 px-1.5 text-[10px] tabular-nums"
            >
              {activeCount}
            </Badge>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Filters</span>
            {activeCount > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground h-6 px-2 text-xs"
                onClick={onClear}
              >
                Reset
              </Button>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Status</Label>
            <Select
              value={status}
              onValueChange={(value) =>
                onChange({
                  status: value as AdminAllowlistStatus,
                  page: 1,
                })
              }
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {statusLabel(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Provider</Label>
            <Select
              value={query.provider ?? ANY_VALUE}
              onValueChange={(value) =>
                onChange({
                  provider:
                    value === ANY_VALUE
                      ? undefined
                      : (value as OAuthProviderId),
                  page: 1,
                })
              }
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="All providers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY_VALUE}>All providers</SelectItem>
                {OAUTH_PROVIDER_IDS.map((id) => (
                  <SelectItem
                    key={id}
                    value={id}
                    aria-label={getProviderLabel(id)}
                  >
                    <ProviderLogo provider={id} height={14} />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Role</Label>
            <Select
              value={query.role ?? ANY_VALUE}
              onValueChange={(value) =>
                onChange({
                  role: value === ANY_VALUE ? undefined : (value as AdminRole),
                  page: 1,
                })
              }
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="All roles" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY_VALUE}>All roles</SelectItem>
                {ROLE_OPTIONS.map((role) => (
                  <SelectItem key={role} value={role}>
                    {roleLabel(role)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

interface FilterChipProps {
  label: string
  onRemove: () => void
}

function FilterChip({ label, onRemove }: FilterChipProps) {
  return (
    <span className="bg-muted text-foreground inline-flex items-center gap-1 rounded-full py-0.5 pl-2.5 pr-1 text-xs">
      {label}
      <button
        type="button"
        aria-label={`Remove ${label}`}
        onClick={onRemove}
        className="hover:bg-background focus-visible:ring-ring/50 inline-flex size-4 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-[3px]"
      >
        <X className="size-3" />
      </button>
    </span>
  )
}
