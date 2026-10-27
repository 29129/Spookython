function buildAdjacency(map, blockedStreetIds = []) {
  const blocked = new Set(blockedStreetIds)
  const adjacency = new Map(map.nodes.map((node) => [node.id, []]))
  for (const street of map.streets) {
    if (blocked.has(street.id)) continue
    const edge = { streetId: street.id, distanceM: street.distanceM, speedMps: street.speedMps }
    adjacency.get(street.fromNode)?.push({ ...edge, nodeId: street.toNode })
    adjacency.get(street.toNode)?.push({ ...edge, nodeId: street.fromNode })
  }
  return adjacency
}

function shortestPath(start, targets, adjacency, forbidden = new Set()) {
  const targetSet = new Set(targets)
  const queue = [start]
  const previous = new Map([[start, null]])
  let found = null
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const node = queue[cursor]
    if (targetSet.has(node)) { found = node; break }
    for (const edge of adjacency.get(node) || []) {
      if (previous.has(edge.nodeId) || forbidden.has(edge.nodeId)) continue
      previous.set(edge.nodeId, node)
      queue.push(edge.nodeId)
    }
  }
  if (found === null) return []
  const path = []
  for (let node = found; node !== null; node = previous.get(node)) path.push(node)
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

module.exports = { buildAdjacency, shortestPath, stableHash }
