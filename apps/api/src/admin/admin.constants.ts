export const ADMIN_ALLOWLIST_STATUSES = ['active', 'revoked', 'all'] as const;
export type AdminAllowlistStatus = (typeof ADMIN_ALLOWLIST_STATUSES)[number];

export const ADMIN_ALLOWLIST_SORT_FIELDS = ['email', 'invitedAt', 'revokedAt', 'role'] as const;
export type AdminAllowlistSortField = (typeof ADMIN_ALLOWLIST_SORT_FIELDS)[number];

export const ADMIN_ALLOWLIST_SORT_ORDERS = ['asc', 'desc'] as const;
export type AdminAllowlistSortOrder = (typeof ADMIN_ALLOWLIST_SORT_ORDERS)[number];
