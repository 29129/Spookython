import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'

const require = createRequire(import.meta.url)
const map = require('../src/data/manta.graph.json')
const { advanceWorld, createInitialState } = require('../src/simulation/engine.js')
const { findBestRoute } = require('../src/routing/planner.js')

const MAX_TURNS = 150
const COHORTS = [20, 80, 200]
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function nearestRank(values, percentile) {
  if (!values.length) return null
  const ordered = [...values].sort((left, right) => left - right)
  return Number(ordered[Math.max(0, Math.ceil(percentile * ordered.length) - 1)].toFixed(3))
}

function buildAdjacency() {
  const adjacency = new Map(map.nodes.map((node) => [node.id, []]))
  for (const street of map.streets) {
    adjacency.get(street.fromNode).push(street.toNode)
    adjacency.get(street.toNode).push(street.fromNode)
  }
  return adjacency
}

const adjacency = buildAdjacency()

function shortestStepsToShelter(startNodeId) {
  const refugeNodes = new Set(map.refuges.map((refuge) => refuge.nodeId))
  const queue = [[startNodeId, 0]]
  const visited = new Set([startNodeId])
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const [nodeId, distance] = queue[cursor]
    if (refugeNodes.has(nodeId)) return distance
    for (const nextNodeId of adjacency.get(nodeId) || []) {
      if (visited.has(nextNodeId)) continue
      visited.add(nextNodeId)
      queue.push([nextNodeId, distance + 1])
    }
  }
  return null
}

function validateScenario(name, passed, details = {}) {
  return { name, status: passed ? 'PASSED' : 'FAILED', ...details }
}

function runCityEventScenario(type) {
  const streetType = type === 'BRIDGE_COLLAPSE' ? 'PUENTE' : 'AVENIDA'
  const street = map.streets.find((candidate) => candidate.type === streetType)
  if (!street) throw new Error(`El mapa no tiene una calle de tipo ${streetType}.`)
  const state = createInitialState(map, `scenario-${type}`, 1)
  const result = advanceWorld(state, map, { type, streetId: street.id })
  return validateScenario(type, result.blockedStreetIds.includes(street.id), { streetId: street.id })
}

function runSleeperScenario() {
  const state = createInitialState(map, 'scenario-sleeper', 1)
  const sleeper = state.zombies.find((zombie) => zombie.type === 'SLEEPER')
  state.zombies = [sleeper]
  const neighbor = adjacency.get(sleeper.nodeId)?.[0]
  if (!neighbor) throw new Error('El zombi dormido no tiene una intersección vecina para el escenario.')
  state.survivors[0].nodeId = neighbor
  state.survivors[0].routeNodeIds = []
  const result = advanceWorld(state, map, { type: 'NONE' })
  const awakened = result.zombies.find((zombie) => zombie.id === sleeper.id)
  return validateScenario(
    'SLEEPER_WAKEUP',
    awakened?.type === 'WALKER' && awakened.asleep !== true,
    { survivorStartNode: neighbor, zombieNode: sleeper.nodeId },
  )
}

function stableHash(value) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function runCrossingScenario() {
  const state = createInitialState(map, 'scenario-crossing', 1)
  const survivor = state.survivors[0]
  const refugeNodes = new Set(map.refuges.map((refuge) => refuge.nodeId))
  let crossing = null

  for (const street of map.streets) {
    const fromNode = street.fromNode
    const toNode = street.toNode
    if (refugeNodes.has(toNode)) continue
    const route = findBestRoute(fromNode, map, [], new Set([toNode]))
    if (!route) continue
    const options = adjacency.get(fromNode) || []
    const targetIndex = options.indexOf(toNode)
    if (targetIndex < 0) continue
    let zombieId
    for (let suffix = 0; suffix < 1000; suffix += 1) {
      const candidate = `Z-CROSSING-${suffix}`
      if (stableHash(`${candidate}:2:0`) % options.length === targetIndex) {
        zombieId = candidate
        break
      }
    }
    if (zombieId) {
      crossing = { fromNode, toNode, street, route, zombieId }
      break
    }
  }

  if (!crossing) throw new Error('No se encontró una calle apta para el escenario de cruce opuesto.')
  state.turn = 1
  state.zombies = [{ id: crossing.zombieId, type: 'WALKER', nodeId: crossing.fromNode }]
  survivor.nodeId = crossing.toNode
  survivor.refugeId = crossing.route.refugeId
  survivor.routeNodeIds = [crossing.toNode, ...crossing.route.routeNodeIds]
  const result = advanceWorld(state, map, { type: 'NONE' })
  const resolved = result.survivors.find((candidate) => candidate.id === survivor.id)
  return validateScenario(
    'OPPOSITE_CROSSING',
    resolved?.status === 'BITTEN',
    { streetId: crossing.street.id, survivorStatus: resolved?.status },
  )
}

function runRound(survivorCount) {
  let state = createInitialState(map, `fire-drill-${survivorCount}`, survivorCount)
  const survivorsAtStart = new Map(state.survivors.map((survivor) => [survivor.id, survivor.nodeId]))
  const baselineSteps = new Map(
    state.survivors.map((survivor) => [survivor.id, shortestStepsToShelter(survivor.nodeId)]),
  )
  const movementSteps = new Map(state.survivors.map((survivor) => [survivor.id, 0]))
  const routeLatenciesMs = []
  let routeRecalculations = 0
  let invalidMoves = 0
  let engineErrors = 0
  const startedAt = performance.now()

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    if (!state.survivors.some((survivor) => survivor.status === 'ACTIVE')) break
    const previousNodes = new Map(state.survivors.map((survivor) => [survivor.id, survivor.nodeId]))
    try {
      state = advanceWorld(state, map, undefined, {
        onRouteDecision: ({ durationMs, cacheHit }) => {
          routeLatenciesMs.push(durationMs)
          if (!cacheHit) routeRecalculations += 1
        },
      })
    } catch (error) {
      engineErrors += 1
      break
    }

    const blocked = new Set(state.blockedStreetIds)
    for (const survivor of state.survivors) {
      const previousNode = previousNodes.get(survivor.id)
      if (survivor.nodeId === previousNode) continue
      movementSteps.set(survivor.id, movementSteps.get(survivor.id) + 1)
      const validEdge = map.streets.some((street) =>
        !blocked.has(street.id)
        && ((street.fromNode === previousNode && street.toNode === survivor.nodeId)
          || (street.toNode === previousNode && street.fromNode === survivor.nodeId)),
      )
      if (!validEdge) invalidMoves += 1
    }
  }

  const elapsedMs = performance.now() - startedAt
  const rescued = state.survivors.filter((survivor) => survivor.status === 'RESCUED').length
  const bitten = state.survivors.filter((survivor) => survivor.status === 'BITTEN').length
  const active = state.survivors.filter((survivor) => survivor.status === 'ACTIVE').length
  const efficiencies = state.survivors
    .filter((survivor) => survivor.status === 'RESCUED')
    .map((survivor) => {
      const shortest = baselineSteps.get(survivor.id)
      const moved = movementSteps.get(survivor.id)
      return shortest !== null && moved > 0 ? (shortest / moved) * 100 : null
    })
    .filter((value) => value !== null)

  const routeDecisionP95Ms = nearestRank(routeLatenciesMs, 0.95)
  const routeDecisionsOver500Ms = routeLatenciesMs.filter((latency) => latency > 500).length
  return {
    survivorCount,
    turns: state.turn,
    durationSecondsAtGameSpeed: state.turn * 2,
    completed: active === 0,
    rescued,
    bitten,
    activeAtEnd: active,
    survivalRatePercent: Number((((rescued + active) / survivorCount) * 100).toFixed(2)),
    meanRouteEfficiencyPercent: efficiencies.length
      ? Number((efficiencies.reduce((sum, value) => sum + value, 0) / efficiencies.length).toFixed(2))
      : null,
    rescuedWithEfficiencyBaseline: efficiencies.length,
    routeDecisionCalls: routeLatenciesMs.length,
    routeRecalculations,
    routeDecisionLatencyMs: {
      p95: routeDecisionP95Ms,
      max: routeLatenciesMs.length ? Number(Math.max(...routeLatenciesMs).toFixed(3)) : null,
    },
    routeDecisionsOver500Ms,
    invalidMoves,
    engineErrors,
    timedOut: active > 0 && state.turn >= MAX_TURNS,
    passed: active === 0 && engineErrors === 0 && invalidMoves === 0
      && routeDecisionP95Ms !== null && routeDecisionP95Ms <= 500,
    localExecutionMs: Number(elapsedMs.toFixed(2)),
    baselineSurvivors: survivorsAtStart.size,
  }
}

async function main() {
  const scenarios = [
    runCityEventScenario('BRIDGE_COLLAPSE'),
    runCityEventScenario('AVENUE_BLOCK'),
    runSleeperScenario(),
    runCrossingScenario(),
  ]
  const rounds = COHORTS.map(runRound)
  const report = {
    generatedAt: new Date().toISOString(),
    map: map.metadata.name,
    mapVersion: map.metadata.sourceTimestamp,
    source: 'Simulación local determinista; latencia del planificador sin latencia de red AWS.',
    maxTurnsPerRound: MAX_TURNS,
    scenarios,
    rounds,
  }

  const reportsDirectory = path.join(root, 'reports', 'sprint-5')
  await mkdir(reportsDirectory, { recursive: true })
  const reportPath = path.join(reportsDirectory, 'fire-drill-latest.json')
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ ...report, reportPath: path.relative(root, reportPath) }, null, 2))

  const failed = scenarios.some((scenario) => scenario.status !== 'PASSED')
    || rounds.some((round) => !round.passed)
  if (failed) process.exitCode = 1
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
