import type { Role } from '@prisma/client'

export const PRIMARY_ADMIN_EMAIL = 'waystayrooms@gmail.com'
export const ADMIN_ROLE_CHANGE_CONFIRMATION = 'CONFIRM_ADMIN_ROLE_CHANGE'

export const PERMISSIONS = {
  CUSTOMER_ACCESS: 'customer:access',
  BOOKING_CREATE: 'booking:create',
  REVIEW_CREATE: 'review:create',
  OWNER_ACCESS: 'owner:access',
  HOTEL_STATUS_MANAGE: 'hotel-status:manage',
  HOTEL_CREATE: 'hotel:create',
  HOTEL_MANAGE: 'hotel:manage',
  OWNER_BOOKINGS_MANAGE: 'owner-bookings:manage',
  REVIEW_REPLY: 'review:reply',
  RESTAURANT_MANAGE: 'restaurant:manage',
  ADMIN_ACCESS: 'admin:access',
  USER_MANAGE: 'user:manage',
  HOTEL_APPROVE: 'hotel:approve',
  BOOKING_MANAGE: 'booking:manage',
  REVIEW_MODERATE: 'review:moderate',
  AUDIT_VIEW: 'audit:view',
  PARTNER_APPLICATION_MANAGE: 'partner-application:manage',
} as const

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

const customerPermissions: readonly Permission[] = [
  PERMISSIONS.CUSTOMER_ACCESS,
  PERMISSIONS.BOOKING_CREATE,
  PERMISSIONS.REVIEW_CREATE,
]

const ownerPermissions: readonly Permission[] = [
  ...customerPermissions,
  PERMISSIONS.OWNER_ACCESS,
  PERMISSIONS.HOTEL_STATUS_MANAGE,
]

export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  CUSTOMER: customerPermissions,
  OWNER: ownerPermissions,
  ADMIN: [
    ...ownerPermissions,
    PERMISSIONS.ADMIN_ACCESS,
    PERMISSIONS.HOTEL_CREATE,
    PERMISSIONS.HOTEL_MANAGE,
    PERMISSIONS.OWNER_BOOKINGS_MANAGE,
    PERMISSIONS.REVIEW_REPLY,
    PERMISSIONS.RESTAURANT_MANAGE,
    PERMISSIONS.USER_MANAGE,
    PERMISSIONS.HOTEL_APPROVE,
    PERMISSIONS.BOOKING_MANAGE,
    PERMISSIONS.REVIEW_MODERATE,
    PERMISSIONS.AUDIT_VIEW,
    PERMISSIONS.PARTNER_APPLICATION_MANAGE,
  ],
}

export function normalizeEmail(email: string | null | undefined) {
  return email?.trim().toLowerCase() ?? ''
}

export function isPrimaryAdmin(email: string | null | undefined) {
  return normalizeEmail(email) === PRIMARY_ADMIN_EMAIL
}

export function getEffectiveRole(email: string | null | undefined, storedRole: Role): Role {
  return isPrimaryAdmin(email) ? 'ADMIN' : storedRole
}

export function hasPermission(role: Role | null | undefined, permission: Permission) {
  return Boolean(role && ROLE_PERMISSIONS[role]?.includes(permission))
}

export function meetsRequiredRole(role: Role, requiredRole: string | null | undefined) {
  if (!requiredRole) return true
  if (requiredRole === 'ADMIN') return hasPermission(role, PERMISSIONS.ADMIN_ACCESS)
  if (requiredRole === 'OWNER') return hasPermission(role, PERMISSIONS.OWNER_ACCESS)
  if (requiredRole === 'CUSTOMER') return hasPermission(role, PERMISSIONS.CUSTOMER_ACCESS)
  return false
}

export function sessionHasPermission(
  session: { user?: { role?: Role; isActive?: boolean } } | null | undefined,
  permission: Permission,
) {
  return Boolean(session?.user && session.user.isActive !== false && hasPermission(session.user.role, permission))
}
