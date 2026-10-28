import * as T from './vendor/three.mjs'

export const MODEL_TYPES = ['survivor', 'walker', 'runner', 'horde', 'truck', 'refuge', 'blocked']
const COLORS = { survivor: '#61e3eb', walker: '#ff6679', runner: '#ffb15d', horde: '#ad76ff', truck: '#f4bd62', refuge: '#63e6a3', blocked: '#ff6679' }

// Each model is merged into one colored geometry, then shared by GPU instances.
export function createAvatarGeometry(type) {
  if (!MODEL_TYPES.includes(type)) throw new RangeError(`Modelo desconocido: ${type}`)
  const pieces = []
  function part(geometry, color, position = [0, 0, 0], rotation = [0, 0, 0]) {
    geometry.rotateX(rotation[0]); geometry.rotateY(rotation[1]); geometry.rotateZ(rotation[2]); geometry.translate(...position)
    const flat = geometry.index ? geometry.toNonIndexed() : geometry
    if (flat !== geometry) geometry.dispose()
    const rgb = new T.Color(color)
    const colors = new Float32Array(flat.getAttribute('position').count * 3)
    for (let i = 0; i < colors.length; i += 3) { colors[i] = rgb.r; colors[i + 1] = rgb.g; colors[i + 2] = rgb.b }
    flat.setAttribute('color', new T.BufferAttribute(colors, 3)); pieces.push(flat)
  }
  const box = (size, color, position, rotation) => part(new T.BoxGeometry(...size), color, position, rotation)
  function person(color, zombie = false, runner = false, offset = [0, 0, 0], scale = 1) {
    const begin = pieces.length
    const skin = zombie ? '#9fb67a' : '#f0c5a0'
    const dark = '#19333f'
    part(new T.CylinderGeometry(.48, .52, .06, 8), color, [0, .035, 0])
    box([.25, .62, .28], dark, [-.18, .39, runner ? -.12 : .06], [runner ? -.35 : -.13, 0, 0])
    box([.25, .62, .28], dark, [.18, .39, runner ? .18 : -.06], [runner ? .45 : .13, 0, 0])
    box([.29, .13, .4], '#0c1b24', [-.18, .1, runner ? -.22 : .12])
    box([.29, .13, .4], '#0c1b24', [.18, .1, runner ? .28 : -.04])
    box([.67, .71, .39], color, [0, 1.08, runner ? .1 : 0], [runner ? .18 : 0, 0, zombie ? .05 : 0])
    box([.19, .18, .19], skin, [0, 1.5, runner ? .16 : 0])
    part(new T.IcosahedronGeometry(.27, 0), skin, [0, 1.78, runner ? .19 : .02])
    box([.43, .12, .35], zombie ? '#43533a' : '#25343b', [0, 1.98, runner ? .15 : -.02])
    for (const side of [-1, 1]) {
      box([.18, .57, .21], color, [side * .44, 1.13, zombie ? .22 : runner ? side * .12 : 0], [zombie ? -1.15 : runner ? side * .65 : 0, 0, side * -.15])
      box([.18, .2, .2], skin, [side * .45, zombie ? 1.04 : .78, zombie ? .51 : runner ? side * .25 : .02])
    }
    if (!zombie) box([.35, .45, .16], '#36717b', [0, 1.15, -.27])
    for (let i = begin; i < pieces.length; i++) { pieces[i].scale(scale, scale, scale); pieces[i].translate(...offset) }
  }
  if (['survivor', 'walker', 'runner'].includes(type)) person(COLORS[type], type !== 'survivor', type === 'runner')
  if (type === 'horde') {
    person(COLORS.horde, true, false, [-.64, 0, .2], .8)
    person('#925bd9', true, false, [.64, 0, .2], .8)
    person('#c39aff', true, false, [0, 0, -.38], .94)
  }
  if (type === 'truck') {
    box([2.1, .62, 4.1], COLORS.truck, [0, .85, 0])
    box([1.92, .87, 1.65], '#ffd484', [0, 1.54, 1.03])
    box([1.68, .55, .06], '#284e62', [0, 1.6, 1.88])
    box([.06, .52, 1.25], '#284e62', [-.98, 1.6, 1.08])
    box([.06, .52, 1.25], '#284e62', [.98, 1.6, 1.08])
    box([1.6, .18, 1.7], '#aa803d', [0, 1.21, -1.03])
    box([.35, .18, .48], '#ffae3f', [0, 2.05, 1.04])
    for (const x of [-1.06, 1.06]) for (const z of [-1.28, 1.28]) {
      part(new T.CylinderGeometry(.44, .44, .27, 8), '#17242d', [x, .48, z], [0, 0, Math.PI / 2])
    }
    for (const x of [-.68, .68]) box([.3, .2, .08], '#fff2c4', [x, .92, 2.08])
    box([2.2, .14, .14], '#b8c8c7', [0, .6, 2.1])
  }
  if (type === 'refuge') {
    box([4.5, .18, 4.1], '#295647', [0, .09, 0])
    box([4, 2.4, 3.5], COLORS.refuge, [0, 1.38, 0])
    part(new T.ConeGeometry(3.25, 1.65, 4), '#2a9e70', [0, 3.36, 0], [0, Math.PI / 4, 0])
    box([.94, 1.92, .08], '#173b38', [0, 1.15, 1.79])
    for (const x of [-1.3, 1.3]) box([.75, .72, .08], '#c6fff0', [x, 1.73, 1.8])
    box([1.16, .25, .12], '#f0fff6', [0, 2.45, 1.85])
    box([.25, .96, .12], '#f0fff6', [0, 2.45, 1.85])
  }
  if (type === 'blocked') {
    for (const x of [-1.1, 1.1]) box([.2, 1.5, .28], '#b3bdba', [x, .75, 0])
    box([2.8, .7, .2], COLORS.blocked, [0, 1, 0])
    for (const x of [-.85, 0, .85]) box([.2, .6, .04], '#fff0d1', [x, 1, .13], [0, 0, -.4])
  }
  const merged = new T.BufferGeometry()
  for (const attribute of ['position', 'normal', 'color']) {
    const length = pieces.reduce((sum, piece) => sum + piece.getAttribute(attribute).array.length, 0)
    const data = new Float32Array(length)
    let offset = 0
    for (const piece of pieces) { data.set(piece.getAttribute(attribute).array, offset); offset += piece.getAttribute(attribute).array.length }
    merged.setAttribute(attribute, new T.BufferAttribute(data, 3))
  }
  pieces.forEach(piece => piece.dispose())
  merged.computeBoundingBox(); merged.computeBoundingSphere()
  return merged
}

// All placements come from public game state. Sleepers and inactive people stay absent.
export function avatarPlacements(graph, state) {
  const nodes = new Map(graph.nodes.map(node => [node.id, node]))
  const placements = []
  function place(type, entity, nodeId) {
    const node = nodes.get(nodeId)
    if (!node) return
    const next = nodes.get(entity.routeNodeIds?.[1])
    placements.push({ id: entity.id, type, lng: node.lng, lat: node.lat,
      next: next ? [next.lng, next.lat] : null })
  }
  for (const person of state.survivors || []) if (person.status === 'ACTIVE') place('survivor', person, person.nodeId)
  const types = { WALKER: 'walker', RUNNER: 'runner', HORDE: 'horde' }
  for (const zombie of state.zombies || []) if (types[zombie.type] && !zombie.asleep) place(types[zombie.type], zombie, zombie.nodeId)
  for (const truck of state.vehicles || []) place('truck', truck, truck.nodeId)
  for (const refuge of graph.refuges) place('refuge', refuge, refuge.nodeId)
  const blocked = new Set(state.blockedStreetIds || [])
  for (const street of graph.streets) if (blocked.has(street.id)) {
    const coordinates = street.geometry?.[Math.floor(street.geometry.length / 2)]
    if (coordinates) placements.push({ id: street.id, type: 'blocked', lng: coordinates[0], lat: coordinates[1], next: null })
  }
  return placements
}
