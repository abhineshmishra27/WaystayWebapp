import assert from 'node:assert/strict'
import test from 'node:test'
import { hasPermission, PERMISSIONS } from '../src/lib/rbac.ts'

test('owners can only control assigned listing availability', () => {
  assert.equal(hasPermission('OWNER', PERMISSIONS.OWNER_ACCESS), true)
  assert.equal(hasPermission('OWNER', PERMISSIONS.HOTEL_STATUS_MANAGE), true)
  assert.equal(hasPermission('OWNER', PERMISSIONS.HOTEL_CREATE), false)
  assert.equal(hasPermission('OWNER', PERMISSIONS.HOTEL_MANAGE), false)
  assert.equal(hasPermission('OWNER', PERMISSIONS.RESTAURANT_MANAGE), false)
})

test('administrators retain all hotel-content controls', () => {
  assert.equal(hasPermission('ADMIN', PERMISSIONS.PARTNER_APPLICATION_MANAGE), true)
  assert.equal(hasPermission('ADMIN', PERMISSIONS.HOTEL_CREATE), true)
  assert.equal(hasPermission('ADMIN', PERMISSIONS.HOTEL_MANAGE), true)
  assert.equal(hasPermission('ADMIN', PERMISSIONS.HOTEL_STATUS_MANAGE), true)
})
