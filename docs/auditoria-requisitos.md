# Comparación con el reto Track A

Revisión del 26/10/2026 contra las ocho capturas aportadas por el usuario. Las capturas del reto son la especificación; el plan anterior contenía una contradicción respecto a las hordas y se corrigió.

No se afirma cumplimiento completo de la entrega. La versión anterior funcionaba públicamente, pero esta revisión debe desplegarse y su carga real debe verificarse.

| Requisito | Hallazgo anterior | Acción y evidencia actual |
| --- | --- | --- |
| Grafo Manta ~300, distancias, tipos y cuatro refugios | 300 nodos / 424 calles / 4 refugios | Conservado; `npm run map:validate` |
| Zombis primero, sobrevivientes después | Correcto en el motor local | Fases PREPARE/RESOLVE compartidas en DynamoDB |
| Caminante, corredor, dormido | Reglas básicas implementadas | Casos específicos para cadencia, persecución y despertar |
| Horda bloquea su nodo y todos los vecinos | Solo se bloqueaba el nodo; el plan decía lo contrario | `dangerNodes` incluye todos los vecinos, aun si una arista está cerrada |
| Puente/avenida retirados en vivo | Cierre lógico y línea roja | Arista retirada de red visual; cruz en el lugar del cierre |
| Mordida por nodo/cruce opuesto | Implementada | Escenarios independientes que fuerzan ambas colisiones |
| El simulador consulta POST /paso por persona y turno | Usaba la función de planificación directamente | El cliente web y el runner hacen una solicitud HTTP real por cada ACTIVE |
| Contrato de /paso y x-api-key | Correctos; el simulador evitaba HTTP | Se conservan JSON y autenticación; pruebas 401 y solicitudes reales |
| Respuesta <500 ms; tarde/inválida = quieto | No se aplicaba el plazo en el simulador | Abort por consulta y verificación al resolver; probados errores y destinos inválidos |
| Cientos simultáneos, p95 y disponibilidad | 20 consultas seriales no demostraban 200 concurrentes | Ensayo HTTP local de 200 con timeouts registrados; validación de AWS pendiente |
| Distancia y tipo de calle | Dijkstra válido | Cola de prioridad y coste distancia/velocidad; prueba de selección ponderada |
| Recalcular y compartir estado | Caché y DynamoDB ya existían | Rutas de snapshot preparado, control de revisión/sesión y rechazo de turnos antiguos |
| Rondas 20/80/200 con mezclas distintas | Las tres tenían la misma mezcla de zombis | R1 caminantes; R2 añade corredores/horda y puente; R3 todos y dos cierres |
| Cinco minutos por ronda | Simulación local acelerada con hasta 150 turnos | Runner HTTP conserva cinco minutos; `--fast` queda marcado como ensayo |
| Mapa accesible y actualizado | Panel y API anteriores desplegados | UI nueva incluye ronda, reset, métricas y Pro; requiere redeploy |
| Predicción Pro | Ausente | Posiciones del siguiente turno, sin revelar dormidos; caso que cambia la ruta |
| Capacidad de refugios | Ausente | Reservas y comprobación final de cupos; sin sobreasignaciones en las seis rondas locales |
| Cinco camionetas × cuatro plazas, doble velocidad | Ausente | Cinco vehículos, máximo cuatro a bordo, dos aristas por turno; pruebas de recogida/entrega |
| Budget con alerta y captura | Existente; usuario confirmó email | Sigue pendiente la captura nueva; se conserva la antigua identificada como tal |
| README, arquitectura, costos, repo con historial | Documentación preparada, sin publicar esta revisión | README y costos actualizados; diagrama y fuente en docs; commit/push pendientes |
| Presentación PDF/PPT <=20 MB y ensayo | Solo guion Markdown | Se incorpora PDF; ensayo y entrega en plataforma pendientes |

## Evidencia local

`npm test`: 15 casos funcionales. El test con servidor HTTP local usa un adaptador de DynamoDB en memoria únicamente para verificar contratos, carreras y persistencia de snapshots; Lambda utiliza DynamoDB real. Los timeouts de 200 solicitudes quedan en `reports/audit/http-local-200-latest.json`. Que el fallback funcione no aprueba la meta de rendimiento.

`npm run fire-drill`: seis rondas aceleradas con reglas corregidas; sin movimientos inválidos ni refugios desbordados. Las cifras del archivo `reports/sprint-5/` son históricas, de una versión que todavía tenía diferencias con el reto, y no deben presentarse como aceptación de esta revisión.

| Modo | Personas | Rescatadas | Mordidas | Vivas sin evacuar al límite |
| --- | ---: | ---: | ---: | ---: |
| Base | 20 | 20 | 0 | 0 |
| Pro | 20 | 20 | 0 | 0 |
| Base | 80 | 78 | 1 | 1 |
| Pro | 80 | 71 | 4 | 5 |
| Base | 200 | 194 | 3 | 3 |
| Pro | 200 | 195 | 2 | 3 |

Pro añade restricciones de cupos y puede empeorar una ronda; no se afirma que siempre mejore la supervivencia. Las capacidades predeterminadas y las reglas de vehículos son supuestos declarados porque las capturas no los detallan.

La última prueba local HTTP/1 de 200 peticiones registró p95 de aproximadamente 514 ms y 28 fuera de plazo. El entorno es un solo proceso local con almacenamiento simulado; no reproduce el escalado de Lambda, pero tampoco permite aprobar la latencia. El archivo conserva la última ejecución y se añadirá la medición real de AWS después del despliegue. Las pruebas funcionales comprueban que quienes exceden el plazo no caminen; no ocultan este fallo de rendimiento.

El PDF se renderizó y revisó visualmente. La revisión visual del panel actualizado quedó pendiente: el navegador integrado no pudo acceder al servidor local; las pruebas de contratos HTTP sí conectaron al servidor de prueba. Revisar el panel público después del despliegue antes de dar por aprobada su presentación.

## Aceptación pendiente en AWS y entrega

1. Desplegar y abrir la nueva versión pública.
2. Ejecutar `npm run fire-drill:http` (15 minutos) y después `npm run fire-drill:http -- --pro` si se evaluará Pro. Revisar p95, errores/timeouts y turnos >2 s, no solo la salud del API.
3. Si la carga falla, revisar métricas y cuotas reales de Lambda/API Gateway antes de proponer cambios que impliquen costo.
4. Reemplazar captura del Budget, confirmar gasto actualizado, publicar repo y subir PDF/URLs/evidencias a la plataforma.
5. Ensayar pitch y preguntas. Ni el ensayo ni la entrega se dan por hechos desde esta revisión de código.
