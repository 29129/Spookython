import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function summarizeTrial({ baseline, prepared, cleanupSucceeded, stage, runId, exitStatus, now }) {
  const sample = (report) => {
    if (!report?.rounds?.[0]) return null
    const round = report.rounds[0]
    return { generatedAt: report.generatedAt, calls: round.calls, p95HttpMs: round.p95HttpMs,
      p95HandlerMs: round.p95HandlerMsReceived, errors: round.errors, timeouts: round.timeouts,
      invalidMoves: round.invalidMoves, initializationTypes: round.observedInitializationTypes,
      qualifiers: round.observedQualifiers, failure: round.failure,
      latencyBandScore: round.latencyBandScore, availabilityBandScore: round.availabilityBandScore }
  }
  const before = sample(baseline), after = sample(prepared)
  const verified = after?.initializationTypes?.length === 1 && after.initializationTypes[0] === 'provisioned-concurrency'
    && after.qualifiers?.length === 1 && after.qualifiers[0] === 'prepared'
  const selected = verified ? after : before
  return { generatedAt: now, runId, stage, exitStatus, measurementLocation: 'AWS-CodeBuild-us-east-1-general1.small',
    protocol: 'Round 3, 200 survivors, 12 accelerated turns, full concurrency, HTTP/2 two connections. Partial diagnostic.',
    excludesFirstRequests: false, baseline: before, prepared: after, preparedVerified: !!verified,
    cleanupSucceeded, selectedMeasurement: verified ? 'prepared' : before ? 'baseline' : 'none',
    p95HttpMs: selected?.p95HttpMs ?? null,
    meets150Ms: !!selected && Number.isFinite(selected.p95HttpMs) && selected.p95HttpMs <= 150
      && !selected.errors && !selected.timeouts && !selected.invalidMoves && !selected.failure,
    limitation: 'Regional measurement; does not certify Ecuador latency or the full three-round competition protocol.' }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const read = (name) => { try { return JSON.parse(fs.readFileSync(`reports/http/${name}.json`, 'utf8')) } catch { return null } }
  const summary = summarizeTrial({ baseline: read('baseline'), prepared: read('prepared'),
    cleanupSucceeded: process.env.TRIAL_CLEANUP_OK === 'true', stage: process.env.TRIAL_STAGE,
    runId: process.env.TRIAL_RUN_ID, exitStatus: Number(process.env.TRIAL_EXIT_STATUS), now: new Date().toISOString() })
  fs.writeFileSync('reports/http/summary.json', JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary, null, 2))
}
