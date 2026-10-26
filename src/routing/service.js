const { createInitialState } = require('../simulation/engine')
const { getOrCreateWorldState, readRouteCache, writeRouteCache } = require('../simulation/store')
const { planNextStep } = require('./planner')

async function getNextStep(input, map) {
  if (!input || typeof input.sobrevivienteId !== 'string' || input.sobrevivienteId.trim().length === 0 || input.sobrevivienteId.length > 128) {
    return planNextStep(input, map, { zombies: [], blockedStreetIds: [] }, null).siguienteNodo
  }

  const worldState = await getOrCreateWorldState(() => createInitialState(map))
  const cachedRoute = await readRouteCache(input.sobrevivienteId)
  const result = planNextStep(input, map, worldState, cachedRoute)
  if (!result.cacheHit && result.routeCache) await writeRouteCache(input.sobrevivienteId, result.routeCache)
  return result.siguienteNodo
}

module.exports = { getNextStep }
