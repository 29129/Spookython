const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { createDiagnosticHandler } = require('../src/diagnostic-handler')
const key = 'local-test-only-control-key-1234567890'
process.env.SIMULATOR_API_KEY_SHA256 = crypto.createHash('sha256').update(key).digest('hex')
process.env.WORLD_STATE_TABLE_NAME = 'test-world'
const event = { headers: { 'x-api-key': key }, requestContext: { http: { method: 'POST' } } }
function fixture() {
  let locked = false
  const calls = []
  const handler = createDiagnosticHandler({
    db: { async send(command) {
      assert.equal(command.input.TableName, 'test-world')
      assert.equal((command.input.Key || command.input.Item).worldId, 'refugio593-diagnostics')
      if (command.constructor.name === 'GetCommand') return { Item: locked ? {} : undefined }
      assert.equal(command.input.ConditionExpression, 'attribute_not_exists(worldId)')
      if (locked) throw Object.assign(new Error(), { name: 'ConditionalCheckFailedException' })
      locked = true
      return {}
    } },
    secrets: { async send(command) { assert.deepEqual(JSON.parse(command.input.SecretString), { apiKey: key }); calls.push('secret'); return {} } },
    build: { async send(command) { assert.equal(command.input.projectName, 'refugio593-latency-final'); calls.push('build'); return { build: { id: 'test-build' } } } },
  })
  return { handler, calls }
}
test('local starter rejects an invalid key before contacting AWS', async () => {
  const { handler, calls } = fixture()
  assert.equal((await handler({ ...event, headers: { 'x-api-key': 'wrong' } })).statusCode, 401)
  assert.deepEqual(calls, [])
})
test('local starter starts one job, returns no key and rejects a repeat', async () => {
  const { handler, calls } = fixture()
  const response = await handler(event)
  assert.equal(response.statusCode, 202)
  assert(!response.body.includes(key))
  assert.equal(JSON.parse(response.body).buildId, 'test-build')
  assert.equal((await handler(event)).statusCode, 409)
  assert.deepEqual(calls, ['secret', 'build'])
})
test('conditional lock prevents concurrent duplicate paid jobs', async () => {
  const { handler, calls } = fixture()
  const responses = await Promise.all([handler(event), handler(event)])
  assert.deepEqual(responses.map(r => r.statusCode).sort(), [202, 409])
  assert.equal(calls.filter(c => c === 'build').length, 1)
})
