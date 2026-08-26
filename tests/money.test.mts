import test from 'node:test'
import assert from 'node:assert/strict'
import { formatRupees, moneyToNumber, rupeesToPaise } from '../src/lib/money.ts'

test('converts fixed-precision rupees to paise exactly', () => {
  assert.equal(rupeesToPaise('4574.00'), 457400)
  assert.equal(rupeesToPaise('123.45'), 12345)
  assert.equal(rupeesToPaise('0.01'), 1)
})

test('rounds excess fractional digits to the nearest paise', () => {
  assert.equal(rupeesToPaise('10.004'), 1000)
  assert.equal(rupeesToPaise('10.005'), 1001)
})

test('converts and formats decimal-like monetary values', () => {
  const decimalLike = { toString: () => '4574.50' }
  assert.equal(moneyToNumber(decimalLike), 4574.5)
  assert.equal(formatRupees(decimalLike), '4,574.5')
})

test('rejects invalid or unsafe monetary values', () => {
  assert.throws(() => rupeesToPaise('not-money'), /Invalid monetary value/)
  assert.throws(() => rupeesToPaise('999999999999999999.00'), /exceeds the supported payment range/)
})
