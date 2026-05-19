/**
 * Shared constants for the admin allowlist surface.
 *
 * The runtime arrays drive both class-validator (`IsIn`) at the DTO boundary
 * and the repository's filter/sort contracts. Keeping a single source removes
 * the drift risk that two parallel literal unions would introduce.
 */

export const ADMIN_ALLOWLIST_STATUSES = ['active', 'revoked', 'all'] as const;
export type AdminAllowlistStatus = (typeof ADMIN_ALLOWLIST_STATUSES)[number];

export const ADMIN_ALLOWLIST_SORT_FIELDS = ['email', 'invitedAt', 'revokedAt', 'role'] as const;
export type AdminAllowlistSortField = (typeof ADMIN_ALLOWLIST_SORT_FIELDS)[number];

export const ADMIN_ALLOWLIST_SORT_ORDERS = ['asc', 'desc'] as const;
export type AdminAllowlistSortOrder = (typeof ADMIN_ALLOWLIST_SORT_ORDERS)[number];
