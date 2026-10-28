const { buildAdjacency, stableHash } = require('../domain/graph')
const HORDE_MOVE_EVERY_TURNS = 5

function moveZombie(zombie, survivors, adjacency, turn, movements) {
  if (zombie.asleep || (zombie.type === 'HORDE' && (turn < 1 || turn % HORDE_MOVE_EVERY_TURNS !== 0))
    || (zombie.type === 'WALKER' && turn % 2 !== 0)) return zombie
  for (let step = 0; step < (zombie.type === 'RUNNER' ? 2 : 1); step += 1) {
    const edges = adjacency.get(zombie.nodeId) || []
    if (!edges.length) break
    let nextEdge
    if (zombie.type === 'RUNNER') {
      const targets = new Set(survivors.filter((survivor) => survivor.status === 'ACTIVE').map((survivor) => survivor.nodeId))
      const queue = [{ node: zombie.nodeId, distance: 0, first: null }]
      const seen = new Set([zombie.nodeId])
      for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const current = queue[cursor]
        if (current.distance > 0 && targets.has(current.node)) {
          nextEdge = edges.find((edge) => edge.nodeId === current.first)
          break
        }
        if (current.distance >= 3) continue
        for (const edge of adjacency.get(current.node) || []) {
          if (seen.has(edge.nodeId)) continue
          seen.add(edge.nodeId)
          queue.push({ node: edge.nodeId, distance: current.distance + 1, first: current.first || edge.nodeId })
        }
      }
    }
    nextEdge ||= edges[stableHash(`${zombie.id}:${turn}:${step}`) % edges.length]
    const fromNodeId = zombie.nodeId
    zombie.nodeId = nextEdge.nodeId
    movements.push({ zombieId: zombie.id, fromNodeId, toNodeId: zombie.nodeId, streetId: nextEdge.streetId })
  }
  return zombie
}

function dangerNodes(map, state) {
  const adjacency = buildAdjacency(map)
  const forbidden = new Set()
  for (const zombie of state.zombies || []) {
    if (zombie.asleep) continue
    forbidden.add(zombie.nodeId)
    if (zombie.type === 'HORDE') {
      for (const edge of adjacency.get(zombie.nodeId) || []) forbidden.add(edge.nodeId)
    }
  }
  return forbidden
}

function predictRunners(map, state) {
  if (!state.pro) return []
  if (state.predictionTurn === state.turn + 1 && Array.isArray(state.runnerPredictions)) return state.runnerPredictions
  const adjacency = buildAdjacency(map, state.blockedStreetIds)
  return (state.zombies || []).filter((zombie) => zombie.type === 'RUNNER' && !zombie.asleep).map((zombie) => {
    const movements = []
    moveZombie({ ...zombie }, state.survivors || [], adjacency, state.turn + 1, movements)
    return { zombieId: zombie.id, nodeIds: movements.map((movement) => movement.toNodeId) }
  })
}

module.exports = { dangerNodes, moveZombie, predictRunners, HORDE_MOVE_EVERY_TURNS }
