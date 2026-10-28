// Paid initialization only: establish SDK credentials/TLS before serving traffic.
// Discard the read result; DynamoDB remains the authoritative shared state.
export async function initializeProvisionedConnection(connect, initializationType = process.env.AWS_LAMBDA_INITIALIZATION_TYPE,
  { wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), random = Math.random } = {}) {
  if (initializationType !== 'provisioned-concurrency') return false
  await wait(Math.floor(random() * 1000))
  const transient = new Set(['ProvisionedThroughputExceededException', 'ThrottlingException', 'RequestLimitExceeded', 'TimeoutError', 'NetworkingError'])
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try { await connect(); return true }
    catch (error) {
      if (!transient.has(error.name) || attempt === 3) throw error
      await wait(250 * 2 ** attempt + Math.floor(random() * 250))
    }
  }
}
