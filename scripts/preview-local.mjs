// Isolated visual QA only: no AWS calls or production data.
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
const require = createRequire(import.meta.url)
const { localApi } = require('../test/support.cjs')
const map = require('../data/manta.graph.local-600.json')
process.env.SIMULATOR_API_KEY_SHA256 = createHash('sha256').update('disposable-local-preview-key-1234567890').digest('hex')
const api = await localApi({ serveWeb: true, port: 4180, map })
await api.store.resetStoredWorldState(map, { round: 2, pro: true })
console.log(`Vista local de prueba: ${api.baseUrl}`)
console.log(`Red local ampliada: ${map.nodes.length} intersecciones, ${map.streets.length} calles. Entorno de datos aislado de AWS.`)
