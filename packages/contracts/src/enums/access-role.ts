export const ACCESS_ROLE_OWNER = 'owner' as const;
export const ACCESS_ROLE_ADMIN = 'admin' as const;
export const ACCESS_ROLES = [ACCESS_ROLE_OWNER, ACCESS_ROLE_ADMIN] as const;
export type AccessRole = (typeof ACCESS_ROLES)[number];
