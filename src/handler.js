const mantaMap = require('./data/manta.graph.json')
const defaultStore = require('./simulation/store')
const { checkApiKey } = require('./security/api-key')
const { getNextStep } = require('./routing/service')

const response = (statusCode, body) => ({ statusCode, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, body: JSON.stringify(body) })
function createHandler(store = defaultStore, map = mantaMap) {
  let firstInvocation = true
  const processRequest = async (event) => {
    const method = event.requestContext?.http?.method || event.httpMethod
    const route = event.rawPath || event.path
    try {
      if (method === 'GET' && route === '/health') return response(200, { status: 'ok', service: 'spookython-api', schemaVersion: 2 })
      if (method === 'GET' && route === '/map') return response(200, map)
      if (method === 'GET' && route === '/estado') {
        const { createInitialState, publicState } = require('./simulation/engine')
        return response(200, publicState(await store.getOrCreateWorldState(() => createInitialState(map)), map))
      }
      if (method !== 'POST' || !['/paso', '/estado/avanzar', '/simulacion/reiniciar'].includes(route)) return response(404, { message: 'Ruta no encontrada.' })
      const authorization = checkApiKey(event)
      if (authorization === 'not-configured') return response(503, { message: 'La API key del simulador todavía no está configurada.' })
      if (authorization !== 'valid') return response(401, { message: 'API key inválida.' })
      let payload
      try { payload = JSON.parse(event.body ? (event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body) : '{}') }
      catch { return response(400, { message: 'El cuerpo debe ser JSON válido.' }) }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return response(400, { message: 'El cuerpo debe ser un objeto JSON.' })
      if (route === '/paso') return response(200, { siguienteNodo: await getNextStep(payload, map, store) })
      const { publicState } = require('./simulation/engine')
      if (route === '/simulacion/reiniciar') return response(200, publicState(await store.resetStoredWorldState(map, payload), map))
      if (payload.phase === 'PREPARE') return response(200, publicState(await store.prepareStoredWorldState(map, payload), map))
      if (payload.phase === 'RESOLVE') return response(200, publicState(await store.resolveStoredWorldState(map, payload), map))
      return response(400, { message: 'El simulador debe enviar phase PREPARE y después RESOLVE con las respuestas HTTP de /paso.' })
    } catch (error) {
      if (['InvalidStepRequestError', 'InvalidSimulationRequestError'].includes(error.name)) return response(400, { message: error.message })
      if (['StaleTurnError', 'ConditionalCheckFailedException'].includes(error.name)) return response(409, { message: 'El turno cambió en otro cliente. Actualiza el estado.' })
      console.error('Error de API:', error.name)
      const errorCodes = { ProvisionedThroughputExceededException: 'DYNAMODB_THROTTLED', ThrottlingException: 'DYNAMODB_THROTTLED',
        RequestLimitExceeded: 'DYNAMODB_LIMIT', TimeoutError: 'DEPENDENCY_TIMEOUT', NetworkingError: 'DEPENDENCY_NETWORK' }
      return response(500, { message: 'No se pudo procesar la solicitud.', code: errorCodes[error.name] || 'INTERNAL_ERROR' })
    }
  }
  return async (event, context = {}) => {
    const started = performance.now()
    const first = firstInvocation
    firstInvocation = false
    const result = await processRequest(event)
    const handlerMs = Number((performance.now() - started).toFixed(2))
    const memoryMb = Number(process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE) || null
    result.headers['x-app-duration-ms'] = String(handlerMs)
    result.headers['x-first-invocation'] = String(first)
    if (memoryMb) result.headers['x-lambda-memory-mb'] = String(memoryMb)
    if (process.env.AWS_LAMBDA_INITIALIZATION_TYPE) result.headers['x-lambda-init-type'] = process.env.AWS_LAMBDA_INITIALIZATION_TYPE
    const qualifier = context.invokedFunctionArn?.split(':')[7]
    if (qualifier) result.headers['x-lambda-qualifier'] = qualifier
    if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
      const path = event.rawPath || event.path
      const route = ['/paso', '/estado/avanzar', '/simulacion/reiniciar', '/health', '/estado', '/map'].includes(path) ? path : 'OTHER'
      console.log(JSON.stringify({ event: 'api_timing', requestId: context.awsRequestId,
        route, status: result.statusCode, handlerMs, firstInvocation: first, memoryMb,
        deploymentLabel: process.env.DEPLOYMENT_LABEL || 'default' }))
    }
    return result
  }
}
module.exports = { createHandler, handler: createHandler() }
