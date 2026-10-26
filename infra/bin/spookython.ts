import * as cdk from 'aws-cdk-lib'
import { SpookythonStack } from '../lib/spookython-stack'

const app = new cdk.App()
new SpookythonStack(app, 'SpookythonStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  description: 'Base serverless para el simulador Spookython en Manta',
})
