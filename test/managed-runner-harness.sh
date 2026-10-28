#!/usr/bin/env bash
set -Eeuo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$repo/tmp"
harness=$(mktemp -d "$repo/tmp/managed-harness-XXXXXX")
export REAL_NODE="$(command -v node)"
export HARNESS_ROOT="$harness"
export RESULT_BUCKET=test-bucket WATCHDOG_GROUP=test-group WATCHDOG_ROLE_ARN=test-role TRIAL_SECRET_NAME=test-secret
export SIMULATOR_API_KEY=disposable-harness-key
aws() {
  echo "$*" >> "$HARNESS_ROOT/calls"
  case "$1 $2" in
    'lambda get-provisioned-concurrency-config')
      if [[ ! -f "$HARNESS_ROOT/pc" ]]; then echo ProvisionedConcurrencyConfigNotFoundException >&2; return 1; fi
      echo '{"Status":"READY","AllocatedProvisionedConcurrentExecutions":200,"AvailableProvisionedConcurrentExecutions":200}' ;;
    'lambda put-provisioned-concurrency-config')
      if [[ "${HARNESS_FAIL:-0}" == 1 && "${@: -1}" == 100 ]]; then echo 'Mocked preparation failure' >&2; return 1; fi
      echo active > "$HARNESS_ROOT/pc"; echo '{}' ;;
    'lambda delete-provisioned-concurrency-config') rm -f "$HARNESS_ROOT/pc"; echo '{}' ;;
    'scheduler create-schedule'|'scheduler delete-schedule'|'s3 cp'|'secretsmanager delete-secret') echo '{}' ;;
    *) echo "Unexpected mocked AWS operation: $1 $2" >&2; return 91 ;;
  esac
}
node() {
  if [[ "$1" == 'scripts/run-http-fire-drill.mjs' ]]; then
    local prepared=false
    [[ ! -f "$HARNESS_ROOT/pc" ]] || prepared=true
    HARNESS_IS_PREPARED="$prepared" "$REAL_NODE" -e 'const prepared=process.env.HARNESS_IS_PREPARED==="true";require("fs").writeFileSync("reports/http/fire-drill-base-turns-12-http2-2connections-latest.json",JSON.stringify({generatedAt:new Date().toISOString(),baseUrl:process.env.SPOOKYTHON_API_BASE_URL,rounds:[{calls:1800,p95HttpMs:prepared?95:250,errors:0,timeouts:0,invalidMoves:0,observedInitializationTypes:[prepared?"provisioned-concurrency":"on-demand"],observedQualifiers:["prepared"]}]}))'
    return
  fi
  if [[ "$1" == '-e' ]]; then
    case "$2" in
      *'fetch('*|*'writeFileSync("/tmp/watchdog-target.json"'*|*'AllocatedProvisionedConcurrentExecutions'*) return 0 ;;
      *'require("/tmp/pc-status.json").Status'*) echo READY; return 0 ;;
    esac
  fi
  "$REAL_NODE" "$@"
}
export -f aws node
mkdir -p "$harness/scripts"
cp "$repo/scripts/summarize-managed-trial.mjs" "$harness/scripts/"
cd "$harness"
bash "$repo/diagnostics/runner/runner.sh"
"$REAL_NODE" -e 'const r=require("./reports/http/summary.json");if(!r.cleanupSucceeded||!r.preparedVerified||r.p95HttpMs!==95||r.baseline.p95HttpMs!==250)throw Error("Invalid managed summary")'
test ! -f "$harness/pc"
grep -q 'scheduler create-schedule' "$harness/calls"
grep -q 'scheduler delete-schedule' "$harness/calls"
grep -q 's3 cp reports/http/summary.json' "$harness/calls"
echo 'Managed runner harness passed: baseline, preparation, measurement, cleanup and uploads; all AWS calls mocked.'
mkdir -p "$harness/failure/scripts"
cp "$repo/scripts/summarize-managed-trial.mjs" "$harness/failure/scripts/"
cd "$harness/failure"
export HARNESS_FAIL=1
if bash "$repo/diagnostics/runner/runner.sh"; then echo 'Expected a preparation failure' >&2; exit 1; fi
"$REAL_NODE" -e 'const r=require("./reports/http/summary.json");if(!r.cleanupSucceeded||r.preparedVerified||r.p95HttpMs!==250||r.selectedMeasurement!=="baseline")throw Error("Failed preparation lost the baseline or left capacity")'
test ! -f "$harness/pc"
echo 'Managed runner failure harness passed: preparation failure preserved baseline and removed capacity; all AWS calls mocked.'
