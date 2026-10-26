const DEFAULT_WORLD_ID = 'manta-demo'
const DEFAULT_SURVIVOR_COUNT = 20
const CITY_EVENT_INTERVAL_TURNS = 10
const { performance } = require('node:perf_hooks')
const { planNextStep } = require('../routing/planner')

function buildAdjacency(map, blockedStreetIds = []) {
  const blocked = new Set(blockedStreetIds)
  const adjacency = new Map(map.nodes.map((node) => [node.id, []]))
  for (const street of map.streets) {
    if (blocked.has(street.id)) continue
    adjacency.get(street.fromNode)?.push({ nodeId: street.toNode, streetId: street.id })
    adjacency.get(street.toNode)?.push({ nodeId: street.fromNode, streetId: street.id })
  }
  return adjacency
}

function cachedRouteForSurvivor(survivor, map, streetByPair) {
  const routeNodeIds = survivor.routeNodeIds || []
  if (routeNodeIds.length < 2) return null

  const routeStreetIds = []
  for (let index = 0; index < routeNodeIds.length - 1; index += 1) {
    const streetId = streetByPair.get([routeNodeIds[index], routeNodeIds[index + 1]].sort().join('|'))
    if (!streetId) return null
    routeStreetIds.push(streetId)
  }

  return {
    routeNodeIds,
    routeStreetIds,
    refugeId: survivor.refugeId,
    mapVersion: map.metadata.sourceTimestamp,
  }
}

function shortestPath(startNodeId, targetNodeIds, adjacency, forbiddenNodeIds = new Set()) {
  if (!adjacency.has(startNodeId)) return []
  const targets = new Set(targetNodeIds)
  const queue = [startNodeId]
  const previous = new Map([[startNodeId, null]])
  let found = targets.has(startNodeId) ? startNodeId : null

  for (let cursor = 0; cursor < queue.length && !found; cursor += 1) {
    const current = queue[cursor]
    for (const edge of adjacency.get(current) || []) {
      if (forbiddenNodeIds.has(edge.nodeId) || previous.has(edge.nodeId)) continue
      previous.set(edge.nodeId, current)
      if (targets.has(edge.nodeId)) {
        found = edge.nodeId
        break
      }
      queue.push(edge.nodeId)
    }
  }

  if (!found) return []
  const path = []
  for (let nodeId = found; nodeId !== null; nodeId = previous.get(nodeId)) path.push(nodeId)
  return path.reverse()
}

function stableHash(value) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function makeInitialZombies(map) {
  const types = ['WALKER', 'WALKER', 'RUNNER', 'RUNNER', 'HORDE', 'SLEEPER']
  const preferredIndices = [18, 72, 121, 178, 231, 278]
  const refugeNodes = new Set(map.refuges.map((refuge) => refuge.nodeId))
  const chosen = new Set()
  const zombies = []

  for (let index = 0; index < types.length; index += 1) {
    let node = map.nodes[preferredIndices[index] % map.nodes.length]
    if (refugeNodes.has(node.id) || chosen.has(node.id)) {
      node = map.nodes.find((candidate) => !refugeNodes.has(candidate.id) && !chosen.has(candidate.id))
    }
    chosen.add(node.id)
    zombies.push({
      id: `Z-${types[index]}-${index + 1}`,
      type: types[index],
      nodeId: node.id,
      ...(types[index] === 'SLEEPER' ? { asleep: true } : {}),
    })
  }
  return zombies
}

function createInitialState(map, worldId = DEFAULT_WORLD_ID, survivorCount = DEFAULT_SURVIVOR_COUNT) {
  if (!Number.isInteger(survivorCount) || survivorCount < 1 || survivorCount > map.nodes.length) {
    throw new RangeError(`survivorCount debe ser un entero entre 1 y ${map.nodes.length}.`)
  }
  const zombies = makeInitialZombies(map)
  const adjacency = buildAdjacency(map)
  const dangerNodes = new Set(zombies.filter((zombie) => zombie.type !== 'SLEEPER').map((zombie) => zombie.nodeId))
  const refugeByNodeId = new Map(map.refuges.map((refuge) => [refuge.nodeId, refuge]))
  const refugeNodes = map.refuges.map((refuge) => refuge.nodeId)
  const survivors = []
  const usedStarts = new Set()

  for (let index = 0; index < survivorCount; index += 1) {
    const preferredIndex = Math.floor(((index + 0.5) * map.nodes.length) / survivorCount)
    const candidates = [
      ...map.nodes.slice(preferredIndex),
      ...map.nodes.slice(0, preferredIndex),
    ]
    const start = candidates.find((node) =>
      !dangerNodes.has(node.id) && !usedStarts.has(node.id) && !refugeByNodeId.has(node.id),
    )
    if (!start) break
    usedStarts.add(start.id)

    const path = shortestPath(start.id, refugeNodes, adjacency, dangerNodes)
    const refugeId = path.length
      ? map.refuges.find((refuge) => refuge.nodeId === path[path.length - 1]).id
      : map.refuges[index % map.refuges.length].id
    survivors.push({
      id: `S-${String(index + 1).padStart(4, '0')}`,
      nodeId: start.id,
      refugeId,
      status: 'ACTIVE',
      routeNodeIds: path,
    })
  }

  return {
    worldId,
    turn: 0,
    updatedAt: new Date().toISOString(),
    zombies,
    survivors,
    blockedStreetIds: [],
    lastEvent: null,
  }
}

function resolveCityEvent(requestedEvent, turn, state, map) {
  let event = requestedEvent
  if (event && (typeof event !== 'object' || typeof event.type !== 'string')) {
    throw Object.assign(new Error('cityEvent debe incluir un tipo de evento válido.'), { name: 'InvalidCityEventError' })
  }
  if (event?.type === 'NONE') return null

  if (!event && turn % CITY_EVENT_INTERVAL_TURNS !== 0) return null
  const eventType = event?.type || (turn % (CITY_EVENT_INTERVAL_TURNS * 2) === 0 ? 'BRIDGE_COLLAPSE' : 'AVENUE_BLOCK')
  if (eventType !== 'BRIDGE_COLLAPSE' && eventType !== 'AVENUE_BLOCK') {
    throw Object.assign(new Error('Tipos permitidos: BRIDGE_COLLAPSE, AVENUE_BLOCK o NONE.'), { name: 'InvalidCityEventError' })
  }

  const streetType = eventType === 'BRIDGE_COLLAPSE' ? 'PUENTE' : 'AVENIDA'
  const candidates = map.streets
    .filter((street) => street.type === streetType && !state.blockedStreetIds.includes(street.id))
    .sort((left, right) => left.id.localeCompare(right.id))
  const requestedStreet = event?.streetId
    ? candidates.find((street) => street.id === event.streetId)
    : null
  if (event?.streetId && !requestedStreet) {
    throw Object.assign(new Error(`La calle ${event.streetId} no es una ${streetType.toLowerCase()} disponible.`), { name: 'InvalidCityEventError' })
  }
  if (event?.streetId && event.type !== eventType) {
    throw Object.assign(new Error('El tipo de evento no corresponde al tipo de calle.'), { name: 'InvalidCityEventError' })
  }
  if (!candidates.length) return null

  const selected = requestedStreet || candidates[stableHash(`${state.worldId}:${turn}:${eventType}`) % candidates.length]
  return { type: eventType, streetId: selected.id, turn }
}

function zombieDistanceToSurvivor(zombieNodeId, survivorNodeId, adjacency, maxDistance) {
  const queue = [[zombieNodeId, 0]]
  const visited = new Set([zombieNodeId])
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const [nodeId, distance] = queue[cursor]
    if (nodeId === survivorNodeId) return distance
    if (distance >= maxDistance) continue
    for (const edge of adjacency.get(nodeId) || []) {
      if (visited.has(edge.nodeId)) continue
      visited.add(edge.nodeId)
      queue.push([edge.nodeId, distance + 1])
    }
  }
  return Infinity
}

function chooseRunnerTarget(zombie, survivors, adjacency) {
  let closest = null
  for (const survivor of survivors) {
    if (survivor.status !== 'ACTIVE') continue
    const path = shortestPath(zombie.nodeId, [survivor.nodeId], adjacency)
    if (path.length && (!closest || path.length < closest.path.length)) closest = { survivor, path }
  }
  return closest && closest.path.length - 1 <= 3 ? closest : null
}

function moveZombie(zombie, survivors, adjacency, turn, movements) {
  if (zombie.asleep) return zombie
  if (zombie.type === 'HORDE') return zombie
  if (zombie.type === 'WALKER' && turn % 2 !== 0) return zombie

  const steps = zombie.type === 'RUNNER' ? 2 : 1
  for (let step = 0; step < steps; step += 1) {
    const options = adjacency.get(zombie.nodeId) || []
    if (!options.length) break
    let nextEdge

    if (zombie.type === 'RUNNER') {
      const target = chooseRunnerTarget(zombie, survivors, adjacency)
      if (target && target.path.length > 1) {
        const targetNodeId = target.path[1]
        nextEdge = options.find((edge) => edge.nodeId === targetNodeId)
      }
    }

    if (!nextEdge) {
      const choice = stableHash(`${zombie.id}:${turn}:${step}`) % options.length
      nextEdge = options[choice]
    }
    const fromNodeId = zombie.nodeId
    zombie.nodeId = nextEdge.nodeId
    movements.push({ zombieId: zombie.id, fromNodeId, toNodeId: zombie.nodeId, streetId: nextEdge.streetId })
  }
  return zombie
}

function nextCityEvent(requestedEvent, turn, state, map) {
  const event = resolveCityEvent(requestedEvent, turn, state, map)
  if (event) state.blockedStreetIds = [...new Set([...state.blockedStreetIds, event.streetId])]
  return event
}

function advanceWorld(currentState, map, requestedEvent, options = {}) {
  const state = structuredClone(currentState)
  const nextTurn = state.turn + 1
  const event = nextCityEvent(requestedEvent, nextTurn, state, map)
  const adjacency = buildAdjacency(map, state.blockedStreetIds)
  const streetByPair = new Map()
  for (const street of map.streets) {
    const key = [street.fromNode, street.toNode].sort().join('|')
    if (!streetByPair.has(key)) streetByPair.set(key, street.id)
  }
  const activeSurvivors = state.survivors.filter((survivor) => survivor.status === 'ACTIVE')

  for (const sleeper of state.zombies) {
    if (sleeper.type !== 'SLEEPER' || !sleeper.asleep) continue
    const awakened = activeSurvivors.some((survivor) =>
      zombieDistanceToSurvivor(sleeper.nodeId, survivor.nodeId, adjacency, 2) <= 2,
    )
    if (awakened) {
      sleeper.type = 'WALKER'
      sleeper.asleep = false
    }
  }

  const zombieMovements = []
  state.zombies = state.zombies.map((zombie) => moveZombie(zombie, activeSurvivors, adjacency, nextTurn, zombieMovements))

  const survivorMovements = []
  for (const survivor of activeSurvivors) {
    if (survivor.status !== 'ACTIVE') continue
    const decisionStartedAt = performance.now()
    const decision = planNextStep({
      sobrevivienteId: survivor.id,
      nodoActual: survivor.nodeId,
      turno: nextTurn,
    }, map, state, cachedRouteForSurvivor(survivor, map, streetByPair))
    options.onRouteDecision?.({
      survivorId: survivor.id,
      durationMs: performance.now() - decisionStartedAt,
      cacheHit: decision.cacheHit,
    })
    const nextNodeId = decision.siguienteNodo
    if (decision.routeCache) {
      const currentIndex = decision.routeCache.routeNodeIds.indexOf(survivor.nodeId)
      survivor.refugeId = decision.routeCache.refugeId
      survivor.routeNodeIds = currentIndex >= 0
        ? decision.routeCache.routeNodeIds.slice(currentIndex)
        : [survivor.nodeId]
    } else {
      survivor.routeNodeIds = [survivor.nodeId]
    }
    if (!nextNodeId) continue
    const edge = (adjacency.get(survivor.nodeId) || []).find((candidate) => candidate.nodeId === nextNodeId)
    if (!edge || state.zombies.some((zombie) => !zombie.asleep && zombie.nodeId === nextNodeId)) continue
    const fromNodeId = survivor.nodeId
    survivor.nodeId = nextNodeId
    survivor.routeNodeIds = survivor.routeNodeIds.slice(1)
    survivorMovements.push({ survivorId: survivor.id, fromNodeId, toNodeId: nextNodeId, streetId: edge.streetId })
  }

  const zombieNodes = new Set(state.zombies.map((zombie) => zombie.nodeId))
  const reversedCrossings = new Set(
    zombieMovements.map((movement) => `${movement.streetId}:${movement.toNodeId}:${movement.fromNodeId}`),
  )
  for (const survivor of state.survivors) {
    if (survivor.status !== 'ACTIVE') continue
    const movement = survivorMovements.find((item) => item.survivorId === survivor.id)
    const bittenBySharedNode = zombieNodes.has(survivor.nodeId)
    const bittenByCrossing = movement && reversedCrossings.has(
      `${movement.streetId}:${movement.fromNodeId}:${movement.toNodeId}`,
    )
    if (bittenBySharedNode || bittenByCrossing) survivor.status = 'BITTEN'
  }

  const refugeNodesById = new Map(map.refuges.map((refuge) => [refuge.id, refuge.nodeId]))
  for (const survivor of state.survivors) {
    if (survivor.status === 'ACTIVE' && refugeNodesById.get(survivor.refugeId) === survivor.nodeId) {
      survivor.status = 'RESCUED'
    }
  }

  state.turn = nextTurn
  state.updatedAt = new Date().toISOString()
  state.lastEvent = event
  return state
}

function publicState(state, map) {
  const zombies = state.zombies
    .filter((zombie) => !zombie.asleep)
    .map(({ asleep, ...zombie }) => zombie)
  return {
    worldId: state.worldId,
    turn: state.turn,
    updatedAt: state.updatedAt,
    zombies,
    survivors: state.survivors,
    blockedStreetIds: state.blockedStreetIds,
    lastEvent: state.lastEvent || null,
    turnDurationMs: 2000,
    summary: {
      activeSurvivors: state.survivors.filter((survivor) => survivor.status === 'ACTIVE').length,
      bittenSurvivors: state.survivors.filter((survivor) => survivor.status === 'BITTEN').length,
      rescuedSurvivors: state.survivors.filter((survivor) => survivor.status === 'RESCUED').length,
      visibleZombies: zombies.length,
      blockedStreets: state.blockedStreetIds.length,
      refugeCount: map.refuges.length,
    },
  }
}

module.exports = { DEFAULT_WORLD_ID, advanceWorld, createInitialState, publicState }
