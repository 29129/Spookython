const { buildAdjacency, shortestPath } = require('../domain/graph')
const { findBestRoute } = require('../routing/planner')
const { dangerNodes } = require('./zombies')

function updateRefugeStats(state) {
  for (const refuge of state.refuges || []) {
    refuge.occupied = state.survivors.filter((survivor) => survivor.status === 'RESCUED' && survivor.refugeId === refuge.id).length
    refuge.reserved = Object.values(state.reservations || {}).filter((id) => id === refuge.id).length
  }
}

function reserveRefuges(state, map) {
  if (!state.pro) return
  const previous = state.reservations || {}
  state.reservations = {}
  updateRefugeStats(state)
  const remaining = new Map(state.refuges.map((refuge) => [refuge.id, refuge.capacity - refuge.occupied]))
  const forbidden = dangerNodes(map, state)
  const survivors = state.survivors.filter((survivor) => ['ACTIVE', 'ONBOARD'].includes(survivor.status))
    .sort((left, right) => Number(right.status === 'ONBOARD') - Number(left.status === 'ONBOARD') || left.id.localeCompare(right.id))
  for (const survivor of survivors) {
    const allowed = [...remaining].filter(([, spaces]) => spaces > 0).map(([id]) => id)
    const preferred = previous[survivor.id]
    let route = preferred && allowed.includes(preferred)
      ? findBestRoute(survivor.nodeId, map, state.blockedStreetIds, forbidden, { refugeIds: [preferred] }) : null
    route ||= findBestRoute(survivor.nodeId, map, state.blockedStreetIds, forbidden, { refugeIds: allowed })
    if (route) {
      state.reservations[survivor.id] = route.refugeId
      survivor.refugeId = route.refugeId
      survivor.routeNodeIds = route.routeNodeIds
      remaining.set(route.refugeId, remaining.get(route.refugeId) - 1)
    } else {
      survivor.refugeId = null
      survivor.routeNodeIds = [survivor.nodeId]
    }
  }
  updateRefugeStats(state)
}

function admitSurvivor(state, survivor, map) {
  const refuge = map.refuges.find((item) => item.id === survivor.refugeId && item.nodeId === survivor.nodeId)
  if (!refuge || !['ACTIVE', 'ONBOARD'].includes(survivor.status)) return false
  if (state.pro) {
    const shelter = state.refuges.find((item) => item.id === refuge.id)
    const occupied = state.survivors.filter((item) => item.status === 'RESCUED' && item.refugeId === refuge.id).length
    if (!shelter || occupied >= shelter.capacity) return false
    delete state.reservations[survivor.id]
  }
  survivor.status = 'RESCUED'
  survivor.rescuedTurn = state.turn
  survivor.vehicleId = null
  survivor.routeNodeIds = [survivor.nodeId]
  return true
}

function moveVehicles(state, map) {
  if (!state.pro) return
  const forbidden = dangerNodes(map, state)
  const adjacency = buildAdjacency(map, state.blockedStreetIds)
  const claimed = new Map()
  state.vehicleMovements = []
  for (const vehicle of state.vehicles) {
    vehicle.routeNodeIds = [vehicle.nodeId]
    let preferredPickup = vehicle.targetSurvivorId
    vehicle.targetSurvivorId = null
    for (let step = 0; step < 2; step += 1) {
      // Unload first, then board at most four people with a shelter reservation.
      for (const id of vehicle.passengerIds) {
        const passenger = state.survivors.find((survivor) => survivor.id === id)
        passenger.nodeId = vehicle.nodeId
        admitSurvivor(state, passenger, map)
      }
      vehicle.passengerIds = vehicle.passengerIds.filter((id) => state.survivors.find((survivor) => survivor.id === id)?.status === 'ONBOARD')
      for (const survivor of state.survivors) {
        if (vehicle.passengerIds.length >= vehicle.capacity) break
        if (survivor.status !== 'ACTIVE' || survivor.nodeId !== vehicle.nodeId || !state.reservations[survivor.id]) continue
        survivor.status = 'ONBOARD'
        survivor.vehicleId = vehicle.id
        vehicle.passengerIds.push(survivor.id)
        vehicle.totalPickedUp += 1
      }
      const deliveryIds = [...new Set(vehicle.passengerIds.map((id) => state.reservations[id]).filter(Boolean))]
      const delivery = deliveryIds.length
        ? findBestRoute(vehicle.nodeId, map, state.blockedStreetIds, forbidden, { refugeIds: deliveryIds }) : null
      let pickup = null
      if (vehicle.passengerIds.length < vehicle.capacity) {
        const candidates = state.survivors.filter((survivor) => survivor.status === 'ACTIVE'
          && state.reservations[survivor.id] && (!claimed.has(survivor.id) || claimed.get(survivor.id) === vehicle.id))
          .map((survivor) => ({ survivor, path: shortestPath(vehicle.nodeId, [survivor.nodeId], adjacency, forbidden) }))
          .filter((candidate) => candidate.path.length > 1)
          .sort((left, right) => Number(right.survivor.id === preferredPickup) - Number(left.survivor.id === preferredPickup)
            || left.path.length - right.path.length || left.survivor.id.localeCompare(right.survivor.id)).slice(0, 8)
        for (const candidate of candidates) {
          const route = findBestRoute(vehicle.nodeId, { ...map, refuges: [{ id: 'PICKUP', nodeId: candidate.survivor.nodeId }] }, state.blockedStreetIds, forbidden)
          if (!route) continue
          const threatened = state.zombies.some((zombie) => {
            if (zombie.asleep || zombie.type !== 'RUNNER') return false
            const path = shortestPath(zombie.nodeId, [candidate.survivor.nodeId], adjacency)
            return path.length > 0 && path.length <= 4
          })
          const score = route.estimatedSeconds - (threatened ? 120 : 0)
          if (!pickup || score < pickup.score) pickup = { ...route, score, survivorId: candidate.survivor.id }
          if (candidate.survivor.id === preferredPickup) { pickup = { ...route, score, survivorId: candidate.survivor.id }; break }
        }
      }
      const choosePickup = pickup && (!delivery || pickup.estimatedSeconds <= delivery.estimatedSeconds * 0.5 + 30)
      const route = choosePickup ? pickup : delivery
      if (!route || route.routeNodeIds.length < 2) break
      if (choosePickup) { claimed.set(pickup.survivorId, vehicle.id); preferredPickup = pickup.survivorId; vehicle.targetSurvivorId = pickup.survivorId }
      vehicle.routeNodeIds = route.routeNodeIds
      const nextNodeId = route.routeNodeIds[1]
      const edge = (adjacency.get(vehicle.nodeId) || []).find((item) => item.nodeId === nextNodeId && item.streetId === route.routeStreetIds[0])
      const crossedZombie = (state.zombieMovements || []).some((movement) => movement.streetId === edge?.streetId
        && movement.fromNodeId === nextNodeId && movement.toNodeId === vehicle.nodeId)
      if (!edge || forbidden.has(nextNodeId) || crossedZombie) break
      state.vehicleMovements.push({ vehicleId: vehicle.id, fromNodeId: vehicle.nodeId, toNodeId: nextNodeId, streetId: edge.streetId })
      vehicle.nodeId = nextNodeId
      vehicle.routeNodeIds = vehicle.routeNodeIds.slice(1)
      for (const id of vehicle.passengerIds) state.survivors.find((survivor) => survivor.id === id).nodeId = nextNodeId
    }
    // Allow unloading or pickup at the second arrival without a third movement.
    for (const id of vehicle.passengerIds) admitSurvivor(state, state.survivors.find((survivor) => survivor.id === id), map)
    vehicle.passengerIds = vehicle.passengerIds.filter((id) => state.survivors.find((survivor) => survivor.id === id)?.status === 'ONBOARD')
  }
  updateRefugeStats(state)
}

module.exports = { admitSurvivor, moveVehicles, reserveRefuges, updateRefugeStats }
