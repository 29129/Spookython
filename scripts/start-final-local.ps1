$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$receiptPath = Join-Path $projectDirectory 'tmp/managed-trial-local-start.json'
New-Item -ItemType Directory -Path (Split-Path -Parent $receiptPath) -Force | Out-Null
$secureKey = $null
$headers = @{}
try {
    Write-Host 'REFUGIO 593 - ultima prueba regional en AWS'
    Write-Host 'La clave se usa solo para iniciar el trabajo. No se guarda en este archivo ni se muestra.'
    Write-Host 'El trabajo genera cargos temporales y retira la capacidad al terminar.'
    $secureKey = Read-Host 'Pega la clave de control y pulsa Enter' -AsSecureString
    $headers['x-api-key'] = [System.Net.NetworkCredential]::new('', $secureKey).Password
    $result = Invoke-RestMethod -Uri 'https://gkzb014d54.execute-api.us-east-1.amazonaws.com/diagnostico/prueba-final' -Method POST -Headers $headers -ContentType 'application/json' -Body '{}' -TimeoutSec 60
    @{status='STARTED'; startedAt=[DateTime]::UtcNow.ToString('o'); buildId=$result.buildId; summaryUrl=$result.summaryUrl} | ConvertTo-Json | Set-Content -LiteralPath $receiptPath -Encoding utf8
    Write-Host 'TRABAJO INICIADO EN AWS. Puedes cerrar esta ventana.' -ForegroundColor Green
    Write-Host $result.buildId
} catch {
    @{status='FAILED'; checkedAt=[DateTime]::UtcNow.ToString('o'); message=$_.Exception.Message} | ConvertTo-Json | Set-Content -LiteralPath $receiptPath -Encoding utf8
    Write-Host 'No se pudo confirmar el inicio. No vuelvas a intentarlo hasta revisar el estado.' -ForegroundColor Red
    Write-Host $_.Exception.Message
} finally {
    $headers.Clear()
    if ($secureKey) { $secureKey.Dispose() }
}
Read-Host 'Pulsa Enter para cerrar esta ventana' | Out-Null
