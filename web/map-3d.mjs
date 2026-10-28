// Camera and building settings are independent of the evacuation state.
export const BUILDINGS_3D_ID = 'refugio-buildings-3d'
export function buildingVolumeLayer(source = 'openmaptiles') {
  return {
    id: BUILDINGS_3D_ID, type: 'fill-extrusion', source, 'source-layer': 'building', minzoom: 13,
    filter: ['!=', ['get', 'hide_3d'], true],
    layout: { visibility: 'none' },
    paint: {
      'fill-extrusion-color': '#294956',
      'fill-extrusion-height': ['max', 0, ['to-number', ['get', 'render_height'], ['get', 'height'], 6], ['to-number', ['get', 'render_min_height'], 0]],
      'fill-extrusion-base': ['max', 0, ['to-number', ['get', 'render_min_height'], 0]],
      'fill-extrusion-opacity': .88,
      'fill-extrusion-vertical-gradient': true,
    },
  }
}
export function createCameraController(map, { reducedMotion = false, onChange = () => {} } = {}) {
  let mode = '2d'
  let pitch = 55
  let bearing = -18
  const duration = reducedMotion ? 0 : 650
  function gestures(enabled) {
    if (enabled) {
      map.dragRotate.enable()
      map.touchZoomRotate.enableRotation()
      map.touchPitch.enable()
      map.keyboard?.enableRotation()
    } else {
      map.dragRotate.disable()
      map.touchZoomRotate.disableRotation()
      map.touchPitch.disable()
      map.keyboard?.disableRotation()
    }
  }
  function installBuildings() {
    const style = map.getStyle()
    const building = style.layers.find(layer => layer.type === 'fill' && layer['source-layer'] === 'building')
    if (!building || !style.sources[building.source]) return false
    if (!map.getLayer(BUILDINGS_3D_ID)) {
      const firstLabel = style.layers.find(layer => layer.type === 'symbol')?.id
      map.addLayer(buildingVolumeLayer(building.source), firstLabel)
    }
    map.setLayoutProperty(BUILDINGS_3D_ID, 'visibility', mode === '3d' ? 'visible' : 'none')
    return true
  }
  function setMode(nextMode) {
    if (!['2d', '3d'].includes(nextMode)) throw new RangeError('Vista de mapa desconocida.')
    if (nextMode === mode) return
    if (mode === '3d') { pitch = Math.max(25, Math.min(65, map.getPitch())); bearing = map.getBearing() }
    mode = nextMode
    gestures(mode === '3d')
    if (map.getLayer(BUILDINGS_3D_ID)) map.setLayoutProperty(BUILDINGS_3D_ID, 'visibility', mode === '3d' ? 'visible' : 'none')
    map.stop()
    map.easeTo({ pitch: mode === '3d' ? pitch : 0, bearing: mode === '3d' ? bearing : 0,
      zoom: mode === '3d' ? Math.max(map.getZoom(), 14.3) : map.getZoom(), duration })
    onChange(mode)
  }
  gestures(false)
  return {
    get mode() { return mode },
    installBuildings, setMode,
    rotateBy(degrees) {
      if (mode !== '3d') return
      map.stop()
      bearing = map.getBearing() + degrees
      map.easeTo({ bearing, duration: reducedMotion ? 0 : 280 })
    },
    setPitch(degrees) {
      if (mode !== '3d') return
      pitch = Math.max(25, Math.min(65, Number(degrees) || 55))
      map.stop(); map.easeTo({ pitch, duration: 0 })
    },
    recenterOptions: () => ({ pitch: mode === '3d' ? pitch : 0, bearing: mode === '3d' ? map.getBearing() : 0 }),
  }
}
