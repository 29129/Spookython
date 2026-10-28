import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { advanceHttpTurn } from '../web/simulator-client.mjs'
import { latencyScore, availabilityScore, rubricSummary } from './rubric.mjs'
import { createHttp2Fetch } from './http2-fetch.mjs'

const baseUrl = (process.env.SPOOKYTHON_API_BASE_URL || '').replace(/\/$/, '')
const apiKey = process.env.SIMULATOR_API_KEY
if (!baseUrl || !apiKey) throw new Error('Configura SPOOKYTHON_API_BASE_URL y SIMULATOR_API_KEY localmente.')
const useHttp2 = process.argv.includes('--http2')
const h2ConnectionsArg = process.argv.find((argument) => argument.startsWith('--http2-connections='))
const h2Connections = h2ConnectionsArg ? Number(h2ConnectionsArg.split('=')[1]) : 1
if (![1, 2].includes(h2Connections) || (h2ConnectionsArg && !useHttp2)) throw new Error('--http2-connections requiere --http2 y admite 1 o 2.')
const transport = useHttp2 ? createHttp2Fetch(baseUrl, {connections: h2Connections}) : null
const fetchImpl = transport?.fetch || fetch
const pro = process.argv.includes('--pro')
const fast = process.argv.includes('--fast')
const runnerContactBites = process.argv.includes('--runner-contact-bites')
const maxTurnsArg = process.argv.find((argument) => argument.startsWith('--max-turns='))
const maxTurns = maxTurnsArg ? Number(maxTurnsArg.split('=')[1]) : 150
if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 150 || (maxTurns !== 150 && !fast)) throw new Error('--max-turns requiere --fast y un entero entre 1 y 150.')
const concurrencyArg = process.argv.find((argument) => argument.startsWith('--concurrency='))
const concurrency = concurrencyArg ? Number(concurrencyArg.split('=')[1]) : Infinity
if (concurrency !== Infinity && (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 200)) throw new Error('--concurrency debe ser un entero entre 1 y 200.')
const roundArg = process.argv.find((argument) => argument.startsWith('--round='))
const selected = roundArg ? [Number(roundArg.split('=')[1])] : [1, 2, 3]
if (selected.some((round) => ![1, 2, 3].includes(round))) throw new Error('--round debe ser 1, 2 o 3.')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const percentile = (values, fraction) => {
  const ordered = [...values].sort((a, b) => a - b)
  return ordered.length ? Number(ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)].toFixed(2)) : null
}
async function request(route, body) {
  const response = await fetchImpl(`${baseUrl}${route}`, body === undefined ? { signal: AbortSignal.timeout(10000) } : {
    signal: AbortSignal.timeout(10000),
    method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey }, body: JSON.stringify(body) })
  const data = await response.json()
  if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`)
  return data
}
function baselineTurns(map, start) {
  const targets = new Set(map.refuges.map((refuge) => refuge.nodeId))
  const adjacency = new Map(map.nodes.map((node) => [node.id, []]))
  for (const street of map.streets) { adjacency.get(street.fromNode).push(street.toNode); adjacency.get(street.toNode).push(street.fromNode) }
  const queue = [[start, 0]], visited = new Set([start])
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const [node, distance] = queue[cursor]
    if (targets.has(node)) return distance
    for (const next of adjacency.get(node)) if (!visited.has(next)) { visited.add(next); queue.push([next, distance + 1]) }
  }
  return null
}

const map = await request('/map')
const rounds = []
console.log(`Prueba HTTP ${pro ? 'Pro' : 'base'}: reinicia el mundo compartido. ${fast ? 'Modo acelerado; no es la prueba oficial de 5 minutos.' : 'Cada ronda dura 5 minutos; evita operar otro controlador.'}`)
for (const round of selected) {
  let state = await request('/simulacion/reiniciar', { round, pro, runnerContactBites })
  if (state.runnerContactBites !== runnerContactBites) throw new Error('La API no confirma el modo de mordida solicitado. Despliega la versión actual antes de certificar estas pruebas.')
  const baseline = new Map(state.survivors.map((survivor) => [survivor.id, baselineTurns(map, survivor.nodeId)]))
  const latencies = [], queueTimes = [], decisionTimes = [], turnDiagnostics = [], serverDurations = []
  const observedMemoryMb = new Set()
  const observedInitializationTypes = new Set(), observedQualifiers = new Set()
  let firstInvocationsWithResponse = 0
  const httpStatuses = {}
  const errorCodes = {}
  let timeouts = 0, errors = 0, maxConcurrent = 0, slowTurns = 0, failure = null
  const started = performance.now()
  for (let index = 0; index < maxTurns && !state.roundFinished; index += 1) {
    if (!fast && performance.now() - started >= 300000) break
    try {
      const result = await advanceHttpTurn({ baseUrl, apiKey, currentState: state, concurrency, fetchImpl })
      state = result.state
      maxConcurrent = Math.max(maxConcurrent, result.maxConcurrentRequests)
      if (result.durationMs > 2000) slowTurns += 1
      for (const decision of result.decisions) {
        latencies.push(decision.durationMs)
        queueTimes.push(decision.queueMs)
        decisionTimes.push(decision.queueMs + decision.durationMs)
        if (Number.isFinite(decision.serverDurationMs)) serverDurations.push(decision.serverDurationMs)
        if (decision.firstInvocation === true) firstInvocationsWithResponse += 1
        if (decision.lambdaMemoryMb) observedMemoryMb.add(decision.lambdaMemoryMb)
        if (decision.initializationType) observedInitializationTypes.add(decision.initializationType)
        if (decision.lambdaQualifier) observedQualifiers.add(decision.lambdaQualifier)
        httpStatuses[decision.httpStatus] = (httpStatuses[decision.httpStatus] || 0) + 1
        if (decision.errorCode) errorCodes[decision.errorCode] = (errorCodes[decision.errorCode] || 0) + 1
        if (decision.timedOut || decision.durationMs > 500) timeouts += 1
        else if (decision.error) errors += 1
      }
      const turnTimeouts = result.decisions.filter((decision) => decision.timedOut || decision.durationMs > 500).length
      const turnErrors = result.decisions.filter((decision) => !decision.timedOut && decision.durationMs <= 500 && decision.error).length
      const waitingWithoutRoute = state.survivors.filter((survivor) => survivor.status === 'ACTIVE' && (survivor.routeNodeIds?.length || 0) <= 1).length
      turnDiagnostics.push({ turn: state.turn, calls: result.decisions.length, timeouts: turnTimeouts, errors: turnErrors,
        p95HttpMs: percentile(result.decisions.map((decision) => decision.durationMs), .95),
        p95HandlerMsReceived: percentile(result.decisions.map((decision) => decision.serverDurationMs).filter(Number.isFinite), .95),
        durationMs: Number(result.durationMs.toFixed(2)), active: state.summary.activeSurvivors, waitingWithoutRoute })
      console.log(`R${round} T${state.turn}: activos=${state.summary.activeSurvivors}, rescatados=${state.summary.rescuedSurvivors}, mordidos=${state.summary.bittenSurvivors}, timeouts=${turnTimeouts}, sin ruta=${waitingWithoutRoute}`)
    } catch (error) { failure = error.message; break }
    if (!fast) await sleep(Math.max(0, Math.min(2000, (index + 1) * 2000 - (performance.now() - started))))
  }
  if (!fast && !failure) {
    let nextNotice = 0
    while (performance.now() - started < 300000) {
      const elapsed = performance.now() - started
      if (elapsed >= nextNotice) {
        const seconds = Math.ceil((300000 - elapsed) / 1000)
        const remaining = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
        console.log(`R${round}: simulación finalizada en T${state.turn}. Esperando ${remaining} para completar los 5 minutos de la ronda; no está bloqueada.`)
        nextNotice = elapsed + 30000
      }
      await sleep(Math.max(0, Math.min(2000, 300000 - (performance.now() - started))))
    }
  }
  console.log(`R${round}: medición terminada. ${round === selected.at(-1) ? 'Preparando reporte.' : 'Iniciando la siguiente ronda.'}`)
  const efficiencies = state.survivors.filter((survivor) => survivor.status === 'RESCUED' && survivor.rescuedTurn > 0 && baseline.get(survivor.id) !== null)
    .map((survivor) => Math.min(100, 100 * baseline.get(survivor.id) / survivor.rescuedTurn))
  rounds.push({ round, pro, survivorCount: state.survivors.length, actualDurationSeconds: Number(((performance.now() - started) / 1000).toFixed(2)),
    turns: state.turn, completed: state.roundFinished, rescued: state.summary.rescuedSurvivors, bitten: state.summary.bittenSurvivors,
    activeAtEnd: state.summary.activeSurvivors, survivalPercent: 100 * (state.survivors.length - state.summary.bittenSurvivors) / state.survivors.length,
    meanRouteEfficiencyPercent: efficiencies.length ? Number((efficiencies.reduce((sum, value) => sum + value, 0) / efficiencies.length).toFixed(2)) : null,
    calls: latencies.length, maxConcurrentRequests: maxConcurrent, p95HttpMs: percentile(latencies, 0.95), maxHttpMs: percentile(latencies, 1),
    p95QueueMs: percentile(queueTimes, .95), p95QueuePlusHttpMs: percentile(decisionTimes, .95), httpStatuses, errorCodes,
    handlerMeasurementsReceived: serverDurations.length, p95HandlerMsReceived: percentile(serverDurations, .95),
    firstInvocationsWithResponse, observedMemoryMb: [...observedMemoryMb],
    observedInitializationTypes: [...observedInitializationTypes], observedQualifiers: [...observedQualifiers],
    timeouts, errors, errorOrTimeoutPercent: latencies.length ? 100 * (timeouts + errors) / latencies.length : null,
    latencyBandScore: latencyScore(percentile(latencies, .95)),
    availabilityBandScore: availabilityScore(errors, timeouts, latencies.length),
    rescuedPercent: 100 * state.summary.rescuedSurvivors / state.survivors.length,
    invalidMoves: state.metrics?.invalidMoves || 0, slowTurns, allCallsWithinDeadline: timeouts === 0,
    allTurnsWithinCadence: slowTurns === 0,
    refugeOverflow: state.refuges.some((refuge) => refuge.capacity !== null && refuge.occupied > refuge.capacity),
    failure })
  rounds.at(-1).turnDiagnostics = turnDiagnostics
  rounds.at(-1).unrescuedSurvivors = state.survivors.filter((survivor) => ['ACTIVE', 'ONBOARD'].includes(survivor.status))
    .map((survivor) => ({ id: survivor.id, nodeId: survivor.nodeId, status: survivor.status,
      hasPlannedRoute: (survivor.routeNodeIds?.length || 0) > 1 }))
}
const report = { generatedAt: new Date().toISOString(), source: 'HTTP real desde el equipo que ejecuta el script; no mide solo el algoritmo.',
  baseUrl, pro, runnerContactBites, accelerated: fast, maxTurns, transport: useHttp2 ? 'HTTP2' : 'NODE_FETCH_DEFAULT',
  http2Connections: useHttp2 ? h2Connections : null,
  telemetryNote: 'Handler excluye inicialización, API Gateway y red. Solo respuestas recibidas aportan telemetría; no describe las peticiones abortadas. firstInvocation no mide Init Duration.',
  concurrencyLimit: Number.isFinite(concurrency) ? concurrency : null,
  rubric: rubricSummary(rounds, { fast, concurrency, runnerContactBites }),
  loadMode: Number.isFinite(concurrency) ? 'CAPPED_NOT_FULL_CONCURRENCY' : 'FULL_CONCURRENCY', deadlineMs: 500, targetTurnMs: 2000, rounds }
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../reports/http')
await mkdir(directory, { recursive: true })
const destination = path.join(directory, `fire-drill-${pro ? 'pro' : 'base'}${runnerContactBites ? '-custom-bites' : ''}${Number.isFinite(concurrency) ? `-capped-${concurrency}` : ''}${maxTurns !== 150 ? `-turns-${maxTurns}` : ''}${useHttp2 ? `-http2${h2Connections === 2 ? '-2connections' : ''}` : ''}-latest.json`)
await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
console.log(`Reporte guardado: ${destination}`)
if (transport) await transport.close()
if (rounds.some((round) => round.failure || round.invalidMoves || round.refugeOverflow || !round.completed
  || round.timeouts || round.errors || round.slowTurns || round.p95HttpMs === null || round.p95HttpMs > 500)) process.exitCode = 1
