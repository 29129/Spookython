const STEP_GROUPS = 16
function stepKey(survivorId) {
  let hash = 0
  for (const char of survivorId) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0
  return { worldId: `manta-demo#steps#${hash % STEP_GROUPS}`, entityId: 'CURRENT' }
}
function stepRecords(state) {
  const records = Array.from({ length: STEP_GROUPS }, (_, index) => ({
    worldId: `manta-demo#steps#${index}`, entityId: 'CURRENT',
    turn: state.turn, sessionId: state.sessionId, revision: state.revision,
    phase: state.phase, schemaVersion: state.schemaVersion,
    blockedStreetIds: state.blockedStreetIds || [], dangerNodeIds: state.dangerNodeIds || [], stepDecisions: {},
  }))
  for (const survivor of state.survivors) {
    const group = Number(stepKey(survivor.id).worldId.split('#').at(-1))
    records[group].stepDecisions[survivor.id] = [survivor.nodeId, survivor.status, survivor.routeNodeIds?.[1] || survivor.nodeId]
  }
  return records
}
module.exports = { stepKey, stepRecords, STEP_GROUPS }
