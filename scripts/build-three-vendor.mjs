import { build } from 'esbuild'
import { copyFile } from 'node:fs/promises'
await build({ stdin: { contents: "export { AmbientLight, BoxGeometry, BufferAttribute, BufferGeometry, Camera, Color, ConeGeometry, CylinderGeometry, DirectionalLight, DoubleSide, DynamicDrawUsage, Euler, IcosahedronGeometry, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, NoBlending, NoToneMapping, Quaternion, RingGeometry, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from 'three'", resolveDir: process.cwd() }, bundle: true, format: 'esm', minify: true, sourcemap: false, outfile: 'web/vendor/three.mjs', legalComments: 'eof' })
await copyFile('node_modules/three/LICENSE','web/vendor/three-LICENSE.txt')
console.log('Three.js empaquetado localmente.')
