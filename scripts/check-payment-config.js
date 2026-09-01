const { loadEnvFile } = require('node:process')

for (const file of ['.env', '.env.local', '.env.development.local']) {
  try {
    loadEnvFile(file)
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error
  }
}

const serverKey = process.env.RAZORPAY_KEY_ID || ''
const publicKey = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || ''
const mode = serverKey.startsWith('rzp_live_')
  ? 'live'
  : serverKey.startsWith('rzp_test_')
    ? 'test'
    : 'unknown'

const checks = {
  serverKeyPresent: serverKey.startsWith('rzp_'),
  publicKeyPresent: publicKey.startsWith('rzp_'),
  keysMatch: Boolean(serverKey && serverKey === publicKey),
  apiSecretPresent: Boolean(process.env.RAZORPAY_KEY_SECRET),
  webhookSecretPresent: Boolean(process.env.RAZORPAY_WEBHOOK_SECRET),
  cronSecretPresent: Boolean(process.env.CRON_SECRET),
  mode,
}

checks.productionReady = Boolean(
  checks.serverKeyPresent &&
  checks.publicKeyPresent &&
  checks.keysMatch &&
  checks.apiSecretPresent &&
  checks.webhookSecretPresent &&
  checks.cronSecretPresent
)

console.log(JSON.stringify(checks, null, 2))

const strict = process.argv.includes('--production')
if (!checks.serverKeyPresent || !checks.publicKeyPresent || !checks.keysMatch || !checks.apiSecretPresent || (strict && !checks.productionReady)) {
  process.exitCode = 1
}
