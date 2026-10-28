import * as T from './vendor/three.mjs'
import { MODEL_TYPES, createAvatarGeometry, avatarPlacements } from './avatar-models.mjs'
export const AVATAR_LAYER_ID = 'refugio-avatar-models'

// One world origin keeps coordinates near zero for GPU precision.
export function createAvatarLayer(graph, { toMercator, reducedMotion = false, onReady = () => {}, onError = () => {} }) {
  const lng = graph.nodes.reduce((sum, node) => sum + node.lng, 0) / graph.nodes.length
  const lat = graph.nodes.reduce((sum, node) => sum + node.lat, 0) / graph.nodes.length
  const origin = toMercator([lng, lat])
  const meters = origin.meterInMercatorCoordinateUnits()
  const localMatrix = new T.Matrix4().makeTranslation(origin.x, origin.y, origin.z)
    .multiply(new T.Matrix4().makeScale(meters, -meters, meters))
    .multiply(new T.Matrix4().makeRotationX(Math.PI / 2))
  const scene = new T.Scene()
  const camera = new T.Camera()
  scene.add(new T.AmbientLight('#ffffff', .95))
  const key = new T.DirectionalLight('#ffffff', 1.4); key.position.set(-120, 260, 180); scene.add(key)
  const fill = new T.DirectionalLight('#c8e3ff', .3); fill.position.set(100, 100, -180); scene.add(fill)
  const material = new T.MeshLambertMaterial({ vertexColors: true, flatShading: true, transparent: false, opacity: 1, depthWrite: true, blending: T.NoBlending })
  const geometries = new Map()
  const meshes = new Map()
  let renderer = null, map = null, enabled = false, ready = false, dirty = true
  let selectedId = null, lastKey = null, records = new Map(), lastScale = null
  const matrix = new T.Matrix4(), projection = new T.Matrix4()
  const position = new T.Vector3(), size = new T.Vector3(), rotation = new T.Quaternion(), axis = new T.Vector3(0, 1, 0)
  const ringGeometry = new T.RingGeometry(.6, .7, 18).rotateX(-Math.PI / 2)
  const ringMaterial = new T.MeshBasicMaterial({ color: '#ffcf78', side: T.DoubleSide, depthTest: false })
  const ring = new T.Mesh(ringGeometry, ringMaterial); ring.visible = false; scene.add(ring)
  function local(coordinate) {
    const value = toMercator(coordinate)
    return { x: (value.x - origin.x) / meters, z: (value.y - origin.y) / meters }
  }
  function currentPosition(record, now) {
    const progress = reducedMotion || !enabled ? 1 : Math.min(1, Math.max(0, (now - record.started) / 650))
    const eased = progress * progress * (3 - 2 * progress)
    return { x: record.from.x + (record.to.x - record.from.x) * eased, z: record.from.z + (record.to.z - record.from.z) * eased, moving: progress < 1 && (record.from.x !== record.to.x || record.from.z !== record.to.z) }
  }
  function updateState(state) {
    if (!state) return
    const stateKey = `${state.sessionId}:${state.revision}:${state.turn}:${state.phase}`
    if (lastKey === stateKey) return
    lastKey = stateKey
    const now = performance.now(), next = new Map()
    for (const entity of avatarPlacements(graph, state)) {
      const id = `${entity.type}:${entity.id}`, previous = records.get(id)
      const target = local([entity.lng, entity.lat])
      const start = previous ? currentPosition(previous, now) : target
      let yaw = previous?.yaw || 0
      const ahead = entity.next ? local(entity.next) : target
      const hasRoute = Math.abs(ahead.x - target.x) + Math.abs(ahead.z - target.z) > .01
      const dx = hasRoute ? ahead.x - target.x : target.x - start.x
      const dz = hasRoute ? ahead.z - target.z : target.z - start.z
      if (Math.abs(dx) + Math.abs(dz) > .01) yaw = Math.atan2(dx, dz)
      next.set(id, { ...entity, from: start, to: target, started: now, yaw })
    }
    records = next; dirty = true
    map?.triggerRepaint()
  }
  function ensureMesh(type, count) {
    let mesh = meshes.get(type)
    if (mesh && mesh.instanceMatrix.count >= count) return mesh
    if (mesh) { scene.remove(mesh); mesh.dispose() }
    if (!geometries.has(type)) geometries.set(type, createAvatarGeometry(type))
    const capacity = Math.max(8, 2 ** Math.ceil(Math.log2(Math.max(1, count))))
    mesh = new T.InstancedMesh(geometries.get(type), material, capacity)
    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage); mesh.count = 0; mesh.frustumCulled = false
    scene.add(mesh); meshes.set(type, mesh)
    return mesh
  }
  function updateMatrices(now, units) {
    let animating = false
    for (const type of MODEL_TYPES) {
      const group = [...records.values()].filter(record => record.type === type)
      const mesh = ensureMesh(type, group.length)
      mesh.count = group.length
      for (let index = 0; index < group.length; index++) {
        const entity = group[index], at = currentPosition(entity, now)
        animating ||= at.moving
        const scale = units * (type === 'truck' ? .84 : type === 'refuge' ? .83 : 1)
        position.set(at.x, .15, at.z); size.setScalar(scale); rotation.setFromAxisAngle(axis, entity.yaw)
        matrix.compose(position, rotation, size); mesh.setMatrixAt(index, matrix)
      }
      mesh.instanceMatrix.needsUpdate = true
    }
    const selected = records.get(`survivor:${selectedId}`)
    ring.visible = Boolean(selected)
    if (selected) { const at = currentPosition(selected, now); ring.position.set(at.x, .35, at.z); ring.scale.setScalar(units) }
    dirty = animating
    return animating
  }
  const layer = {
    id: AVATAR_LAYER_ID, type: 'custom', renderingMode: '3d',
    onAdd(owner, gl) {
      map = owner
      try {
        renderer = new T.WebGLRenderer({ canvas: owner.getCanvas(), context: gl, antialias: true, alpha: true })
        renderer.autoClear = false; renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.NoToneMapping
        ready = true; onReady(enabled); dirty = true
      } catch (error) { ready = false; onError(error) }
    },
    render(gl, args) {
      if (!enabled || !ready) return
      try {
        // Models are cartographic markers: exaggerated size preserves readability.
        const metersPerPixel = 156543.03392 * Math.cos(lat * Math.PI / 180) / 2 ** map.getZoom()
        const units = Math.max(1.2, Math.min(48, metersPerPixel * 9))
        const now = performance.now()
        let animating = false
        if (dirty || units !== lastScale) { animating = updateMatrices(now, units); lastScale = units }
        projection.fromArray(args.defaultProjectionData.mainMatrix).multiply(localMatrix)
        camera.projectionMatrix.copy(projection); camera.projectionMatrixInverse.copy(projection).invert()
        renderer.resetState(); renderer.setViewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight); renderer.render(scene, camera); renderer.resetState()
        if (animating) map.triggerRepaint()
      } catch (error) { ready = false; onReady(false); onError(error) }
    },
    onRemove() {
      ready = false; onReady(false)
      for (const mesh of meshes.values()) { scene.remove(mesh); mesh.dispose() }
      for (const geometry of geometries.values()) geometry.dispose()
      meshes.clear(); geometries.clear(); ringGeometry.dispose(); ringMaterial.dispose(); material.dispose(); renderer?.dispose()
    },
    updateState,
    setSelected(id) { selectedId = id; dirty = true; map?.triggerRepaint() },
    setVisible(value) { enabled = value; dirty = true; onReady(ready && enabled); map?.triggerRepaint() },
    stats() { return { models: records.size, batches: [...meshes.values()].filter(mesh => mesh.count > 0).length, triangles: renderer?.info.render.triangles ?? null, ready, enabled } },
  }
  return layer
}
