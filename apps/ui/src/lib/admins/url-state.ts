import type {
  AdminAllowlistStatus,
  AdminListSortField,
  AdminRole,
  ListAdminsQueryParams,
  OAuthProviderId,
  SortOrder,
} from "@/lib/api/types"
import { OAUTH_PROVIDER_IDS } from "@/lib/api/types"

const STATUSES: readonly AdminAllowlistStatus[] = ["active", "revoked", "all"]
const ROLES: readonly AdminRole[] = ["owner", "admin"]
const SORT_FIELDS: readonly AdminListSortField[] = [
  "email",
  "invitedAt",
  "revokedAt",
  "role",
]
const SORT_ORDERS: readonly SortOrder[] = ["asc", "desc"]

export const ADMIN_QUERY_DEFAULTS: Required<
  Pick<
    ListAdminsQueryParams,
    "status" | "sortField" | "sortOrder" | "page" | "limit"
  >
> = {
  status: "active",
  // Sort by role descending so owners surface above admins by default; the
  // repository tie-breaks within the same role by email asc.
  sortField: "role",
  sortOrder: "desc",
  page: 1,
  limit: 20,
}

function parseEnum<T extends string>(
  allowed: readonly T[],
  value: string | null
): T | undefined {
  if (!value) return undefined
  return (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined
}

function parsePositiveInt(value: string | null): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return parsed
}

export function parseAdminQueryParams(
  searchParams: URLSearchParams
): ListAdminsQueryParams {
  const provider = parseEnum<OAuthProviderId>(
    OAUTH_PROVIDER_IDS,
    searchParams.get("provider")
  )
  const role = parseEnum<AdminRole>(ROLES, searchParams.get("role"))
  const status = parseEnum<AdminAllowlistStatus>(
    STATUSES,
    searchParams.get("status")
  )
  const sortField = parseEnum<AdminListSortField>(
    SORT_FIELDS,
    searchParams.get("sortField")
  )
  const sortOrder = parseEnum<SortOrder>(
    SORT_ORDERS,
    searchParams.get("sortOrder")
  )
  const q = searchParams.get("q")?.trim() || undefined
  const page = parsePositiveInt(searchParams.get("page"))
  const limit = parsePositiveInt(searchParams.get("limit"))

  return {
    provider,
    role,
    status: status ?? ADMIN_QUERY_DEFAULTS.status,
    q,
    sortField: sortField ?? ADMIN_QUERY_DEFAULTS.sortField,
    sortOrder: sortOrder ?? ADMIN_QUERY_DEFAULTS.sortOrder,
    page: page ?? ADMIN_QUERY_DEFAULTS.page,
    limit: limit ?? ADMIN_QUERY_DEFAULTS.limit,
  }
}

export function adminQueryToSearchParams(
  params: ListAdminsQueryParams
): URLSearchParams {
  const next = new URLSearchParams()
  if (params.provider) next.set("provider", params.provider)
  if (params.role) next.set("role", params.role)
  if (params.status && params.status !== ADMIN_QUERY_DEFAULTS.status)
    next.set("status", params.status)
  if (params.q) next.set("q", params.q)
  if (params.sortField && params.sortField !== ADMIN_QUERY_DEFAULTS.sortField) {
    next.set("sortField", params.sortField)
  }
  if (params.sortOrder && params.sortOrder !== ADMIN_QUERY_DEFAULTS.sortOrder) {
    next.set("sortOrder", params.sortOrder)
  }
  if (params.page && params.page !== ADMIN_QUERY_DEFAULTS.page)
    next.set("page", String(params.page))
  if (params.limit && params.limit !== ADMIN_QUERY_DEFAULTS.limit)
    next.set("limit", String(params.limit))
  return next
}
