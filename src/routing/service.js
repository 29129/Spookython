const { validateStepInput } = require('./request')

async function getNextStep(input, map, store = require('../simulation/store')) {
  validateStepInput(input, map)
  const compact = await store.readStepState?.(input.sobrevivienteId)
  if (compact?.stepDecisions && compact.phase === 'DECIDING' && compact.schemaVersion === 2) {
    if (input.turno !== compact.turn) throw Object.assign(new Error('El turno consultado ya no es el actual.'), { name: 'StaleTurnError' })
    const decision = Object.hasOwn(compact.stepDecisions, input.sobrevivienteId) ? compact.stepDecisions[input.sobrevivienteId] : null
    if (decision) {
      const [node, status, next] = decision
      if (node !== input.nodoActual) throw Object.assign(new Error('nodoActual no coincide con la posición guardada.'), { name: 'InvalidStepRequestError' })
      if (status !== 'ACTIVE' || next === node) return node
      const allowed = map.streets.some((street) => !compact.blockedStreetIds.includes(street.id)
        && ((street.fromNode === node && street.toNode === next) || (street.toNode === node && street.fromNode === next)))
      return allowed && !compact.dangerNodeIds.includes(next) ? next : node
    }
  }
  // Compatibility for existing snapshots, READY phase and external survivor IDs.
  const state = await store.getOrCreateWorldState(() => require('../simulation/engine').createInitialState(map))
  if (input.turno !== state.turn) throw Object.assign(new Error('El turno consultado ya no es el actual.'), { name: 'StaleTurnError' })
  const survivor = state.survivors.find((item) => item.id === input.sobrevivienteId)
  if (survivor && survivor.nodeId !== input.nodoActual) throw Object.assign(new Error('nodoActual no coincide con la posición guardada.'), { name: 'InvalidStepRequestError' })
  if (survivor && survivor.status !== 'ACTIVE') return survivor.nodeId
  // PREPARE validates and freezes routes before publishing this shared snapshot.
  // Reading it once from DynamoDB avoids recalculating predictions for 200 HTTP callers.
  if (survivor && state.schemaVersion === 2 && state.phase === 'DECIDING') {
    const next = survivor.routeNodeIds?.[1] || survivor.nodeId
    if (next === survivor.nodeId) return next
    const allowed = map.streets.some((street) => !state.blockedStreetIds.includes(street.id)
      && ((street.fromNode === survivor.nodeId && street.toNode === next) || (street.toNode === survivor.nodeId && street.fromNode === next)))
    return allowed && !state.dangerNodeIds.includes(next) ? next : survivor.nodeId
  }
  const { planNextStep, survivorRouteCache } = require('./planner')
  const cached = survivor ? survivorRouteCache(survivor, map, state) : await store.readRouteCache(input.sobrevivienteId, state.sessionId)
  const result = planNextStep(input, map, state, cached)
  if (!survivor && !result.cacheHit && result.routeCache) await store.writeRouteCache(input.sobrevivienteId, result.routeCache, state.sessionId)
  return result.siguienteNodo
}
module.exports = { getNextStep }
