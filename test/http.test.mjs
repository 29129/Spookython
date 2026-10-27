import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { advanceHttpTurn } from '../web/simulator-client.mjs'
const require = createRequire(import.meta.url)
const { localApi } = require('./support.cjs')
const map = require('../src/data/manta.graph.json')
const key = 'local-disposable-test-key-for-http-only-1234'
process.env.SIMULATOR_API_KEY_SHA256 = createHash('sha256').update(key).digest('hex')

test('el cliente consulta HTTP /paso por sobreviviente y el servidor conserva el estado', async () => {
  const api = await localApi()
  try {
    const initial = await (await fetch(`${api.baseUrl}/estado`)).json()
    const result = await advanceHttpTurn({ baseUrl: api.baseUrl, apiKey: key, currentState: initial })
    assert.equal(api.requests.filter((path) => path === '/paso').length, 20)
    assert.equal(result.state.phase, 'READY')
    assert.equal(result.state.turn, 1)
    assert.equal(result.state.metrics.invalidMoves, 0)
    assert(result.decisions.every((decision) => !decision.error && !decision.timedOut), JSON.stringify(result.state.lastTurnMetrics))
    const bad = await fetch(`${api.baseUrl}/paso`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    assert.equal(bad.status, 401)
  } finally { await api.close() }
})

test('dos clientes y un token antiguo no pueden resolver o reiniciar el mismo turno encima del otro', async () => {
  const api = await localApi()
  try {
    const [left, right] = await Promise.all([
      api.store.prepareStoredWorldState(map, {}), api.store.prepareStoredWorldState(map, {}),
    ].map((promise) => promise.then((value) => ({ value }), (error) => ({ error }))))
    assert.equal([left, right].filter((result) => result.error?.name === 'ConditionalCheckFailedException').length, 1)
    const state = (left.value || right.value)
    await api.store.resolveStoredWorldState(map, { turnToken: state.turnToken, decisions: [] })
    await assert.rejects(api.store.resolveStoredWorldState(map, { turnToken: state.turnToken, decisions: [] }), { name: 'StaleTurnError' })
    const reset = await api.store.resetStoredWorldState(map, { round: 3, pro: true })
    assert.equal(reset.vehicles.length, 5)
    assert.equal(reset.survivors.length, 200)
    assert.notEqual(reset.sessionId, state.sessionId)
  } finally { await api.close() }
})

test('un endpoint /paso que tarda más de 500 ms no mueve a nadie', async () => {
  const api = await localApi()
  try {
    const initial = await (await fetch(`${api.baseUrl}/estado`)).json()
    const delayed = async (url, options) => {
      if (url.endsWith('/paso')) await new Promise((resolve) => setTimeout(resolve, 550))
      return fetch(url, options)
    }
    const result = await advanceHttpTurn({ baseUrl: api.baseUrl, apiKey: key, currentState: initial, fetchImpl: delayed })
    assert.equal(result.state.lastTurnMetrics.timeouts, 20)
    for (const survivor of result.state.survivors) assert.equal(survivor.nodeId, initial.survivors.find((item) => item.id === survivor.id).nodeId)
  } finally { await api.close() }
})

test('200 solicitudes HTTP conservan cupos y aplican la espera ante timeout', async () => {
  const api = await localApi()
  try {
    const initial = await api.store.resetStoredWorldState(map, { round: 3, pro: true })
    const result = await advanceHttpTurn({ baseUrl: api.baseUrl, apiKey: key, currentState: initial })
    assert.equal(api.requests.filter((path) => path === '/paso').length, 200)
    assert.equal(result.decisions.length, 200)
    assert.equal(result.state.lastTurnMetrics.invalidMoves, 0)
    assert(result.state.refuges.every((refuge) => refuge.occupied + refuge.reserved <= refuge.capacity))
    const timedOutIds = new Set(result.decisions.filter((decision) => decision.timedOut).map((decision) => decision.survivorId))
    const stored = await api.store.readWorldState()
    assert(!stored.survivorMovements.some((movement) => timedOutIds.has(movement.survivorId)))
    assert.equal(result.state.lastTurnMetrics.timeouts, timedOutIds.size)
    const ordered = result.decisions.map((decision) => decision.durationMs).sort((a, b) => a - b)
    await mkdir(new URL('../reports/audit/', import.meta.url), { recursive: true })
    await writeFile(new URL('../reports/audit/http-local-200-latest.json', import.meta.url), JSON.stringify({
      source: 'Servidor HTTP/1 local de un solo proceso y DynamoDB simulado; no es una medición de AWS.',
      generatedAt: new Date().toISOString(), requests: 200, p95HttpMs: ordered[Math.ceil(ordered.length * .95) - 1],
      timeouts: timedOutIds.size, errors: result.state.lastTurnMetrics.errors,
      allResponsesUnder500Ms: timedOutIds.size === 0, turnDurationMs: result.durationMs,
      fallbackAndCapacityChecks: 'PASSED', cloudConcurrentValidation: 'PENDING',
    }, null, 2))
  } finally { await api.close() }
})
