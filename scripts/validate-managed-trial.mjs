import fs from 'node:fs'
import assert from 'node:assert/strict'
const template = JSON.parse(fs.readFileSync('cdk.out/Refugio593LatencyTrial.template.json', 'utf8'))
const resources = Object.values(template.Resources)
const project = resources.find((item) => item.Type === 'AWS::CodeBuild::Project').Properties
assert.equal(project.TimeoutInMinutes, 12)
assert.equal(project.ConcurrentBuildLimit, 1)
assert.equal(project.Environment.PrivilegedMode, false)
assert(project.Environment.EnvironmentVariables.some((item) => item.Name === 'SIMULATOR_API_KEY' && item.Type === 'SECRETS_MANAGER'))
assert.equal(project.Source.Type, 'S3')
assert(project.LogsConfig.CloudWatchLogs.Status === 'ENABLED')
assert(resources.find((item) => item.Type === 'AWS::Logs::LogGroup' && item.Properties.LogGroupName === '/aws/codebuild/refugio593-latency-final').Properties.KmsKeyId)
const policies = resources.filter((item) => item.Type === 'AWS::IAM::Policy').flatMap((item) => item.Properties.PolicyDocument.Statement)
for (const statement of policies) {
  const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action]
  if (actions.includes('lambda:PutProvisionedConcurrencyConfig') || actions.includes('iam:PassRole')) assert.notEqual(statement.Resource, '*')
  if (actions.includes('iam:PassRole')) assert.equal(statement.Condition.StringEquals['iam:PassedToService'], 'scheduler.amazonaws.com')
}
const cleanup = resources.find((item) => item.Type === 'Custom::AWS')
assert(cleanup)
const assets = JSON.parse(fs.readFileSync('cdk.out/Refugio593LatencyTrial.assets.json', 'utf8'))
const asset = Object.values(assets.files).find((item) => item.source.packaging === 'zip' && fs.existsSync(`cdk.out/${item.source.path}/runner.sh`))
assert(asset)
const directory = `cdk.out/${asset.source.path}`
for (const file of ['runner.sh', 'scripts/run-http-fire-drill.mjs', 'scripts/summarize-managed-trial.mjs', 'scripts/http2-fetch.mjs', 'scripts/rubric.mjs', 'web/simulator-client.mjs']) assert(fs.existsSync(`${directory}/${file}`))
assert(!fs.existsSync(`${directory}/README.md`))
assert(!fs.existsSync(`${directory}/tmp`))
console.log('Managed trial: isolated source package, secret reference, encrypted logs, timeout, single build and scoped cleanup verified.')
