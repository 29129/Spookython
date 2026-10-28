const { createServer } = require('node:http')
const { createStore } = require('../src/simulation/store')
const { createHandler } = require('../src/handler')
const fs = require('node:fs/promises')

class MemoryDynamo {
  constructor() { this.items = new Map() }
  async send(command) {
    const input = command.input
    const key = JSON.stringify([input.Key?.worldId || input.Item.worldId, input.Key?.entityId || input.Item.entityId])
    if (command.constructor.name === 'GetCommand') return { Item: structuredClone(this.items.get(key)) }
    const previous = this.items.get(key)
    const values = input.ExpressionAttributeValues
    let valid = true
    if (input.ConditionExpression === 'attribute_not_exists(worldId)') valid = !previous
    else if (input.ConditionExpression) {
      valid = previous && previous.turn === values[':turn']
      if (input.ConditionExpression.includes('attribute_not_exists(#revision)')) valid &&= previous.revision === undefined
      else if (input.ConditionExpression.includes('#revision')) valid &&= previous.revision === values[':revision']
      if (input.ConditionExpression.includes('#session')) valid &&= previous.sessionId === values[':session']
    }
    if (!valid) throw Object.assign(new Error('Condition mismatch'), { name: 'ConditionalCheckFailedException' })
    this.items.set(key, structuredClone(input.Item))
    return {}
  }
}

async function localApi({ serveWeb = false, port = 0 } = {}) {
  const client = new MemoryDynamo()
  const store = createStore(client, () => 'test-table')
  const handler = createHandler(store)
  const requests = []
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const path = new URL(request.url, 'http://localhost').pathname
    if (serveWeb && request.method === 'GET' && !['/health', '/map', '/estado'].includes(path)) {
      const relative = path === '/' ? '/index.html' : path
      if (!['/index.html', '/avatars.html', '/styles.css', '/app.js', '/simulator-client.mjs', '/map-projection.mjs', '/map-avatars.mjs', '/assets/avatars/spookython-pixel-atlas.png'].includes(relative)) { response.writeHead(404); response.end(); return }
      const binary = relative.endsWith('.png')
      let content = await fs.readFile(require('node:path').join(__dirname, '../web', relative.slice(1)), binary ? undefined : 'utf8')
      if (relative === '/app.js') content = content.replace('https://gkzb014d54.execute-api.us-east-1.amazonaws.com', `http://127.0.0.1:${server.address().port}`)
      response.writeHead(200, { 'content-type': binary ? 'image/png' : relative.endsWith('.css') ? 'text/css' : relative.endsWith('.html') ? 'text/html' : 'text/javascript' })
      response.end(content)
      return
    }
    requests.push(path)
    const result = await handler({ rawPath: path, requestContext: { http: { method: request.method } },
      headers: request.headers, body: Buffer.concat(chunks).toString('utf8') })
    response.writeHead(result.statusCode, result.headers)
    response.end(result.body)
  })
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))
  return { server, store, client, requests, baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve) }) }
}
module.exports = { MemoryDynamo, localApi }
