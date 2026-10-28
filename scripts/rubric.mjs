// Only the bands explicitly printed in the supplied Track A rubric.
export function latencyScore(p95Ms) {
  if (!Number.isFinite(p95Ms) || p95Ms < 0) return null
  return p95Ms <= 150 ? 10 : p95Ms <= 300 ? 7 : p95Ms <= 500 ? 4 : 0
}
export function availabilityScore(errors, timeouts, calls) {
  if (!Number.isInteger(calls) || calls <= 0) return null
  const rate = 100 * (errors + timeouts) / calls
  return rate < .5 ? 10 : rate < 2 ? 6 : rate < 5 ? 3 : 0
}
export function rubricSummary(rounds, { fast, concurrency, runnerContactBites }) {
  const complete = rounds.length === 3 && [1, 2, 3].every((id) => rounds.some((round) => round.round === id))
  const weightedSurvivalPercent = complete ? rounds.reduce((sum, round) => sum + round.survivalPercent * round.round, 0) / 6 : null
  return {
    weightedSurvivalPercent,
    fullProtocol: complete && !fast && concurrency === Infinity && !runnerContactBites
      && rounds.every((round) => !round.failure && round.completed && round.actualDurationSeconds >= 300),
    allLatencyBands10: rounds.every((round) => latencyScore(round.p95HttpMs) === 10),
    allAvailabilityBands10: rounds.every((round) => availabilityScore(round.errors, round.timeouts, round.calls) === 10),
    finalScore: null,
    note: 'No se inventa una nota final: la captura no detalla la conversión de supervivencia y eficiencia a notas ni cómo agregar latencia entre rondas. Los umbrales se muestran por ronda. Tener protocolo completo no garantiza 10 ni aprueba la cadencia.',
  }
}
