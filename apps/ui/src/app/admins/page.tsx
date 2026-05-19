"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useCallback, useMemo, useState } from "react"
import { AddAdminDialog } from "@/components/admins/add-admin-dialog"
import { AdminsTable } from "@/components/admins/admins-table"
import { AdminsToolbar } from "@/components/admins/admins-toolbar"
import { RoleGate } from "@/components/admins/role-gate"
import {
  ADMIN_QUERY_DEFAULTS,
  adminQueryToSearchParams,
  parseAdminQueryParams,
} from "@/lib/admins/url-state"
import { useAdmins } from "@/lib/api/hooks"
import type { ListAdminsQueryParams } from "@/lib/api/types"
import { useAuthSession } from "@/lib/auth/auth-context"

function AdminsPageContent() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { session } = useAuthSession()
  const actorEmail = session?.user?.email
  const [isAddOpen, setIsAddOpen] = useState(false)

  const query = useMemo<ListAdminsQueryParams>(
    () => parseAdminQueryParams(new URLSearchParams(searchParams.toString())),
    [searchParams]
  )

  // While the user is searching, look across all statuses so a typed email
  // resolves even if it's a revoked row. The toolbar surfaces a hint when the
  // user's explicit status filter is being bypassed.
  const isSearching = Boolean(query.q)
  const effectiveQuery: ListAdminsQueryParams = isSearching
    ? { ...query, status: "all", includeSessions: true }
    : { ...query, includeSessions: true }

  const adminsQuery = useAdmins(effectiveQuery)

  const updateQuery = useCallback(
    (next: Partial<ListAdminsQueryParams>) => {
      const merged: ListAdminsQueryParams = { ...query, ...next }
      // Reset page to 1 when filters change but caller didn't override.
      const filterChanged =
        next.q !== undefined ||
        next.role !== undefined ||
        next.provider !== undefined ||
        next.status !== undefined ||
        next.limit !== undefined
      if (filterChanged && next.page === undefined) {
        merged.page = ADMIN_QUERY_DEFAULTS.page
      }
      const params = adminQueryToSearchParams(merged)
      const queryString = params.toString()
      router.replace(queryString ? `${pathname}?${queryString}` : pathname, {
        scroll: false,
      })
    },
    [pathname, query, router]
  )

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Admins</h1>
        <p className="text-muted-foreground text-sm">
          Manage who can sign in and administer Reputo.
        </p>
      </header>

      <section className="flex flex-col gap-4">
        <AdminsToolbar
          query={query}
          onChange={updateQuery}
          onAdd={() => setIsAddOpen(true)}
        />
        <AdminsTable
          data={adminsQuery.data}
          isLoading={adminsQuery.isLoading}
          isError={adminsQuery.isError}
          query={query}
          onChange={updateQuery}
          actorEmail={actorEmail}
        />
      </section>

      <AddAdminDialog open={isAddOpen} onOpenChange={setIsAddOpen} />
    </div>
  )
}

export default function AdminsPage() {
  return (
    <RoleGate requiredRole="owner">
      <AdminsPageContent />
    </RoleGate>
  )
}
