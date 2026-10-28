import { Map as GeoMap, LngLatBounds, setWorkerUrl } from './vendor/maplibre-gl.mjs'

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
      minZoom: 10, maxZoom: 18, attributionControl: false, pitchWithRotate: false, dragRotate: false, touchPitch: false,
      renderWorldCopies: false, fadeDuration: 0 })
    map.on('style.load', () => applyPetroleumPalette(map))
    map.touchZoomRotate.disableRotation()
    const recenter = (animate = true) => {
      const narrow = window.innerWidth < 900
      map.fitBounds(bounds, { padding: { top: narrow ? 130 : 110, bottom: narrow ? 85 : 140, left: 65, right: narrow ? 45 : 400 }, duration: animate ? 600 : 0, maxZoom: 14.6 })
    }
    recenter(false)
    let queued = false
    map.on('move', () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; onMove() }) } })
    map.on('load', () => { notice.hidden = true; onMove() })
    map.on('error', () => { notice.hidden = false })
    document.querySelector('#zoomIn').addEventListener('click', () => map.zoomIn())
    document.querySelector('#zoomOut').addEventListener('click', () => map.zoomOut())
    document.querySelector('#recenterMap').addEventListener('click', () => recenter())
    return { project: coordinate => map.project(coordinate), resize: () => map.resize(), recenter }
  } catch {
    notice.hidden = false
    return null
  }
}
