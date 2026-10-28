import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { avatarPlacements, createAvatarGeometry, MODEL_TYPES } from '../web/avatar-models.mjs'
import { createAvatarLayer } from '../web/avatar-scene.mjs'
const graph = JSON.parse(readFileSync(new URL('../data/manta.graph.local-600.json', import.meta.url)))

test('los siete modelos tienen volumen real, colores y geometria finita reutilizable', () => {
  for (const type of MODEL_TYPES) {
    const geometry = createAvatarGeometry(type)
    const position = geometry.getAttribute('position')
    assert(position.count > 0)
    assert.equal(geometry.getAttribute('normal').count, position.count)
    assert.equal(geometry.getAttribute('color').count, position.count)
    assert([...position.array].every(Number.isFinite))
    const box = geometry.boundingBox
    assert(box.max.x > box.min.x && box.max.y > box.min.y && box.max.z > box.min.z, type)
    assert(position.count / 3 < 1000, 'Presupuesto de triangulos por modelo')
    geometry.dispose()
  }
})

test('los modelos omiten dormidos, rescatados, mordidos y pasajeros y usan posiciones reales', () => {
  const state = { survivors: ['ACTIVE','RESCUED','BITTEN','ONBOARD'].map((status,index) => ({ id:`S${index}`,status,nodeId:graph.nodes[index].id })),
    zombies: [{id:'ZZ',type:'SLEEPER',nodeId:graph.nodes[0].id},{id:'Z1',type:'WALKER',nodeId:graph.nodes[1].id}],vehicles:[],blockedStreetIds:[] }
  const placements = avatarPlacements(graph,state)
  assert.deepEqual(placements.filter(item=>item.type==='survivor').map(item=>item.id), ['S0'])
  assert(!placements.some(item=>item.id==='ZZ'))
  assert.equal(placements.find(item=>item.id==='S0').lng,graph.nodes[0].lng)
  assert.equal(placements.filter(item=>item.type==='refuge').length,4)
})

test('la escena acepta 200 personas sin cambiar el estado y elimina entidades al finalizar', () => {
  const toMercator = ([lng,lat]) => ({x:(lng+180)/360,y:(90-lat)/180,z:0,meterInMercatorCoordinateUnits:()=>1/40000000})
  const layer = createAvatarLayer(graph,{toMercator,reducedMotion:true})
  const state = {sessionId:'local',revision:1,turn:0,phase:'READY',survivors:graph.nodes.slice(0,200).map((node,index)=>({id:`S${index}`,status:'ACTIVE',nodeId:node.id})),zombies:[],vehicles:[],blockedStreetIds:[]}
  const original = structuredClone(state)
  layer.updateState(state); layer.setVisible(true)
  assert.equal(layer.stats().models,204)
  assert.deepEqual(state,original)
  layer.updateState({...state,revision:2,survivors:state.survivors.map(item=>({...item,status:'RESCUED'}))})
  assert.equal(layer.stats().models,4)
  layer.onRemove()
})
