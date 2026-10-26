const mantaMap = require('./data/manta.graph.json')

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
  return response(404, { message: 'Ruta no encontrada.' })
}
