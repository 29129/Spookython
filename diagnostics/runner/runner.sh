#!/usr/bin/env bash
set -Eeuo pipefail
export AWS_PAGER='' AWS_CLI_AUTO_PROMPT=off
export SPOOKYTHON_API_BASE_URL='https://gkzb014d54.execute-api.us-east-1.amazonaws.com'
export MEASUREMENT_LOCATION='AWS-CodeBuild-us-east-1-general1.small'
mkdir -p reports/http
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-${CODEBUILD_BUILD_NUMBER:-0}"
WATCHDOG="final-${RUN_ID}"
OWNED_CAPACITY=0
WATCHDOG_CREATED=0
STAGE='preflight'

cleanup() {
  original_status=$?
  trap - EXIT
  cleanup_ok=true
  if [[ "$OWNED_CAPACITY" == 1 ]]; then
    if ! aws lambda delete-provisioned-concurrency-config --function-name spookython-api-handler --qualifier prepared > /tmp/pc-delete.json 2>/tmp/pc-delete.err; then
      if ! grep -Eq 'ResourceNotFoundException|ProvisionedConcurrencyConfigNotFoundException' /tmp/pc-delete.err; then cleanup_ok=false; fi
    fi
    if aws lambda get-provisioned-concurrency-config --function-name spookython-api-handler --qualifier prepared >/tmp/pc-check.json 2>/tmp/pc-check.err; then
      cleanup_ok=false
    elif ! grep -Eq 'ResourceNotFoundException|ProvisionedConcurrencyConfigNotFoundException' /tmp/pc-check.err; then
      cleanup_ok=false
    fi
  fi
  if [[ "$cleanup_ok" == true && "$WATCHDOG_CREATED" == 1 ]]; then
    aws scheduler delete-schedule --name "$WATCHDOG" --group-name "$WATCHDOG_GROUP" || true
  fi
  export TRIAL_CLEANUP_OK="$cleanup_ok" TRIAL_EXIT_STATUS="$original_status" TRIAL_STAGE="$STAGE" TRIAL_RUN_ID="$RUN_ID"
  node scripts/summarize-managed-trial.mjs || true
  aws s3 cp reports/http/ "s3://${RESULT_BUCKET}/runs/${RUN_ID}/" --recursive --exclude '*' --include '*.json' || cleanup_ok=false
  if [[ -f reports/http/summary.json ]]; then
    aws s3 cp reports/http/summary.json "s3://${RESULT_BUCKET}/latest/summary.json" --content-type application/json --cache-control no-store || cleanup_ok=false
  fi
  # This secret is dedicated to this one-shot diagnostic, not the API's hash.
  aws secretsmanager delete-secret --secret-id "$TRIAL_SECRET_NAME" --force-delete-without-recovery >/dev/null || true
  echo "TRIAL_FINISHED: capacity_cleanup=$TRIAL_CLEANUP_OK report_upload=$cleanup_ok stage=$STAGE"
  if [[ "$cleanup_ok" != true ]]; then exit 1; fi
  exit "$original_status"
}
trap cleanup EXIT

# Validate the secret without changing the world.
node -e 'fetch(process.env.SPOOKYTHON_API_BASE_URL+"/paso",{method:"POST",headers:{"content-type":"application/json","x-api-key":process.env.SIMULATOR_API_KEY},body:"{}",signal:AbortSignal.timeout(15000)}).then(async r=>{await r.arrayBuffer();if(r.status!==400)throw Error("Invalid diagnostic key, HTTP "+r.status)}).catch(e=>{console.error(e.message);process.exitCode=1})'
if aws lambda get-provisioned-concurrency-config --function-name spookython-api-handler --qualifier prepared >/tmp/existing-pc.json 2>/tmp/existing-pc.err; then
  echo 'Another prepared capacity configuration exists; no changes made.' >&2
  exit 1
elif ! grep -Eq 'ResourceNotFoundException|ProvisionedConcurrencyConfigNotFoundException' /tmp/existing-pc.err; then
  echo 'Cannot verify absence of prepared capacity; no changes made.' >&2
  exit 1
fi

measure() {
  local name="$1"
  export TRIAL_SAMPLE_STARTED="$(node -e 'process.stdout.write(String(Date.now()))')"
  node scripts/run-http-fire-drill.mjs --round=3 --fast --max-turns=12 --http2 --http2-connections=2 || true
  test -f reports/http/fire-drill-base-turns-12-http2-2connections-latest.json
  node -e 'const r=require("./reports/http/fire-drill-base-turns-12-http2-2connections-latest.json");if(!Number.isFinite(Date.parse(r.generatedAt))||Date.parse(r.generatedAt)<Number(process.env.TRIAL_SAMPLE_STARTED)||r.baseUrl!==process.env.SPOOKYTHON_API_BASE_URL)throw Error("Missing fresh sample")'
  cp reports/http/fire-drill-base-turns-12-http2-2connections-latest.json "reports/http/${name}.json"
}
STAGE='baseline'
measure baseline

# Arm a service-side cleanup BEFORE allocating paid capacity.
export WATCHDOG_AT="$(date -u -d '+15 minutes' +%Y-%m-%dT%H:%M:%S)"
node -e 'require("fs").writeFileSync("/tmp/watchdog-target.json",JSON.stringify({Arn:"arn:aws:scheduler:::aws-sdk:lambda:deleteProvisionedConcurrencyConfig",RoleArn:process.env.WATCHDOG_ROLE_ARN,Input:JSON.stringify({FunctionName:"spookython-api-handler",Qualifier:"prepared"}),RetryPolicy:{MaximumEventAgeInSeconds:3600,MaximumRetryAttempts:10}}))'
aws scheduler create-schedule --name "$WATCHDOG" --group-name "$WATCHDOG_GROUP" --schedule-expression "at(${WATCHDOG_AT})" --schedule-expression-timezone UTC --flexible-time-window '{"Mode":"OFF"}' --action-after-completion DELETE --target file:///tmp/watchdog-target.json >/tmp/watchdog.json
WATCHDOG_CREATED=1
OWNED_CAPACITY=1
STAGE='preparing'
deadline=$((SECONDS+420))
for count in 50 100 150 200; do
  echo "PREPARING $count environments through Lambda API"
  aws lambda put-provisioned-concurrency-config --function-name spookython-api-handler --qualifier prepared --provisioned-concurrent-executions "$count" >/tmp/pc-put.json
  while true; do
    aws lambda get-provisioned-concurrency-config --function-name spookython-api-handler --qualifier prepared >/tmp/pc-status.json
    status=$(node -e 'process.stdout.write(require("/tmp/pc-status.json").Status)')
    if [[ "$status" == 'FAILED' ]]; then echo 'Capacity preparation failed' >&2; exit 2; fi
    if [[ "$status" == 'READY' ]] && node -e 'const r=require("/tmp/pc-status.json");process.exit(r.AllocatedProvisionedConcurrentExecutions>=Number(process.argv[1])&&r.AvailableProvisionedConcurrentExecutions>=Number(process.argv[1])?0:1)' "$count"; then break; fi
    if (( SECONDS >= deadline )); then echo 'Preparation deadline reached; baseline preserved' >&2; exit 2; fi
    sleep 5
  done
done
STAGE='prepared'
measure prepared
STAGE='completed'
