param(
    [ValidateSet('Diff', 'Deploy')][string]$Action = 'Diff',
    [string]$Profile = 'cdk-developer'
)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$projectDirectory = Split-Path $PSScriptRoot -Parent
Push-Location $projectDirectory
try {
    if (-not $env:SIMULATOR_API_KEY) {
        # The owner explicitly published this simulator-only demo key for evaluation.
        $readmeText = [IO.File]::ReadAllText((Join-Path $projectDirectory 'README.md'))
        $keyMatch = [regex]::Match($readmeText, '(?s)## Acceso para evaluaci.n.*?```text\s*\r?\n([^\r\n]+)\r?\n\s*```')
        if ($keyMatch.Success -and $keyMatch.Groups[1].Value.Trim() -ne 'PEGA_AQUI_LA_CLAVE_DEL_SIMULADOR') {
            $env:SIMULATOR_API_KEY = $keyMatch.Groups[1].Value.Trim()
        }
    }
    if ($env:SIMULATOR_API_KEY) {
        $env:SIMULATOR_API_KEY_SHA256 = node -e "process.stdout.write(require('node:crypto').createHash('sha256').update(process.env.SIMULATOR_API_KEY).digest('hex'))"
        if ($LASTEXITCODE -ne 0) { throw 'No se pudo calcular el hash de la clave.' }
    }
    if (-not $env:SIMULATOR_API_KEY_SHA256) {
        $referencePath = Join-Path $projectDirectory 'tmp/production-reference-template.json'
        if (Test-Path -LiteralPath $referencePath) {
            $reference = [IO.File]::ReadAllText($referencePath) | ConvertFrom-Json
            $referenceFunction = $reference.Resources.PSObject.Properties.Value | Where-Object { $_.Type -eq 'AWS::Lambda::Function' -and $_.Properties.FunctionName -eq 'spookython-api-handler' } | Select-Object -First 1
            $env:SIMULATOR_API_KEY_SHA256 = $referenceFunction.Properties.Environment.Variables.SIMULATOR_API_KEY_SHA256
            Write-Host 'Se conserva el hash de la plantilla del ultimo despliegue, sin recuperar ni cambiar la clave.'
        }
    }
    if ($env:SIMULATOR_API_KEY_SHA256 -notmatch '^[a-f0-9]{64}$') { throw 'Configura SIMULATOR_API_KEY o su hash vigente antes de desplegar.' }
    if (-not $env:BUDGET_ALERT_EMAIL) { $env:BUDGET_ALERT_EMAIL = 'jofredavidcedenoroldan450@gmail.com' }
    if (-not $env:MONTHLY_BUDGET_USD) { $env:MONTHLY_BUDGET_USD = '5' }
    $env:SPOOKYTHON_LAMBDA_MEMORY_MB = '1024'
    $env:SPOOKYTHON_PROVISIONED_CONCURRENCY = '0'
    $env:SPOOKYTHON_DEPLOYMENT_LABEL = 'refugio-600-20261028'
    Write-Host 'Refugio 593: mapa de 600 nodos, Lambda 1024 MB, capacidad bajo demanda. No se imprime la clave.'
    if ($Action -eq 'Diff') {
        & npx.cmd cdk diff SpookythonStack --profile $Profile
        if ($LASTEXITCODE -ne 0) { throw 'No se pudo completar cdk diff. No se ha desplegado.' }
        return
    }
    & npx.cmd cdk synth SpookythonStack --profile $Profile --no-lookups --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Fallo la sintesis; no se despliega.' }
    & node scripts/validate-lambda-bundle.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Paquete Lambda invalido; no se despliega.' }
    & npx.cmd cdk deploy SpookythonStack --profile $Profile --require-approval never
    if ($LASTEXITCODE -ne 0) { throw 'Fallo el despliegue. Revisar los eventos del stack antes de reintentar.' }
    $base = 'https://gkzb014d54.execute-api.us-east-1.amazonaws.com'
    $headers = @{ 'x-api-key' = $env:SIMULATOR_API_KEY }
    $map = Invoke-RestMethod -Uri "$base/map"
    if ($map.nodes.Count -ne 600 -or $map.streets.Count -ne 868) { throw 'AWS no devuelve el mapa esperado de 600 nodos y 868 calles.' }
    if (-not $env:SIMULATOR_API_KEY) {
        Write-Host 'PRODUCCION ACTUALIZADA: mapa verificado. Falta pulsar Preparar nueva ronda con tu clave en la web.'
        return
    }
    $state = Invoke-RestMethod -Uri "$base/simulacion/reiniciar" -Method POST -Headers $headers -ContentType 'application/json' -Body '{"round":1,"pro":false}'
    if ($state.turn -ne 0 -or $state.survivors.Count -ne 20) { throw 'La nueva ronda no devolvio el estado esperado.' }
    Write-Host 'PRODUCCION ACTUALIZADA: 600 intersecciones, 868 calles y ronda base preparada desde turno 0.'
    Write-Host 'Web: https://d2qqi0nkfeyck5.cloudfront.net'
} finally { Pop-Location }
