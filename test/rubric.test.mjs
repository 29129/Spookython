import test from 'node:test'
import assert from 'node:assert/strict'
import { latencyScore, availabilityScore, rubricSummary } from '../scripts/rubric.mjs'
test('las bandas del jurado respetan los bordes inclusivos de latencia y estrictos de disponibilidad', () => {
  assert.deepEqual([150, 150.01, 300, 300.01, 500, 500.01, null].map(latencyScore), [10, 7, 7, 4, 4, 0, null])
  assert.deepEqual([0, 4, 5, 19, 20, 49, 50].map((errors) => availabilityScore(errors, 0, 1000)), [10, 10, 6, 6, 3, 3, 0])
  assert.equal(availabilityScore(0, 0, 0), null)
  const rounds = [1, 2, 3].map((round) => ({round, survivalPercent: round === 1 ? 100 : 50, p95HttpMs: 150, errors: 0, timeouts: 0, calls: 100, completed: true, actualDurationSeconds: 300}))
  const config = {fast: false, concurrency: Infinity, runnerContactBites: false}
  const result = rubricSummary(rounds, config)
  assert.equal(result.weightedSurvivalPercent, 350 / 6)
  assert.equal(result.finalScore, null)
  assert.equal(result.fullProtocol, true)
  assert.equal(rubricSummary(rounds, {...config, runnerContactBites: true}).fullProtocol, false)
  assert.equal(rubricSummary(rounds, {...config, fast: true}).fullProtocol, false)
})
