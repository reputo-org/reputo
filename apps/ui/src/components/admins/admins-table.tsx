"use client"

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table"
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import { useCallback, useMemo } from "react"
import { ProviderLogo } from "@/components/providers/provider-logo"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ADMIN_QUERY_DEFAULTS } from "@/lib/admins/url-state"
import type {
  AdminListResponseDto,
  AdminListSortField,
  AdminViewDto,
  ListAdminsQueryParams,
} from "@/lib/api/types"
import { cn } from "@/lib/utils"
import { AdminRowActions } from "./admin-row-actions"
import { TimeCell } from "./time-cell"

interface AdminsTableProps {
  data: AdminListResponseDto | undefined
  isLoading: boolean
  isError: boolean
  query: ListAdminsQueryParams
  onChange: (next: Partial<ListAdminsQueryParams>) => void
  actorEmail?: string
}

const SORTABLE_COLUMNS: ReadonlySet<AdminListSortField> = new Set([
  "email",
  "role",
])

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const
const SKELETON_ROWS = [
  "skeleton-row-1",
  "skeleton-row-2",
  "skeleton-row-3",
] as const

export function AdminsTable({
  data,
  isLoading,
  isError,
  query,
  onChange,
  actorEmail,
}: AdminsTableProps) {
  const sortField = query.sortField ?? ADMIN_QUERY_DEFAULTS.sortField
  const sortOrder = query.sortOrder ?? ADMIN_QUERY_DEFAULTS.sortOrder
  const sorting: SortingState = useMemo(
    () => [{ id: sortField, desc: sortOrder === "desc" }],
    [sortField, sortOrder]
  )

  const handleSort = useCallback(
    (columnId: string) => {
      if (!SORTABLE_COLUMNS.has(columnId as AdminListSortField)) return
      if (sortField === columnId) {
        onChange({ sortOrder: sortOrder === "asc" ? "desc" : "asc", page: 1 })
      } else {
        onChange({
          sortField: columnId as AdminListSortField,
          sortOrder: "asc",
          page: 1,
        })
      }
    },
    [sortField, sortOrder, onChange]
  )

  const columns = useMemo<ColumnDef<AdminViewDto>[]>(
    () => [
      {
        id: "email",
        accessorKey: "email",
        header: () => (
          <SortableHeader
            id="email"
            label="Email"
            sorting={sorting}
            onSort={handleSort}
          />
        ),
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium">{row.original.email}</span>
            {row.original.revokedAt ? (
              <span className="border-destructive/40 text-destructive bg-destructive/5 inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                Revoked
              </span>
            ) : null}
          </div>
        ),
      },
      {
        id: "provider",
        accessorKey: "provider",
        header: () => (
          <span className="text-muted-foreground text-xs font-medium">
            Provider
          </span>
        ),
        cell: ({ row }) => (
          <ProviderLogo
            provider={row.original.provider}
            height={14}
            className="opacity-90"
          />
        ),
      },
      {
        id: "role",
        accessorKey: "role",
        header: () => (
          <SortableHeader
            id="role"
            label="Role"
            sorting={sorting}
            onSort={handleSort}
          />
        ),
        cell: ({ row }) => (
          <span className="text-foreground text-sm capitalize">
            {row.original.role}
          </span>
        ),
      },
      {
        id: "lastSignInAt",
        accessorKey: "lastSignInAt",
        header: "Last sign-in",
        cell: ({ row }) => (
          <TimeCell value={row.original.lastSignInAt} emptyLabel="Never" />
        ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => (
          <div className="flex justify-end">
            <AdminRowActions row={row.original} actorEmail={actorEmail} />
          </div>
        ),
      },
    ],
    [actorEmail, handleSort, sorting]
  )

  const table = useReactTable({
    data: data?.results ?? [],
    columns,
    state: { sorting },
    manualSorting: true,
    manualFiltering: true,
    manualPagination: true,
    getCoreRowModel: getCoreRowModel(),
  })

  const total = data?.totalResults ?? 0
  const limit = query.limit ?? 20
  const page = query.page ?? 1
  const totalPages = data?.totalPages ?? Math.max(1, Math.ceil(total / limit))
  const startIndex = total === 0 ? 0 : (page - 1) * limit + 1
  const endIndex = Math.min(page * limit, total)

  const visibleColumns = table
    .getAllColumns()
    .filter((column) => column.getIsVisible())
  const visibleColumnsCount = visibleColumns.length

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex flex-col gap-3">
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="hover:bg-transparent">
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id} className="h-9">
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {isLoading ? (
                SKELETON_ROWS.map((rowKey) => (
                  <TableRow key={rowKey}>
                    {visibleColumns.map((column) => (
                      <TableCell key={`${rowKey}-${column.id}`}>
                        <Skeleton className="h-4 w-24" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : isError ? (
                <TableRow>
                  <TableCell
                    colSpan={visibleColumnsCount}
                    className="text-muted-foreground py-10 text-center"
                  >
                    Failed to load admins. Please refresh and try again.
                  </TableCell>
                </TableRow>
              ) : table.getRowModel().rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={visibleColumnsCount}
                    className="text-muted-foreground py-10 text-center text-sm"
                  >
                    No admins match these filters.
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((row) => {
                  const isRevoked = Boolean(row.original.revokedAt)
                  return (
                    <TableRow
                      key={row.id}
                      className={cn(isRevoked && "text-muted-foreground/80")}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id} className="py-2.5">
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext()
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
          <div className="text-muted-foreground flex items-center gap-4 text-xs">
            <span>
              {isLoading
                ? "Loading…"
                : total === 0
                  ? "No matches"
                  : `${startIndex}–${endIndex} of ${total}`}
            </span>
            <div className="flex items-center gap-2">
              <span>Rows</span>
              <Select
                value={String(limit)}
                onValueChange={(value) =>
                  onChange({ limit: Number(value), page: 1 })
                }
              >
                <SelectTrigger
                  className="h-7 w-16 text-xs"
                  aria-label="Rows per page"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="size-7 p-0"
              onClick={() => onChange({ page: Math.max(1, page - 1) })}
              disabled={page <= 1}
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="size-7 p-0"
              onClick={() => onChange({ page: Math.min(totalPages, page + 1) })}
              disabled={page >= totalPages}
              aria-label="Next page"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}

interface SortableHeaderProps {
  id: AdminListSortField
  label: string
  sorting: SortingState
  onSort: (id: string) => void
}

function SortableHeader({ id, label, sorting, onSort }: SortableHeaderProps) {
  const current = sorting[0]
  const isActive = current?.id === id
  const isDesc = current?.desc ?? false
  const Icon = !isActive ? ArrowUpDown : isDesc ? ArrowDown : ArrowUp
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        "text-muted-foreground -ml-2 h-7 gap-1 px-2 text-xs font-medium",
        isActive && "text-foreground"
      )}
      onClick={() => onSort(id)}
    >
      {label}
      <Icon
        className={cn("size-3", isActive ? "opacity-100" : "opacity-40")}
        aria-hidden="true"
      />
    </Button>
  )
}
