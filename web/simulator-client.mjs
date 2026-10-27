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

export async function advanceHttpTurn({ baseUrl, apiKey, currentState, fetchImpl = fetch, onProgress = () => {} }) {
  const started = performance.now()
  const prepared = await jsonRequest(baseUrl, '/estado/avanzar', apiKey,
    { phase: 'PREPARE', expectedTurn: currentState.turn }, fetchImpl)
  const active = prepared.survivors.filter((survivor) => survivor.status === 'ACTIVE')
  let completed = 0
  onProgress(0, active.length)
  // One real HTTP request per active survivor. The deadline applies independently.
  const decisions = await Promise.all(active.map(async (survivor) => {
    const decision = await requestStep(baseUrl, apiKey, survivor, prepared.turn, fetchImpl)
    onProgress(++completed, active.length)
    return decision
  }))
  const state = await jsonRequest(baseUrl, '/estado/avanzar', apiKey,
    { phase: 'RESOLVE', turnToken: prepared.turnToken, decisions, turnDurationMs: performance.now() - started }, fetchImpl)
  return { state, decisions, durationMs: performance.now() - started }
}
