import api from './handler.js'
import store from './simulation/store.js'
import { initializeProvisionedConnection } from './provisioned-init.mjs'

const started = performance.now()
try {
  if (await initializeProvisionedConnection(() => store.initializeConnection())) {
    console.log(JSON.stringify({ event: 'provisioned_connection_ready', durationMs: Number((performance.now() - started).toFixed(2)) }))
  }
} catch (error) {
  console.error(JSON.stringify({ event: 'provisioned_connection_failed', errorType: error.name }))
  throw error
}
export const handler = api.handler
