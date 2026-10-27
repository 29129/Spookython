# Spookython

Motor de evacuación y simulador de Manta para SpookyThon 2026. Usa un grafo real de OpenStreetMap con 300 intersecciones, 424 calles y cuatro refugios. El panel muestra zombis, sobrevivientes, rutas, cierres y rescate en vivo.

La revisión del 26/10/2026 contrastó el código con las capturas del reto y corrigió el plan inicial: **las hordas bloquean su nodo y todos sus vecinos**. El nivel Pro está implementado como opción al crear una ronda. Consulta la comparación completa en [docs/auditoria-requisitos.md](docs/auditoria-requisitos.md).

## Estado de la entrega

La versión anterior de API y panel ya se desplegó en AWS y se abrió desde un navegador público. Su prueba serial de 20 llamadas produjo p95 de 258,18 ms y máximo de 263,59 ms. Estas cifras pertenecen a la versión anterior y no certifican 200 consultas simultáneas.

La nueva revisión de reglas y Pro está validada localmente y **requiere actualizar el despliegue**. Los 15 casos funcionales pasan; las seis rondas locales no produjeron movimientos inválidos ni refugios desbordados. El ensayo HTTP local de 200 peticiones usa un único proceso y un adaptador de DynamoDB de prueba: registró timeouts y no aprobó el objetivo de latencia. No es una medición de AWS. La prueba pública de las tres rondas sigue pendiente.

## Ejecutar y comprobar

Requiere Node.js 22 y npm. Desde la raíz:

```powershell
npm install
npm run map:validate
npm run build
npm test
npm run fire-drill
npm run web:serve
```

El panel local abre en `http://127.0.0.1:4173` y consulta la API configurada en `web/app.js`. El grafo se genera de nuevo con `npm run map:build`; su fuente, atribución y licencia ODbL están en [data/README.md](data/README.md).

`npm test` comprueba el contrato HTTP con un servidor de prueba local, las reglas y las funciones Pro. El adaptador en memoria pertenece únicamente a las pruebas; Lambda persiste siempre en DynamoDB. `npm run fire-drill` ejecuta seis simulaciones aceleradas (base y Pro para cada población). Guarda evidencia en [reports/audit/fire-drill-latest.json](reports/audit/fire-drill-latest.json). Las cifras antiguas de Sprint 5 se conservan como históricas y no prueban las reglas corregidas.

## Rondas y manejo del panel

Ingresa la clave de control, selecciona ronda, activa Pro si corresponde y pulsa **Nueva ronda**. Esa acción reinicia el mundo de demostración compartido. Después inicia o avanza un turno; puedes pausar entre turnos.

| Ronda | Población | Zombis y eventos |
| --- | ---: | --- |
| Anochecer | 20 | Solo caminantes; sin eventos automáticos |
| Medianoche | 80 | Caminantes, corredores y horda; puente colapsado en turno 5 |
| Apocalipsis | 200 | Todos los tipos; avenidas cerradas en turnos 5 y 10 |

Un turno apunta a dos segundos. Primero se mueven zombis y después sobrevivientes. El navegador consulta realmente `POST /paso` para cada sobreviviente activo, en paralelo. Cada consulta tiene plazo de 500 ms. Un timeout, error o destino inválido deja al sobreviviente quieto; los turnos que demoran más de dos segundos se cuentan y muestran. La ronda termina al evacuar/eliminar a todos o alcanzar 150 turnos. El panel puede finalizar antes si no quedan personas activas; el script de prueba de fuego conserva los cinco minutos por ronda.

## API pública y contrato

API desplegada: `https://gkzb014d54.execute-api.us-east-1.amazonaws.com`. Endpoint de decisión: `https://gkzb014d54.execute-api.us-east-1.amazonaws.com/paso` (método POST). El stack produce también `WebUrl`, la dirección HTTPS de CloudFront para el panel. Conserva la URL de la salida de tu despliegue al preparar la entrega.

- `GET /health`: salud y versión del esquema.
- `GET /map`: grafo y fuente OpenStreetMap.
- `GET /estado`: mundo compartido, turno, fase, zombis visibles, sobrevivientes y calles bloqueadas; en Pro incluye refugios, vehículos y predicciones.
- `POST /simulacion/reiniciar`: crea una ronda nueva con `{"round":3,"pro":true}`. Opcionalmente acepta `refugeCapacities`, un objeto de cupos por ID de refugio.
- `POST /estado/avanzar`, fase `PREPARE`: recibe `{"phase":"PREPARE","expectedTurn":0}`; mueve zombis y guarda un snapshot con `phase=DECIDING` y `turnToken`.
- `POST /paso`: recibe el contrato del reto: `{"sobrevivienteId":"S-0001","nodoActual":"osm:4131814272","turno":1}` y devuelve solo `{"siguienteNodo":"..."}`.
- `POST /estado/avanzar`, fase `RESOLVE`: recibe el `turnToken` y `decisions` con `survivorId`, `siguienteNodo`, `durationMs` y los indicadores de timeout/error de cada consulta. Valida vecinos, cierres, amenazas y mordidas, y guarda el resultado.

Todos los POST requieren `x-api-key`. Las lecturas son públicas. Una revisión y sesión de DynamoDB evitan resolver dos veces un turno o aplicar un resultado antiguo tras un reinicio. Una ronda interrumpida en `DECIDING` se puede reanudar: el próximo controlador consulta sus decisiones y resuelve ese snapshot. Un solo controlador debe dirigir cada partida; otros navegadores pueden observar.

## Algoritmo y reglas

Dijkstra pondera cada calle por `distancia_m / velocidad_mps`, con una cola de prioridad. Los desplazamientos del juego usan calles como pasos: un sobreviviente avanza una por turno; una camioneta, dos. Se tratan las calles como conexiones peatonales en ambos sentidos. Las velocidades iniciales son supuestos de simulación: avenida 1,6 m/s, calle 1,4, callejón 1,0 y puente 1,2.

Los caminantes eligen dirección pseudoaleatoria reproducible cada dos turnos. Los corredores avanzan hasta dos calles y persiguen personas a tres nodos o menos. Las hordas permanecen inmóviles y prohíben su nodo y los vecinos. Los dormidos no se publican hasta que una persona queda a dos nodos o menos; despiertan como caminantes. Compartir nodo o cruzarse por una calle en sentidos opuestos causa mordida. El planificador evita amenazas visibles y valida las rutas guardadas cuando cambian zombis o cierres. Una calle cerrada se retira de la red dibujada y se marca con una cruz.

## Nivel Pro

Las capturas no fijan capacidades concretas ni reglas especiales de combate para vehículos. Estas decisiones se documentan como supuestos del simulador:

- **Predicción:** se simulan los dos pasos del siguiente movimiento de cada corredor usando su regla de persecución y las posiciones visibles del snapshot. Se evita entrar de inmediato en esos nodos y se penalizan en el resto del trayecto. Es una previsión condicionada al estado actual, que se recalcula cada turno; no revela dormidos.
- **Capacidad:** cada persona tiene una reserva en un refugio con espacio. Se conservan las reservas viables y se redistribuyen al cambiar una ruta o perderse una persona. Cupos por defecto: 5, 20 o 50 por refugio según la ronda; se pueden ajustar desde el panel o el API. Si no existe cupo, espera. La admisión vuelve a comprobar la capacidad, aun si la asignación era anterior.
- **Rescate:** cinco camionetas, cuatro plazas y dos calles por turno. Eligen entre recogidas próximas y entregas; entre candidatas cercanas favorecen a las amenazadas por corredores y limitan el desvío si ya llevan pasajeros. Evitan nodos peligrosos, calles cerradas y cruces opuestos con zombis. Las personas a bordo se representan como `ONBOARD` y no caminan simultáneamente. El reto no define daño a vehículos; este simulador no añade combate ni destrucción de camionetas.

Las reservas pueden obligar a caminar más y Pro no garantiza mejorar todas las métricas. El reporte muestra ambos modos para que el equipo pueda elegir con evidencia.

## Prueba de fuego HTTP real

Después de desplegar, con las variables de la API y la clave en tu terminal:

```powershell
$env:SPOOKYTHON_API_BASE_URL = 'https://gkzb014d54.execute-api.us-east-1.amazonaws.com'
# SIMULATOR_API_KEY debe contener tu clave local, sin publicarla.
npm run fire-drill:http
npm run fire-drill:http -- --pro
```

Cada comando reinicia el mundo y ejecuta tres rondas consecutivas de cinco minutos; evita usar otro controlador durante esos quince minutos. El reporte en `reports/http/` contiene p95 HTTP, solicitudes concurrentes, errores, timeouts, supervivencia, eficiencia en turnos, cierres y desbordes. `--round=3` limita a una ronda; `--fast` acelera y queda marcado como ensayo, no como la prueba oficial. La disponibilidad cuenta tanto errores como respuestas fuera de plazo. La eficiencia compara los turnos de rescate con la mínima cantidad de calles sin zombis; incluye esperas y se limita a 100% para no inflar resultados por camionetas.

El comando termina con código de salida 1 si detecta una ronda incompleta, errores, timeouts, turnos de más de dos segundos, pasos inválidos o desbordes. El reporte conserva el detalle para distinguir problemas funcionales y de rendimiento; no elimina los fallos para presentar una prueba aprobada.

El script serial `scripts/check-public-api.ps1` sirve para una comprobación pequeña en modo base. No sustituye las rondas ni se usa para certificar concurrencia.

## Despliegue AWS

Región `us-east-1`; API Gateway HTTP API, Lambda Node.js 22 ARM64, DynamoDB bajo demanda y CloudWatch. El panel se publica desde S3 privado mediante CloudFront con OAC y HTTPS. La clave solo permanece en memoria de la pestaña y su hash SHA-256 se configura en Lambda; no se incluye en el repositorio ni en los logs.

Mantén las variables de entorno usadas en el despliegue anterior. Omitirlas puede eliminar el Budget del template o dejar la API sin clave:

```powershell
$env:BUDGET_ALERT_EMAIL = 'tu-correo@example.com'
$env:MONTHLY_BUDGET_USD = '5'
# Conserva SIMULATOR_API_KEY_SHA256 en esta misma terminal.
npx cdk synth --strict --profile cdk-developer
npx cdk diff --profile cdk-developer
npx cdk deploy --profile cdk-developer
```

Si necesitas derivar el hash de la clave que ya conservas, sin mostrarla:

```powershell
$sha = [System.Security.Cryptography.SHA256]::Create()
$env:SIMULATOR_API_KEY_SHA256 = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($env:SIMULATOR_API_KEY))).Replace('-', '').ToLowerInvariant()
```

Salidas: `ApiBaseUrl`, `WebUrl` y `WorldStateTableName`. Esta revisión añade la ruta de reinicio y TTL para cachés de rutas con expiración; el estado de partida no tiene TTL. No destruyas el stack antes del pitch: la configuración de demo permite borrar tabla, logs y archivos al destruirlo.

## Entregables y límites pendientes

- [Auditoría contra el reto](docs/auditoria-requisitos.md).
- [Arquitectura SVG](docs/arquitectura.svg) y [fuente Mermaid](docs/arquitectura.mmd).
- [Declaración de costos](docs/costos.md), que distingue gasto de cuenta y del proyecto anterior.
- [Captura del Budget](docs/budget.png). El usuario confirmó el correo; falta sustituir la captura antigua, que muestra 0/1 verificado.
- [Presentación PDF](output/pdf/presentacion-spookython.pdf) y [guion de cinco minutos](docs/pitch.md).
- [Repositorio público](https://github.com/29129/Spookython), con historial; falta publicar mediante commit/push esta revisión local.

Pendientes para afirmar cumplimiento completo: desplegar esta revisión, ejecutar las rondas HTTP con carga real y revisar latencia/disponibilidad (incluidos arranques en frío), incorporar la captura actualizada del Budget y cargar los entregables en la plataforma antes del miércoles 28/10/2026 a las 10:00 de Ecuador. El pitch de cinco minutos y sus tres minutos de preguntas deben ensayarse con el equipo; un PDF o guion no acredita el ensayo.

La demo comparte un mundo, no implementa cuentas ni partidas privadas. El mapa y refugios son de demostración; las velocidades y cupos son supuestos. El Budget de USD 5 avisa, pero no detiene gastos. Los datos actuales de Cost Explorer mezclan esta aplicación con servicios del sistema anterior y están redondeados; no demuestran costo cero de Spookython.
