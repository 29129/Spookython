# Datos de OpenStreetMap

`manta.osm.json` es una extracción de calles alrededor del centro de Manta. Se usa para generar `src/data/manta.graph.json` mediante `npm run map:build`.

Los datos de OpenStreetMap se distribuyen bajo la Open Database License (ODbL). Atribución: © OpenStreetMap contributors — https://www.openstreetmap.org/copyright.

## Red actual

`src/data/manta.graph.json` contiene **600 intersecciones conectadas, 868 calles y cuatro refugios**. Incluye las 300 intersecciones de la versión inicial. Los refugios se distribuyen por el área ampliada y son ubicaciones de demostración, no refugios oficiales. No representa toda Manta.

- Regenerar: `npm run map:build`.
- Verificar: `npm run map:validate`.
- Probar sin AWS: `npm run preview:local` en http://127.0.0.1:4180.
- Ensayo de reglas con reporte separado: `npm run fire-drill:local-map`.

La copia `manta.graph.local-600.json` conserva el mismo grafo para el servidor local aislado. Se puede regenerar y validar con `map:build:local` y `map:validate:local`.

## Versión inicial y cambio de mapa

La red de entrega inicial, de 300 intersecciones y 424 calles, queda en `archive/manta.graph.300.json`. Validar con `node scripts/validate-map.mjs --nodes=300 --map=data/archive/manta.graph.300.json`.

Después de desplegar la red ampliada, preparar una nueva ronda: los refugios cambian de ubicación y no se debe continuar una partida iniciada sobre la red anterior. Los reportes AWS y el PDF anteriores corresponden a esa red de 300 nodos.
