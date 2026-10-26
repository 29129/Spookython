import * as path from 'node:path'
import * as cdk from 'aws-cdk-lib'
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2'
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as logs from 'aws-cdk-lib/aws-logs'
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
    })

    const apiLogGroup = new logs.LogGroup(this, 'ApiHandlerLogGroup', {
      logGroupName: '/aws/lambda/spookython-api-handler',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })
    const apiHandler = new lambda.Function(this, 'ApiHandler', {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      functionName: 'spookython-api-handler',
      logGroup: apiLogGroup,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../src')),
      memorySize: 512,
      timeout: cdk.Duration.seconds(3),
      environment: {
        MAP_VERSION: '1',
        WORLD_STATE_TABLE_NAME: worldStateTable.tableName,
      },
    })

    const api = new apigwv2.HttpApi(this, 'SpookythonHttpApi', {
      apiName: 'spookython-api',
      description: 'API pública del simulador Spookython',
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [apigwv2.CorsHttpMethod.GET],
        allowHeaders: ['content-type'],
        maxAge: cdk.Duration.hours(1),
      },
    })
    const integration = new HttpLambdaIntegration('ApiIntegration', apiHandler)
    api.addRoutes({ path: '/health', methods: [apigwv2.HttpMethod.GET], integration })
    api.addRoutes({ path: '/map', methods: [apigwv2.HttpMethod.GET], integration })

    new cdk.CfnOutput(this, 'ApiBaseUrl', { value: api.apiEndpoint })
    new cdk.CfnOutput(this, 'WorldStateTableName', { value: worldStateTable.tableName })

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
