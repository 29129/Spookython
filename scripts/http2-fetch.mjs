import { connect } from 'node:http2'

// Reuse one HTTP/2 session; keep one real stream/request per survivor.
// The caller's AbortSignal still includes any stream queueing in its deadline.
function createSingleSessionFetch(baseUrl) {
  const origin = new URL(baseUrl).origin
  const session = connect(origin)
  let sessionError
  session.on('error', (error) => { sessionError = error })
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input)
    if (url.origin !== origin) throw new Error('El transporte HTTP/2 solo permite el origen configurado.')
    if (sessionError) throw sessionError
    options.signal?.throwIfAborted()
    return new Promise((resolve, reject) => {
      let stream
      try {
        stream = session.request({ ':method': options.method || 'GET', ':path': url.pathname + url.search,
          ...Object.fromEntries(new Headers(options.headers)) }, { signal: options.signal })
      } catch (error) { reject(error); return }
      const chunks = []
      let responseHeaders
      stream.on('response', (headers) => { responseHeaders = headers })
      stream.on('data', (chunk) => chunks.push(chunk))
      stream.on('error', reject)
      stream.on('end', () => {
        if (!responseHeaders) { reject(new Error('HTTP/2 terminó sin respuesta.')); return }
        const headers = Object.fromEntries(Object.entries(responseHeaders).filter(([key]) => !key.startsWith(':')))
        const status = Number(responseHeaders[':status'])
        resolve(new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), {status, headers}))
      })
      stream.end(options.body)
    })
  }
  return { fetch: fetchImpl, close: () => new Promise((resolve) => session.close(resolve)) }
}

export function createHttp2Fetch(baseUrl, { connections = 1 } = {}) {
  if (![1, 2].includes(connections)) throw new Error('HTTP/2 admite una o dos conexiones para esta comparación.')
  const clients = Array.from({length: connections}, () => createSingleSessionFetch(baseUrl))
  let next = 0
  return {
    fetch: (input, options) => clients[next++ % clients.length].fetch(input, options),
    close: () => Promise.all(clients.map((client) => client.close())),
  }
}
