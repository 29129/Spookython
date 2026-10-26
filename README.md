# Spookython

Simulador y servicio de rutas para el reto SpookyThon 2026 en Manta, Ecuador. El alcance sigue el plan de seis sprints en [`docs/Plan_de_desarrollo.txt`](docs/Plan_de_desarrollo.txt). Nos enfocamos en los requisitos obligatorios del nivel base; las funciones Pro quedan fuera.

## Estado del Sprint 1

- Proyecto TypeScript y AWS CDK preparado.
- Grafo local con 300 intersecciones conectadas, 424 segmentos de calle y cuatro refugios de demostración.
- Validador que comprueba conexiones, conteos, coordenadas, distancias, velocidades y referencias a refugios.
- Infraestructura base lista para desplegar: HTTP API, Lambda de lectura del mapa, tabla DynamoDB para el estado compartido y alertas de presupuesto.

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

## API base del Sprint 1

La Lambda implementa rutas de solo lectura para comprobar el despliegue:

- `GET /health` — estado del servicio.
- `GET /map` — grafo completo con sus metadatos.

El endpoint `POST /paso`, la autenticación con API key y la simulación se desarrollarán en sus sprints correspondientes.

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
