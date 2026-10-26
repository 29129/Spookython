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
}

let mapData = null
let worldState = null
let isRunning = false
let runSequence = 0
let refreshInFlight = false

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
  const bounds = map.metadata.boundingBox
  const padding = 42
  const latCorrection = Math.cos(((bounds.south + bounds.north) / 2) * Math.PI / 180)
  const width = (bounds.east - bounds.west) * latCorrection
  const height = bounds.north - bounds.south
  const scale = Math.min((1000 - padding * 2) / width, (700 - padding * 2) / height)
  const drawnWidth = width * scale
  const drawnHeight = height * scale
  const left = (1000 - drawnWidth) / 2
  const top = (700 - drawnHeight) / 2
  return ([lng, lat]) => ({
    x: left + (lng - bounds.west) * latCorrection * scale,
    y: top + (bounds.north - lat) * scale,
  })
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

  const active = state.survivors.filter((survivor) => survivor.status === 'ACTIVE' && survivor.routeNodeIds?.length > 1)
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
      const route = svgElement('path', { class: 'route-line', d: points.join(' ') })
      const title = svgElement('title')
      title.textContent = `Ruta planificada · ${survivor.id}`
      route.append(title)
      elements.routeLayer.append(route)
    }
  }
}

function drawRefuges(project) {
  elements.refugeLayer.replaceChildren()
  for (const [index, refuge] of mapData.refuges.entries()) {
    const point = project([refuge.lng, refuge.lat])
    const marker = svgElement('g', { transform: `translate(${point.x} ${point.y})` })
    marker.append(svgElement('circle', { class: 'refuge-ring', r: 11 }))
    marker.append(svgElement('rect', { class: 'refuge-core', x: -4, y: -4, width: 8, height: 8, rx: 1.5 }))
    const label = svgElement('text', { class: 'refuge-label', x: 0, y: 23 })
    label.textContent = `R${index + 1}`
    marker.append(label)
    const title = svgElement('title')
    title.textContent = `${refuge.name} · refugio de demostración`
    marker.append(title)
    elements.refugeLayer.append(marker)
  }
}

function drawEntities(project, state) {
  elements.entityLayer.replaceChildren()
  for (const survivor of state.survivors) {
    const node = mapData.nodesById.get(survivor.nodeId)
    if (!node) continue
    const point = project([node.lng, node.lat])
    const marker = svgElement('g', { transform: `translate(${point.x} ${point.y})` })
    const statusClass = survivor.status === 'BITTEN' ? 'survivor-bitten' : survivor.status === 'RESCUED' ? 'survivor-rescued' : 'survivor-mark'
    if (survivor.status === 'ACTIVE') marker.append(svgElement('circle', { class: 'entity-halo', r: 7.5 }))
    marker.append(svgElement('circle', { class: statusClass, r: survivor.status === 'ACTIVE' ? 3.3 : 3.8 }))
    const title = svgElement('title')
    title.textContent = `${survivor.id} · ${survivor.status}`
    marker.append(title)
    elements.entityLayer.append(marker)
  }

  const zombieLabels = { WALKER: 'C', RUNNER: 'R', HORDE: 'H', SLEEPER: 'D' }
  for (const zombie of state.zombies) {
    const node = mapData.nodesById.get(zombie.nodeId)
    if (!node) continue
    const point = project([node.lng, node.lat])
    const marker = svgElement('g', { transform: `translate(${point.x} ${point.y})` })
    if (zombie.type === 'HORDE') marker.append(svgElement('circle', { cx: 0, cy: 0, r: 16, fill: 'rgba(189,118,255,.08)', stroke: 'rgba(189,118,255,.38)', 'stroke-width': 1 }))
    marker.append(svgElement('circle', { class: `zombie-mark ${zombie.type.toLowerCase()}`, r: 8 }))
    const label = svgElement('text', { class: 'entity-label', x: 0, y: .5 })
    label.textContent = zombieLabels[zombie.type] || '?'
    marker.append(label)
    const title = svgElement('title')
    title.textContent = `${zombie.id} · ${zombie.type}`
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
  worldState = state
  const project = makeProjection(mapData)
  const blockedStreetIds = state.blockedStreetIds || []
  drawStreets(project, blockedStreetIds)
  drawRoutes(project, state, blockedStreetIds)
  drawRefuges(project)
  drawEntities(project, state)

  elements.turnNumber.textContent = String(state.turn).padStart(2, '0')
  elements.activeCount.textContent = state.summary.activeSurvivors
  elements.rescuedCount.textContent = state.summary.rescuedSurvivors
  elements.bittenCount.textContent = state.summary.bittenSurvivors
  elements.zombieCount.textContent = state.summary.visibleZombies
  elements.blockedCount.textContent = state.summary.blockedStreets
  elements.mapUpdated.textContent = `Actualizado ${new Date(state.updatedAt).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
  elements.mapMessage.hidden = true
  elements.nodeCount.textContent = mapData.nodes.length
  elements.refugeCount.textContent = mapData.refuges.length
  elements.sourceStamp.textContent = `OpenStreetMap contributors · ${mapData.metadata.sourceTimestamp.slice(0, 10)}`
  describeEvent(state.lastEvent)
  setConnection('online', 'Conectado · actualización cada 2 s')
}

async function loadMap() {
  mapData = await fetchJson('/map')
  mapData.nodesById = new Map(mapData.nodes.map((node) => [node.id, node]))
  drawStreets(makeProjection(mapData), [])
  drawRefuges(makeProjection(mapData))
}

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
  elements.startButton.disabled = running
  elements.stepButton.disabled = running
  elements.stopButton.disabled = !running
  elements.apiKey.disabled = running
  elements.simulationTitle.textContent = running ? 'Simulación en curso' : 'Modo espectador'
  elements.simulationHelp.textContent = running
    ? 'Los zombis avanzan primero; luego se actualiza el estado de los sobrevivientes.'
    : 'El mapa se actualiza automáticamente. Ingresa la clave de control para iniciar o avanzar turnos.'
  elements.simulationState.classList.toggle('running', running)
  elements.simulationState.lastElementChild.textContent = running ? 'Turnos activos · 2 segundos' : 'Lectura en vivo activa'
}

async function advanceOneTurn(apiKey) {
  const state = await fetchJson('/estado/avanzar', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: '{}',
  })
  render(state)
  return state
}

async function startSimulation() {
  const apiKey = elements.apiKey.value.trim()
  if (!apiKey) {
    showError('Ingresa la clave de control para iniciar la simulación.')
    return
  }
  clearError()
  setControlState(true)
  const sequence = ++runSequence
  while (isRunning && sequence === runSequence) {
    const startedAt = Date.now()
    try {
      const state = await advanceOneTurn(apiKey)
      if (state.summary.activeSurvivors === 0) {
        setControlState(false)
        elements.simulationHelp.textContent = 'La evacuación terminó: no quedan sobrevivientes activos.'
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

async function initialize() {
  try {
    await loadMap()
    await refreshState()
    window.setInterval(() => {
      if (!isRunning) refreshState()
    }, REFRESH_INTERVAL_MS)
  } catch (error) {
    elements.mapMessage.textContent = `No se pudo cargar el mapa: ${error.message}`
    setConnection('error', 'Sin conexión con la API')
    showError(error.message)
  }
}

initialize()
