import * as path from 'node:path'
import * as cdk from 'aws-cdk-lib'
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2'
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment'
import { Construct } from 'constructs'

export class SpookythonStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    const worldStateTable = new dynamodb.Table(this, 'WorldStateTable', {
      partitionKey: { name: 'worldId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'entityId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: false },
      timeToLiveAttribute: 'expiresAt',
    })

    const apiLogGroup = new logs.LogGroup(this, 'ApiHandlerLogGroup', {
      logGroupName: '/aws/lambda/spookython-api-handler',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })
    const apiMemoryMb = Number(process.env.SPOOKYTHON_LAMBDA_MEMORY_MB || 512)
    if (![512, 1024, 1769].includes(apiMemoryMb)) throw new Error('SPOOKYTHON_LAMBDA_MEMORY_MB debe ser 512, 1024 o 1769.')
    const apiHandler = new nodejs.NodejsFunction(this, 'ApiHandler', {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      functionName: 'spookython-api-handler',
      logGroup: apiLogGroup,
      entry: path.join(__dirname, '../../src/lambda-entry.mjs'),
      bundling: { bundleAwsSDK: true, minify: true, sourceMap: false, format: nodejs.OutputFormat.ESM,
        // Single quotes survive Windows cmd escaping in CDK's esbuild CLI.
        banner: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
      memorySize: apiMemoryMb,
      timeout: cdk.Duration.seconds(8),
      environment: {
        MAP_VERSION: 'manta-600-v2',
        DEPLOYMENT_LABEL: process.env.SPOOKYTHON_DEPLOYMENT_LABEL || 'default',
        WORLD_STATE_TABLE_NAME: worldStateTable.tableName,
        SIMULATOR_API_KEY_SHA256: process.env.SIMULATOR_API_KEY_SHA256 || '',
      },
    })
    worldStateTable.grant(apiHandler, 'dynamodb:GetItem', 'dynamodb:PutItem')
    // Opt-in only: pre-initialized environments have an ongoing capacity charge.
    const provisionedCount = Number(process.env.SPOOKYTHON_PROVISIONED_CONCURRENCY || 0)
    if (![0, 50, 100, 150, 200].includes(provisionedCount)) throw new Error('SPOOKYTHON_PROVISIONED_CONCURRENCY debe ser 0, 50, 100, 150 o 200; los valores positivos tienen costo continuo.')
    const apiTarget = provisionedCount > 0 ? new lambda.Alias(this, 'PreparedApiAlias', {
      aliasName: 'prepared', version: apiHandler.currentVersion,
      provisionedConcurrentExecutions: provisionedCount,
    }) : apiHandler

    const api = new apigwv2.HttpApi(this, 'SpookythonHttpApi', {
      apiName: 'spookython-api',
      description: 'API pública del simulador Spookython',
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.POST],
        allowHeaders: ['content-type', 'x-api-key'],
        exposeHeaders: ['x-app-duration-ms', 'x-first-invocation', 'x-lambda-memory-mb', 'x-lambda-init-type', 'x-lambda-qualifier'],
        maxAge: cdk.Duration.hours(1),
      },
    })
    const integration = new HttpLambdaIntegration('ApiIntegration', apiTarget)
    api.addRoutes({ path: '/health', methods: [apigwv2.HttpMethod.GET], integration })
    api.addRoutes({ path: '/map', methods: [apigwv2.HttpMethod.GET], integration })
    api.addRoutes({ path: '/estado', methods: [apigwv2.HttpMethod.GET], integration })
    api.addRoutes({ path: '/estado/avanzar', methods: [apigwv2.HttpMethod.POST], integration })
    api.addRoutes({ path: '/paso', methods: [apigwv2.HttpMethod.POST], integration })
    api.addRoutes({ path: '/simulacion/reiniciar', methods: [apigwv2.HttpMethod.POST], integration })

    const webBucket = new s3.Bucket(this, 'WebAssetsBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    })
    const webDistribution = new cloudfront.Distribution(this, 'WebDistribution', {
      defaultRootObject: 'index.html',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(webBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        compress: true,
      },
      comment: 'Spookython mapa público',
    })
    new s3deploy.BucketDeployment(this, 'DeployWebAssets', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../web'))],
      destinationBucket: webBucket,
      distribution: webDistribution,
      distributionPaths: ['/*'],
      prune: true,
    })

    new cdk.CfnOutput(this, 'ApiBaseUrl', { value: api.apiEndpoint })
    new cdk.CfnOutput(this, 'WorldStateTableName', { value: worldStateTable.tableName })
    new cdk.CfnOutput(this, 'WebUrl', { value: `https://${webDistribution.distributionDomainName}` })

    const budgetEmail = process.env.BUDGET_ALERT_EMAIL
    const monthlyBudgetUsd = process.env.MONTHLY_BUDGET_USD
    if (budgetEmail && monthlyBudgetUsd) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(budgetEmail)) {
        throw new Error('BUDGET_ALERT_EMAIL no parece ser una dirección de correo válida.')
      }
      const budgetAmount = Number(monthlyBudgetUsd)
      if (!Number.isFinite(budgetAmount) || budgetAmount <= 0) {
        throw new Error('MONTHLY_BUDGET_USD debe ser un número positivo en USD.')
      }
      new cdk.aws_budgets.CfnBudget(this, 'MonthlyCostBudget', {
        budget: {
          budgetName: 'Spookython-Monthly-Cost',
          budgetLimit: { amount: budgetAmount, unit: 'USD' },
          timeUnit: 'MONTHLY',
          budgetType: 'COST',
        },
        notificationsWithSubscribers: [
          {
            notification: {
              notificationType: 'ACTUAL',
              comparisonOperator: 'GREATER_THAN',
              threshold: 80,
              thresholdType: 'PERCENTAGE',
            },
            subscribers: [{ subscriptionType: 'EMAIL', address: budgetEmail }],
          },
          {
            notification: {
              notificationType: 'FORECASTED',
              comparisonOperator: 'GREATER_THAN',
              threshold: 100,
              thresholdType: 'PERCENTAGE',
            },
            subscribers: [{ subscriptionType: 'EMAIL', address: budgetEmail }],
          },
        ],
      })
    }
  }
}
