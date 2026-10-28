import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http2'
import { createHttp2Fetch } from '../scripts/http2-fetch.mjs'

test('HTTP/2 conserva peticiones independientes y cancelar una no cierra la sesión compartida', async () => {
  const server = createServer()
  let sessions = 0, requests = 0
  server.on('session', () => { sessions += 1 })
  server.on('stream', (stream, headers) => {
    requests += 1
    stream.on('error', () => {})
    const reply = () => {
      if (stream.destroyed) return
      stream.respond({':status': 200, 'content-type': 'application/json', 'x-app-duration-ms': '12'})
      stream.end(JSON.stringify({path: headers[':path']}))
    }
    if (headers[':path'] === '/slow') setTimeout(reply, 100)
    else reply()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  const transport = createHttp2Fetch(baseUrl)
  try {
    const responses = await Promise.all(Array.from({length: 20}, (_, i) => transport.fetch(`${baseUrl}/paso?i=${i}`, {method: 'POST', body: '{}'})))
    assert.equal(responses.length, 20)
    assert(responses.every((response) => response.status === 200 && response.headers.get('x-app-duration-ms') === '12'))
    await assert.rejects(transport.fetch(`${baseUrl}/slow`, {signal: AbortSignal.timeout(20)}))
    const next = await transport.fetch(`${baseUrl}/health`)
    assert.deepEqual(await next.json(), {path:'/health'})
    assert.equal(requests, 22)
    assert.equal(sessions, 1)
    await assert.rejects(transport.fetch('http://other.invalid/'))
  } finally {
    await transport.close()
    await new Promise((resolve) => server.close(resolve))
  }
})

test('dos conexiones HTTP/2 reparten los streams sin cambiar las respuestas ni limitar personas', async () => {
  const server = createServer()
  let sessions = 0, requests = 0
  server.on('session', () => { sessions += 1 })
  server.on('stream', (stream) => { requests += 1; stream.respond({':status':200}); stream.end('{}') })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const transport = createHttp2Fetch(origin, {connections:2})
  try {
    const responses = await Promise.all(Array.from({length:200}, () => transport.fetch(`${origin}/paso`)))
    assert.equal(responses.filter((response) => response.ok).length, 200)
    assert.equal(requests, 200)
    assert.equal(sessions, 2)
  } finally { await transport.close(); await new Promise((resolve) => server.close(resolve)) }
})
