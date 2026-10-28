// Fit the actual street network, keeping geographic proportions at any panel size.
export function createMapProjection(map, viewportWidth, viewportHeight) {
  const coordinates = map.nodes.map((node) => [node.lng, node.lat])
  for (const street of map.streets) coordinates.push(...street.geometry)
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity
  for (const [lng, lat] of coordinates) {
    west = Math.min(west, lng); east = Math.max(east, lng)
    south = Math.min(south, lat); north = Math.max(north, lat)
  }
  const correction = Math.cos((south + north) / 2 * Math.PI / 180)
  const width = Math.max((east - west) * correction, 1e-9)
  const height = Math.max(north - south, 1e-9)
  const padding = Math.min(32, viewportWidth / 8, viewportHeight / 8)
  const scale = Math.min((viewportWidth - 2 * padding) / width, (viewportHeight - 2 * padding) / height)
  const left = (viewportWidth - width * scale) / 2
  const top = (viewportHeight - height * scale) / 2
  return ([lng, lat]) => ({ x: left + (lng - west) * correction * scale, y: top + (north - lat) * scale })
}
