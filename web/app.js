import { advanceHttpTurn } from './simulator-client.mjs'
import { createMapProjection } from './map-projection.mjs'
import { avatarSprite, hydrateAvatarLegends } from './map-avatars.mjs'

hydrateAvatarLegends()

const API_BASE_URL = 'https://gkzb014d54.execute-api.us-east-1.amazonaws.com'
const REFRESH_INTERVAL_MS = 2000
const SVG_NS = 'http://www.w3.org/2000/svg'

const elements = {
  connection: document.querySelector('#connection'),
  connectionText: document.querySelector('#connectionText'),
  turnNumber: document.querySelector('#turnNumber'),
  activeCount: document.querySelector('#activeCount'),
  rescuedCount: document.querySelector('#rescuedCount'),
  bittenCount: document.querySelector('#bittenCount'),
  zombieCount: document.querySelector('#zombieCount'),
  blockedCount: document.querySelector('#blockedCount'),
  lastEvent: document.querySelector('#lastEvent'),
  mapUpdated: document.querySelector('#mapUpdated'),
  mapMessage: document.querySelector('#mapMessage'),
  streetLayer: document.querySelector('#streetLayer'),
  routeLayer: document.querySelector('#routeLayer'),
  refugeLayer: document.querySelector('#refugeLayer'),
  entityLayer: document.querySelector('#entityLayer'),
  sourceStamp: document.querySelector('#sourceStamp'),
  nodeCount: document.querySelector('#nodeCount'),
  refugeCount: document.querySelector('#refugeCount'),
  apiKey: document.querySelector('#apiKey'),
  startButton: document.querySelector('#startButton'),
  stepButton: document.querySelector('#stepButton'),
  stopButton: document.querySelector('#stopButton'),
  simulationTitle: document.querySelector('#simulationTitle'),
  simulationHelp: document.querySelector('#simulationHelp'),
  simulationState: document.querySelector('#simulationState'),
  errorBox: document.querySelector('#errorBox'),
  eventTitle: document.querySelector('#eventTitle'),
  eventDescription: document.querySelector('#eventDescription'),
  roundSelect: document.querySelector('#roundSelect'),
  proMode: document.querySelector('#proMode'),
  runnerContactBites: document.querySelector('#runnerContactBites'),
  concurrencySelect: document.querySelector('#concurrencySelect'),
  refugeCapacity: document.querySelector('#refugeCapacity'),
  resetButton: document.querySelector('#resetButton'),
  proPanel: document.querySelector('#proPanel'),
  refugeStatus: document.querySelector('#refugeStatus'),
  vehicleStatus: document.querySelector('#vehicleStatus'),
  httpMetrics: document.querySelector('#httpMetrics'),
  roundBadge: document.querySelector('#roundBadge'),
  rescuePercent: document.querySelector('#rescuePercent'),
  rescueProgress: document.querySelector('#rescueProgress'),
  rescueCaption: document.querySelector('#rescueCaption'),
}

let mapData = null
let worldState = null
let isRunning = false
let runSequence = 0
let refreshInFlight = false
let turnInFlight = false
let observedSlowTurns = 0
let lastHttpTurnMs = 0

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name)
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value))
  return element
}

function setConnection(state, message) {
  elements.connection.dataset.state = state
  elements.connectionText.textContent = message
}

function showError(message) {
  elements.errorBox.textContent = message
  elements.errorBox.hidden = false
}

function clearError() {
  elements.errorBox.textContent = ''
  elements.errorBox.hidden = true
}

async function fetchJson(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, options)
  let body
  try {
    body = await response.json()
  } catch {
    throw new Error(`La API respondió con HTTP ${response.status}.`)
  }
  if (!response.ok) throw new Error(body.message || `La API respondió con HTTP ${response.status}.`)
  return body
}

function makeProjection(map) {
  const svg = elements.streetLayer.ownerSVGElement
  const width = Math.max(1, svg.clientWidth)
  const height = Math.max(1, svg.clientHeight)
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
  return createMapProjection(map, width, height)
}

function typeClass(type) {
  if (type === 'AVENIDA') return 'avenue'
  if (type === 'PUENTE') return 'bridge'
  if (type === 'CALLEJON') return 'alley'
  return 'street'
}

function drawStreets(project, blockedStreetIds) {
  elements.streetLayer.replaceChildren()
  const blocked = new Set(blockedStreetIds)
  for (const street of mapData.streets) {
    const coordinates = street.geometry.map((coordinate) => {
      const point = project(coordinate)
      return `${point.x.toFixed(1)},${point.y.toFixed(1)}`
    })
    if (blocked.has(street.id)) {
      const center = project(street.geometry[Math.floor(street.geometry.length / 2)])
      const marker = svgElement('g', { transform: `translate(${center.x} ${center.y})` })
      marker.append(avatarSprite('blocked', 18, { centered: true }))
      const title = svgElement('title')
      title.textContent = `${street.name || street.type} cerrada: arista retirada de la red transitable`
      marker.append(title)
      elements.streetLayer.append(marker)
      continue
    }
    const path = svgElement('polyline', {
      class: `street ${typeClass(street.type)}${blocked.has(street.id) ? ' blocked' : ''}`,
      points: coordinates.join(' '),
    })
    const title = svgElement('title')
    title.textContent = `${street.name || street.type} · ${Math.round(street.distanceM)} m${blocked.has(street.id) ? ' · bloqueada' : ''}`
    path.append(title)
    elements.streetLayer.append(path)
  }
}

function drawRoutes(project, state, blockedStreetIds) {
  elements.routeLayer.replaceChildren()
  const blocked = new Set(blockedStreetIds)
  const streetByPair = new Map()
  for (const street of mapData.streets) {
    const key = [street.fromNode, street.toNode].sort().join('|')
    if (!streetByPair.has(key) || blocked.has(streetByPair.get(key).id)) streetByPair.set(key, street)
  }

  const active = [...state.survivors.filter((survivor) => survivor.status === 'ACTIVE' && survivor.routeNodeIds?.length > 1),
    ...(state.vehicles || []).filter((vehicle) => vehicle.routeNodeIds?.length > 1).map((vehicle) => ({ ...vehicle, rescueVehicle: true }))]
  for (const survivor of active) {
    const points = []
    for (let index = 0; index < survivor.routeNodeIds.length - 1; index += 1) {
      const fromId = survivor.routeNodeIds[index]
      const toId = survivor.routeNodeIds[index + 1]
      const pair = [fromId, toId].sort().join('|')
      const street = streetByPair.get(pair)
      const from = mapData.nodesById.get(fromId)
      const to = mapData.nodesById.get(toId)
      if (!street || blocked.has(street.id) || !from || !to) continue
      const start = project([from.lng, from.lat])
      const end = project([to.lng, to.lat])
      points.push(`${index === 0 ? 'M' : 'L'}${start.x.toFixed(1)},${start.y.toFixed(1)} L${end.x.toFixed(1)},${end.y.toFixed(1)}`)
    }
    if (points.length) {
      const route = svgElement('path', { class: survivor.rescueVehicle ? 'route-line vehicle-route' : 'route-line', d: points.join(' ') })
      const title = svgElement('title')
      title.textContent = `Ruta ${survivor.rescueVehicle ? 'de rescate' : 'planificada'} · ${survivor.id}`
      route.append(title)
      elements.routeLayer.append(route)
    }
  }
}

function drawRefuges(project, state) {
  elements.refugeLayer.replaceChildren()
  for (const [index, refuge] of mapData.refuges.entries()) {
    const point = project([refuge.lng, refuge.lat])
    const marker = svgElement('g', { transform: `translate(${point.x} ${point.y})` })
    marker.append(svgElement('circle', { class: 'refuge-ring', r: 11 }))
    marker.append(avatarSprite('refuge', 28))
    const label = svgElement('text', { class: 'refuge-label', x: 0, y: 17 })
    label.textContent = `R${index + 1}`
    marker.append(label)
    const title = svgElement('title')
    const occupancy = state?.refuges?.find((item) => item.id === refuge.id)
    title.textContent = `${refuge.name}${state?.pro ? ` · ${occupancy?.occupied || 0}/${occupancy?.capacity} ocupados, ${occupancy?.reserved || 0} reservados` : ' · refugio de demostración'}`
    marker.append(title)
    elements.refugeLayer.append(marker)
  }
}

function drawEntities(project, state) {
  elements.entityLayer.replaceChildren()
  for (const survivor of state.survivors) {
    if (survivor.status === 'ONBOARD') continue
    const node = mapData.nodesById.get(survivor.nodeId)
    if (!node) continue
    const point = project([node.lng, node.lat])
    const marker = svgElement('g', { transform: `translate(${point.x} ${point.y})` })
    const statusClass = survivor.status === 'BITTEN' ? 'survivor-bitten' : survivor.status === 'RESCUED' ? 'survivor-rescued' : 'survivor-mark'
    if (survivor.status === 'ACTIVE') marker.append(svgElement('circle', { class: 'entity-halo', r: 7.5 }))
    marker.append(svgElement('circle', { class: statusClass, r: survivor.status === 'ACTIVE' ? 3.3 : 3.8 }))
    if (survivor.status === 'ACTIVE') marker.append(avatarSprite('survivor', 18))
    const title = svgElement('title')
    title.textContent = `${survivor.id} · ${survivor.status}`
    marker.append(title)
    elements.entityLayer.append(marker)
  }

  for (const vehicle of state.vehicles || []) {
    const node = mapData.nodesById.get(vehicle.nodeId)
    if (!node) continue
    const point = project([node.lng, node.lat])
    const marker = svgElement('g', { transform: `translate(${point.x} ${point.y})` })
    marker.append(avatarSprite('truck', 26))
    const label = svgElement('text', { x: 0, y: 15, class: 'vehicle-passengers' })
    label.textContent = `${vehicle.passengerIds.length}/4`
    marker.append(label)
    const title = svgElement('title')
    title.textContent = `${vehicle.id} · ${vehicle.passengerIds.length}/4 pasajeros · objetivo ${vehicle.targetSurvivorId || 'refugio'}`
    marker.append(title)
    elements.entityLayer.append(marker)
  }
  for (const nodeId of state.dangerNodeIds || []) {
    const node = mapData.nodesById.get(nodeId)
    if (!node || !state.zombies.some((zombie) => zombie.type === 'HORDE' && (zombie.nodeId === nodeId
      || mapData.streets.some((street) => (street.fromNode === zombie.nodeId && street.toNode === nodeId)
        || (street.toNode === zombie.nodeId && street.fromNode === nodeId))))) continue
    const point = project([node.lng, node.lat])
    elements.entityLayer.append(svgElement('circle', { cx: point.x, cy: point.y, r: 10, class: 'horde-zone' }))
  }
  for (const prediction of state.runnerPredictions || []) {
    for (const nodeId of prediction.nodeIds) {
      const node = mapData.nodesById.get(nodeId)
      if (!node) continue
      const point = project([node.lng, node.lat])
      const marker = svgElement('circle', { cx: point.x, cy: point.y, r: 9, class: 'runner-prediction' })
      const title = svgElement('title')
      title.textContent = `Posición prevista de ${prediction.zombieId} en el siguiente turno`
      marker.append(title)
      elements.entityLayer.append(marker)
    }
  }

  const zombieAvatars = { WALKER: 'walker', RUNNER: 'runner', HORDE: 'horde' }
  for (const zombie of state.zombies) {
    // Sleepers are invisible; after waking, the engine changes their type to WALKER.
    if (!zombieAvatars[zombie.type]) continue
    const node = mapData.nodesById.get(zombie.nodeId)
    if (!node) continue
    const point = project([node.lng, node.lat])
    const marker = svgElement('g', { transform: `translate(${point.x} ${point.y})` })
    if (zombie.type === 'HORDE') marker.append(svgElement('circle', { cx: 0, cy: 0, r: 16, fill: 'rgba(189,118,255,.08)', stroke: 'rgba(189,118,255,.38)', 'stroke-width': 1 }))
    marker.append(avatarSprite(zombieAvatars[zombie.type], zombie.type === 'HORDE' ? 28 : 22))
    const title = svgElement('title')
    title.textContent = `${zombie.id} · ${zombie.type}${zombie.type === 'HORDE' ? ' · avanza una calle cada 5 turnos' : ''}`
    marker.append(title)
    elements.entityLayer.append(marker)
  }
}

function describeEvent(event) {
  if (!event) {
    elements.eventTitle.textContent = 'Sin novedades'
    elements.eventDescription.textContent = 'Las rutas permanecen abiertas. Los incidentes aparecerán aquí cuando ocurran.'
    elements.lastEvent.textContent = 'Sin incidentes nuevos'
    return
  }
  const isBridge = event.type === 'BRIDGE_COLLAPSE'
  const label = isBridge ? 'Puente colapsado' : 'Avenida bloqueada'
  const street = mapData.streets.find((item) => item.id === event.streetId)
  elements.eventTitle.textContent = label
  elements.eventDescription.textContent = `${street?.name || street?.type || 'Una vía'} quedó fuera de servicio en el turno ${event.turn}. El bloqueo permanece activo.`
  elements.lastEvent.textContent = label
}

function render(state) {
  if (!mapData || !state) return
  if (worldState?.revision !== undefined && state.revision !== undefined && state.revision < worldState.revision) return
  worldState = state
  const project = makeProjection(mapData)
  const blockedStreetIds = state.blockedStreetIds || []
  drawStreets(project, blockedStreetIds)
  drawRoutes(project, state, blockedStreetIds)
  drawRefuges(project, state)
  drawEntities(project, state)

  elements.turnNumber.textContent = String(state.turn).padStart(2, '0')
  elements.activeCount.textContent = state.summary.activeSurvivors
  elements.rescuedCount.textContent = state.summary.rescuedSurvivors
  elements.bittenCount.textContent = state.summary.bittenSurvivors
  elements.zombieCount.textContent = state.summary.visibleZombies
  elements.blockedCount.textContent = state.summary.blockedStreets
  const total = state.survivors.length
  const rescuedPercent = total ? Math.round(100 * state.summary.rescuedSurvivors / total) : 0
  elements.rescuePercent.textContent = `${rescuedPercent}%`
  elements.rescueProgress.value = rescuedPercent
  elements.rescueCaption.textContent = `${state.summary.rescuedSurvivors} de ${total} personas llegaron a un refugio${state.roundFinished ? ' · Ronda finalizada' : ''}.`
  elements.roundBadge.textContent = `Ronda ${state.round || 1} · ${state.pro ? 'Rescate Pro' : 'Rescate base'} · ${state.runnerContactBites ? 'Mordida al pasar' : 'Reglas del reto'}`
  elements.mapUpdated.textContent = `Actualizado ${new Date(state.updatedAt).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
  elements.mapMessage.hidden = true
  elements.nodeCount.textContent = mapData.nodes.length
  elements.refugeCount.textContent = mapData.refuges.length
  elements.sourceStamp.textContent = `OpenStreetMap contributors · ${mapData.metadata.sourceTimestamp.slice(0, 10)}`
  describeEvent(state.lastEvent)
  elements.proPanel.hidden = !state.pro
  elements.refugeStatus.replaceChildren()
  for (const refuge of state.refuges || []) {
    const line = document.createElement('p')
    line.textContent = `${refuge.id}: ${refuge.occupied || 0}/${refuge.capacity ?? '∞'} ocupados · ${refuge.reserved || 0} reservas`
    elements.refugeStatus.append(line)
  }
  elements.vehicleStatus.textContent = `${state.vehicles?.length || 0} camionetas · ${state.summary.onboardSurvivors || 0} pasajeros a bordo`
  const metrics = state.metrics
  elements.httpMetrics.textContent = metrics ? `${metrics.requests} consultas · ${metrics.timeouts} fuera de tiempo · ${metrics.errors} errores · ${metrics.invalidMoves} inválidos. Último turno observado: ${Math.round(lastHttpTurnMs)} ms · ${observedSlowTurns} turnos >2 s en esta pestaña.` : 'Inicia una ronda nueva para medir las consultas HTTP.'
  setConnection('online', 'Conectado · actualización cada 2 s')
}

async function loadMap() {
  mapData = await fetchJson('/map')
  mapData.nodesById = new Map(mapData.nodes.map((node) => [node.id, node]))
  drawStreets(makeProjection(mapData), [])
  drawRefuges(makeProjection(mapData))
}

new ResizeObserver(() => {
  if (mapData && worldState) render(worldState)
}).observe(elements.streetLayer.ownerSVGElement)

async function refreshState() {
  if (refreshInFlight) return
  refreshInFlight = true
  try {
    const state = await fetchJson('/estado')
    render(state)
  } catch (error) {
    setConnection('error', 'Sin conexión con la API')
    if (!worldState) elements.mapMessage.textContent = error.message
  } finally {
    refreshInFlight = false
  }
}

function setControlState(running) {
  isRunning = running
  const busy = running || turnInFlight
  elements.startButton.disabled = busy
  elements.stepButton.disabled = busy
  elements.stopButton.disabled = !running
  elements.apiKey.disabled = busy
  elements.resetButton.disabled = busy
  elements.roundSelect.disabled = busy
  elements.proMode.disabled = busy
  elements.runnerContactBites.disabled = busy
  elements.concurrencySelect.disabled = busy
  elements.refugeCapacity.disabled = busy || !elements.proMode.checked
  elements.simulationTitle.textContent = running ? 'Simulación en curso' : 'Modo espectador'
  elements.simulationHelp.textContent = running
    ? 'Los zombis avanzan primero; luego se actualiza el estado de los sobrevivientes.'
    : 'El mapa se actualiza automáticamente. Ingresa la clave de control para iniciar o avanzar turnos.'
  elements.simulationState.classList.toggle('running', running)
  elements.simulationState.lastElementChild.textContent = running ? 'Turnos activos · 2 segundos' : 'Lectura en vivo activa'
}

async function advanceOneTurn(apiKey) {
  if (turnInFlight) throw new Error('Ya hay un turno en proceso.')
  turnInFlight = true
  elements.startButton.disabled = true
  elements.stepButton.disabled = true
  elements.resetButton.disabled = true
  try {
    const result = await advanceHttpTurn({
    baseUrl: API_BASE_URL, apiKey, currentState: worldState,
    concurrency: Number(elements.concurrencySelect.querySelector('input:checked').value) || Infinity,
    onProgress: (completed, total) => {
      elements.simulationHelp.textContent = `Turno en proceso: ${completed}/${total} respuestas de /paso. Las tardías se quedan quietas.`
    },
    })
    lastHttpTurnMs = result.durationMs
    if (lastHttpTurnMs > 2000) observedSlowTurns += 1
    render(result.state)
    return result.state
  } finally {
    turnInFlight = false
    setControlState(isRunning)
  }
}

async function startSimulation() {
  const apiKey = elements.apiKey.value.trim()
  if (!apiKey) {
    showError('Ingresa la clave de control para iniciar la simulación.')
    return
  }
  clearError()
  if (worldState?.roundFinished || worldState?.turn >= 150) {
    showError('La ronda ya terminó. Selecciona una ronda y pulsa Nueva ronda.')
    return
  }
  setControlState(true)
  const sequence = ++runSequence
  while (isRunning && sequence === runSequence) {
    const startedAt = Date.now()
    try {
      const state = await advanceOneTurn(apiKey)
      if (state.roundFinished || state.summary.activeSurvivors === 0) {
        setControlState(false)
        elements.simulationHelp.textContent = state.summary.activeSurvivors === 0
          ? 'La evacuación terminó: no quedan sobrevivientes activos.'
          : `Límite de 150 turnos alcanzado: quedan ${state.summary.activeSurvivors} personas sin evacuar.`
        break
      }
    } catch (error) {
      showError(error.message)
      setConnection('error', 'No se pudo avanzar el turno')
      setControlState(false)
      break
    }
    const remaining = Math.max(0, REFRESH_INTERVAL_MS - (Date.now() - startedAt))
    await new Promise((resolve) => setTimeout(resolve, remaining))
  }
}

elements.startButton.addEventListener('click', startSimulation)
elements.stopButton.addEventListener('click', () => {
  runSequence += 1
  setControlState(false)
})
elements.stepButton.addEventListener('click', async () => {
  const apiKey = elements.apiKey.value.trim()
  if (!apiKey) {
    showError('Ingresa la clave de control para avanzar un turno.')
    return
  }
  clearError()
  elements.stepButton.disabled = true
  try {
    await advanceOneTurn(apiKey)
  } catch (error) {
    showError(error.message)
  } finally {
    elements.stepButton.disabled = false
  }
})
elements.apiKey.addEventListener('input', () => clearError())
elements.proMode.addEventListener('change', () => { elements.refugeCapacity.disabled = !elements.proMode.checked })
elements.resetButton.addEventListener('click', async () => {
  const apiKey = elements.apiKey.value.trim()
  if (!apiKey) { showError('Ingresa la clave de control para crear la ronda.'); return }
  clearError()
  elements.resetButton.disabled = true
  try {
    observedSlowTurns = 0
    lastHttpTurnMs = 0
    const payload = { round: Number(elements.roundSelect.querySelector('input:checked').value), pro: elements.proMode.checked,
      runnerContactBites: elements.runnerContactBites.checked }
    if (payload.pro && elements.refugeCapacity.value !== '') {
      const capacity = Number(elements.refugeCapacity.value)
      if (!Number.isInteger(capacity) || capacity < 0 || capacity > 1000) throw new Error('Indica cupos entre 0 y 1000.')
      payload.refugeCapacities = Object.fromEntries(mapData.refuges.map((refuge) => [refuge.id, capacity]))
    }
    render(await fetchJson('/simulacion/reiniciar', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey }, body: JSON.stringify(payload) }))
    elements.simulationHelp.textContent = `Ronda ${payload.round} lista${payload.pro ? ' con nivel Pro' : ''}. Pulsa Iniciar simulación.`
  } catch (error) { showError(error.message) }
  finally { elements.resetButton.disabled = false }
})

async function initialize() {
  try {
    await loadMap()
    await refreshState()
    window.setInterval(() => {
      if (!isRunning && !turnInFlight) refreshState()
    }, REFRESH_INTERVAL_MS)
  } catch (error) {
    elements.mapMessage.textContent = `No se pudo cargar el mapa: ${error.message}`
    setConnection('error', 'Sin conexión con la API')
    showError(error.message)
  }
}

initialize()
