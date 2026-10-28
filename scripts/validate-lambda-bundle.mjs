import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const directory = path.resolve(process.argv[2] || 'cdk.out')
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'SpookythonStack.assets.json'), 'utf8'))
let checked = 0
function runNode(args, env = process.env) {
  try { execFileSync(process.execPath, args, {stdio:'pipe', env}) }
  catch (error) {
    const detail = error.stderr?.toString().split('\n').find((line) => /^(SyntaxError|Error|TypeError|ReferenceError):/.test(line))
    throw new Error(`Paquete CDK rechazado: ${detail || 'fallo la comprobacion de sintaxis o importacion'}`)
  }
}
for (const asset of Object.values(manifest.files || {})) {
  if (asset.source.packaging !== 'zip' || !asset.source.path) continue
  const diagnostic = path.resolve(directory, asset.source.path, 'index.js')
  if (fs.existsSync(diagnostic) && fs.readFileSync(diagnostic, 'utf8').includes('diagnostic_start_error')) {
    runNode(['--check', diagnostic])
    runNode(['-e', `const api=require(${JSON.stringify(diagnostic)});api.handler({requestContext:{http:{method:'GET'}}}).then(r=>{if(r.statusCode!==404)process.exit(1)})`])
    console.log('Diagnostic starter: exact CJS artifact syntax and import verified.')
  }
  const entry = path.resolve(directory, asset.source.path, 'index.mjs')
  if (!fs.existsSync(entry)) continue
  runNode(['--check', entry])
  // Import the exact CDK artifact, not a separately built approximation.
  // on-demand + GET /health ensures this check does not contact DynamoDB/AWS.
  const code = `const api=await import(${JSON.stringify(pathToFileURL(entry).href)});const r=await api.handler({rawPath:'/health',requestContext:{http:{method:'GET'}}});if(r.statusCode!==200)throw Error('GET /health no responde 200');`
  runNode(['--input-type=module', '-e', code], {...process.env, AWS_LAMBDA_INITIALIZATION_TYPE:'on-demand', AWS_LAMBDA_FUNCTION_NAME:''})
  checked += 1
  console.log(`CDK bundle validado: sintaxis, importacion ESM y /health 200 (${path.relative(directory, entry)}).`)
}
if (!checked) throw new Error('No se encontro el paquete Lambda index.mjs en el manifiesto de CDK.')
