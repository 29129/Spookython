import test from 'node:test'
import assert from 'node:assert/strict'
import { advanceHttpTurn } from '../web/simulator-client.mjs'

test('la cola limita peticiones, conserva un /paso por persona y mide la espera', async () => {
  const survivors = Array.from({ length: 20 }, (_, i) => ({ id: `S-${i}`, nodeId: `N-${i}`, status: 'ACTIVE' }))
  let pending = 0, peak = 0, calls = 0
  const fetchImpl = async (url, options) => {
    const payload = JSON.parse(options.body)
    if (!url.endsWith('/paso')) return Response.json(payload.phase === 'PREPARE' ? { survivors, turn: 1, turnToken: 'test' } : payload)
    calls += 1
    peak = Math.max(peak, ++pending)
    await new Promise((resolve) => setTimeout(resolve, 15))
    pending -= 1
    return Response.json({ siguienteNodo: payload.nodoActual })
  }
  const result = await advanceHttpTurn({ baseUrl: 'https://test.invalid', apiKey: 'test', currentState: { turn: 0 }, concurrency: 4, fetchImpl })
  assert.equal(calls, 20)
  assert.equal(peak, 4)
  assert.equal(result.maxConcurrentRequests, 4)
  assert.deepEqual(result.decisions.map((d) => d.survivorId), survivors.map((s) => s.id))
  assert(result.decisions[19].queueMs > result.decisions[0].queueMs)
  assert(result.decisions.every((d) => !d.error && !d.timedOut))
  assert.equal(result.state.decisions.length, 20)
})

test('el modo limitado mantiene el plazo de 500 ms por petición y registra cola separada', async () => {
  const survivors = [1, 2].map((i) => ({ id: `S-${i}`, nodeId: `N-${i}`, status: 'ACTIVE' }))
  let calls = 0
  const fetchImpl = async (url, options) => {
    const payload = JSON.parse(options.body)
    if (!url.endsWith('/paso')) return Response.json(payload.phase === 'PREPARE' ? { survivors, turn: 1, turnToken: 'test' } : payload)
    if (++calls === 1) {
      await new Promise((resolve) => setTimeout(resolve, 550))
      options.signal.throwIfAborted()
    }
    return Response.json({ siguienteNodo: 'destination' })
  }
  const result = await advanceHttpTurn({ baseUrl: 'https://test.invalid', apiKey: 'test', currentState: { turn: 0 }, concurrency: 1, fetchImpl })
  assert.equal(result.decisions[0].timedOut, true)
  assert.equal(result.decisions[0].siguienteNodo, 'N-1')
  assert.equal(result.decisions[1].timedOut, false)
  assert.equal(result.decisions[1].siguienteNodo, 'destination')
  assert(result.decisions[1].queueMs >= 500)
  assert(result.durationMs >= 550)
})
