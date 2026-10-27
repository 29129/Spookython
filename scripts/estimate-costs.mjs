import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

// Planning assumptions, not account billing data. Rates checked against official AWS pages.
const suitesPerMonth = 2 // one base suite and one Pro suite
const turns = 150
const stepRequests = [20, 80, 200].reduce((sum, count) => sum + count * turns, 0) * suitesPerMonth
const phaseRequests = 3 * turns * 2 * suitesPerMonth
const resets = 3 * suitesPerMonth
const requests = stepRequests + phaseRequests + resets
const snapshotBytes = 100 * 1024
const readUnits = requests * Math.ceil(snapshotBytes / 4096)
const writeUnits = (phaseRequests + resets) * Math.ceil(snapshotBytes / 1024)
const api = requests / 1e6 * 1
const lambda = requests * .2 * .5 * .0000133334 + requests / 1e6 * .2
const dynamodb = readUnits / 1e6 * .125 + writeUnits / 1e6 * .625
const report = { dateOfRateCheck: '2026-10-26', region: 'us-east-1', suitesPerMonth, turns,
  stepRequests, phaseRequests, resets, requests, snapshotBytesAssumed: snapshotBytes,
  lambdaDurationSecondsAssumed: .2, lambdaMemoryGb: .5, readUnits, writeUnits,
  prices: { httpApiPerMillion: 1, lambdaArmGbSecond: .0000133334, lambdaPerMillion: .2,
    dynamodbReadPerMillion: .125, dynamodbWritePerMillion: .625 },
  estimatedUsdBeforeFreeTier: { api, lambda, dynamodb, subtotal: api + lambda + dynamodb },
  excluded: ['S3', 'CloudFront', 'CloudWatch', 'transferencia de datos', 'despliegues', 'impuestos'],
  accountActualCost: 'No se consulta en este script. Ver la captura de Cost Explorer y sus límites de atribución.' }
const destination = new URL('../reports/audit/cost-model.json', import.meta.url)
await mkdir(new URL('../reports/audit/', import.meta.url), { recursive: true })
await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
console.log(fileURLToPath(destination))
