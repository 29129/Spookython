const { DynamoDBClient } = require('@aws-sdk/client-dynamodb')
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb')
const { SecretsManagerClient, PutSecretValueCommand } = require('@aws-sdk/client-secrets-manager')
const { CodeBuildClient, StartBuildCommand } = require('@aws-sdk/client-codebuild')
const { checkApiKey } = require('./security/api-key')
const config = { region: process.env.AWS_REGION || 'us-east-1', maxAttempts: 2 }
const defaults = { db: DynamoDBDocumentClient.from(new DynamoDBClient(config)),
  secrets: new SecretsManagerClient(config), build: new CodeBuildClient(config) }
const respond = (statusCode, body) => ({ statusCode, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(body) })

function createDiagnosticHandler({ db, secrets, build } = defaults) {
  return async (event) => {
    if ((event.requestContext?.http?.method || event.httpMethod) !== 'POST') return respond(404, { message: 'Ruta no encontrada.' })
    const authorization = checkApiKey(event)
    if (authorization !== 'valid') return respond(authorization === 'not-configured' ? 503 : 401, { message: 'Clave de control no valida.' })
    const key = { worldId: 'refugio593-diagnostics', entityId: 'FINAL-20261028' }
    const TableName = process.env.WORLD_STATE_TABLE_NAME
    try {
      const existing = await db.send(new GetCommand({ TableName, Key: key, ConsistentRead: true }))
      if (existing.Item) return respond(409, { message: 'La prueba final ya fue solicitada. Revisa el resumen; no se inicia otro trabajo.' })
      const headers = event.headers || {}
      const rawKey = headers['x-api-key'] || headers['X-Api-Key'] || headers['X-API-Key']
      await secrets.send(new PutSecretValueCommand({ SecretId: 'refugio593/latency-final-key', SecretString: JSON.stringify({ apiKey: rawKey }) }))
      // A separate partition and conditional write make this a one-shot paid action.
      await db.send(new PutCommand({ TableName, Item: { ...key, requestedAt: new Date().toISOString() }, ConditionExpression: 'attribute_not_exists(worldId)' }))
      const result = await build.send(new StartBuildCommand({ projectName: 'refugio593-latency-final', idempotencyToken: 'refugio593-final-20261028' }))
      return respond(202, { buildId: result.build?.id, summaryUrl: 'https://d2qqi0nkfeyck5.cloudfront.net/evidence/summary.json' })
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') return respond(409, { message: 'La prueba final ya fue solicitada.' })
      console.error(JSON.stringify({ event: 'diagnostic_start_error', error: error.name }))
      return respond(500, { message: 'No se pudo confirmar el inicio de la prueba final. No repitas el pedido hasta revisar su estado.' })
    }
  }
}
module.exports = { createDiagnosticHandler, handler: createDiagnosticHandler() }
