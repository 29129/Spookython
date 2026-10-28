import * as fs from 'node:fs'
import * as path from 'node:path'
import * as cdk from 'aws-cdk-lib'
import * as codebuild from 'aws-cdk-lib/aws-codebuild'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as kms from 'aws-cdk-lib/aws-kms'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as assets from 'aws-cdk-lib/aws-s3-assets'
import * as scheduler from 'aws-cdk-lib/aws-scheduler'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import * as custom from 'aws-cdk-lib/custom-resources'
import { Construct } from 'constructs'

export class LatencyTrialStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)
    const functionArn = this.formatArn({ service: 'lambda', resource: 'function', resourceName: 'spookython-api-handler', arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME })
    const aliasArn = `${functionArn}:prepared`
    const projectName = 'refugio593-latency-final'
    const secretName = 'refugio593/latency-final-key'
    const resultBucket = s3.Bucket.fromBucketName(this, 'Results', `refugio593-trial-${this.account}-${this.region}`)
    const secret = secretsmanager.Secret.fromSecretNameV2(this, 'ControlKey', secretName)
    const logKey = new kms.Key(this, 'LogKey', { enableKeyRotation: true, removalPolicy: cdk.RemovalPolicy.DESTROY,
      pendingWindow: cdk.Duration.days(7) })
    const groupName = '/aws/codebuild/refugio593-latency-final'
    logKey.addToResourcePolicy(new iam.PolicyStatement({ principals: [new iam.ServicePrincipal(`logs.${this.region}.amazonaws.com`)],
      actions: ['kms:Encrypt*', 'kms:Decrypt*', 'kms:ReEncrypt*', 'kms:GenerateDataKey*', 'kms:Describe*'], resources: ['*'],
      conditions: { ArnEquals: { 'kms:EncryptionContext:aws:logs:arn': this.formatArn({ service: 'logs', resource: 'log-group', resourceName: groupName, arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME }) } } }))
    const buildLogs = new logs.LogGroup(this, 'BuildLogs', { logGroupName: groupName, encryptionKey: logKey,
      retention: logs.RetentionDays.ONE_WEEK, removalPolicy: cdk.RemovalPolicy.DESTROY })
    const scheduleGroup = new scheduler.CfnScheduleGroup(this, 'CleanupSchedules', { name: 'refugio593-latency-cleanup' })
    const scheduleGroupArn = this.formatArn({ service: 'scheduler', resource: 'schedule-group', resourceName: scheduleGroup.ref })
    const cleanupRole = new iam.Role(this, 'CleanupRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com', { conditions: {
        StringEquals: { 'aws:SourceAccount': this.account }, ArnEquals: { 'aws:SourceArn': scheduleGroupArn },
      } }),
    })
    cleanupRole.addToPolicy(new iam.PolicyStatement({ actions: ['lambda:DeleteProvisionedConcurrencyConfig'], resources: [aliasArn] }))
    const sourceRoot = path.resolve(__dirname, '../../')
    const source = new assets.Asset(this, 'RunnerSource', {
      path: path.join(sourceRoot, 'diagnostics/runner'),
      assetHashType: cdk.AssetHashType.OUTPUT,
      bundling: { image: cdk.DockerImage.fromRegistry('public.ecr.aws/docker/library/node:22'),
        local: { tryBundle(outputDirectory: string) {
          for (const file of ['scripts/run-http-fire-drill.mjs', 'scripts/http2-fetch.mjs', 'scripts/rubric.mjs',
            'scripts/summarize-managed-trial.mjs', 'web/simulator-client.mjs']) {
            const destination = path.join(outputDirectory, file)
            fs.mkdirSync(path.dirname(destination), { recursive: true })
            fs.writeFileSync(destination, fs.readFileSync(path.join(sourceRoot, file), 'utf8').replace(/\r\n/g, '\n'))
          }
          fs.writeFileSync(path.join(outputDirectory, 'runner.sh'), fs.readFileSync(path.join(sourceRoot, 'diagnostics/runner/runner.sh'), 'utf8').replace(/\r\n/g, '\n'))
          return true
        } },
      },
    })
    const projectArn = this.formatArn({ service: 'codebuild', resource: 'project', resourceName: projectName })
    const buildRole = new iam.Role(this, 'BuildRole', { assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com', {
      conditions: { StringEquals: { 'aws:SourceAccount': this.account }, ArnEquals: { 'aws:SourceArn': projectArn } },
    }) })
    buildRole.addToPolicy(new iam.PolicyStatement({ actions: ['lambda:GetProvisionedConcurrencyConfig', 'lambda:PutProvisionedConcurrencyConfig', 'lambda:DeleteProvisionedConcurrencyConfig'], resources: [aliasArn] }))
    const scheduleArn = this.formatArn({ service: 'scheduler', resource: 'schedule', resourceName: `${scheduleGroup.ref}/final-*` })
    buildRole.addToPolicy(new iam.PolicyStatement({ actions: ['scheduler:CreateSchedule', 'scheduler:DeleteSchedule'], resources: [scheduleArn] }))
    buildRole.addToPolicy(new iam.PolicyStatement({ actions: ['iam:PassRole'], resources: [cleanupRole.roleArn], conditions: { StringEquals: { 'iam:PassedToService': 'scheduler.amazonaws.com' } } }))
    secret.grantRead(buildRole)
    buildRole.addToPolicy(new iam.PolicyStatement({ actions: ['secretsmanager:DeleteSecret'], resources: [
      this.formatArn({ service: 'secretsmanager', resource: 'secret', resourceName: `${secretName}-??????`, arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME }),
    ] }))
    resultBucket.grantPut(buildRole, 'runs/*')
    resultBucket.grantPut(buildRole, 'latest/summary.json')
    new codebuild.Project(this, 'Trial', { projectName, role: buildRole,
      source: codebuild.Source.s3({ bucket: source.bucket, path: source.s3ObjectKey }),
      environment: { buildImage: codebuild.LinuxBuildImage.STANDARD_7_0, computeType: codebuild.ComputeType.SMALL, privileged: false },
      environmentVariables: {
        SIMULATOR_API_KEY: { type: codebuild.BuildEnvironmentVariableType.SECRETS_MANAGER, value: `${secretName}:apiKey` },
        TRIAL_SECRET_NAME: { value: secretName }, RESULT_BUCKET: { value: resultBucket.bucketName },
        WATCHDOG_GROUP: { value: scheduleGroup.ref }, WATCHDOG_ROLE_ARN: { value: cleanupRole.roleArn },
      },
      logging: { cloudWatch: { logGroup: buildLogs } },
      timeout: cdk.Duration.minutes(12), queuedTimeout: cdk.Duration.minutes(5), concurrentBuildLimit: 1,
      buildSpec: codebuild.BuildSpec.fromObject({ version: '0.2', phases: {
        install: { 'runtime-versions': { nodejs: 22 } }, build: { commands: ['bash runner.sh'] },
      } }),
    })
    // Destroying the diagnostic stack also removes capacity if a build was interrupted.
    new custom.AwsCustomResource(this, 'DeleteCapacityOnDestroy', {
      onDelete: { service: 'Lambda', action: 'deleteProvisionedConcurrencyConfig',
        parameters: { FunctionName: 'spookython-api-handler', Qualifier: 'prepared' },
        ignoreErrorCodesMatching: 'ResourceNotFoundException|ProvisionedConcurrencyConfigNotFoundException' },
      policy: custom.AwsCustomResourcePolicy.fromSdkCalls({ resources: [aliasArn] }), installLatestAwsSdk: false,
    })
    new cdk.CfnOutput(this, 'ProjectName', { value: projectName })
    new cdk.CfnOutput(this, 'SecretName', { value: secretName })
    new cdk.CfnOutput(this, 'ResultsBucket', { value: resultBucket.bucketName })
  }
}
