import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const baseUrl = 'https://gkzb014d54.execute-api.us-east-1.amazonaws.com'

export async function waitUntilPrepared({ readCapacity, probe, runTest, wait, now = Date.now, log = console.log, timeoutMs = 3600000 }) {
  const started = now()
  // This first read checks AWS permissions before anyone activates paid capacity.
  let capacity = await readCapacity()
  log('WAITING_FOR_PREPARED_200: permisos comprobados; esperando 200 entornos. No activa capacidad.')
  while (now() - started < timeoutMs) {
    if (capacity?.Status === 'FAILED') throw new Error('AWS no pudo preparar la capacidad. No se ejecuta el ensayo.')
    if (capacity?.Status === 'READY' && capacity.RequestedProvisionedConcurrentExecutions >= 200
      && capacity.AllocatedProvisionedConcurrentExecutions >= 200 && capacity.AvailableProvisionedConcurrentExecutions >= 200) {
      const ready = await probe()
      if (ready) {
        log('PREPARED_200_CONFIRMED: iniciando ensayo automaticamente.')
        return runTest()
      }
    }
    await wait(15000)
    capacity = await readCapacity()
  }
  throw new Error('Termino la espera de 60 minutos; no se ejecuto ninguna prueba sin capacidad preparada.')
}

async function readCapacity() {
  try {
    const { stdout } = await promisify(execFile)('aws', ['lambda', 'get-provisioned-concurrency-config',
      '--function-name', 'spookython-api-handler', '--qualifier', 'prepared', '--region', 'us-east-1', '--output', 'json', '--no-cli-pager'],
    { timeout: 20000, env: { ...process.env, AWS_PAGER: '', AWS_CLI_AUTO_PROMPT: 'off' } })
    return JSON.parse(stdout)
  } catch (error) {
    const detail = String(error.stderr || '')
    if (detail.includes('ResourceNotFoundException') || detail.includes('ProvisionedConcurrencyConfigNotFoundException')) return null
    if (detail.includes('AccessDenied')) throw new Error('Falta el permiso lambda:GetProvisionedConcurrencyConfig en CloudShell. No activar capacidad.')
    throw new Error('No se pudo consultar la capacidad con AWS CLI. Comprueba la sesion y los permisos; no activar capacidad.')
  }
}

async function main() {
  if (!process.env.SIMULATOR_API_KEY) throw new Error('Falta SIMULATOR_API_KEY. Carga la clave en CloudShell, sin pegarla en el chat.')
  if (process.env.AWS_REGION && process.env.AWS_REGION !== 'us-east-1') throw new Error('Selecciona us-east-1 en CloudShell antes del ensayo.')
  // An authenticated invalid input returns 400 without changing the world.
  const auth = await fetch(`${baseUrl}/paso`, { method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.SIMULATOR_API_KEY }, body: '{}' })
  await auth.arrayBuffer()
  if (auth.status !== 400) throw new Error(`La comprobacion de clave no fue valida (HTTP ${auth.status}). No activar capacidad.`)
  console.log('Clave y acceso HTTP comprobados. Script localizado en el repositorio correcto.')
  await waitUntilPrepared({ readCapacity,
    probe: async () => {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(15000) })
      await response.arrayBuffer()
      return response.ok && response.headers.get('x-lambda-qualifier') === 'prepared'
        && response.headers.get('x-lambda-init-type') === 'provisioned-concurrency'
    },
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    runTest: async () => {
      const started = Date.now()
      await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['scripts/run-http-fire-drill.mjs', '--round=3', '--fast', '--max-turns=12', '--http2', '--http2-connections=2'],
          { cwd: root, stdio: 'inherit', env: { ...process.env, SPOOKYTHON_API_BASE_URL: baseUrl, MEASUREMENT_LOCATION: 'AWS-CloudShell-us-east-1-prepared' } })
        child.once('error', reject)
        child.once('exit', resolve)
      })
      const file = path.join(root, 'reports/http/fire-drill-base-turns-12-http2-2connections-latest.json')
      const report = JSON.parse(await readFile(file, 'utf8'))
      if (!Number.isFinite(Date.parse(report.generatedAt)) || Date.parse(report.generatedAt) < started || report.baseUrl !== baseUrl) {
        throw new Error('No se produjo un reporte nuevo valido; no se presenta evidencia antigua.')
      }
      report.measurementLocation = 'AWS-CloudShell-us-east-1-prepared'
      const result = report.rounds[0]
      report.preparedVerified = result.observedInitializationTypes?.length === 1 && result.observedInitializationTypes[0] === 'provisioned-concurrency'
        && result.observedQualifiers?.length === 1 && result.observedQualifiers[0] === 'prepared'
      const destination = path.join(root, `reports/http/regional-prepared-${report.generatedAt.replace(/[:.]/g, '-')}.json`)
      await writeFile(destination, JSON.stringify(report, null, 2))
      console.table([{ p95Ms: result.p95HttpMs, errores: result.errors, timeouts: result.timeouts,
        preparadaVerificada: report.preparedVerified, cumple150ms: report.preparedVerified && result.p95HttpMs !== null && result.p95HttpMs <= 150 && !result.errors && !result.timeouts }])
      console.log(`REPORTE_REGIONAL: ${destination}`)
      if (!report.preparedVerified) process.exitCode = 1
    },
  })
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1 })
}
