[CmdletBinding()]
param([string]$Profile = 'cdk-developer', [ValidateRange(60, 600)][int]$WindowSeconds = 300)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$projectDirectory = Split-Path -Parent $PSScriptRoot
$stopPath = Join-Path $projectDirectory 'tmp/regional-prepared-stop'
$readyPath = Join-Path $projectDirectory 'tmp/regional-prepared-ready.json'
$started = [DateTimeOffset]::UtcNow
$activationAttempted = $false
$cleanupSucceeded = $false
Push-Location -LiteralPath $projectDirectory
try {
    New-Item -ItemType Directory -Path (Join-Path $projectDirectory 'tmp') -Force | Out-Null
    foreach ($marker in @($stopPath, $readyPath)) {
        if (Test-Path -LiteralPath $marker) { Remove-Item -LiteralPath $marker }
    }
    # Reuse the production helper to preserve key hash, budget and memory settings.
    # No raw simulator key is required to prepare capacity.
    & ./scripts/deploy-production.ps1 -Action Diff -Profile $Profile
    if ($LASTEXITCODE -ne 0) { throw 'Fallo la comprobacion inicial; no se activa capacidad.' }
    & node scripts/validate-lambda-bundle.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Paquete Lambda invalido; no se activa capacidad.' }
    Write-Host 'Prueba temporal: hasta 200 entornos ARM de 1 GB. La capacidad genera cargos mientras esta activa.'
    Write-Host "Ventana regional: $WindowSeconds segundos despues de completar la preparacion; luego retirada automatica."
    $activationAttempted = $true
    foreach ($count in @(50, 100, 150, 200)) {
        $env:SPOOKYTHON_PROVISIONED_CONCURRENCY = [string]$count
        & npx.cmd cdk diff SpookythonStack --profile $Profile --method=template
        if ($LASTEXITCODE -ne 0) { throw "Fallo el diff de la etapa $count." }
        & npx.cmd cdk deploy SpookythonStack --profile $Profile --require-approval never
        if ($LASTEXITCODE -ne 0) { throw "Fallo la activacion de $count entornos." }
    }
    $probe = Invoke-WebRequest -Uri 'https://gkzb014d54.execute-api.us-east-1.amazonaws.com/health' -TimeoutSec 20
    if ($probe.Headers['x-lambda-qualifier'] -notcontains 'prepared' -or $probe.Headers['x-lambda-init-type'] -notcontains 'provisioned-concurrency') {
        throw 'La API no confirma alias prepared y capacidad preparada; no se abre la ventana.'
    }
    $ready = [DateTimeOffset]::UtcNow
    $expires = $ready.AddSeconds($WindowSeconds)
    @{readyAt=$ready.ToString('o'); expiresAt=$expires.ToString('o'); count=200;
      endpoint='https://gkzb014d54.execute-api.us-east-1.amazonaws.com'} | ConvertTo-Json | Set-Content -LiteralPath $readyPath -Encoding utf8
    Write-Host "REGIONAL_READY: ejecutar prueba en CloudShell ahora. Retirada a $($expires.ToString('o'))."
    while ([DateTimeOffset]::UtcNow -lt $expires -and -not (Test-Path -LiteralPath $stopPath)) { Start-Sleep -Seconds 2 }
} finally {
    $env:SPOOKYTHON_PROVISIONED_CONCURRENCY = '0'
    if ($activationAttempted) {
        Write-Host 'REGIONAL_CLEANUP: retirando capacidad pagada y alias preparado...'
        & npx.cmd cdk deploy SpookythonStack --profile $Profile --require-approval never
        $cleanupSucceeded = $LASTEXITCODE -eq 0
        if (-not $cleanupSucceeded) { Write-Warning 'Retirada fallida: revisar y retirar capacidad del alias prepared inmediatamente.' }
    }
    $receipt = @{startedAt=$started.ToString('o'); finishedAt=[DateTimeOffset]::UtcNow.ToString('o');
      activationAttempted=$activationAttempted; cleanupDeploymentSucceeded=$cleanupSucceeded;
      regionalWindowSeconds=$WindowSeconds; capacityCount=200; memoryMb=1024; measurement='User CloudShell terminal; report pending'}
    $receipt | ConvertTo-Json | Set-Content -LiteralPath 'reports/http/regional-prepared-cleanup-latest.json' -Encoding utf8
    Write-Host "REGIONAL_FINISHED: cleanupDeploymentSucceeded=$cleanupSucceeded"
    Pop-Location
}
