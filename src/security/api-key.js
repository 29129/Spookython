const crypto = require('node:crypto')

function checkApiKey(event) {
  const expectedHash = process.env.SIMULATOR_API_KEY_SHA256 || ''
  if (!/^[a-f0-9]{64}$/i.test(expectedHash)) return 'not-configured'

  const headers = event.headers || {}
  const suppliedKey = headers['x-api-key'] || headers['X-Api-Key'] || headers['X-API-Key']
  if (typeof suppliedKey !== 'string' || suppliedKey.length < 32 || suppliedKey.length > 256) return 'invalid'

  const suppliedHash = crypto.createHash('sha256').update(suppliedKey, 'utf8').digest()
  const configuredHash = Buffer.from(expectedHash, 'hex')
  return crypto.timingSafeEqual(suppliedHash, configuredHash) ? 'valid' : 'invalid'
}

module.exports = { checkApiKey }
