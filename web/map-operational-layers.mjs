// Native map layers place roads below solid 3D models instead of on the SVG overlay.
const NETWORK = 'refugio-network-native'
const ROUTES = 'refugio-routes-native'
const IDS = ['refugio-roads-open', 'refugio-roads-blocked', 'refugio-route-lines']
const collection = features => ({ type: 'FeatureCollection', features })
export function createOperationalLayers(map, graph) {
  let state = null, selected = null, visible = false, networkVisible = true, previousKey = null
  const streetByPair = new Map()
  for (const street of graph.streets) {
    const key = [street.fromNode, street.toNode].sort().join('|')
    if (!streetByPair.has(key)) streetByPair.set(key, [])
    streetByPair.get(key).push(street)
  }
  function update() {
    if (!map.getSource(NETWORK)) return
    const blocked = new Set(state?.blockedStreetIds || [])
    map.getSource(NETWORK).setData(collection(graph.streets.map(street => ({ type: 'Feature', properties: { blocked: blocked.has(street.id), kind: street.type }, geometry: { type: 'LineString', coordinates: street.geometry } }))))
    const features = []
    for (const entity of [...(state?.survivors || []).filter(item => item.status === 'ACTIVE'), ...(state?.vehicles || []).map(item => ({...item, vehicle: true}))]) {
      const route = entity.routeNodeIds || []
      for (let i = 0; i < route.length - 1; i++) {
        const street = streetByPair.get([route[i], route[i + 1]].sort().join('|'))?.find(item => !blocked.has(item.id))
        if (!street) continue
        features.push({ type: 'Feature', properties: { selected: entity.id === selected, vehicle: Boolean(entity.vehicle) }, geometry: { type: 'LineString', coordinates: street.geometry } })
      }
    }
    map.getSource(ROUTES).setData(collection(features))
  }
  function syncVisibility() {
    for (const id of IDS) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible && (id === IDS[2] || networkVisible) ? 'visible' : 'none')
  }
  function install() {
    if (!map.getSource(NETWORK)) map.addSource(NETWORK, { type: 'geojson', data: collection([]) })
    if (!map.getSource(ROUTES)) map.addSource(ROUTES, { type: 'geojson', data: collection([]) })
    const before = map.getLayer('refugio-buildings-3d') ? 'refugio-buildings-3d' : map.getStyle().layers.find(layer => layer.type === 'symbol')?.id
    const layers = operationalLayerStyles()
    for (const layer of layers) if (!map.getLayer(layer.id)) map.addLayer(layer, before)
    update(); syncVisibility()
  }
  return { install,
    updateState(next) {
      state = next
      const key = `${next.sessionId}:${next.revision}:${next.turn}:${next.phase}`
      if (previousKey !== key) { previousKey = key; update() }
    },
    selectEntity(id) { selected = id; update() },
    setVisible(value) { visible = value; syncVisibility() },
    setNetworkVisible(value) { networkVisible = value; syncVisibility() },
  }
}
export function operationalLayerStyles() {
  return [
    { id: IDS[0], type: 'line', source: NETWORK, filter: ['==', ['get', 'blocked'], false], layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['match', ['get', 'kind'], 'AVENIDA', '#FFD28A', '#E7B968'], 'line-width': ['match', ['get', 'kind'], 'AVENIDA', 3, 2], 'line-opacity': .9 } },
    { id: IDS[1], type: 'line', source: NETWORK, filter: ['==', ['get', 'blocked'], true], layout: { visibility: 'none' }, paint: { 'line-color': '#ff6679', 'line-width': 4, 'line-dasharray': [2, 2] } },
    { id: IDS[2], type: 'line', source: ROUTES, layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['case', ['get', 'selected'], '#f4bd62', ['get', 'vehicle'], '#f4bd62', '#61e3eb'], 'line-width': ['case', ['get', 'selected'], 3.5, 2.6], 'line-opacity': ['case', ['get', 'selected'], 1, .75], 'line-dasharray': [1.5, 2] } },
  ]
}
