import test from 'node:test'
import assert from 'node:assert/strict'
import { summarizeTrial } from '../scripts/summarize-managed-trial.mjs'
const report = (type, ms = 120) => ({ generatedAt: '2026-10-28T20:00:00Z', secret: 'must-not-leak', rounds: [{
  calls: 1800, p95HttpMs: ms, p95HandlerMsReceived: 7, errors: 0, timeouts: 0, invalidMoves: 0,
  observedInitializationTypes: [type], observedQualifiers: ['prepared'], failure: null,
  survivors: [{ private: 'not-public' }], latencyBandScore: ms <= 150 ? 10 : 7, availabilityBandScore: 10,
}] })
test('public summary whitelists metrics, verifies prepared environment and preserves measured latency', () => {
  const summary = summarizeTrial({ baseline: report('on-demand', 250), prepared: report('provisioned-concurrency'), cleanupSucceeded: true })
  assert.equal(summary.p95HttpMs, 120)
  assert.equal(summary.meets150Ms, true)
  assert.equal(summary.preparedVerified, true)
  assert(!JSON.stringify(summary).includes('must-not-leak'))
  assert(!JSON.stringify(summary).includes('not-public'))
})
test('failed preparation retains baseline and never claims prepared success', () => {
  const summary = summarizeTrial({ baseline: report('on-demand', 280), prepared: null, cleanupSucceeded: true })
  assert.equal(summary.p95HttpMs, 280)
  assert.equal(summary.selectedMeasurement, 'baseline')
  assert.equal(summary.meets150Ms, false)
  assert.equal(summary.preparedVerified, false)
})
test('timeouts or missing measurements cannot pass the 150 ms goal', () => {
  const after = report('provisioned-concurrency', 100)
  after.rounds[0].timeouts = 1
  assert.equal(summarizeTrial({ prepared: after }).meets150Ms, false)
  assert.equal(summarizeTrial({}).p95HttpMs, null)
  assert.equal(summarizeTrial({}).meets150Ms, false)
})
