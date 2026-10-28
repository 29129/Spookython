import { mkdir, writeFile } from 'node:fs/promises'
import { createHttp2Fetch } from './http2-fetch.mjs'

const endpoints = ['https://gkzb014d54.execute-api.us-east-1.amazonaws.com', 'https://d2qqi0nkfeyck5.cloudfront.net/api']
const results = []
for (const endpoint of endpoints) {
  const client = createHttp2Fetch(endpoint, { connections: 2 })
  const samples = []
  try {
    for (let index = 0; index < 25; index++) {
      const started = performance.now()
      try {
        const response = await client.fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(10000) })
        const data = await response.json()
        samples.push({ httpMs: performance.now() - started, status: response.status, valid: data.status === 'ok',
          handlerMs: Number(response.headers.get('x-app-duration-ms')), firstInvocation: response.headers.get('x-first-invocation') })
      } catch (error) { samples.push({ error: error.name, httpMs: performance.now() - started }) }
    }
  } finally { await client.close() }
  const times = samples.map((sample) => sample.httpMs).sort((a, b) => a - b)
  results.push({ endpoint, p95HealthHttpMs: Number(times[Math.ceil(times.length * .95) - 1].toFixed(2)), samples })
}
const report = { generatedAt: new Date().toISOString(), source: 'HTTP/2 desde este equipo, 25 peticiones secuenciales por endpoint, sin clave ni mutaciones.',
  limitation: 'GET /health no lee DynamoDB ni demuestra latencia de POST /paso con 200 personas. Incluye primeros accesos y fallos.', results }
await mkdir('reports/http', { recursive: true })
await writeFile('reports/http/network-probe-latest.json', JSON.stringify(report, null, 2))
console.table(results.map(({ endpoint, p95HealthHttpMs }) => ({ endpoint, p95HealthHttpMs })))
if (results.some((result) => result.samples.some((sample) => !sample.valid || sample.status !== 200))) process.exitCode = 1
