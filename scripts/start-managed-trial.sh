#!/usr/bin/env bash
set -Eeuo pipefail
export AWS_PAGER='' AWS_CLI_AUTO_PROMPT=off AWS_DEFAULT_REGION=us-east-1
if [[ -z "${SIMULATOR_API_KEY:-}" ]]; then
  read -r -s -p 'Clave de control (no se muestra): ' SIMULATOR_API_KEY
  echo
fi
export SIMULATOR_API_KEY
node -e 'fetch("https://gkzb014d54.execute-api.us-east-1.amazonaws.com/paso",{method:"POST",headers:{"content-type":"application/json","x-api-key":process.env.SIMULATOR_API_KEY},body:"{}",signal:AbortSignal.timeout(15000)}).then(async r=>{await r.arrayBuffer();if(r.status!==400)throw Error("Clave no valida, HTTP "+r.status)}).catch(e=>{console.error(e.message);process.exitCode=1})'
umask 077
trial_temp=$(mktemp -d)
trap 'rm -f "$trial_temp/key.json" "$trial_temp/secret.err"; rmdir "$trial_temp" 2>/dev/null || true; unset SIMULATOR_API_KEY' EXIT
node -e 'require("fs").writeFileSync(process.argv[1],JSON.stringify({apiKey:process.env.SIMULATOR_API_KEY}),{mode:0o600})' "$trial_temp/key.json"
secret_name='refugio593/latency-final-key'
if aws secretsmanager describe-secret --secret-id "$secret_name" >/dev/null 2>"$trial_temp/secret.err"; then
  aws secretsmanager put-secret-value --secret-id "$secret_name" --secret-string "file://$trial_temp/key.json" >/dev/null
else
  if ! grep -q 'ResourceNotFoundException' "$trial_temp/secret.err"; then
    cat "$trial_temp/secret.err" >&2
    exit 1
  fi
  aws secretsmanager create-secret --name "$secret_name" --secret-string "file://$trial_temp/key.json" >/dev/null
fi
rm -f "$trial_temp/secret.err"
if ! aws codebuild start-build --project-name refugio593-latency-final --idempotency-token refugio593-final-20261028 --query 'build.{id:id,status:buildStatus}' --output json; then
  aws secretsmanager delete-secret --secret-id "$secret_name" --force-delete-without-recovery >/dev/null || true
  exit 1
fi
echo 'Trabajo iniciado en AWS. Ya no depende de que CloudShell permanezca abierto.'
echo 'Resumen: https://d2qqi0nkfeyck5.cloudfront.net/evidence/summary.json'
