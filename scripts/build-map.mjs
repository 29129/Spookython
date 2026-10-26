import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const inputPath = path.join(root, 'data/manta.osm.json')
const outputPath = path.join(root, 'src/data/manta.graph.json')
const center = { lat: -0.96212, lng: -80.71271 }
const selectedNodeCount = 300
const box = { south: -0.98, west: -80.735, north: -0.945, east: -80.69 }
const roadClasses = new Set([
  'primary', 'primary_link', 'trunk', 'trunk_link', 'secondary', 'secondary_link',
  'tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street',
  'service', 'pedestrian', 'footway', 'path',
])
const walkingSpeedMps = { AVENIDA: 1.6, CALLE: 1.4, CALLEJON: 1.0, PUENTE: 1.2 }

const source = JSON.parse(fs.readFileSync(inputPath, 'utf8'))
const ways = (source.elements || []).filter((element) => (
  element.type === 'way' && roadClasses.has(element.tags?.highway) &&
  Array.isArray(element.nodes) && Array.isArray(element.geometry) &&
  element.nodes.length === element.geometry.length
))
if (ways.length === 0) throw new Error(`No se encontraron vías OSM en ${inputPath}.`)

const occurrences = new Map()
for (const way of ways) {
  for (const nodeId of new Set(way.nodes)) {
    const wayIds = occurrences.get(nodeId) || new Set()
    wayIds.add(way.id)
    occurrences.set(nodeId, wayIds)
  }
}

const intersections = new Set([...occurrences]
  .filter(([, wayIds]) => wayIds.size > 1)
  .map(([nodeId]) => nodeId))
const coordinates = new Map()
const candidateStreets = []

function distanceMeters(a, b) {
  const radians = (degrees) => degrees * Math.PI / 180
  const lat1 = radians(a.lat)
  const lat2 = radians(b.lat)
  const deltaLat = lat2 - lat1
  const deltaLng = radians(b.lon - a.lon)
  const value = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
}

function classifyStreet(tags) {
  if (tags.bridge && tags.bridge !== 'no') return 'PUENTE'
  if (['trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link'].includes(tags.highway)) return 'AVENIDA'
  if (['service', 'pedestrian', 'footway', 'path', 'living_street'].includes(tags.highway)) return 'CALLEJON'
  return 'CALLE'
}

for (const way of ways) {
  const anchors = []
  for (let index = 0; index < way.nodes.length; index += 1) {
    const nodeId = way.nodes[index]
    const point = way.geometry[index]
    if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lon)) continue
    coordinates.set(nodeId, { lat: point.lat, lon: point.lon })
    if (intersections.has(nodeId)) anchors.push(index)
  }

  for (let segmentIndex = 0; segmentIndex < anchors.length - 1; segmentIndex += 1) {
    const start = anchors[segmentIndex]
    const end = anchors[segmentIndex + 1]
    const fromNode = way.nodes[start]
    const toNode = way.nodes[end]
    if (fromNode === toNode) continue
    const segmentGeometry = way.geometry.slice(start, end + 1)
    let distanceM = 0
    for (let index = 1; index < segmentGeometry.length; index += 1) {
      distanceM += distanceMeters(segmentGeometry[index - 1], segmentGeometry[index])
    }
    if (!Number.isFinite(distanceM) || distanceM <= 0) continue

    const streetType = classifyStreet(way.tags || {})
    const oneWayTag = way.tags?.oneway
    const oneWay = ['yes', '1', 'true', '-1'].includes(oneWayTag) || way.tags?.junction === 'roundabout'
    const reverseOnly = oneWayTag === '-1'
    const coordinatesInOrder = segmentGeometry.map((point) => [point.lon, point.lat])
    candidateStreets.push({
      id: `osm:${way.id}:${segmentIndex}`,
      fromNode: `osm:${reverseOnly ? toNode : fromNode}`,
      toNode: `osm:${reverseOnly ? fromNode : toNode}`,
      distanceM: Math.round(distanceM),
      type: streetType,
      speedMps: walkingSpeedMps[streetType],
      osmHighway: way.tags.highway,
      osmWayId: way.id,
      ...(way.tags.name ? { name: way.tags.name } : {}),
      oneWay,
      ...(reverseOnly ? { reverseOnly: true } : {}),
      geometry: reverseOnly ? coordinatesInOrder.reverse() : coordinatesInOrder,
    })
  }
}

if (candidateStreets.length === 0) throw new Error('No se pudieron construir segmentos entre intersecciones OSM.')

const adjacency = new Map()
for (const street of candidateStreets) {
  const from = adjacency.get(street.fromNode) || new Set()
  const to = adjacency.get(street.toNode) || new Set()
  from.add(street.toNode)
  to.add(street.fromNode)
  adjacency.set(street.fromNode, from)
  adjacency.set(street.toNode, to)
}

const nearestNode = [...adjacency.keys()].sort((leftId, rightId) => {
  const left = coordinates.get(Number(leftId.slice(4)))
  const right = coordinates.get(Number(rightId.slice(4)))
  return distanceMeters({ lat: center.lat, lon: center.lng }, left) - distanceMeters({ lat: center.lat, lon: center.lng }, right)
})[0]
const queue = [nearestNode]
const selectedIds = new Set([nearestNode])
for (let cursor = 0; cursor < queue.length && selectedIds.size < selectedNodeCount; cursor += 1) {
  const current = queue[cursor]
  const neighbors = [...(adjacency.get(current) || [])].sort((leftId, rightId) => {
    const left = coordinates.get(Number(leftId.slice(4)))
    const right = coordinates.get(Number(rightId.slice(4)))
    return distanceMeters(coordinates.get(Number(current.slice(4))), left) - distanceMeters(coordinates.get(Number(current.slice(4))), right)
  })
  for (const neighbor of neighbors) {
    if (selectedIds.has(neighbor)) continue
    selectedIds.add(neighbor)
    queue.push(neighbor)
    if (selectedIds.size === selectedNodeCount) break
  }
}
if (selectedIds.size < selectedNodeCount) {
  throw new Error(`El recorte contiene solo ${selectedIds.size} intersecciones conectadas; se requieren ${selectedNodeCount}.`)
}

const streets = candidateStreets.filter((street) => selectedIds.has(street.fromNode) && selectedIds.has(street.toNode))
  .map(({ reverseOnly, ...street }) => street)
const nodes = [...selectedIds].map((id) => {
  const osmId = Number(id.slice(4))
  const point = coordinates.get(osmId)
  return { id, lat: point.lat, lng: point.lon }
})
const selectedRefuges = []
const firstRefuge = nodes.find((node) => node.id === nearestNode)
selectedRefuges.push(firstRefuge)
while (selectedRefuges.length < 4) {
  const next = nodes
    .filter((node) => !selectedRefuges.some((refuge) => refuge.id === node.id))
    .map((node) => ({
      node,
      spread: Math.min(...selectedRefuges.map((refuge) => distanceMeters(
        { lat: node.lat, lon: node.lng }, { lat: refuge.lat, lon: refuge.lng },
      ))),
    }))
    .sort((left, right) => right.spread - left.spread)[0]?.node
  if (!next) throw new Error('No se pudieron distribuir cuatro refugios en el grafo.')
  selectedRefuges.push(next)
}
const refuges = selectedRefuges.map((node, index) => {
  const id = `REFUGIO-${index + 1}`
  node.refugeId = id
  return { id, name: `Refugio ${index + 1}`, nodeId: node.id, lat: node.lat, lng: node.lng }
})

const graph = {
  schemaVersion: 1,
  metadata: {
    name: 'Manta, Ecuador',
    source: 'OpenStreetMap',
    sourceTimestamp: source.osm3s?.timestamp_osm_base || 'desconocido',
    attribution: '© OpenStreetMap contributors',
    license: 'ODbL-1.0',
    boundingBox: box,
    nodeCount: nodes.length,
    streetCount: streets.length,
    speedAssumptionsMps: walkingSpeedMps,
  },
  nodes,
  streets,
  refuges,
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, `${JSON.stringify(graph, null, 2)}\n`)
console.log(`Mapa generado: ${nodes.length} intersecciones, ${streets.length} segmentos, ${refuges.length} refugios.`)
console.log(`Fuente OSM actualizada: ${graph.metadata.sourceTimestamp}. Archivo: ${path.relative(root, outputPath)}`)
