const { DynamoDBClient } = require('@aws-sdk/client-dynamodb')
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb')
const { prepareWorld, resolveWorld, createInitialState, ROUND_COUNTS } = require('./engine')

const dynamoDb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1', maxAttempts: 2 }),
  { marshallOptions: { removeUndefinedValues: true } })
const stale = () => Object.assign(new Error('El turno cambió en otro cliente. Actualiza el estado.'), { name: 'StaleTurnError' })

function createStore(client = dynamoDb, table = () => process.env.WORLD_STATE_TABLE_NAME) {
  const tableName = () => { const value = table(); if (!value) throw new Error('Falta configurar WORLD_STATE_TABLE_NAME.'); return value }
  async function readWorldState() {
    const result = await client.send(new GetCommand({ TableName: tableName(), Key: { worldId: 'manta-demo', entityId: 'STATE' }, ConsistentRead: true }))
    if (!result.Item) return null
    const { entityId, ...state } = result.Item
    return state
  }
  async function saveState(next, current) {
    next.revision = (current?.revision || 0) + 1
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
    await client.send(new PutCommand(values))
    return next
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
    const current = await getOrCreateWorldState(() => createInitialState(map))
    if (current.phase === 'DECIDING') return current
    if (payload.expectedTurn !== undefined && payload.expectedTurn !== current.turn) throw stale()
    return saveState(prepareWorld(current, map, payload.cityEvent), current)
  }
  async function resolveStoredWorldState(map, payload) {
    const current = await readWorldState()
    if (!current || current.phase !== 'DECIDING' || payload.turnToken !== current.turnToken) throw stale()
    return saveState(resolveWorld(current, map, payload.decisions, { turnDurationMs: payload.turnDurationMs }), current)
  }
  async function resetStoredWorldState(map, payload) {
    const round = payload.round ?? 1
    if (!ROUND_COUNTS[round] || !Number.isInteger(round) || (payload.pro !== undefined && typeof payload.pro !== 'boolean')
      || (payload.refugeCapacities !== undefined && (!payload.refugeCapacities || typeof payload.refugeCapacities !== 'object' || Array.isArray(payload.refugeCapacities)))) {
      throw Object.assign(new Error('Indica round 1, 2 o 3 y pro como booleano.'), { name: 'InvalidSimulationRequestError' })
    }
    const current = await readWorldState()
    return saveState(createInitialState(map, 'manta-demo', ROUND_COUNTS[round], { round, pro: payload.pro, refugeCapacities: payload.refugeCapacities }), current)
  }
  return { getOrCreateWorldState, readWorldState, readRouteCache, writeRouteCache,
    prepareStoredWorldState, resolveStoredWorldState, resetStoredWorldState }
}
module.exports = { createStore, ...createStore() }
