const { randomUUID } = require('node:crypto')
const { performance } = require('node:perf_hooks')
const { buildAdjacency, shortestPath, stableHash } = require('../domain/graph')
const { planNextStep, survivorRouteCache } = require('../routing/planner')
const { dangerNodes, moveZombie, predictRunners } = require('./zombies')
const { admitSurvivor, moveVehicles, reserveRefuges, updateRefugeStats } = require('./rescue')

const DEFAULT_WORLD_ID = 'manta-demo'
const DEFAULT_SURVIVOR_COUNT = 20
const ROUND_COUNTS = { 1: 20, 2: 80, 3: 200 }
const MAX_TURNS = 150
const invalid = (message) => Object.assign(new Error(message), { name: 'InvalidSimulationRequestError' })

function makeInitialZombies(map, round) {
  const types = round === 1 ? ['WALKER', 'WALKER', 'WALKER', 'WALKER', 'WALKER']
    : round === 2 ? ['WALKER', 'WALKER', 'RUNNER', 'RUNNER', 'HORDE']
      : ['WALKER', 'WALKER', 'RUNNER', 'RUNNER', 'HORDE', 'SLEEPER']
  const used = new Set(map.refuges.map((refuge) => refuge.nodeId))
  const adjacency = buildAdjacency(map)
  const center = map.nodes.reduce((sum, node) => ({ lat: sum.lat + node.lat / map.nodes.length,
    lng: sum.lng + node.lng / map.nodes.length }), { lat: 0, lng: 0 })
  const correction = Math.cos(center.lat * Math.PI / 180)
  const centerDistance = (node) => (node.lat - center.lat) ** 2 + ((node.lng - center.lng) * correction) ** 2
  const centralNodes = [...map.nodes].sort((a, b) => centerDistance(a) - centerDistance(b) || a.id.localeCompare(b.id))
  return types.flatMap((type, index) => {
    let node = map.nodes[[18, 72, 121, 178, 231, 278][index] % map.nodes.length]
    if (type === 'HORDE') {
      // Prefer a central junction without initially closing the entrance to a refuge.
      node = centralNodes.find((candidate) => !used.has(candidate.id)
        && (adjacency.get(candidate.id)?.length || 0) >= 3
        && !adjacency.get(candidate.id).some((edge) => map.refuges.some((refuge) => refuge.nodeId === edge.nodeId)))
        || centralNodes.find((candidate) => !used.has(candidate.id))
    }
    if (!node) return []
    if (used.has(node.id)) node = map.nodes.find((candidate) => !used.has(candidate.id))
    if (!node) return []
    used.add(node.id)
    return [{ id: `Z-${type}-${index + 1}`, type, nodeId: node.id, ...(type === 'SLEEPER' ? { asleep: true } : {}) }]
  })
}

function planSurvivors(state, map) {
  for (const survivor of state.survivors) {
    if (survivor.status !== 'ACTIVE') continue
    const result = planNextStep({ sobrevivienteId: survivor.id, nodoActual: survivor.nodeId, turno: state.turn },
      map, state, survivorRouteCache(survivor, map, state))
    if (result.routeCache) {
      const index = result.routeCache.routeNodeIds.indexOf(survivor.nodeId)
      survivor.routeNodeIds = result.routeCache.routeNodeIds.slice(index)
      survivor.refugeId = result.routeCache.refugeId
    } else survivor.routeNodeIds = [survivor.nodeId]
  }
}

function createInitialState(map, worldId = DEFAULT_WORLD_ID, survivorCount = DEFAULT_SURVIVOR_COUNT, options = {}) {
  if (!Number.isInteger(survivorCount) || survivorCount < 1 || survivorCount > map.nodes.length) throw new RangeError('Cantidad de sobrevivientes inválida.')
  const round = options.round || (survivorCount <= 20 ? 1 : survivorCount <= 80 ? 2 : 3)
  if (!ROUND_COUNTS[round]) throw invalid('round debe ser 1, 2 o 3.')
  const state = { schemaVersion: 2, worldId, sessionId: randomUUID(), revision: 0, phase: 'READY', round,
    pro: options.pro === true, turn: 0, updatedAt: new Date().toISOString(), roundFinished: false,
    zombies: options.zombies || makeInitialZombies(map, round), survivors: [], blockedStreetIds: [], lastEvent: null,
    reservations: {}, vehicles: [], metrics: { requests: 0, errors: 0, timeouts: 0, invalidMoves: 0, slowTurns: 0 } }
  const forbidden = dangerNodes(map, state)
  const refugeNodes = new Set(map.refuges.map((refuge) => refuge.nodeId))
  const used = new Set()
  for (let index = 0; index < survivorCount; index += 1) {
    const preferred = Math.floor(((index + 0.5) * map.nodes.length) / survivorCount)
    const candidates = [...map.nodes.slice(preferred), ...map.nodes.slice(0, preferred)]
    const start = candidates.find((node) => !used.has(node.id) && !forbidden.has(node.id) && !refugeNodes.has(node.id))
      || candidates.find((node) => !forbidden.has(node.id) && !refugeNodes.has(node.id))
    if (!start) throw invalid('No hay nodos seguros suficientes para iniciar la ronda.')
    used.add(start.id)
    state.survivors.push({ id: `S-${String(index + 1).padStart(4, '0')}`, nodeId: start.id, refugeId: null,
      status: 'ACTIVE', routeNodeIds: [start.id] })
  }
  state.refuges = map.refuges.map((refuge) => {
    const capacity = options.refugeCapacities?.[refuge.id] ?? Math.ceil(survivorCount / map.refuges.length)
    if (!Number.isInteger(capacity) || capacity < 0 || capacity > 1000) throw invalid('Las capacidades deben ser enteros entre 0 y 1000.')
    return { ...refuge, capacity: state.pro ? capacity : null, occupied: 0, reserved: 0 }
  })
  if (state.pro) {
    state.vehicles = Array.from({ length: 5 }, (_, index) => ({ id: `V-${index + 1}`,
      nodeId: map.refuges[index % map.refuges.length].nodeId, capacity: 4, passengerIds: [], totalPickedUp: 0,
      routeNodeIds: [], targetSurvivorId: null }))
    reserveRefuges(state, map)
  }
  state.runnerPredictions = predictRunners(map, state)
  state.predictionTurn = state.turn + 1
  planSurvivors(state, map)
  return state
}

function resolveCityEvent(requested, turn, state, map) {
  if (requested && (typeof requested !== 'object' || Array.isArray(requested) || typeof requested.type !== 'string')) throw invalid('cityEvent debe ser un objeto con type.')
  if (requested?.type === 'NONE') return null
  const automatic = state.round === 2 && turn === 5 ? 'BRIDGE_COLLAPSE'
    : state.round === 3 && (turn === 5 || turn === 10) ? 'AVENUE_BLOCK' : null
  const type = requested?.type || automatic
  if (!type) return null
  if (!['BRIDGE_COLLAPSE', 'AVENUE_BLOCK'].includes(type)) throw invalid('Evento de ciudad inválido.')
  const candidates = map.streets.filter((street) => street.type === (type === 'BRIDGE_COLLAPSE' ? 'PUENTE' : 'AVENIDA')
    && !state.blockedStreetIds.includes(street.id)).sort((left, right) => left.id.localeCompare(right.id))
  const selected = requested?.streetId ? candidates.find((street) => street.id === requested.streetId)
    : candidates[stableHash(`${state.worldId}:${turn}:${type}`) % candidates.length]
  if (requested?.streetId && !selected) throw invalid('La calle no corresponde al evento o ya está bloqueada.')
  return selected ? { type, streetId: selected.id, turn } : null
}

function wakeSleepers(state, adjacency) {
  for (const zombie of state.zombies) {
    if (!zombie.asleep) continue
    if (state.survivors.some((survivor) => survivor.status === 'ACTIVE' && (() => {
      const path = shortestPath(zombie.nodeId, [survivor.nodeId], adjacency)
      return path.length > 0 && path.length <= 3
    })())) { zombie.type = 'WALKER'; zombie.asleep = false }
  }
}

function prepareWorld(current, map, requestedEvent) {
  if (current.phase === 'DECIDING') return structuredClone(current)
  if (current.roundFinished || current.turn >= MAX_TURNS) throw invalid('La ronda terminó. Inicia una ronda nueva.')
  const state = structuredClone(current)
  state.turn += 1
  state.phase = 'DECIDING'
  state.turnToken = randomUUID()
  state.lastEvent = resolveCityEvent(requestedEvent, state.turn, state, map)
  if (state.lastEvent) state.blockedStreetIds.push(state.lastEvent.streetId)
  const adjacency = buildAdjacency(map, state.blockedStreetIds)
  wakeSleepers(state, adjacency)
  state.zombieMovements = []
  for (const zombie of state.zombies) moveZombie(zombie, state.survivors, adjacency, state.turn, state.zombieMovements)
  delete state.predictionTurn
  state.runnerPredictions = predictRunners(map, state)
  state.predictionTurn = state.turn + 1
  reserveRefuges(state, map)
  planSurvivors(state, map)
  state.updatedAt = new Date().toISOString()
  state.dangerNodeIds = [...dangerNodes(map, state)]
  return state
}

function resolveWorld(prepared, map, decisions, options = {}) {
  if (prepared.phase !== 'DECIDING') throw invalid('No hay un turno esperando decisiones.')
  if (!Array.isArray(decisions) || decisions.length > prepared.survivors.length) throw invalid('decisions debe ser un arreglo de decisiones por sobreviviente.')
  if (options.turnDurationMs !== undefined && (!Number.isFinite(options.turnDurationMs) || options.turnDurationMs < 0)) throw invalid('turnDurationMs debe ser un número positivo.')
  const decisionById = new Map()
  for (const decision of decisions) {
    if (!decision || typeof decision.survivorId !== 'string' || decisionById.has(decision.survivorId)) throw invalid('Cada decisión debe tener un survivorId único.')
    if (!prepared.survivors.some((survivor) => survivor.id === decision.survivorId)) throw invalid('La decisión corresponde a un sobreviviente desconocido.')
    decisionById.set(decision.survivorId, decision)
  }
  const state = structuredClone(prepared)
  const adjacency = buildAdjacency(map, state.blockedStreetIds)
  const forbidden = dangerNodes(map, state)
  const movements = []
  const last = { requests: 0, errors: 0, timeouts: 0, invalidMoves: 0, maxHttpMs: 0, turnDurationMs: options.turnDurationMs || 0 }
  for (const survivor of state.survivors) {
    if (survivor.status !== 'ACTIVE') continue
    last.requests += 1
    const decision = decisionById.get(survivor.id)
    if (decision && Number.isFinite(decision.durationMs)) last.maxHttpMs = Math.max(last.maxHttpMs, decision.durationMs)
    if (!decision || decision.timedOut || decision.durationMs > 500) { last.timeouts += 1; continue }
    if (decision.error || !Number.isFinite(decision.durationMs) || decision.durationMs < 0) { last.errors += 1; continue }
    const next = decision.siguienteNodo
    if (next === survivor.nodeId) continue
    const edge = (adjacency.get(survivor.nodeId) || []).find((item) => item.nodeId === next)
    if (!edge || forbidden.has(next)) { last.invalidMoves += 1; continue }
    const fromNodeId = survivor.nodeId
    survivor.nodeId = next
    survivor.routeNodeIds = survivor.routeNodeIds?.[1] === next ? survivor.routeNodeIds.slice(1) : [next]
    movements.push({ survivorId: survivor.id, fromNodeId, toNodeId: next, streetId: edge.streetId })
  }
  wakeSleepers(state, adjacency)
  delete state.predictionTurn
  const zombieNodes = new Set(state.zombies.map((zombie) => zombie.nodeId))
  for (const survivor of state.survivors) {
    if (survivor.status !== 'ACTIVE') continue
    const movement = movements.find((item) => item.survivorId === survivor.id)
    const crossed = movement && (state.zombieMovements || []).some((zombieMove) => zombieMove.streetId === movement.streetId
      && zombieMove.fromNodeId === movement.toNodeId && zombieMove.toNodeId === movement.fromNodeId)
    if (zombieNodes.has(survivor.nodeId) || crossed) {
      survivor.status = 'BITTEN'
      delete state.reservations?.[survivor.id]
    } else admitSurvivor(state, survivor, map)
  }
  moveVehicles(state, map)
  state.survivorMovements = movements
  updateRefugeStats(state)
  state.lastTurnMetrics = last
  state.metrics ||= { requests: 0, errors: 0, timeouts: 0, invalidMoves: 0, slowTurns: 0 }
  for (const key of ['requests', 'errors', 'timeouts', 'invalidMoves']) state.metrics[key] += last[key]
  if (last.turnDurationMs > 2000) state.metrics.slowTurns += 1
  state.phase = 'READY'
  state.roundFinished = state.turn >= MAX_TURNS || !state.survivors.some((survivor) => ['ACTIVE', 'ONBOARD'].includes(survivor.status))
  state.updatedAt = new Date().toISOString()
  delete state.turnToken
  return state
}

function advanceWorld(current, map, requestedEvent, options = {}) {
  const state = prepareWorld(current, map, requestedEvent)
  const decisions = state.survivors.filter((survivor) => survivor.status === 'ACTIVE').map((survivor) => {
    const start = performance.now()
    const result = planNextStep({ sobrevivienteId: survivor.id, nodoActual: survivor.nodeId, turno: state.turn },
      map, state, survivorRouteCache(survivor, map, state))
    const durationMs = performance.now() - start
    options.onRouteDecision?.({ survivorId: survivor.id, durationMs, cacheHit: result.cacheHit })
    return { survivorId: survivor.id, siguienteNodo: result.siguienteNodo, durationMs }
  })
  return resolveWorld(state, map, decisions)
}

function publicState(state, map) {
  return { worldId: state.worldId, sessionId: state.sessionId, revision: state.revision, phase: state.phase || 'READY',
    turnToken: state.turnToken, round: state.round || 1, pro: state.pro === true, roundFinished: state.roundFinished || false,
    turn: state.turn, updatedAt: state.updatedAt, zombies: state.zombies.filter((zombie) => !zombie.asleep).map(({ asleep, ...zombie }) => zombie),
    survivors: state.survivors, blockedStreetIds: state.blockedStreetIds, dangerNodeIds: [...dangerNodes(map, state)],
    runnerPredictions: predictRunners(map, state), refuges: state.refuges || map.refuges, vehicles: state.vehicles || [],
    lastEvent: state.lastEvent || null, turnDurationMs: 2000, maxTurns: MAX_TURNS, metrics: state.metrics,
    lastTurnMetrics: state.lastTurnMetrics,
    summary: { activeSurvivors: state.survivors.filter((survivor) => ['ACTIVE', 'ONBOARD'].includes(survivor.status)).length,
      onboardSurvivors: state.survivors.filter((survivor) => survivor.status === 'ONBOARD').length,
      bittenSurvivors: state.survivors.filter((survivor) => survivor.status === 'BITTEN').length,
      rescuedSurvivors: state.survivors.filter((survivor) => survivor.status === 'RESCUED').length,
      visibleZombies: state.zombies.filter((zombie) => !zombie.asleep).length, blockedStreets: state.blockedStreetIds.length,
      refugeCount: map.refuges.length } }
}

module.exports = { DEFAULT_WORLD_ID, ROUND_COUNTS, MAX_TURNS, advanceWorld, createInitialState, prepareWorld, resolveWorld, publicState }
