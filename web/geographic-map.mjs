import { Map as GeoMap, LngLatBounds, MercatorCoordinate, setWorkerUrl } from './vendor/maplibre-gl.mjs'
import { createCameraController } from './map-3d.mjs'
import { createAvatarLayer } from './avatar-scene.mjs'
import { createOperationalLayers } from './map-operational-layers.mjs'

function applyPetroleumPalette(map) {
  for (const layer of map.getStyle().layers) {
    const source = layer['source-layer']
    if (layer.type === 'background') map.setPaintProperty(layer.id, 'background-color', '#13232D')
    if (layer.type === 'fill') {
      const color = source === 'water' ? '#091A24'
        : source === 'building' ? '#1C303B'
        : source === 'landcover' || layer.id === 'landuse_park' ? '#172E32'
        : '#13232D'
      map.setPaintProperty(layer.id, 'fill-color', color)
      if (source === 'building') map.setPaintProperty(layer.id, 'fill-outline-color', '#29414C')
    }
    if (layer.type === 'line') {
      const color = source === 'waterway' ? '#091A24'
        : layer.id.includes('casing') ? '#13232D'
        : source === 'boundary' ? '#29414C'
        : '#38515F'
      map.setPaintProperty(layer.id, 'line-color', color)
    }
    if (layer.type === 'symbol' && layer.layout?.['text-field']) {
      map.setPaintProperty(layer.id, 'text-color', source === 'water_name' ? '#5E8495' : '#8FA6B4')
      map.setPaintProperty(layer.id, 'text-halo-color', '#13232D')
      map.setPaintProperty(layer.id, 'text-halo-width', 1.3)
    }
  }
}

// Static basemap is geographical context only. Routing still uses the simulator graph.
export function createGeographicMap(graph, onMove) {
  const notice = document.querySelector('#basemapNotice')
  try {
    setWorkerUrl(new URL('./vendor/maplibre-gl-worker.mjs', import.meta.url).href)
    const bounds = new LngLatBounds()
    for (const node of graph.nodes) bounds.extend([node.lng, node.lat])
    const container = document.querySelector('#basemap')
    const map = new GeoMap({ container, style: 'https://tiles.openfreemap.org/styles/dark', center: bounds.getCenter(), zoom: 13,
      minZoom: 10, maxZoom: 18, maxPitch: 65, attributionControl: false, pitchWithRotate: true, dragRotate: false, touchPitch: false,
      renderWorldCopies: false, fadeDuration: 0 })
    const view2d = document.querySelector('#view2d')
    const view3d = document.querySelector('#view3d')
    const cameraControls = document.querySelector('#cameraControls')
    const pitchInput = document.querySelector('#cameraPitch')
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const operational = createOperationalLayers(map, graph)
    const avatarNotice = document.querySelector('#avatar3dNotice')
    const avatarLayer = createAvatarLayer(graph, {
      toMercator: coordinate => MercatorCoordinate.fromLngLat(coordinate), reducedMotion,
      onReady: visible => container.closest('.map-frame').classList.toggle('avatars-3d-ready', visible),
      onError: () => { avatarNotice.hidden = false; avatarNotice.textContent = 'Modelos 3D no disponibles. Se conservan los iconos.' },
    })
    const camera = createCameraController(map, { reducedMotion, onChange: mode => {
      const enabled = mode === '3d'
      view2d.setAttribute('aria-pressed', String(!enabled))
      view3d.setAttribute('aria-pressed', String(enabled))
      cameraControls.hidden = !enabled
      container.closest('.map-frame').classList.toggle('view-3d', enabled)
      avatarLayer.setVisible(enabled)
      operational.setVisible(enabled)
      onMove()
    } })
    map.on('style.load', () => {
      applyPetroleumPalette(map)
      camera.installBuildings()
      operational.install()
      container.closest('.map-frame').classList.add('native-network-ready')
      if (!map.getLayer(avatarLayer.id)) map.addLayer(avatarLayer)
      view2d.disabled = false; view3d.disabled = false
    })
    view2d.addEventListener('click', () => camera.setMode('2d'))
    view3d.addEventListener('click', () => camera.setMode('3d'))
    document.querySelector('#rotateLeft').addEventListener('click', () => camera.rotateBy(-20))
    document.querySelector('#rotateRight').addEventListener('click', () => camera.rotateBy(20))
    pitchInput.addEventListener('input', () => camera.setPitch(pitchInput.value))
    const recenter = (animate = true) => {
      const narrow = window.innerWidth < 900
      map.fitBounds(bounds, { ...camera.recenterOptions(), padding: { top: narrow ? 130 : 110, bottom: narrow ? 85 : 140, left: 65, right: narrow ? 45 : 400 }, duration: animate && !reducedMotion ? 600 : 0, maxZoom: 14.6 })
    }
    recenter(false)
    let queued = false
    map.on('move', () => { if (!queued) { queued = true; requestAnimationFrame(() => {
      queued = false
      const actualPitch = Math.round(map.getPitch())
      pitchInput.value = String(actualPitch)
      document.querySelector('#pitchValue').textContent = `${actualPitch}°`
      document.querySelector('#cameraBearing').textContent = `N · ${Math.round(map.getBearing())}°`
      onMove()
    }) } })
    map.on('load', () => { notice.hidden = true; onMove() })
    map.on('error', () => { notice.hidden = false })
    document.querySelector('#zoomIn').addEventListener('click', () => map.zoomIn())
    document.querySelector('#zoomOut').addEventListener('click', () => map.zoomOut())
    document.querySelector('#recenterMap').addEventListener('click', () => recenter())
    return { project: coordinate => map.project(coordinate), resize: () => map.resize(), recenter, updateEntities: state => { avatarLayer.updateState(state); operational.updateState(state) },
      selectEntity: id => { avatarLayer.setSelected(id); operational.selectEntity(id) }, setNetworkVisible: value => operational.setNetworkVisible(value), modelStats: () => avatarLayer.stats() }
  } catch {
    notice.hidden = false
    return null
  }
}
