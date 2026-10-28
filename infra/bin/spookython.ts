import * as cdk from 'aws-cdk-lib'
import { SpookythonStack } from '../lib/spookython-stack'
import { LatencyTrialStack } from '../lib/latency-trial-stack'

const app = new cdk.App()
new SpookythonStack(app, 'SpookythonStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  description: 'Base serverless para el simulador Spookython en Manta',
})
if (process.env.SPOOKYTHON_MANAGED_TRIAL === '1') {
  new LatencyTrialStack(app, 'Refugio593LatencyTrial', {
    env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION || 'us-east-1' },
    description: 'Ejecutor temporal de la ultima prueba regional de Refugio 593',
  })
}
