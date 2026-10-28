const test = require('node:test')
const assert = require('node:assert/strict')
const { moveVehicles } = require('../src/simulation/rescue')
const { resilientRefugeCandidates } = require('../src/domain/refuge-sites')
const { createInitialState, advanceWorld } = require('../src/simulation/engine')
const map = require('../data/manta.graph.local-600.json')

test('una camioneta conserva su objetivo en los dos pasos y no se lo adjudica otra', () => {
  const ids=['A','B','C','D','F']
  const fixture={nodes:ids.map(id=>({id})),streets:ids.slice(1).map((id,i)=>({id:`E${i}`,fromNode:ids[i],toNode:id,distanceM:10,speedMps:1})),refuges:[{id:'F0',nodeId:'F'}]}
  const state={pro:true,blockedStreetIds:[],zombies:[],reservations:{S:'F0'},refuges:[{id:'F0',capacity:4}],survivors:[{id:'S',status:'ACTIVE',nodeId:'D',refugeId:'F0'}],vehicles:['V1','V2'].map(id=>({id,nodeId:'A',capacity:4,passengerIds:[],totalPickedUp:0}))}
  moveVehicles(state,fixture)
  assert.equal(state.vehicles[0].nodeId,'C')
  assert.equal(state.vehicles[0].targetSurvivorId,'S')
  assert.equal(state.vehicles[1].nodeId,'A')
  assert.equal(state.vehicleMovements.filter(item=>item.vehicleId==='V1').length,2)
})

test('los refugios evitan un ramal con un unico acceso', () => {
  const ids=['A','B','C','D','P','Q'],pairs=[['A','B'],['A','C'],['A','D'],['B','C'],['B','D'],['C','D'],['D','P'],['P','Q']]
  const candidates=resilientRefugeCandidates(ids.map(id=>({id})),pairs.map(([fromNode,toNode],i)=>({id:`E${i}`,fromNode,toNode})))
  assert.deepEqual(new Set(candidates.map(node=>node.id)),new Set(['A','B','C','D']))
})

test('regresion de la ronda local 80 Pro: el puente no deja veinte cupos inaccesibles', () => {
  let state=createInitialState(map,'manta-demo',80,{round:2,pro:true})
  while(!state.roundFinished) state=advanceWorld(state,map)
  assert.equal(state.survivors.filter(person=>person.status==='RESCUED').length,80)
  assert.equal(state.survivors.filter(person=>['ACTIVE','ONBOARD'].includes(person.status)).length,0)
  assert.equal(state.metrics.invalidMoves,0)
  assert(state.refuges.every(refuge=>refuge.occupied<=refuge.capacity))
  assert(state.turn<150)
})
