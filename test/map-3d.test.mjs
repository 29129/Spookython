import test from 'node:test'
import assert from 'node:assert/strict'
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec'
import { BUILDINGS_3D_ID, buildingVolumeLayer, createCameraController } from '../web/map-3d.mjs'

test('la capa de edificios 3D cumple la especificacion de MapLibre', () => {
  const errors = validateStyleMin({ version: 8, sources: { openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } }, layers: [buildingVolumeLayer()] })
  assert.deepEqual(errors.map(error => error.message), [])
})

test('volver de 3D a 2D elimina inclinacion, rotacion y edificios sin cambiar el zoom ni el estado de evacuacion', () => {
  const gestures = {}; const layers = new Map(); const calls = []
  let pitch = 0, bearing = 0, zoom = 14.5
  const control = name => ({ enable: () => { gestures[name] = true }, disable: () => { gestures[name] = false }, enableRotation: () => { gestures[name] = true }, disableRotation: () => { gestures[name] = false } })
  const map = { dragRotate: control('drag'), touchZoomRotate: control('touch'), touchPitch: control('pitch'), keyboard: control('keyboard'),
    getPitch: () => pitch, getBearing: () => bearing, getZoom: () => zoom,
    getStyle: () => ({ sources: { openmaptiles: {} }, layers: [{ id: 'building', type: 'fill', source: 'openmaptiles', 'source-layer': 'building' }] }),
    getLayer: id => layers.get(id), addLayer: layer => layers.set(layer.id, structuredClone(layer)),
    setLayoutProperty: (id, property, value) => { layers.get(id).layout[property] = value }, stop() {},
    easeTo(options) { calls.push(options); pitch = options.pitch ?? pitch; bearing = options.bearing ?? bearing; zoom = options.zoom ?? zoom },
  }
  const camera = createCameraController(map, { reducedMotion: true })
  camera.installBuildings(); camera.installBuildings()
  assert.equal(layers.size, 1)
  camera.setMode('3d')
  assert.equal(pitch, 55); assert.equal(layers.get(BUILDINGS_3D_ID).layout.visibility, 'visible')
  camera.setPitch(100); assert.equal(pitch, 65)
  camera.rotateBy(20); assert.equal(bearing, 2)
  camera.setMode('2d')
  assert.equal(pitch, 0); assert.equal(bearing, 0); assert.equal(zoom, 14.5)
  assert.equal(layers.get(BUILDINGS_3D_ID).layout.visibility, 'none')
  assert(Object.values(gestures).every(value => value === false))
  assert(calls.every(call => call.duration === 0))
  assert.throws(() => camera.setMode('unknown'), RangeError)
})
