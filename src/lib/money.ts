export type MoneyValue = number | string | { toString(): string }

function decimalParts(value: MoneyValue) {
  const normalized = value.toString().trim()
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(normalized)
  if (!match) throw new Error('Invalid monetary value')

  return {
    negative: match[1] === '-',
    whole: match[2],
    fraction: match[3] ?? '',
  }
}

export function moneyToNumber(value: MoneyValue) {
  const amount = Number(value.toString())
  if (!Number.isFinite(amount)) throw new Error('Invalid monetary value')
  return amount
}

export function rupeesToPaise(value: MoneyValue) {
  const { negative, whole, fraction } = decimalParts(value)
  const wholePaise = BigInt(whole) * BigInt(100)
  const fractionPaise = BigInt((fraction + '00').slice(0, 2))
  const shouldRoundUp = Number(fraction[2] ?? '0') >= 5
  const absolutePaise = wholePaise + fractionPaise + (shouldRoundUp ? BigInt(1) : BigInt(0))
  const paise = negative ? -absolutePaise : absolutePaise

  if (paise > BigInt(Number.MAX_SAFE_INTEGER) || paise < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error('Monetary value exceeds the supported payment range')
  }
  return Number(paise)
}

export function formatRupees(value: MoneyValue) {
  return moneyToNumber(value).toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}
