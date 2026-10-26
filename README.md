# Spookython

Simulador y servicio de rutas para el reto SpookyThon 2026 en Manta, Ecuador. El alcance sigue el plan de seis sprints en [`docs/Plan_de_desarrollo.txt`](docs/Plan_de_desarrollo.txt). Nos enfocamos en los requisitos obligatorios del nivel base; las funciones Pro quedan fuera.

## Estado de los sprints

- Sprint 1 completado: proyecto preparado, mapa validado y base desplegada en AWS.
- Sprint 2 completado: motor de turnos, tipos de zombi, eventos de ciudad y estado compartido en DynamoDB.
- Sprint 3 completado: `POST /paso` autenticado calcula y conserva rutas seguras; el equipo verificó manualmente una latencia p95 de 252 ms.
- Sprint 4 completado: mapa en vivo, rutas y bloqueos visibles, controles de turno y estado final de sobrevivientes en `web/`.
- Sprint 5 completado: rondas locales 20/80/200, cuatro escenarios límite y métricas guardadas en [`reports/sprint-5/fire-drill-latest.json`](reports/sprint-5/fire-drill-latest.json).

## Mapa

El recorte se generó con calles reales de OpenStreetMap alrededor del centro de Manta. El archivo de origen es [`data/manta.osm.json`](data/manta.osm.json); el grafo utilizado por la aplicación es [`src/data/manta.graph.json`](src/data/manta.graph.json).

Las intersecciones usan identificadores de OpenStreetMap. Cada segmento contiene extremos, distancia calculada sobre su geometría, tipo de vía, velocidad peatonal base y dirección de circulación. Las velocidades son supuestos iniciales para ponderar rutas: avenida 1.6 m/s, calle 1.4 m/s, callejón 1.0 m/s y puente 1.2 m/s. Se deben ajustar si las reglas completas del evento especifican otros valores.

Los cuatro refugios se asignan a intersecciones separadas para la demo. No representan ubicaciones oficiales. El detalle de fuente y licencia está en [`data/README.md`](data/README.md).

## Modelo común del mundo

Los tipos compartidos de nodos, calles, refugios, zombis, sobrevivientes y estado del mundo están en [`src/domain/types.ts`](src/domain/types.ts). El estado del juego se diseñará para persistir en DynamoDB, no en la memoria temporal de una instancia Lambda.

## Compilar y validar

Requiere Node.js 22 o superior y npm.

```powershell
npm install
npm run map:build
npm run map:validate
npm run build
```

`map:build` genera el grafo desde la extracción guardada en `data/manta.osm.json`. No requiere una descarga de red para repetir la generación.

## API actual

La API pública tiene estas rutas:

- `GET /health` — estado del servicio.
- `GET /map` — grafo completo con sus metadatos.
- `GET /estado` — estado actual del mundo. Si todavía no existe, crea la partida de demostración con 20 sobrevivientes y los cuatro tipos de zombi.
- `POST /estado/avanzar` — avanza exactamente un turno y requiere una API key en el encabezado `x-api-key`. El cliente debe llamarlo cada 2 segundos para mantener el ritmo del reto. El cuerpo puede omitirse; se generan eventos de ciudad automáticamente cada diez turnos. Para forzar o evitar un evento, envía `{"cityEvent":{"type":"BRIDGE_COLLAPSE"}}`, `{"cityEvent":{"type":"AVENUE_BLOCK"}}` o `{"cityEvent":{"type":"NONE"}}`.
- `POST /paso` — calcula el siguiente nodo y requiere la misma API key. Recibe `{"sobrevivienteId":"S-0089","nodoActual":"osm:4131814265","turno":142}` y responde `{"siguienteNodo":"..."}`. Usa Dijkstra con distancia/velocidad, evita las calles bloqueadas y los nodos con zombis visibles, y conserva rutas seguras por sobreviviente en DynamoDB.

Los caminantes avanzan una calle cada dos turnos; los corredores avanzan hasta dos calles y persiguen sobrevivientes a tres nodos o menos; las hordas no se mueven y el planificador evita su nodo; los dormidos no aparecen en la respuesta hasta despertar a dos nodos o menos. Después de mover zombis, el motor usa el mismo planificador que `POST /paso` para cada sobreviviente: conserva una ruta válida y calcula otra si un bloqueo o un zombi vuelve inseguro el trayecto. Los choques al compartir nodo y los cruces opuestos por una misma calle los eliminan como `BITTEN`; llegar a un refugio los marca `RESCUED`.

La partida se guarda en DynamoDB para que las invocaciones de Lambda compartan un mismo estado. El endpoint `/paso` respeta los nodos de las hordas, pero no bloquea automáticamente sus vecinos.

## Panel web del Sprint 4

El panel estático de `web/` consulta `/map` y `/estado` cada dos segundos y dibuja la red vial, los refugios, las rutas disponibles, los sobrevivientes, los zombis y las calles bloqueadas. Para avanzar la simulación, el usuario ingresa la API key en el panel y elige iniciar, avanzar un turno o pausar. La clave solo vive en la memoria de esa pestaña: no se guarda en almacenamiento del navegador ni se incluye en el código.

Para verlo en la computadora, desde la carpeta del proyecto ejecuta:

```powershell
npm run web:serve
```

Después abre `http://127.0.0.1:4173`. No requiere instalar dependencias nuevas ni desplegar otra vez la infraestructura; necesita conexión al API desplegado. El servidor local solo escucha en `127.0.0.1`.

## Sprint 5: prueba de fuego local

Desde la raíz del repositorio, ejecuta:

```powershell
npm run fire-drill
```

El simulador ejecuta las rondas de 20, 80 y 200 sobrevivientes, con un máximo de 150 turnos (cinco minutos a dos segundos por turno). También revisa colapso de puente, bloqueo de avenida, despertar de dormidos y mordida por cruce opuesto. Imprime y guarda las métricas en `reports/sprint-5/fire-drill-latest.json`: supervivencia, eficiencia frente a la ruta más corta sin zombis, p95 y máximo del planificador local, recálculos, movimientos inválidos, errores y rondas incompletas.

Última ronda local: 20 sobrevivientes, 90% de supervivencia y 100% de eficiencia; 80, 82.5% y 94.82%; 200, 97% y 94.7%. Las tres terminaron sin sobrevivientes activos, errores, movimientos inválidos ni tiempos agotados. El p95 local del planificador fue 0.069 ms, 0.581 ms y 0.203 ms, respectivamente. Los cuatro escenarios límite pasaron.

La latencia de este informe mide el planificador local sin latencia de red. La medición HTTP manual previa de `POST /paso` fue p95 de 252 ms para 20 llamadas; el despliegue público se volverá a comprobar en el Sprint 6.

La API key no se guarda en el repositorio ni en texto plano en AWS: CDK recibe su SHA-256 mediante `SIMULATOR_API_KEY_SHA256`. En PowerShell, genera y configura una clave localmente. Conserva `SIMULATOR_API_KEY` de forma privada para las llamadas autenticadas y no la subas al repositorio:

```powershell
$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$env:SIMULATOR_API_KEY = [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
$sha = [System.Security.Cryptography.SHA256]::Create()
$env:SIMULATOR_API_KEY_SHA256 = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($env:SIMULATOR_API_KEY))).Replace('-', '').ToLowerInvariant()
```

Antes de ejecutar `cdk synth`, `cdk diff` o `cdk deploy`, configura también `BUDGET_ALERT_EMAIL` y `MONTHLY_BUDGET_USD` para conservar el Budget de la cuenta.

## AWS

La región de despliegue es `us-east-1`. La tabla usa facturación bajo demanda y el API está preparado con Lambda Node.js 22 en arquitectura ARM64. El Budget es de USD 5 mensuales, con aviso al superar el 80% y aviso de pronóstico al superar el 100%; es una alerta de cuenta, no un límite de gasto ni una acción que detenga recursos.

El correo del Budget se pasa por variable de entorno y no se guarda en este repositorio. Con una sesión válida de AWS CLI:

```powershell
$env:BUDGET_ALERT_EMAIL = 'tu-correo@example.com'
$env:MONTHLY_BUDGET_USD = '5'
npx cdk synth --strict --profile cdk-developer
npx cdk diff --profile cdk-developer
npx cdk deploy --profile cdk-developer
```

Después del despliegue, CloudFormation mostrará `ApiBaseUrl` y `WorldStateTableName`. La dirección pública solo ofrece las rutas de lectura indicadas arriba en esta etapa.
