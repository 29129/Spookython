# Datos de OpenStreetMap

`manta.osm.json` es una extracción de calles alrededor del centro de Manta. Se usa para generar `src/data/manta.graph.json` mediante `npm run map:build`.

Los datos de OpenStreetMap se distribuyen bajo la Open Database License (ODbL). Atribución: © OpenStreetMap contributors — https://www.openstreetmap.org/copyright.

## Red actual

`src/data/manta.graph.json` contiene **600 intersecciones conectadas, 868 calles y cuatro refugios**. Incluye las 300 intersecciones de la versión inicial. Los refugios se distribuyen por el área ampliada y son ubicaciones de demostración, no refugios oficiales. No representa toda Manta.

- Regenerar: `npm run map:build`.
- Verificar: `npm run map:validate`.
- Probar sin AWS: `npm run preview:local` en http://127.0.0.1:4180.
- Ensayo de reglas con reporte separado: `npm run fire-drill:local-map`.

La copia `manta.graph.local-600.json` conserva los mismos nodos y calles para el servidor local aislado; la revisión funcional selecciona refugios con accesos redundantes en el componente principal. Se puede regenerar y validar con `map:build:local` y `map:validate:local`.

## Versión inicial y cambio de mapa

La red de entrega inicial, de 300 intersecciones y 424 calles, queda en `archive/manta.graph.300.json`. Validar con `node scripts/validate-map.mjs --nodes=300 --map=data/archive/manta.graph.300.json`.

Después de desplegar la red ampliada, preparar una nueva ronda: los refugios cambian de ubicación y no se debe continuar una partida iniciada sobre la red anterior. Los reportes AWS y el PDF anteriores corresponden a esa red de 300 nodos.

La selección local usa `--resilient-refuges`: detecta aristas de acceso único y elige cruces del mayor componente que permanece unido al retirar esas aristas. Así se evita situar un refugio con 20 cupos detrás del único puente de un ramal. No añade cupos, no abre calles bloqueadas y no garantiza conectividad frente a cualquier combinación de cierres.

## Revisión 3D y de evacuación

El mapa de producción se actualiza con los refugios de accesos redundantes de la variante local. `npm run map:build` conserva esta política. La distribución anterior de 600 nodos queda en `archive/manta.graph.600-v2.json`, además de la copia inicial de 300 nodos. Preparar otra ronda tras desplegar para que la partida use las ubicaciones nuevas.
