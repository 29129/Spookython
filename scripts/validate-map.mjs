import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mapPath = path.join(root, 'src/data/manta.graph.json')
if (!fs.existsSync(mapPath)) throw new Error('No existe src/data/manta.graph.json. Ejecuta npm run map:build.')
const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'))
const fail = (message) => { throw new Error(`Mapa inválido: ${message}`) }

if (map.schemaVersion !== 1) fail('schemaVersion debe ser 1.')
if (!Array.isArray(map.nodes) || map.nodes.length !== 300) fail(`se esperaban 300 intersecciones y hay ${map.nodes?.length ?? 0}.`)
if (!Array.isArray(map.streets) || map.streets.length === 0) fail('se requiere al menos una calle.')
if (!Array.isArray(map.refuges) || map.refuges.length !== 4) fail(`se esperaban 4 refugios y hay ${map.refuges?.length ?? 0}.`)
if (map.metadata?.source !== 'OpenStreetMap' || map.metadata?.license !== 'ODbL-1.0') fail('faltan la fuente y la licencia OSM.')
if (map.metadata.nodeCount !== map.nodes.length || map.metadata.streetCount !== map.streets.length) fail('los conteos de metadata no coinciden con los datos.')

const nodeIds = new Set()
for (const node of map.nodes) {
  if (!node.id || nodeIds.has(node.id)) fail(`id de intersección ausente o duplicado: ${node.id}.`)
  if (!Number.isFinite(node.lat) || !Number.isFinite(node.lng)) fail(`coordenadas inválidas en ${node.id}.`)
  nodeIds.add(node.id)
}

const allowedTypes = new Set(['AVENIDA', 'CALLE', 'CALLEJON', 'PUENTE'])
const adjacency = new Map(map.nodes.map((node) => [node.id, new Set()]))
const streetIds = new Set()
for (const street of map.streets) {
  if (!street.id || streetIds.has(street.id)) fail(`id de calle ausente o duplicado: ${street.id}.`)
  streetIds.add(street.id)
  if (!nodeIds.has(street.fromNode) || !nodeIds.has(street.toNode)) fail(`calle ${street.id} apunta a una intersección inexistente.`)
  if (street.fromNode === street.toNode || !Number.isFinite(street.distanceM) || street.distanceM <= 0) fail(`distancia o extremos inválidos en ${street.id}.`)
  if (!allowedTypes.has(street.type) || !Number.isFinite(street.speedMps) || street.speedMps <= 0) fail(`tipo o velocidad inválidos en ${street.id}.`)
  if (!Array.isArray(street.geometry) || street.geometry.length < 2) fail(`geometría incompleta en ${street.id}.`)
  adjacency.get(street.fromNode).add(street.toNode)
  adjacency.get(street.toNode).add(street.fromNode)
}

const refugeIds = new Set()
for (const refuge of map.refuges) {
  if (!refuge.id || refugeIds.has(refuge.id) || !nodeIds.has(refuge.nodeId)) fail(`refugio inválido: ${refuge.id}.`)
  refugeIds.add(refuge.id)
}

const visited = new Set()
const queue = [map.nodes[0].id]
visited.add(queue[0])
for (let cursor = 0; cursor < queue.length; cursor += 1) {
  for (const neighbor of adjacency.get(queue[cursor])) {
    if (!visited.has(neighbor)) {
      visited.add(neighbor)
      queue.push(neighbor)
    }
  }
}
if (visited.size !== map.nodes.length) fail(`el grafo está desconectado (${visited.size}/${map.nodes.length} intersecciones alcanzables).`)

console.log(`Mapa válido: ${map.nodes.length} intersecciones conectadas, ${map.streets.length} calles, ${map.refuges.length} refugios.`)
