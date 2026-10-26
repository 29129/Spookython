const mantaMap = require('./data/manta.graph.json')
const { getOrCreateWorldState, advanceStoredWorldState } = require('./simulation/store')
const { createInitialState, publicState } = require('./simulation/engine')
const { checkApiKey } = require('./security/api-key')
const { getNextStep } = require('./routing/service')

function response(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  }
}

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod
  const route = event.rawPath || event.path

  if (method === 'GET' && route === '/health') {
    return response(200, { status: 'ok', service: 'spookython-api' })
  }
  if (method === 'GET' && route === '/map') {
    return response(200, mantaMap)
  }
  if (method === 'GET' && route === '/estado') {
    const state = await getOrCreateWorldState(() => createInitialState(mantaMap))
    return response(200, publicState(state, mantaMap))
  }
  if (method === 'POST' && route === '/estado/avanzar') {
    const authorization = checkApiKey(event)
    if (authorization === 'not-configured') {
      return response(503, { message: 'La API key del simulador todavía no está configurada.' })
    }
    if (authorization !== 'valid') return response(401, { message: 'API key inválida.' })

    let payload = {}
    try {
      const body = event.body
        ? (event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body)
        : '{}'
      payload = JSON.parse(body)
    } catch {
      return response(400, { message: 'El cuerpo debe ser JSON válido.' })
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return response(400, { message: 'El cuerpo debe ser un objeto JSON.' })
    }

    try {
      const state = await advanceStoredWorldState(mantaMap, payload.cityEvent)
      return response(200, publicState(state, mantaMap))
    } catch (error) {
      if (error.name === 'InvalidCityEventError') return response(400, { message: error.message })
      if (error.name === 'ConditionalCheckFailedException') {
        return response(409, { message: 'Otro cliente avanzó el turno. Vuelve a consultar /estado.' })
      }
      console.error('No se pudo avanzar la simulación:', error.name || error.message)
      return response(500, { message: 'No se pudo avanzar la simulación.' })
    }
  }
  if (method === 'POST' && route === '/paso') {
    const authorization = checkApiKey(event)
    if (authorization === 'not-configured') {
      return response(503, { message: 'La API key del simulador todavía no está configurada.' })
    }
    if (authorization !== 'valid') return response(401, { message: 'API key inválida.' })

    let payload
    try {
      const body = event.body
        ? (event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body)
        : '{}'
      payload = JSON.parse(body)
    } catch {
      return response(400, { message: 'El cuerpo debe ser JSON válido.' })
    }

    try {
      const siguienteNodo = await getNextStep(payload, mantaMap)
      return response(200, { siguienteNodo })
    } catch (error) {
      if (error.name === 'InvalidStepRequestError') return response(400, { message: error.message })
      console.error('No se pudo calcular el siguiente paso:', error.name || error.message)
      return response(500, { message: 'No se pudo calcular el siguiente paso.' })
    }
  }
  return response(404, { message: 'Ruta no encontrada.' })
}
