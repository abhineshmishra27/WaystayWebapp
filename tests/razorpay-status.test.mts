import assert from 'node:assert/strict'
import test from 'node:test'
import { waystayStatusForRazorpayRefund } from '../src/lib/razorpay-status.ts'

test('keeps an accepted but unfinished Razorpay refund pending', () => {
  assert.equal(waystayStatusForRazorpayRefund('pending'), 'REFUND_PENDING')
})

test('marks only processed Razorpay refunds as refunded', () => {
  assert.equal(waystayStatusForRazorpayRefund('processed'), 'REFUNDED')
})

test('preserves a failed refund as an operational failure', () => {
  assert.equal(waystayStatusForRazorpayRefund('failed'), 'REFUND_FAILED')
})
