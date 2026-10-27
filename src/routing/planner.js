const { buildAdjacency } = require('../domain/graph')
const { dangerNodes, predictRunners } = require('../simulation/zombies')

function push(heap, entry) {
  heap.push(entry)
  let index = heap.length - 1
  while (index > 0) {
    const parent = (index - 1) >> 1
    if (heap[parent][1] <= entry[1]) break
    heap[index] = heap[parent]
    index = parent
  }
  heap[index] = entry
}
function pop(heap) {
  const first = heap[0]
  const last = heap.pop()
  if (!heap.length) return first
  let index = 0
  while (index * 2 + 1 < heap.length) {
    let child = index * 2 + 1
    if (child + 1 < heap.length && heap[child + 1][1] < heap[child][1]) child += 1
    if (heap[child][1] >= last[1]) break
    heap[index] = heap[child]
    index = child
  }
  heap[index] = last
  return first
}

function findBestRoute(startNodeId, map, blockedStreetIds, forbiddenNodeIds, options = {}) {
  const adjacency = buildAdjacency(map, blockedStreetIds)
  if (!adjacency.has(startNodeId)) return null
  const refugeByNodeId = new Map(map.refuges.filter((refuge) =>
    !options.refugeIds || options.refugeIds.includes(refuge.id),
  ).map((refuge) => [refuge.nodeId, refuge]))
  const distances = new Map([[startNodeId, 0]])
  const previous = new Map()
  const settled = new Set()
  const heap = [[startNodeId, 0]]
  let destinationNodeId = null
  while (heap.length) {
    const [current, cost] = pop(heap)
    if (settled.has(current) || cost !== distances.get(current)) continue
    settled.add(current)
    if (refugeByNodeId.has(current) && !forbiddenNodeIds.has(current)) { destinationNodeId = current; break }
    for (const edge of adjacency.get(current) || []) {
      if (settled.has(edge.nodeId) || forbiddenNodeIds.has(edge.nodeId)) continue
      if (current === startNodeId && (options.avoidFirstNodes?.has(edge.nodeId)
        || options.avoidFirstStreets?.has(edge.streetId))) continue
      const nextCost = cost + edge.distanceM / edge.speedMps + (options.penalties?.get(edge.nodeId) || 0)
      if (nextCost < (distances.get(edge.nodeId) ?? Infinity)) {
        distances.set(edge.nodeId, nextCost)
        previous.set(edge.nodeId, { nodeId: current, streetId: edge.streetId })
        push(heap, [edge.nodeId, nextCost])
      }
    }
  }
  if (destinationNodeId === null) return null
  const routeNodeIds = [destinationNodeId]
  const routeStreetIds = []
  for (let cursor = destinationNodeId; cursor !== startNodeId;) {
    const step = previous.get(cursor)
    if (!step) return null
    routeStreetIds.push(step.streetId)
    routeNodeIds.push(step.nodeId)
    cursor = step.nodeId
  }
  return { routeNodeIds: routeNodeIds.reverse(), routeStreetIds: routeStreetIds.reverse(),
    refugeId: refugeByNodeId.get(destinationNodeId).id, estimatedSeconds: distances.get(destinationNodeId) }
}

function routeOptions(input, map, state) {
  const predictedNodes = new Set(predictRunners(map, state).flatMap((prediction) => prediction.nodeIds))
  const avoidFirstStreets = new Set((state.zombieMovements || [])
    .filter((movement) => movement.toNodeId === input.nodoActual).map((movement) => movement.streetId))
  const options = { avoidFirstNodes: predictedNodes, avoidFirstStreets,
    penalties: new Map([...predictedNodes].map((node) => [node, 300])) }
  if (state.pro) options.refugeIds = state.reservations?.[input.sobrevivienteId]
    ? [state.reservations[input.sobrevivienteId]] : []
  return options
}

function cachedRouteIndex(cache, input, map, state, forbidden, options) {
  if (!cache || cache.mapVersion !== map.metadata.sourceTimestamp) return -1
  if (cache.sessionId && cache.sessionId !== state.sessionId) return -1
  if (!Array.isArray(cache.routeNodeIds) || !Array.isArray(cache.routeStreetIds)
    || cache.routeNodeIds.length !== cache.routeStreetIds.length + 1) return -1
  if (options.refugeIds && !options.refugeIds.includes(cache.refugeId)) return -1
  if (!map.refuges.some((refuge) => refuge.id === cache.refugeId && refuge.nodeId === cache.routeNodeIds.at(-1))) return -1
  const index = cache.routeNodeIds.indexOf(input.nodoActual)
  if (index < 0) return -1
  const blocked = new Set(state.blockedStreetIds)
  const streets = new Map(map.streets.map((street) => [street.id, street]))
  for (let cursor = index; cursor < cache.routeStreetIds.length; cursor += 1) {
    const street = streets.get(cache.routeStreetIds[cursor])
    const from = cache.routeNodeIds[cursor]
    const to = cache.routeNodeIds[cursor + 1]
    if (!street || blocked.has(street.id) || forbidden.has(to)) return -1
    if (!((street.fromNode === from && street.toNode === to) || (street.toNode === from && street.fromNode === to))) return -1
    if (cursor === index && (options.avoidFirstNodes.has(to) || options.avoidFirstStreets.has(street.id))) return -1
  }
  return index
}

function validateStepInput(input, map) {
  const invalid = (message) => { throw Object.assign(new Error(message), { name: 'InvalidStepRequestError' }) }
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('El cuerpo debe ser un objeto JSON.')
  if (typeof input.sobrevivienteId !== 'string' || !input.sobrevivienteId.trim() || input.sobrevivienteId.length > 128) invalid('sobrevivienteId debe ser un texto de 1 a 128 caracteres.')
  if (!map.nodes.some((node) => node.id === input.nodoActual)) invalid('nodoActual no pertenece al mapa de Manta.')
  if (!Number.isInteger(input.turno) || input.turno < 0) invalid('turno debe ser un entero mayor o igual a cero.')
}

function planNextStep(input, map, state, cachedRoute) {
  validateStepInput(input, map)
  const forbidden = dangerNodes(map, state)
  const options = routeOptions(input, map, state)
  const index = cachedRouteIndex(cachedRoute, input, map, state, forbidden, options)
  if (index >= 0) return { siguienteNodo: cachedRoute.routeNodeIds[index + 1] || input.nodoActual, routeCache: cachedRoute, cacheHit: true }
  const route = findBestRoute(input.nodoActual, map, state.blockedStreetIds || [], forbidden, options)
  if (!route) return { siguienteNodo: input.nodoActual, routeCache: null, cacheHit: false }
  return { siguienteNodo: route.routeNodeIds[1] || input.nodoActual,
    routeCache: { ...route, mapVersion: map.metadata.sourceTimestamp, sessionId: state.sessionId }, cacheHit: false }
}

function survivorRouteCache(survivor, map, state) {
  const routeNodeIds = survivor.routeNodeIds || []
  const blocked = new Set(state.blockedStreetIds)
  const routeStreetIds = []
  for (let index = 0; index < routeNodeIds.length - 1; index += 1) {
    const street = map.streets.find((item) => !blocked.has(item.id)
      && ((item.fromNode === routeNodeIds[index] && item.toNode === routeNodeIds[index + 1])
        || (item.toNode === routeNodeIds[index] && item.fromNode === routeNodeIds[index + 1])))
    if (!street) return null
    routeStreetIds.push(street.id)
  }
  return { routeNodeIds, routeStreetIds, refugeId: survivor.refugeId,
    mapVersion: map.metadata.sourceTimestamp, sessionId: state.sessionId }
}

module.exports = { findBestRoute, planNextStep, survivorRouteCache, validateStepInput }
