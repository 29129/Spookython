const { DynamoDBClient } = require('@aws-sdk/client-dynamodb')
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb')
const { advanceWorld, createInitialState } = require('./engine')

const WORLD_STATE_ENTITY_ID = 'STATE'
const dynamoDb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' }),
  { marshallOptions: { removeUndefinedValues: true } },
)

function tableName() {
  const name = process.env.WORLD_STATE_TABLE_NAME
  if (!name) throw new Error('Falta configurar WORLD_STATE_TABLE_NAME.')
  return name
}

async function readWorldState() {
  const result = await dynamoDb.send(new GetCommand({
    TableName: tableName(),
    Key: { worldId: 'manta-demo', entityId: WORLD_STATE_ENTITY_ID },
    ConsistentRead: true,
  }))
  if (!result.Item) return null
  const { entityId, ...state } = result.Item
  return state
}

async function readRouteCache(survivorId) {
  const result = await dynamoDb.send(new GetCommand({
    TableName: tableName(),
    Key: { worldId: 'manta-demo', entityId: `ROUTE#${survivorId}` },
    ConsistentRead: true,
  }))
  if (!result.Item) return null
  const { worldId, entityId, survivorId: cachedSurvivorId, ...route } = result.Item
  return route
}

async function writeRouteCache(survivorId, route) {
  await dynamoDb.send(new PutCommand({
    TableName: tableName(),
    Item: {
      worldId: 'manta-demo',
      entityId: `ROUTE#${survivorId}`,
      survivorId,
      ...route,
    },
  }))
}

async function saveInitialState(state) {
  await dynamoDb.send(new PutCommand({
    TableName: tableName(),
    Item: { ...state, entityId: WORLD_STATE_ENTITY_ID },
    ConditionExpression: 'attribute_not_exists(worldId)',
  }))
}

async function getOrCreateWorldState(createState) {
  const existing = await readWorldState()
  if (existing) return existing

  const initial = createState()
  try {
    await saveInitialState(initial)
    return initial
  } catch (error) {
    if (error.name !== 'ConditionalCheckFailedException') throw error
    const winner = await readWorldState()
    if (winner) return winner
    throw error
  }
}

async function advanceStoredWorldState(map, requestedEvent) {
  const current = await readWorldState()
  if (!current) {
    const initial = await getOrCreateWorldState(() => createInitialState(map))
    return advanceStoredWorldStateFromState(initial, map, requestedEvent)
  }
  return advanceStoredWorldStateFromState(current, map, requestedEvent)
}

async function advanceStoredWorldStateFromState(current, map, requestedEvent) {
  const next = advanceWorld(current, map, requestedEvent)
  await dynamoDb.send(new PutCommand({
    TableName: tableName(),
    Item: { ...next, entityId: WORLD_STATE_ENTITY_ID },
    ConditionExpression: '#turn = :previousTurn',
    ExpressionAttributeNames: { '#turn': 'turn' },
    ExpressionAttributeValues: { ':previousTurn': current.turn },
  }))
  return next
}

module.exports = {
  advanceStoredWorldState,
  getOrCreateWorldState,
  readRouteCache,
  writeRouteCache,
}
