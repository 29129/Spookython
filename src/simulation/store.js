const { DynamoDBClient } = require('@aws-sdk/client-dynamodb')
const { DynamoDBDocumentClient, GetCommand, PutCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb')
const { stepKey, stepRecords } = require('./step-records')

const dynamoDb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1', maxAttempts: 2 }),
  { marshallOptions: { removeUndefinedValues: true } })
const stale = () => Object.assign(new Error('El turno cambió en otro cliente. Actualiza el estado.'), { name: 'StaleTurnError' })

function createStore(client = dynamoDb, table = () => process.env.WORLD_STATE_TABLE_NAME) {
  const tableName = () => { const value = table(); if (!value) throw new Error('Falta configurar WORLD_STATE_TABLE_NAME.'); return value }
  async function initializeConnection() {
    // A missing metadata item opens credentials/TLS without reading the whole world.
    await client.send(new GetCommand({ TableName: tableName(),
      Key: { worldId: 'manta-demo', entityId: 'INITIALIZATION_CHECK' }, ConsistentRead: true }))
  }
  async function readWorldState() {
    const result = await client.send(new GetCommand({ TableName: tableName(), Key: { worldId: 'manta-demo', entityId: 'STATE' }, ConsistentRead: true }))
    if (!result.Item) return null
    const { entityId, ...state } = result.Item
    return state
  }
  async function saveState(next, current) {
    next.revision = (current?.revision || 0) + 1
    // Remove the legacy duplicated decisions from STATE when upgrading a live world.
    delete next.stepDecisions
    const values = { TableName: tableName(), Item: { ...next, entityId: 'STATE' } }
    if (!current) values.ConditionExpression = 'attribute_not_exists(worldId)'
    else {
      values.ExpressionAttributeNames = { '#turn': 'turn' }
      values.ExpressionAttributeValues = { ':turn': current.turn }
      values.ConditionExpression = '#turn = :turn'
      if (current.revision !== undefined) {
        values.ExpressionAttributeNames['#revision'] = 'revision'
        values.ExpressionAttributeValues[':revision'] = current.revision
        values.ConditionExpression += ' AND #revision = :revision'
      } else {
        values.ExpressionAttributeNames['#revision'] = 'revision'
        values.ConditionExpression += ' AND attribute_not_exists(#revision)'
      }
      if (current.sessionId) {
        values.ExpressionAttributeNames['#session'] = 'sessionId'
        values.ExpressionAttributeValues[':session'] = current.sessionId
        values.ConditionExpression += ' AND #session = :session'
      }
    }
    try {
      await client.send(new TransactWriteCommand({ TransactItems: [
        { Put: values },
        ...stepRecords(next).map((Item) => ({ Put: { TableName: tableName(), Item } })),
      ] }))
    } catch (error) {
      if (error.name === 'TransactionCanceledException' && error.CancellationReasons?.some((reason) =>
        ['ConditionalCheckFailed', 'TransactionConflict'].includes(reason.Code))) {
        throw Object.assign(new Error('El mundo cambio durante la escritura atomica.'), { name: 'ConditionalCheckFailedException' })
      }
      throw error
    }
    return next
  }
  async function readStepState(survivorId) {
    const result = await client.send(new GetCommand({ TableName: tableName(),
      Key: stepKey(survivorId), ConsistentRead: true,
      ProjectionExpression: '#turn, sessionId, revision, phase, schemaVersion, stepDecisions.#survivor, blockedStreetIds, dangerNodeIds',
      ExpressionAttributeNames: { '#turn': 'turn', '#survivor': survivorId } }))
    return result.Item || null
  }
  async function getOrCreateWorldState(createState) {
    const existing = await readWorldState()
    if (existing) return existing
    try { return await saveState(createState(), null) }
    catch (error) {
      if (error.name !== 'ConditionalCheckFailedException') throw error
      const winner = await readWorldState()
      if (!winner) throw error
      return winner
    }
  }
  async function readRouteCache(survivorId, sessionId = 'legacy') {
    const result = await client.send(new GetCommand({ TableName: tableName(),
      Key: { worldId: 'manta-demo', entityId: `ROUTE#${sessionId}#${survivorId}` }, ConsistentRead: true }))
    if (!result.Item || result.Item.expiresAt < Math.floor(Date.now() / 1000)) return null
    const { worldId, entityId, expiresAt, ...route } = result.Item
    return route
  }
  async function writeRouteCache(survivorId, route, sessionId = 'legacy') {
    await client.send(new PutCommand({ TableName: tableName(), Item: { ...route, worldId: 'manta-demo',
      entityId: `ROUTE#${sessionId}#${survivorId}`, expiresAt: Math.floor(Date.now() / 1000) + 3600 } }))
  }
  async function prepareStoredWorldState(map, payload) {
    const { createInitialState, prepareWorld } = require('./engine')
    const current = await getOrCreateWorldState(() => createInitialState(map))
    if (current.phase === 'DECIDING') return current
    if (payload.expectedTurn !== undefined && payload.expectedTurn !== current.turn) throw stale()
    return saveState(prepareWorld(current, map, payload.cityEvent), current)
  }
  async function resolveStoredWorldState(map, payload) {
    const { resolveWorld } = require('./engine')
    const current = await readWorldState()
    if (!current || current.phase !== 'DECIDING' || payload.turnToken !== current.turnToken) throw stale()
    return saveState(resolveWorld(current, map, payload.decisions, { turnDurationMs: payload.turnDurationMs }), current)
  }
  async function resetStoredWorldState(map, payload) {
    const { ROUND_COUNTS, createInitialState } = require('./engine')
    const round = payload.round ?? 1
    if (!ROUND_COUNTS[round] || !Number.isInteger(round) || (payload.pro !== undefined && typeof payload.pro !== 'boolean')
      || (payload.runnerContactBites !== undefined && typeof payload.runnerContactBites !== 'boolean')
      || (payload.refugeCapacities !== undefined && (!payload.refugeCapacities || typeof payload.refugeCapacities !== 'object' || Array.isArray(payload.refugeCapacities)))) {
      throw Object.assign(new Error('Indica round 1, 2 o 3 y pro como booleano.'), { name: 'InvalidSimulationRequestError' })
    }
    const current = await readWorldState()
    return saveState(createInitialState(map, 'manta-demo', ROUND_COUNTS[round], { round, pro: payload.pro,
      runnerContactBites: payload.runnerContactBites, refugeCapacities: payload.refugeCapacities }), current)
  }
  return { initializeConnection, getOrCreateWorldState, readWorldState, readStepState, readRouteCache, writeRouteCache,
    prepareStoredWorldState, resolveStoredWorldState, resetStoredWorldState }
}
module.exports = { createStore, ...createStore() }
