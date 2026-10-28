import test from 'node:test'
import assert from 'node:assert/strict'
import { initializeProvisionedConnection } from '../src/provisioned-init.mjs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createStore } = require('../src/simulation/store')

test('preparar la conexión solo en capacidad aprovisionada espera el SDK y no devuelve el estado', async () => {
  let reads = 0
  const read = async () => { reads += 1; return {survivors:['private-world']} }
  assert.equal(await initializeProvisionedConnection(read, 'on-demand'), false)
  assert.equal(reads, 0)
  assert.equal(await initializeProvisionedConnection(read, 'provisioned-concurrency', {wait:async()=>{},random:()=>0}), true)
  assert.equal(reads, 1)
  await assert.rejects(initializeProvisionedConnection(async () => {throw Error('Cannot establish connection')}, 'provisioned-concurrency', {wait:async()=>{},random:()=>0}))
})

test('inicializar la conexión no lee ni escribe el snapshot del mundo', async () => {
  const calls=[]
  const store=createStore({send:async(command)=>{calls.push(command);return {}}},()=> 'test-table')
  await store.initializeConnection()
  assert.equal(calls.length,1)
  assert.equal(calls[0].constructor.name,'GetCommand')
  assert.equal(calls[0].input.Key.entityId,'INITIALIZATION_CHECK')
})

test('el reintento de inicialización es limitado y no oculta errores de permisos', async () => {
  let calls=0
  const options={wait:async()=>{},random:()=>0}
  const throttled=Object.assign(new Error('transient'),{name:'ThrottlingException'})
  await assert.rejects(initializeProvisionedConnection(async()=>{calls+=1;throw throttled},'provisioned-concurrency',options))
  assert.equal(calls,4)
  calls=0
  await assert.rejects(initializeProvisionedConnection(async()=>{calls+=1;throw Object.assign(new Error('denied'),{name:'AccessDeniedException'})},'provisioned-concurrency',options))
  assert.equal(calls,1)
})
