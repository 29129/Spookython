const test = require('node:test')
const assert = require('node:assert/strict')
const map = require('../src/data/manta.graph.json')
const { buildAdjacency } = require('../src/domain/graph')
const { planNextStep } = require('../src/routing/planner')
const { createInitialState, prepareWorld, resolveWorld, publicState } = require('../src/simulation/engine')
const { dangerNodes, moveZombie, predictRunners } = require('../src/simulation/zombies')
const { reserveRefuges, moveVehicles, admitSurvivor } = require('../src/simulation/rescue')

function graph(ids, edges, shelters = ['F']) {
  return { metadata: { sourceTimestamp: 'fixture' }, nodes: ids.map((id, index) => ({ id, lat: 0, lng: index })),
    streets: edges.map(([fromNode, toNode, distanceM = 1], index) => ({ id: `E${index}`, fromNode, toNode, distanceM, speedMps: 1, type: 'CALLE' })),
    refuges: shelters.map((nodeId, index) => ({ id: `F${index}`, nodeId })) }
}
function state(zombies = [], survivors = [{ id: 'S', nodeId: 'A', status: 'ACTIVE', refugeId: 'F0', routeNodeIds: [] }]) {
  return { worldId: 'test', sessionId: 'session', turn: 0, round: 1, phase: 'READY', zombies, survivors,
    pro: false, blockedStreetIds: [], reservations: {}, vehicles: [], refuges: [], metrics: { requests: 0, errors: 0, timeouts: 0, invalidMoves: 0, slowTurns: 0 } }
}
const input = (node = 'A', turn = 0) => ({ sobrevivienteId: 'S', nodoActual: node, turno: turn })

test('la horda prohíbe su nodo y todos los vecinos, incluso con una calle cerrada', () => {
  const fixture = graph(['A', 'B', 'C', 'H', 'F'], [['A', 'B'], ['B', 'F'], ['A', 'C'], ['C', 'F'], ['H', 'B']])
  const current = state([{ id: 'H', type: 'HORDE', nodeId: 'H' }])
  current.blockedStreetIds = ['E4']
  assert.deepEqual([...dangerNodes(fixture, current)].sort(), ['B', 'H'])
  assert.equal(planNextStep(input(), fixture, current, null).siguienteNodo, 'C')
})

test('Dijkstra pondera distancia/velocidad y descarta caché bloqueada', () => {
  const fixture = graph(['A', 'B', 'C', 'F'], [['A', 'B', 10], ['B', 'F', 10], ['A', 'C', 30], ['C', 'F', 30]])
  fixture.streets[2].speedMps = fixture.streets[3].speedMps = 10
  const current = state()
  const first = planNextStep(input(), fixture, current, null)
  assert.equal(first.siguienteNodo, 'C')
  current.blockedStreetIds = ['E2']
  assert.equal(planNextStep(input(), fixture, current, first.routeCache).siguienteNodo, 'B')
})

test('rondas 20/80/200 tienen la mezcla exigida y cinco vehículos solo en Pro', () => {
  const first = createInitialState(map, 'r1', 20)
  const second = createInitialState(map, 'r2', 80)
  const third = createInitialState(map, 'r3', 200, { pro: true })
  assert(first.zombies.every((zombie) => zombie.type === 'WALKER'))
  assert.deepEqual([...new Set(second.zombies.map((zombie) => zombie.type))].sort(), ['HORDE', 'RUNNER', 'WALKER'])
  assert(third.zombies.some((zombie) => zombie.asleep))
  assert.equal(first.vehicles.length, 0)
  assert.equal(third.vehicles.length, 5)
  assert(third.vehicles.every((vehicle) => vehicle.capacity === 4))
  assert.equal(third.survivors.length, 200)
})

test('caminante cada dos turnos; corredor persigue hasta tres nodos y avanza dos calles', () => {
  const fixture = graph(['A', 'B', 'C', 'F'], [['A', 'B'], ['B', 'C'], ['C', 'F']])
  const adjacency = buildAdjacency(fixture)
  const walker = { id: 'W', type: 'WALKER', nodeId: 'A' }
  moveZombie(walker, [], adjacency, 1, [])
  assert.equal(walker.nodeId, 'A')
  moveZombie(walker, [], adjacency, 2, [])
  assert.equal(walker.nodeId, 'B')
  const runner = { id: 'R', type: 'RUNNER', nodeId: 'A' }
  const moves = []
  moveZombie(runner, [{ status: 'ACTIVE', nodeId: 'F' }], adjacency, 1, moves)
  assert.equal(runner.nodeId, 'C')
  assert.equal(moves.length, 2)
})

test('el dormido permanece oculto lejos y despierta al entrar en un radio de dos nodos', () => {
  const fixture = graph(['A', 'B', 'C', 'D', 'F'], [['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'F']])
  const current = state([{ id: 'Z', type: 'SLEEPER', asleep: true, nodeId: 'D' }])
  assert.equal(publicState(current, fixture).zombies.length, 0)
  current.survivors[0].nodeId = 'B'
  const prepared = prepareWorld(current, fixture, { type: 'NONE' })
  assert.equal(prepared.zombies[0].type, 'WALKER')
  assert.equal(publicState(prepared, fixture).zombies.length, 1)
})

test('la predicción de un corredor cambia el siguiente paso y no revela dormidos', () => {
  const fixture = graph(['A', 'B', 'C', 'R', 'F'], [['A', 'B'], ['B', 'F'], ['A', 'C', 2], ['C', 'F', 2], ['R', 'B']])
  const current = state([{ id: 'R', type: 'RUNNER', nodeId: 'R' }])
  assert.equal(planNextStep(input(), fixture, current, null).siguienteNodo, 'B')
  current.pro = true
  current.reservations.S = 'F0'
  assert.equal(planNextStep(input(), fixture, current, null).siguienteNodo, 'C')
  assert.deepEqual(predictRunners(fixture, current)[0].nodeIds, ['B', 'A'])
})

test('más de 500 ms, error o destino no vecino dejan al sobreviviente quieto', () => {
  const fixture = graph(['A', 'B', 'F'], [['A', 'B'], ['B', 'F']])
  const prepared = prepareWorld(state(), fixture, { type: 'NONE' })
  for (const decision of [{ durationMs: 501, siguienteNodo: 'B' }, { durationMs: 1, error: true, siguienteNodo: 'B' }, { durationMs: 1, siguienteNodo: 'F' }]) {
    const result = resolveWorld(prepared, fixture, [{ survivorId: 'S', ...decision }])
    assert.equal(result.survivors[0].nodeId, 'A')
  }
})

test('compartir nodo y cruzar en sentido opuesto producen mordida', () => {
  const fixture = graph(['A', 'B', 'F'], [['A', 'B'], ['A', 'F']])
  const current = state([{ id: 'Z', type: 'WALKER', nodeId: 'A' }], [{ id: 'S', nodeId: 'B', status: 'ACTIVE', refugeId: 'F0', routeNodeIds: [] }])
  current.turn = 1
  const prepared = prepareWorld(current, fixture, { type: 'NONE' })
  prepared.zombies[0].nodeId = 'B'
  prepared.zombieMovements = [{ fromNodeId: 'A', toNodeId: 'B', streetId: 'E0' }]
  assert.equal(resolveWorld(prepared, fixture, [{ survivorId: 'S', siguienteNodo: 'A', durationMs: 1 }]).survivors[0].status, 'BITTEN')
  assert.equal(resolveWorld(prepared, fixture, []).survivors[0].status, 'BITTEN')
})

test('reservas de refugios reparten cupos y no sobreasignan aunque uno esté lleno', () => {
  const fixture = graph(['A', 'F', 'G'], [['A', 'F'], ['A', 'G', 2]], ['F', 'G'])
  const current = state([], Array.from({ length: 4 }, (_, index) => ({ id: `S${index}`, nodeId: 'A', status: 'ACTIVE' })))
  current.pro = true
  current.refuges = [{ id: 'F0', capacity: 1 }, { id: 'F1', capacity: 2 }]
  reserveRefuges(current, fixture)
  assert.equal(Object.values(current.reservations).filter((id) => id === 'F0').length, 1)
  assert.equal(Object.values(current.reservations).filter((id) => id === 'F1').length, 2)
  assert.equal(Object.keys(current.reservations).length, 3)
  current.survivors[0].status = 'RESCUED'
  current.survivors[0].refugeId = 'F0'
  current.survivors[1].nodeId = 'F'
  current.survivors[1].refugeId = 'F0'
  assert.equal(admitSurvivor(current, current.survivors[1], fixture), false)
})

test('camioneta lleva máximo cuatro personas, avanza dos calles y descarga en refugio', () => {
  const fixture = graph(['A', 'B', 'C', 'D', 'F'], [['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'F']])
  const current = state([], Array.from({ length: 5 }, (_, index) => ({ id: `S${index}`, nodeId: 'A', status: 'ACTIVE', refugeId: 'F0' })))
  current.pro = true
  current.refuges = [{ id: 'F0', capacity: 10 }]
  current.reservations = Object.fromEntries(current.survivors.map((survivor) => [survivor.id, 'F0']))
  current.vehicles = [{ id: 'V1', nodeId: 'A', capacity: 4, passengerIds: [], totalPickedUp: 0 }]
  moveVehicles(current, fixture)
  assert.equal(current.vehicles[0].passengerIds.length, 4)
  assert.equal(current.vehicles[0].nodeId, 'C')
  assert.equal(current.vehicleMovements.length, 2)
  moveVehicles(current, fixture)
  assert.equal(current.vehicles[0].nodeId, 'F')
  assert.equal(current.survivors.filter((survivor) => survivor.status === 'RESCUED').length, 4)
  assert.equal(current.vehicles[0].passengerIds.length, 0)
})

test('eventos de ronda: un puente en R2 y dos avenidas en R3', () => {
  for (const round of [1, 2, 3]) {
    let current = createInitialState(map, `events-${round}`, 1, { round })
    for (let turn = 0; turn < 10; turn += 1) {
      current = prepareWorld(current, map)
      current = resolveWorld(current, map, [])
      current.roundFinished = false
    }
    assert.equal(current.blockedStreetIds.length, round === 1 ? 0 : round === 2 ? 1 : 2)
  }
})
