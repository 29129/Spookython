$ErrorActionPreference = 'Stop'

if (-not $env:SPOOKYTHON_API_BASE_URL) {
  throw 'Define SPOOKYTHON_API_BASE_URL con la URL ApiBaseUrl del stack.'
}
if (-not $env:SIMULATOR_API_KEY) {
  throw 'Define SIMULATOR_API_KEY localmente antes de ejecutar la comprobación.'
}

$base = $env:SPOOKYTHON_API_BASE_URL.TrimEnd('/')
$headers = @{ 'x-api-key' = $env:SIMULATOR_API_KEY }
$health = Invoke-RestMethod -Uri "$base/health" -Method Get
$map = Invoke-RestMethod -Uri "$base/map" -Method Get
$state = Invoke-RestMethod -Uri "$base/estado" -Method Get

if ($health.status -ne 'ok') { throw 'GET /health no devolvió status=ok.' }
if ($map.nodes.Count -lt 1 -or $map.streets.Count -lt 1) { throw 'GET /map no devolvió nodos y calles.' }
if ($null -eq $state.turn) { throw 'GET /estado no devolvió el turno actual.' }
if ($state.pro) { throw 'Esta comprobación serial usa un sobreviviente sintético. Para el nivel Pro ejecuta npm run fire-drill:http -- --pro.' }

$activeSurvivor = $state.survivors | Where-Object status -eq 'ACTIVE' | Select-Object -First 1
$refugeNodeIds = @($map.refuges | ForEach-Object nodeId)
$zombieNodeIds = @($state.zombies | ForEach-Object nodeId)
$candidateNodeIds = @()
if ($activeSurvivor) { $candidateNodeIds += $activeSurvivor.nodeId }
$candidateNodeIds += @(
  $map.nodes |
    Where-Object { $_.id -notin $refugeNodeIds -and $_.id -notin $zombieNodeIds } |
    Select-Object -First 20 -ExpandProperty id
)

# Busca un origen que permita demostrar un paso real, no quedarse en un refugio.
$testNodeId = $null
foreach ($candidateNodeId in $candidateNodeIds) {
  $candidateBody = @{
    sobrevivienteId = 'SPRINT6-CHECK'
    nodoActual = $candidateNodeId
    turno = [int]$state.turn
  } | ConvertTo-Json -Compress
  $candidateResult = Invoke-RestMethod -Uri "$base/paso" -Method Post -Headers $headers -ContentType 'application/json' -Body $candidateBody
  if (-not $candidateResult.siguienteNodo -or $candidateResult.siguienteNodo -eq $candidateNodeId) { continue }

  $candidateStreet = $map.streets | Where-Object {
    (($_.fromNode -eq $candidateNodeId -and $_.toNode -eq $candidateResult.siguienteNodo) -or
      ($_.toNode -eq $candidateNodeId -and $_.fromNode -eq $candidateResult.siguienteNodo)) -and
    $_.id -notin @($state.blockedStreetIds)
  } | Select-Object -First 1
  if ($candidateStreet -and $candidateResult.siguienteNodo -notin $zombieNodeIds) {
    $testNodeId = $candidateNodeId
    break
  }
}
if (-not $testNodeId) { throw 'POST /paso no encontró un movimiento válido desde los nodos de prueba. Revisa el mapa, bloqueos y estado actual.' }

$body = @{
  sobrevivienteId = 'SPRINT6-CHECK'
  nodoActual = $testNodeId
  turno = [int]$state.turn
} | ConvertTo-Json -Compress
$latencies = @(
  for ($i = 0; $i -lt 20; $i++) {
    $timer = [System.Diagnostics.Stopwatch]::StartNew()
    $result = Invoke-RestMethod -Uri "$base/paso" -Method Post -Headers $headers -ContentType 'application/json' -Body $body
    $timer.Stop()
    if (-not $result.siguienteNodo) { throw "POST /paso no devolvió siguienteNodo en llamada $($i + 1)." }
    $validStreet = $map.streets | Where-Object {
      (($_.fromNode -eq $testNodeId -and $_.toNode -eq $result.siguienteNodo) -or
        ($_.toNode -eq $testNodeId -and $_.fromNode -eq $result.siguienteNodo)) -and
      $_.id -notin @($state.blockedStreetIds)
    } | Select-Object -First 1
    if (-not $validStreet) { throw "POST /paso devolvió un nodo que no es vecino habilitado: $($result.siguienteNodo)." }
    if ($result.siguienteNodo -in $zombieNodeIds) {
      throw "POST /paso devolvió el nodo ocupado por un zombi: $($result.siguienteNodo)."
    }
    $timer.Elapsed.TotalMilliseconds
  }
)
$sorted = @($latencies | Sort-Object)
$p95Index = [Math]::Max(0, [Math]::Ceiling(0.95 * $sorted.Count) - 1)

[pscustomobject]@{
  health = $health.status
  mapNodes = $map.nodes.Count
  mapStreets = $map.streets.Count
  currentTurn = $state.turn
  stepCalls = $latencies.Count
  startNode = $testNodeId
  nextNode = $result.siguienteNodo
  p95HttpMs = [Math]::Round($sorted[$p95Index], 2)
  maxHttpMs = [Math]::Round($sorted[-1], 2)
} | Format-List
