import test from 'node:test'
import assert from 'node:assert/strict'
import { waitUntilPrepared } from '../scripts/wait-regional-prepared.mjs'

const ready = (count) => ({ Status: 'READY', RequestedProvisionedConcurrentExecutions: count,
  AllocatedProvisionedConcurrentExecutions: count, AvailableProvisionedConcurrentExecutions: count })

test('regional runner waits for all 200 and for API routing before starting exactly once', async () => {
  const samples = [null, ready(50), ready(100), ready(150), ready(200), ready(200)]
  let reads = 0, probes = 0, runs = 0, clock = 0
  await waitUntilPrepared({ readCapacity: async () => samples[reads++], probe: async () => ++probes === 2,
    runTest: async () => { runs++ }, wait: async (ms) => { clock += ms }, now: () => clock, log: () => {} })
  assert.equal(reads, 6)
  assert.equal(runs, 1)
})
test('regional runner does not start without AWS read permissions', async () => {
  let ran = false
  await assert.rejects(waitUntilPrepared({ readCapacity: async () => { throw Error('AccessDenied') },
    runTest: async () => { ran = true }, log: () => {} }), /AccessDenied/)
  assert.equal(ran, false)
})
test('regional runner times out or fails without issuing a round reset', async () => {
  let runs = 0, clock = 0
  const options = { readCapacity: async () => ready(150), probe: async () => true,
    runTest: async () => { runs++ }, wait: async (ms) => { clock += ms }, now: () => clock, timeoutMs: 30000, log: () => {} }
  await assert.rejects(waitUntilPrepared(options), /Termino la espera/)
  await assert.rejects(waitUntilPrepared({ ...options, readCapacity: async () => ({ Status: 'FAILED' }) }), /AWS no pudo/)
  assert.equal(runs, 0)
})
