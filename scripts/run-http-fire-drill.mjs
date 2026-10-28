import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { advanceHttpTurn } from '../web/simulator-client.mjs'

const baseUrl = (process.env.SPOOKYTHON_API_BASE_URL || '').replace(/\/$/, '')
const apiKey = process.env.SIMULATOR_API_KEY
if (!baseUrl || !apiKey) throw new Error('Configura SPOOKYTHON_API_BASE_URL y SIMULATOR_API_KEY localmente.')
const pro = process.argv.includes('--pro')
const fast = process.argv.includes('--fast')
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
  const response = await fetch(`${baseUrl}${route}`, body === undefined ? { signal: AbortSignal.timeout(10000) } : {
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
  let state = await request('/simulacion/reiniciar', { round, pro })
  const baseline = new Map(state.survivors.map((survivor) => [survivor.id, baselineTurns(map, survivor.nodeId)]))
  const latencies = [], queueTimes = [], decisionTimes = []
  const httpStatuses = {}
  let timeouts = 0, errors = 0, maxConcurrent = 0, slowTurns = 0, failure = null
  const started = performance.now()
  for (let index = 0; index < 150 && !state.roundFinished; index += 1) {
    if (!fast && performance.now() - started >= 300000) break
    try {
      const result = await advanceHttpTurn({ baseUrl, apiKey, currentState: state, concurrency })
      state = result.state
      maxConcurrent = Math.max(maxConcurrent, result.maxConcurrentRequests)
      if (result.durationMs > 2000) slowTurns += 1
      for (const decision of result.decisions) {
        latencies.push(decision.durationMs)
        queueTimes.push(decision.queueMs)
        decisionTimes.push(decision.queueMs + decision.durationMs)
        httpStatuses[decision.httpStatus] = (httpStatuses[decision.httpStatus] || 0) + 1
        if (decision.timedOut || decision.durationMs > 500) timeouts += 1
        else if (decision.error) errors += 1
      }
      console.log(`R${round} T${state.turn}: activos=${state.summary.activeSurvivors}, rescatados=${state.summary.rescuedSurvivors}, mordidos=${state.summary.bittenSurvivors}`)
    } catch (error) { failure = error.message; break }
    if (!fast) await sleep(Math.max(0, Math.min(2000, (index + 1) * 2000 - (performance.now() - started))))
  }
  if (!fast && !failure) {
    while (performance.now() - started < 300000) await sleep(Math.min(2000, 300000 - (performance.now() - started)))
  }
  const efficiencies = state.survivors.filter((survivor) => survivor.status === 'RESCUED' && survivor.rescuedTurn > 0 && baseline.get(survivor.id) !== null)
    .map((survivor) => Math.min(100, 100 * baseline.get(survivor.id) / survivor.rescuedTurn))
  rounds.push({ round, pro, survivorCount: state.survivors.length, actualDurationSeconds: Number(((performance.now() - started) / 1000).toFixed(2)),
    turns: state.turn, completed: state.roundFinished, rescued: state.summary.rescuedSurvivors, bitten: state.summary.bittenSurvivors,
    activeAtEnd: state.summary.activeSurvivors, survivalPercent: 100 * (state.survivors.length - state.summary.bittenSurvivors) / state.survivors.length,
    meanRouteEfficiencyPercent: efficiencies.length ? Number((efficiencies.reduce((sum, value) => sum + value, 0) / efficiencies.length).toFixed(2)) : null,
    calls: latencies.length, maxConcurrentRequests: maxConcurrent, p95HttpMs: percentile(latencies, 0.95), maxHttpMs: percentile(latencies, 1),
    p95QueueMs: percentile(queueTimes, .95), p95QueuePlusHttpMs: percentile(decisionTimes, .95), httpStatuses,
    timeouts, errors, errorOrTimeoutPercent: latencies.length ? 100 * (timeouts + errors) / latencies.length : null,
    invalidMoves: state.metrics?.invalidMoves || 0, slowTurns, allCallsWithinDeadline: timeouts === 0,
    allTurnsWithinCadence: slowTurns === 0,
    refugeOverflow: state.refuges.some((refuge) => refuge.capacity !== null && refuge.occupied > refuge.capacity),
    failure })
}
const report = { generatedAt: new Date().toISOString(), source: 'HTTP real desde el equipo que ejecuta el script; no mide solo el algoritmo.',
  baseUrl, pro, accelerated: fast, concurrencyLimit: Number.isFinite(concurrency) ? concurrency : null,
  loadMode: Number.isFinite(concurrency) ? 'CAPPED_NOT_FULL_CONCURRENCY' : 'FULL_CONCURRENCY', deadlineMs: 500, targetTurnMs: 2000, rounds }
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../reports/http')
await mkdir(directory, { recursive: true })
const destination = path.join(directory, `fire-drill-${pro ? 'pro' : 'base'}${Number.isFinite(concurrency) ? `-capped-${concurrency}` : ''}-latest.json`)
await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
console.log(`Reporte guardado: ${destination}`)
if (rounds.some((round) => round.failure || round.invalidMoves || round.refugeOverflow || !round.completed
  || round.timeouts || round.errors || round.slowTurns || round.p95HttpMs === null || round.p95HttpMs > 500)) process.exitCode = 1
