const { loadEnvFile } = require('node:process')
const Razorpay = require('razorpay')

for (const file of ['.env', '.env.local', '.env.development.local']) {
  try {
    loadEnvFile(file)
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error
  }
}

async function main() {
  const keyId = process.env.RAZORPAY_KEY_ID
  const keySecret = process.env.RAZORPAY_KEY_SECRET
  if (!keyId || !keySecret) throw new Error('Razorpay Key ID or API Secret is missing')

  const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret })
  await razorpay.payments.all({ count: 1 })
  console.log(`Razorpay credentials authenticated successfully in ${keyId.startsWith('rzp_live_') ? 'live' : 'test'} mode.`)
}

main().catch(error => {
  console.error(`Razorpay authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  process.exitCode = 1
})
