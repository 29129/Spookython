function buildAdjacency(map, blockedStreetIds) {
  const blocked = new Set(blockedStreetIds)
  const adjacency = new Map(map.nodes.map((node) => [node.id, []]))
  for (const street of map.streets) {
    if (blocked.has(street.id)) continue
    const edge = { streetId: street.id, distanceM: street.distanceM, speedMps: street.speedMps }
    adjacency.get(street.fromNode)?.push({ ...edge, nodeId: street.toNode })
    adjacency.get(street.toNode)?.push({ ...edge, nodeId: street.fromNode })
  }
  for (const edges of adjacency.values()) edges.sort((left, right) => left.streetId.localeCompare(right.streetId))
  return adjacency
}

function findBestRoute(startNodeId, map, blockedStreetIds, forbiddenNodeIds) {
  const adjacency = buildAdjacency(map, blockedStreetIds)
  if (!adjacency.has(startNodeId)) return null

  const refugeByNodeId = new Map(map.refuges.map((refuge) => [refuge.nodeId, refuge]))
  const distances = new Map([[startNodeId, 0]])
  const previous = new Map()
  const unsettled = new Set(adjacency.keys())
  let destinationNodeId = null

  while (unsettled.size > 0) {
    let currentNodeId = null
    let currentDistance = Infinity
    for (const nodeId of unsettled) {
      const distance = distances.get(nodeId) ?? Infinity
      if (distance < currentDistance) {
        currentDistance = distance
        currentNodeId = nodeId
      }
    }
    if (currentNodeId === null || !Number.isFinite(currentDistance)) break
    unsettled.delete(currentNodeId)
    if (refugeByNodeId.has(currentNodeId)) {
      destinationNodeId = currentNodeId
      break
    }

    for (const edge of adjacency.get(currentNodeId) || []) {
      if (!unsettled.has(edge.nodeId)) continue
      if (edge.nodeId !== startNodeId && forbiddenNodeIds.has(edge.nodeId)) continue
      const cost = edge.distanceM / edge.speedMps
      const nextDistance = currentDistance + cost
      if (nextDistance < (distances.get(edge.nodeId) ?? Infinity)) {
        distances.set(edge.nodeId, nextDistance)
        previous.set(edge.nodeId, { nodeId: currentNodeId, streetId: edge.streetId })
      }
    }
  }

  if (!destinationNodeId) return null
  const routeNodeIds = [destinationNodeId]
  const routeStreetIds = []
  let cursor = destinationNodeId
  while (cursor !== startNodeId) {
    const step = previous.get(cursor)
    if (!step) return null
    routeStreetIds.push(step.streetId)
    cursor = step.nodeId
    routeNodeIds.push(cursor)
  }
  routeNodeIds.reverse()
  routeStreetIds.reverse()
  return {
    routeNodeIds,
    routeStreetIds,
    refugeId: refugeByNodeId.get(destinationNodeId).id,
    estimatedSeconds: distances.get(destinationNodeId),
  }
}

function cachedRouteIndex(cache, currentNodeId, map, blockedStreetIds, forbiddenNodeIds) {
  if (!cache || cache.mapVersion !== map.metadata.sourceTimestamp) return -1
  if (!Array.isArray(cache.routeNodeIds) || !Array.isArray(cache.routeStreetIds)) return -1
  if (cache.routeNodeIds.length !== cache.routeStreetIds.length + 1) return -1
  if (!map.refuges.some((refuge) => refuge.id === cache.refugeId && refuge.nodeId === cache.routeNodeIds.at(-1))) return -1

  const startIndex = cache.routeNodeIds.indexOf(currentNodeId)
  if (startIndex < 0) return -1
  const blocked = new Set(blockedStreetIds)
  const streets = new Map(map.streets.map((street) => [street.id, street]))
  for (let index = startIndex; index < cache.routeStreetIds.length; index += 1) {
    const street = streets.get(cache.routeStreetIds[index])
    const fromNodeId = cache.routeNodeIds[index]
    const toNodeId = cache.routeNodeIds[index + 1]
    if (!street || blocked.has(street.id)) return -1
    const connects = (street.fromNode === fromNodeId && street.toNode === toNodeId)
      || (street.fromNode === toNodeId && street.toNode === fromNodeId)
    if (!connects || forbiddenNodeIds.has(toNodeId)) return -1
  }
  return startIndex
}

function planNextStep(input, map, state, cachedRoute) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw Object.assign(new Error('El cuerpo debe ser un objeto JSON.'), { name: 'InvalidStepRequestError' })
  }
  const { sobrevivienteId, nodoActual, turno } = input
  if (typeof sobrevivienteId !== 'string' || sobrevivienteId.trim().length === 0 || sobrevivienteId.length > 128) {
    throw Object.assign(new Error('sobrevivienteId debe ser un texto de 1 a 128 caracteres.'), { name: 'InvalidStepRequestError' })
  }
  if (typeof nodoActual !== 'string' || !map.nodes.some((node) => node.id === nodoActual)) {
    throw Object.assign(new Error('nodoActual no pertenece al mapa de Manta.'), { name: 'InvalidStepRequestError' })
  }
  if (!Number.isInteger(turno) || turno < 0) {
    throw Object.assign(new Error('turno debe ser un entero mayor o igual a cero.'), { name: 'InvalidStepRequestError' })
  }

  const blockedStreetIds = state.blockedStreetIds || []
  const forbiddenNodeIds = new Set(
    (state.zombies || [])
      .filter((zombie) => !zombie.asleep)
      .map((zombie) => zombie.nodeId),
  )
  const cachedIndex = cachedRouteIndex(cachedRoute, nodoActual, map, blockedStreetIds, forbiddenNodeIds)
  if (cachedIndex >= 0) {
    return {
      siguienteNodo: cachedRoute.routeNodeIds[cachedIndex + 1] || nodoActual,
      routeCache: cachedRoute,
      cacheHit: true,
    }
  }

  const route = findBestRoute(nodoActual, map, blockedStreetIds, forbiddenNodeIds)
  if (!route) return { siguienteNodo: nodoActual, routeCache: null, cacheHit: false }
  return {
    siguienteNodo: route.routeNodeIds[1] || nodoActual,
    routeCache: {
      routeNodeIds: route.routeNodeIds,
      routeStreetIds: route.routeStreetIds,
      refugeId: route.refugeId,
      mapVersion: map.metadata.sourceTimestamp,
      estimatedSeconds: route.estimatedSeconds,
    },
    cacheHit: false,
  }
}

module.exports = { findBestRoute, planNextStep }
