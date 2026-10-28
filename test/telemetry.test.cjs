const test = require('node:test')
const assert = require('node:assert/strict')
const { createHandler } = require('../src/handler')

test('la telemetría mide cada petición, identifica la primera y omite cuerpos, claves y rutas arbitrarias', async () => {
  const saved = { name: process.env.AWS_LAMBDA_FUNCTION_NAME, memory: process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE, log: console.log }
  const logs = []
  process.env.AWS_LAMBDA_FUNCTION_NAME = 'local-telemetry-test'
  process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE = '1024'
  console.log = (line) => logs.push(JSON.parse(line))
  try {
    const handler = createHandler({})
    const first = await handler({ rawPath: '/health', requestContext: { http: { method: 'GET' } } }, { awsRequestId: 'first' })
    const second = await handler({ rawPath: '/secret-path', requestContext: { http: { method: 'POST' } },
      headers: { 'x-api-key': 'never-log-secret' }, body: 'never-log-body' })
    assert.equal(first.headers['x-first-invocation'], 'true')
    assert.equal(second.headers['x-first-invocation'], 'false')
    assert.equal(first.headers['x-lambda-memory-mb'], '1024')
    assert(Number(first.headers['x-app-duration-ms']) >= 0)
    assert.equal(logs[0].requestId, 'first')
    assert.equal(logs[1].route, 'OTHER')
    assert(!JSON.stringify(logs).includes('never-log'))
    assert(!JSON.stringify(logs).includes('/secret-path'))
  } finally {
    console.log = saved.log
    if (saved.name === undefined) delete process.env.AWS_LAMBDA_FUNCTION_NAME
    else process.env.AWS_LAMBDA_FUNCTION_NAME = saved.name
    if (saved.memory === undefined) delete process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE
    else process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE = saved.memory
  }
})
