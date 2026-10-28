// Exclude single-access branches when choosing demonstration shelter sites.
function resilientRefugeCandidates(nodes, streets) {
  const adjacency = new Map(nodes.map(node => [node.id, []]))
  for (const street of streets) {
    adjacency.get(street.fromNode).push({ node: street.toNode, edge: street.id })
    adjacency.get(street.toNode).push({ node: street.fromNode, edge: street.id })
  }
  const visited = new Map(), low = new Map(), bridges = new Set()
  let clock = 0
  function visit(node, parentEdge) {
    visited.set(node, ++clock); low.set(node, clock)
    for (const next of adjacency.get(node)) {
      if (next.edge === parentEdge) continue
      if (!visited.has(next.node)) {
        visit(next.node, next.edge)
        low.set(node, Math.min(low.get(node), low.get(next.node)))
        if (low.get(next.node) > visited.get(node)) bridges.add(next.edge)
      } else low.set(node, Math.min(low.get(node), visited.get(next.node)))
    }
  }
  for (const node of nodes) if (!visited.has(node.id)) visit(node.id)
  const seen = new Set(), components = []
  for (const node of nodes) {
    if (seen.has(node.id)) continue
    const component = [node.id]; seen.add(node.id)
    for (let i = 0; i < component.length; i++) for (const next of adjacency.get(component[i])) {
      if (bridges.has(next.edge) || seen.has(next.node)) continue
      seen.add(next.node); component.push(next.node)
    }
    components.push(component)
  }
  const core = new Set(components.sort((a,b) => b.length-a.length)[0])
  const junctions = nodes.filter(node => core.has(node.id) && adjacency.get(node.id).length >= 3)
  const candidates = junctions.length >= 4 ? junctions : nodes.filter(node => core.has(node.id))
  if (candidates.length < 4) throw new Error('La red no contiene cuatro sitios de refugio con accesos redundantes.')
  return candidates
}
module.exports = { resilientRefugeCandidates }
