import { spawn } from 'node:child_process'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
if (!process.env.SIMULATOR_API_KEY) throw new Error('Configura SIMULATOR_API_KEY en esta terminal; no la pegues en el chat.')
const direct = 'https://gkzb014d54.execute-api.us-east-1.amazonaws.com'
const edge = 'https://d2qqi0nkfeyck5.cloudfront.net/api'
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const directory = path.join(root, 'reports/http', `comparison-${stamp}`)
await mkdir(directory, { recursive: true })
const results = []
// A-B-B-A reduces ordering bias. Each sample resets the same deterministic round.
// This is a diagnostic, not the full 3-round competition protocol.
for (const [index, endpoint] of [direct, edge, edge, direct].entries()) {
  const sampleStarted = Date.now()
  console.log(`Comparison ${index + 1}/4: ${endpoint === direct ? 'direct' : 'CloudFront'}; reinicia ronda 3.`)
  const args = ['scripts/run-http-fire-drill.mjs', '--round=3', '--fast', '--max-turns=12', '--http2', '--http2-connections=2']
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, SPOOKYTHON_API_BASE_URL: endpoint }, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', resolve)
  })
  const source = path.join(root, 'reports/http/fire-drill-base-turns-12-http2-2connections-latest.json')
  const report = JSON.parse(await readFile(source, 'utf8'))
  if (report.baseUrl !== endpoint || !Number.isFinite(Date.parse(report.generatedAt)) || Date.parse(report.generatedAt) < sampleStarted) {
    throw new Error('El reporte no corresponde a esta ejecucion; no se reutiliza evidencia anterior.')
  }
  const round = report.rounds[0]
  await writeFile(path.join(directory, `${index + 1}-${endpoint === direct ? 'direct' : 'edge'}.json`), JSON.stringify(report, null, 2))
  results.push({ endpoint, diagnosticExitCode: code, generatedAt: report.generatedAt, calls: round.calls,
    p95HttpMs: round.p95HttpMs, p95HandlerMs: round.p95HandlerMsReceived,
    errors: round.errors, timeouts: round.timeouts, invalidMoves: round.invalidMoves,
    initializationTypes: round.observedInitializationTypes, failure: round.failure,
    meets150Ms: round.p95HttpMs !== null && round.p95HttpMs <= 150 && !round.failure && !round.errors && !round.timeouts && !round.invalidMoves })
}
const summary = { generatedAt: new Date().toISOString(), measurementLocation: process.env.MEASUREMENT_LOCATION || 'client-unspecified',
  protocol: 'A-B-B-A; round 3, 200 survivors, 12 turns, full concurrency, HTTP/2 two connections; partial diagnostic',
  excludesColdStarts: false, results, allEdgeSamplesMeet150Ms: results.filter((sample) => sample.endpoint === edge).every((sample) => sample.meets150Ms) }
await writeFile(path.join(directory, 'summary.json'), JSON.stringify(summary, null, 2))
console.table(results.map(({ endpoint, p95HttpMs, p95HandlerMs, errors, timeouts, meets150Ms }) => ({ endpoint, p95HttpMs, p95HandlerMs, errors, timeouts, meets150Ms })))
console.log(`Reporte: ${path.join(directory, 'summary.json')}`)
if (!summary.allEdgeSamplesMeet150Ms) process.exitCode = 1
