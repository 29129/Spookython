const test = require('node:test')
const assert = require('node:assert/strict')
const { MemoryDynamo } = require('./support.cjs')
const { createStore } = require('../src/simulation/store')
const { getNextStep } = require('../src/routing/service')
const { stepKey, STEP_GROUPS } = require('../src/simulation/step-records')
const { marshall } = require('@aws-sdk/util-dynamodb')
const map = require('../src/data/manta.graph.json')

test('200 decisions use one strongly consistent projected read each and match full-state decisions', async () => {
  const client = new MemoryDynamo()
  const store = createStore(client, () => 'test')
  await store.resetStoredWorldState(map, { round: 3, pro: true })
  const state = await store.prepareStoredWorldState(map, {})
  let reads = 0
  const send = client.send.bind(client)
  client.send = async (command) => {
    if (command.constructor.name === 'GetCommand') {
      reads++
      assert.equal(command.input.ConsistentRead, true)
      assert.notEqual(command.input.Key.entityId, 'STATE')
      assert.match(command.input.ProjectionExpression, /stepDecisions\.#survivor/)
    }
    return send(command)
  }
  let compactBytes = 0
  for (const survivor of state.survivors) {
    const input = { sobrevivienteId: survivor.id, nodoActual: survivor.nodeId, turno: state.turn }
    const next = await getNextStep(input, map, store)
    const expected = await getNextStep(input, map, { getOrCreateWorldState: async () => state })
    assert.equal(next, expected)
    const snapshot = await store.readStepState(survivor.id)
    assert.deepEqual(Object.keys(snapshot.stepDecisions), [survivor.id])
    assert.equal(snapshot.survivors, undefined)
    compactBytes += Buffer.byteLength(JSON.stringify(snapshot))
  }
  assert.equal(reads, 400)
  assert(compactBytes / 200 < Buffer.byteLength(JSON.stringify(state)) / 10)
  const survivor = state.survivors[0]
  await assert.rejects(getNextStep({ sobrevivienteId: survivor.id, nodoActual: survivor.nodeId, turno: state.turn - 1 }, map, store), { name: 'StaleTurnError' })
  const otherNode = map.nodes.find((node) => node.id !== survivor.nodeId).id
  await assert.rejects(getNextStep({ sobrevivienteId: survivor.id, nodoActual: otherNode, turno: state.turn }, map, store), { name: 'InvalidStepRequestError' })
  client.send = send
  await store.resolveStoredWorldState(map, { turnToken: state.turnToken, decisions: [] })
  const current = await store.readStepState(survivor.id)
  assert.equal(current.phase, 'READY')
  const reset = await store.resetStoredWorldState(map, { round: 1 })
  assert.notEqual((await store.readStepState(reset.survivors[0].id)).sessionId, state.sessionId)
})

test('old snapshots without compact fields remain usable during deployment', async () => {
  const client = new MemoryDynamo()
  const store = createStore(client, () => 'test')
  const state = await store.prepareStoredWorldState(map, {})
  for (const [key, item] of client.items) if (item.entityId === 'CURRENT') client.items.delete(key)
  const survivor = state.survivors[0]
  const input = { sobrevivienteId: survivor.id, nodoActual: survivor.nodeId, turno: state.turn }
  assert.equal(await getNextStep(input, map, store), await getNextStep(input, map, { getOrCreateWorldState: async () => state }))
})

test('compact decisions still reject blocked edges, dangerous nodes and non-neighbors', async () => {
  const client = new MemoryDynamo()
  const store = createStore(client, () => 'test')
  const state = await store.prepareStoredWorldState(map, {})
  const survivor = state.survivors.find((item) => item.status === 'ACTIVE')
  const edge = map.streets.find((street) => street.fromNode === survivor.nodeId || street.toNode === survivor.nodeId)
  const neighbor = edge.fromNode === survivor.nodeId ? edge.toNode : edge.fromNode
  const input = { sobrevivienteId: survivor.id, nodoActual: survivor.nodeId, turno: state.turn }
  const key = stepKey(survivor.id)
  const item = client.items.get(JSON.stringify([key.worldId, key.entityId]))
  item.stepDecisions[survivor.id][2] = neighbor
  item.blockedStreetIds = [edge.id]
  assert.equal(await getNextStep(input, map, store), survivor.nodeId)
  item.blockedStreetIds = []
  item.dangerNodeIds = [neighbor]
  assert.equal(await getNextStep(input, map, store), survivor.nodeId)
  item.dangerNodeIds = []
  const adjacent = new Set(map.streets.flatMap((street) => street.fromNode === survivor.nodeId ? [street.toNode] : street.toNode === survivor.nodeId ? [street.fromNode] : []))
  item.stepDecisions[survivor.id][2] = map.nodes.find((node) => node.id !== survivor.nodeId && !adjacent.has(node.id)).id
  assert.equal(await getNextStep(input, map, store), survivor.nodeId)
  item.stepDecisions[survivor.id] = [survivor.nodeId, 'RESCUED', neighbor]
  assert.equal(await getNextStep(input, map, store), survivor.nodeId)
})

test('compact storage stays below 4 KiB per group and failed writes cannot mix revisions', async () => {
  const client = new MemoryDynamo()
  const store = createStore(client, () => 'test')
  await store.resetStoredWorldState(map, { round: 3, pro: true })
  const first = await store.prepareStoredWorldState(map, {})
  const groups = [...client.items.values()].filter((item) => item.entityId === 'CURRENT')
  assert.equal(groups.length, STEP_GROUPS)
  assert.equal((await store.readWorldState()).stepDecisions, undefined)
  for (const group of groups) {
    // Serialized AttributeValue JSON overestimates DynamoDB's item byte count.
    assert(Buffer.byteLength(JSON.stringify(marshall(group))) < 4096)
    assert.equal(group.revision, first.revision)
    assert.equal(group.sessionId, first.sessionId)
  }
  const originalSend = client.send.bind(client)
  const before = structuredClone(client.items)
  client.send = async (command) => {
    if (command.constructor.name === 'TransactWriteCommand') {
      const invalid = structuredClone(command.input)
      // Fail the last put after all earlier puts have been staged.
      invalid.TransactItems.at(-1).Put.ConditionExpression = 'attribute_not_exists(worldId)'
      return originalSend({ constructor: { name: 'TransactWriteCommand' }, input: invalid })
    }
    return originalSend(command)
  }
  await assert.rejects(store.resolveStoredWorldState(map, { turnToken: first.turnToken, decisions: [] }), { name: 'ConditionalCheckFailedException' })
  assert.deepEqual(client.items, before)
  client.send = originalSend
  const resolved = await store.resolveStoredWorldState(map, { turnToken: first.turnToken, decisions: [] })
  for (const group of [...client.items.values()].filter((item) => item.entityId === 'CURRENT')) {
    assert.equal(group.revision, resolved.revision)
    assert.equal(group.phase, 'READY')
  }
})
