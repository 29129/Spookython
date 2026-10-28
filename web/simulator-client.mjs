async function jsonRequest(baseUrl, path, apiKey, payload, fetchImpl) {
  const response = await fetchImpl(`${baseUrl}${path}`, { method: 'POST',
    signal: AbortSignal.timeout(10000),
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey }, body: JSON.stringify(payload) })
  const body = await response.json()
  if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`)
  return body
}

export async function requestStep(baseUrl, apiKey, survivor, turn, fetchImpl = fetch) {
  const controller = new AbortController()
  const started = performance.now()
  const deadline = setTimeout(() => controller.abort(), 500)
  try {
    const response = await fetchImpl(`${baseUrl}/paso`, { method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ sobrevivienteId: survivor.id, nodoActual: survivor.nodeId, turno: turn }) })
    const body = await response.json()
    const durationMs = performance.now() - started
    return { survivorId: survivor.id, siguienteNodo: response.ok ? body.siguienteNodo : survivor.nodeId,
      durationMs, error: !response.ok || typeof body.siguienteNodo !== 'string', timedOut: durationMs > 500,
      httpStatus: response.status }
  } catch (error) {
    return { survivorId: survivor.id, siguienteNodo: survivor.nodeId, durationMs: performance.now() - started,
      timedOut: controller.signal.aborted, error: !controller.signal.aborted, httpStatus: 0 }
  } finally { clearTimeout(deadline) }
}

export async function advanceHttpTurn({ baseUrl, apiKey, currentState, concurrency = Infinity, fetchImpl = fetch, onProgress = () => {} }) {
  if (concurrency !== Infinity && (!Number.isInteger(concurrency) || concurrency < 1)) throw new Error('La concurrencia debe ser un entero positivo.')
  const started = performance.now()
  const prepared = await jsonRequest(baseUrl, '/estado/avanzar', apiKey,
    { phase: 'PREPARE', expectedTurn: currentState.turn }, fetchImpl)
  const active = prepared.survivors.filter((survivor) => survivor.status === 'ACTIVE')
  let completed = 0
  onProgress(0, active.length)
  // Each dispatched HTTP request keeps its 500 ms deadline. Queue time is separate
  // and remains included in total turn time; capped mode is not a full-load test.
  const decisions = new Array(active.length)
  const queuedAt = performance.now()
  let cursor = 0, inFlight = 0, maxConcurrentRequests = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, active.length) }, async () => {
    while (cursor < active.length) {
      const index = cursor++
      const queueMs = performance.now() - queuedAt
      maxConcurrentRequests = Math.max(maxConcurrentRequests, ++inFlight)
      try {
        decisions[index] = { ...await requestStep(baseUrl, apiKey, active[index], prepared.turn, fetchImpl), queueMs }
      } finally { inFlight -= 1 }
      onProgress(++completed, active.length)
    }
  }))
  const state = await jsonRequest(baseUrl, '/estado/avanzar', apiKey,
    { phase: 'RESOLVE', turnToken: prepared.turnToken, decisions, turnDurationMs: performance.now() - started }, fetchImpl)
  return { state, decisions, maxConcurrentRequests, durationMs: performance.now() - started }
}
