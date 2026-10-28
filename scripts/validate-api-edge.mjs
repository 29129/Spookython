import fs from 'node:fs'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { CachePolicy, OriginRequestPolicy } from 'aws-cdk-lib/aws-cloudfront'
const template = JSON.parse(fs.readFileSync('cdk.out/SpookythonStack.template.json', 'utf8'))
const resources = Object.values(template.Resources)
const distribution = resources.find((resource) => resource.Type === 'AWS::CloudFront::Distribution').Properties.DistributionConfig
const behavior = distribution.CacheBehaviors.find((item) => item.PathPattern === '/api/*')
assert(behavior)
assert.equal(behavior.CachePolicyId, CachePolicy.CACHING_DISABLED.cachePolicyId)
assert.equal(behavior.OriginRequestPolicyId, OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER.originRequestPolicyId)
assert(behavior.AllowedMethods.includes('POST'))
assert.equal(behavior.ViewerProtocolPolicy, 'https-only')
const origin = distribution.Origins.find((item) => item.Id === behavior.TargetOriginId)
assert.equal(origin.CustomOriginConfig.OriginProtocolPolicy, 'https-only')
assert.equal(origin.CustomOriginConfig.OriginKeepaliveTimeout, 60)
for (const status of [500, 502, 503, 504]) assert.equal(distribution.CustomErrorResponses.find((item) => item.ErrorCode === status).ErrorCachingMinTTL, 0)
const rewrite = resources.find((resource) => resource.Type === 'AWS::CloudFront::Function')
for (const uri of ['/api/paso', '/api/estado/avanzar', '/api/simulacion/reiniciar', '/api/health']) {
  const request = { uri, method: 'POST', headers: { 'x-api-key': { value: 'test-only' } }, querystring: { test: { value: '1' } } }
  const context = { event: { request } }
  const result = vm.runInNewContext(`${rewrite.Properties.FunctionCode}; handler(event)`, context)
  assert.equal(result.uri, uri.slice(4))
  assert.equal(result.headers['x-api-key'].value, 'test-only')
  assert.equal(result.querystring.test.value, '1')
}
assert(!resources.some((resource) => resource.Type === 'AWS::Lambda::Alias'))
console.log('API edge: HTTPS, sin cache, POST y x-api-key reenviados, prefijo correcto, capacidad pagada = 0.')
