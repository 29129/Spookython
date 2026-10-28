import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

test('el control de artefacto rechaza el banner sin comillas que falló en Lambda y acepta ESM válido', () => {
  fs.mkdirSync('tmp/bundle-validation', {recursive:true})
  const root = fs.mkdtempSync(path.resolve('tmp/bundle-validation/artifact-'))
  fs.mkdirSync(path.join(root,'asset'))
  fs.writeFileSync(path.join(root,'SpookythonStack.assets.json'), JSON.stringify({files:{example:{source:{packaging:'zip',path:'asset'}}}}))
  const entry = path.join(root,'asset/index.mjs')
  const validate = () => spawnSync(process.execPath,['scripts/validate-lambda-bundle.mjs',root],{encoding:'utf8'})
  fs.writeFileSync(entry, 'import { createRequire } from node:module; export const handler=async()=>({statusCode:200});')
  const invalid = validate()
  assert.notEqual(invalid.status,0)
  assert.match(invalid.stderr,/Unexpected identifier 'node'/)
  fs.writeFileSync(entry, "import { createRequire } from 'node:module'; const require=createRequire(import.meta.url); export const handler=async()=>({statusCode:200});")
  const valid = validate()
  assert.equal(valid.status,0,valid.stderr)
})
