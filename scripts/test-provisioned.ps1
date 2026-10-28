# User-authorized temporary paid diagnostic; cleanup runs even if the test fails.
[CmdletBinding()]
param([string]$Profile = 'cdk-developer', [switch]$CompareEdge)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$projectDirectory = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectDirectory
$transcriptStarted = $false
try {
    if (-not $env:SIMULATOR_API_KEY) {
        $env:SIMULATOR_API_KEY = Read-Host 'Pega tu clave de control guardada (no se muestra)' -MaskInput
    }
    if ([string]::IsNullOrWhiteSpace($env:SIMULATOR_API_KEY)) { throw 'Falta la clave. No se ha activado capacidad.' }
    $env:SIMULATOR_API_KEY_SHA256 = node -e "process.stdout.write(require('node:crypto').createHash('sha256').update(process.env.SIMULATOR_API_KEY).digest('hex'))"
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo calcular el hash.' }
    if (-not $env:BUDGET_ALERT_EMAIL) { $env:BUDGET_ALERT_EMAIL = 'jofredavidcedenoroldan450@gmail.com' }
    if (-not $env:MONTHLY_BUDGET_USD) { $env:MONTHLY_BUDGET_USD = '5' }
    if (-not $env:SPOOKYTHON_API_BASE_URL) { $env:SPOOKYTHON_API_BASE_URL = 'https://gkzb014d54.execute-api.us-east-1.amazonaws.com' }
    $env:SPOOKYTHON_LAMBDA_MEMORY_MB = '1024'
    $env:SPOOKYTHON_DEPLOYMENT_LABEL = 'prepared-trial-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
    $trialStarted = [DateTimeOffset]::UtcNow
    $cleanupSucceeded = $false
    $deploymentAttempted = $false
    $reportCopy = $null
    $transcriptDirectory = Join-Path $projectDirectory 'tmp/provisioned-trial-logs'
    New-Item -ItemType Directory -Path $transcriptDirectory -Force | Out-Null
    $transcriptPath = Join-Path $transcriptDirectory ('trial-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '.log')
    # Start after masked input and hashing: never write the raw key to this log.
    Start-Transcript -LiteralPath $transcriptPath | Out-Null
    $transcriptStarted = $true
    Write-Host "Registro de despliegues y prueba: $transcriptPath"
    try {
        Write-Host 'Comprobando el paquete exacto de CDK antes de activar capacidad pagada...'
        $env:SPOOKYTHON_PROVISIONED_CONCURRENCY = '0'
        & npx.cmd cdk synth SpookythonStack --profile $Profile --no-lookups --quiet
        if ($LASTEXITCODE -ne 0) { throw 'Fallo la sintesis. No se ha intentado activar capacidad pagada.' }
        & node scripts/validate-lambda-bundle.mjs
        if ($LASTEXITCODE -ne 0) { throw 'Paquete CDK invalido. No se ha intentado activar capacidad pagada.' }
        Write-Host 'Activacion gradual 50/100/150/200 entornos de 1 GB; hasta USD 2,40/h de capacidad al llegar a 200.'
        Write-Host 'No cierres esta terminal. La prueba reinicia el mundo; pausa el controlador web.'
        $deploymentAttempted = $true
        foreach ($stage in @(50, 100, 150, 200)) {
            $env:SPOOKYTHON_PROVISIONED_CONCURRENCY = [string]$stage
            Write-Host "Preparando etapa de $stage entornos. El ensayo comienza solo al completar 200."
            & npx.cmd cdk deploy SpookythonStack --profile $Profile --require-approval never
            if ($LASTEXITCODE -ne 0) { throw "Fallo la activacion en etapa $stage. Se intentara retirar toda la capacidad." }
        }
        if ($CompareEdge) {
            & node scripts/compare-api-latency.mjs
        } else {
            & node scripts/run-http-fire-drill.mjs --round=3 --fast --max-turns=12 --http2 --http2-connections=2
        }
        $diagnosticExitCode = $LASTEXITCODE
        # Exit 1 can mean a deliberately incomplete 12-turn round. Always preserve its evidence.
        $reportSource = Join-Path $projectDirectory 'reports/http/fire-drill-base-turns-12-http2-2connections-latest.json'
        if (-not (Test-Path -LiteralPath $reportSource)) { throw 'El diagnóstico no produjo reporte.' }
        $reportText = [System.IO.File]::ReadAllText($reportSource)
        $report = $reportText | ConvertFrom-Json
        $reportTimestamp = [regex]::Match($reportText, '"generatedAt"\s*:\s*"([^"]+)"').Groups[1].Value
        $reportTime = [DateTimeOffset]::Parse($reportTimestamp, [Globalization.CultureInfo]::InvariantCulture)
        if ($reportTime -lt $trialStarted) { throw 'El archivo encontrado es anterior al ensayo; no se usará como evidencia nueva.' }
        $reportCopy = Join-Path $projectDirectory ('reports/http/fire-drill-base-provisioned-' + $reportTime.UtcDateTime.ToString('yyyyMMddTHHmmssZ') + '.json')
        Copy-Item -LiteralPath $reportSource -Destination $reportCopy
        Write-Host "Reporte de prueba: $reportCopy"
        Write-Host "Código diagnóstico: $diagnosticExitCode (una ronda incompleta puede devolver 1)."
        if (@($report.rounds[0].observedInitializationTypes) -notcontains 'provisioned-concurrency' -or @($report.rounds[0].observedQualifiers) -notcontains 'prepared') {
            Write-Warning 'El reporte no confirma alias prepared y entornos aprovisionados. No se dará por validada la configuración.'
        }
    } finally {
        $env:SPOOKYTHON_PROVISIONED_CONCURRENCY = '0'
        if ($deploymentAttempted) {
            Write-Host 'Retirando capacidad pagada y devolviendo API a modo bajo demanda...'
            & npx.cmd cdk deploy SpookythonStack --profile $Profile --require-approval never
            $cleanupSucceeded = $LASTEXITCODE -eq 0
            if ($cleanupSucceeded) {
                Write-Host 'RETIRADA COMPLETADA: CDK desplegó concurrencia aprovisionada = 0.' -ForegroundColor Green
            } else {
                Write-Warning 'RETIRADA FALLIDA: la capacidad podría seguir generando cargos. Comprueba Lambda > alias prepared > concurrencia aprovisionada y retírala. No ignores este aviso.'
            }
        }
        $trialReceipt = @{ startedAt = $trialStarted.ToString('o'); finishedAt = [DateTimeOffset]::UtcNow.ToString('o');
            activationAttempted = $deploymentAttempted; cleanupDeploymentSucceeded = $cleanupSucceeded;
            report = $reportCopy; capacityCount = 200; memoryMb = 1024; deploymentLog = $transcriptPath }
        $receiptPath = Join-Path $projectDirectory 'reports/http/provisioned-trial-cleanup-latest.json'
        New-Item -ItemType Directory -Path (Split-Path -Parent $receiptPath) -Force | Out-Null
        $trialReceipt | ConvertTo-Json | Set-Content -LiteralPath $receiptPath -Encoding utf8
    }
} finally {
    if ($transcriptStarted) { Stop-Transcript | Out-Null }
    Pop-Location
}
