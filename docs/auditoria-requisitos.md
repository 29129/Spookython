# Comparación con el reto Track A

Revisión del 26/10/2026 contra las ocho capturas aportadas por el usuario. Las capturas del reto son la especificación; el plan anterior contenía una contradicción respecto a las hordas y se corrigió.

Actualización del 27/10/2026: el usuario confirmó el despliegue y probó una ronda con 20 rescatados. No se afirma cumplimiento completo: hay errores HTTP y la carga real debe verificarse después de resolver la capacidad regional. La cuota observada fue de 10 ejecuciones Lambda; CloudWatch mostró limitaciones y un máximo de concurrencia de 10. El usuario confirmó después la aprobación del aumento a 1.000. Quedan pendientes la comprobación de la cuota aplicada y las rondas de carga completa con la versión actual del motor.

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
| Budget con alerta y captura | Existente; faltaba evidencia actual del correo | Evidencia actualizada el 27/10: `docs/budget.png` muestra correo Verified y dos alertas; `docs/budget-resumen.png` confirma USD 5 |
| README, arquitectura, costos, repo con historial | Documentación preparada, sin publicar esta revisión | README y costos actualizados; diagrama y fuente en docs; commit/push pendientes |
| Presentación PDF/PPT <=20 MB y ensayo | Solo guion Markdown | Se incorpora PDF; ensayo y entrega en plataforma pendientes |

## Evidencia local

`npm test`: 20 casos funcionales. El test con servidor HTTP local usa un adaptador de DynamoDB en memoria únicamente para verificar contratos, carreras y persistencia de snapshots; Lambda utiliza DynamoDB real. Los timeouts de 200 solicitudes quedan en `reports/audit/http-local-200-latest.json`. Que el fallback funcione no aprueba la meta de rendimiento.

`npm run fire-drill`: seis rondas aceleradas con reglas corregidas; sin movimientos inválidos ni refugios desbordados. Las cifras del archivo `reports/sprint-5/` son históricas, de una versión que todavía tenía diferencias con el reto, y no deben presentarse como aceptación de esta revisión.

| Modo | Personas | Rescatadas | Mordidas | Vivas sin evacuar al límite |
| --- | ---: | ---: | ---: | ---: |
| Base | 20 | 20 | 0 | 0 |
| Pro | 20 | 20 | 0 | 0 |
| Base | 80 | 50 | 30 | 0 |
| Pro | 80 | 57 | 23 | 0 |
| Base | 200 | 119 | 81 | 0 |
| Pro | 200 | 140 | 60 | 0 |

Pro añade restricciones de cupos y puede empeorar una ronda; no se afirma que siempre mejore la supervivencia. Las capacidades predeterminadas y las reglas de vehículos son supuestos declarados porque las capturas no los detallan.

La tabla refleja el último ensayo local con horda central y movimiento cada cinco turnos, más la mordida al pasar de los corredores, solicitados por el usuario el 27/10/2026. La cadencia de horda interpreta «casi inmóvil». La mordida al pasar amplía expresamente la regla original del reto: se aplica en PREPARE antes del movimiento humano y evita el bloqueo de personas entre dos corredores que intercambian posiciones. No afecta a pasajeros a bordo ni a personas rescatadas. Esta variante aumenta la dificultad y no debe presentarse como cumplimiento exacto de la mordida original. Los reportes históricos de AWS y el PDF preparado antes del cambio describen otra versión; no deben atribuirse al motor actual.

La última prueba local de la ronda de 200 registró 196 peticiones (cuatro personas fueron mordidas en PREPARE antes de solicitar ruta), p95 HTTP de aproximadamente 261 ms y cero fuera de plazo. El entorno es un solo proceso local con almacenamiento simulado; no reproduce el escalado de Lambda, pero tampoco permite aprobar la latencia. El archivo conserva la última ejecución y se añadirá la medición real de AWS después del despliegue. Las pruebas funcionales comprueban que quienes exceden el plazo no caminen; no ocultan este fallo de rendimiento.

El PDF se renderizó y revisó visualmente. La revisión visual del panel actualizado quedó pendiente: el navegador integrado no pudo acceder al servidor local; las pruebas de contratos HTTP sí conectaron al servidor de prueba. Revisar el panel público después del despliegue antes de dar por aprobada su presentación.

## Aceptación pendiente en AWS y entrega

1. La versión base/Pro ya fue desplegada según confirmación del usuario. El modo opcional de ocho solicitudes requiere actualizar el panel para usarlo desde la web; el runner local ya puede ejecutarlo.
2. Ejecutar `npm run fire-drill:http` (15 minutos) y después `npm run fire-drill:http -- --pro` si se evaluará Pro. Revisar p95, errores/timeouts y turnos >2 s, no solo la salud del API.
3. Si la carga falla, revisar métricas y cuotas reales de Lambda/API Gateway antes de proponer cambios que impliquen costo.
4. Captura del Budget actualizada y destinatario verificado. Falta confirmar gasto final actualizado, publicar repo y subir PDF/URLs/evidencias a la plataforma.
5. Ensayar pitch y preguntas. Ni el ensayo ni la entrega se dan por hechos desde esta revisión de código.

## Alternativa durante la revisión de cuota

`npm run fire-drill:http -- --round=1 --fast --concurrency=8` conserva un POST por persona y el plazo de 500 ms desde el envío. El reporte diferencia cola, HTTP, códigos de respuesta, concurrencia máxima y duración completa. Se guarda aparte, marcado `CAPPED_NOT_FULL_CONCURRENCY`; no acredita cientos de solicitudes simultáneas. Puede superar dos segundos por turno en rondas grandes y puede seguir encontrando rechazos si otras funciones consumen la cuota o las peticiones canceladas siguen ejecutándose en Lambda. Las pruebas de concurrencia completa se mantienen como opción predeterminada.

Las 20 pruebas funcionales incluyen límite de peticiones en vuelo y separación de cola/plazo HTTP. La aceptación de latencia de AWS sigue pendiente. Ver `docs/cierre-entrega.md` para los pasos de entrega independientes del aumento.

### Ensayo real de AWS con ocho solicitudes simultáneas

Ronda 3 base acelerada, reporte `reports/http/fire-drill-base-capped-8-round-3-20261028T010709Z.json` (27/10/2026, 20:07, Ecuador): 196 de 200 rescatados (98 %), cero mordidos y cuatro activos al límite de 150 turnos. Las 2.293 solicitudes devolvieron HTTP 200, sin timeouts, errores ni pasos inválidos. p95 HTTP 128,21 ms y máximo 472,52 ms. Sin embargo, el p95 de cola fue 2.423,97 ms y el de cola más HTTP 2.540,6 ms, con ocho turnos >2 s. La alternativa mantiene las peticiones individuales dentro del plazo en este ensayo, pero falla la cadencia global y no acredita 200 solicitudes simultáneas. Se conserva como alternativa de demostración mientras se resuelve la cuota; no sustituye la aceptación con carga completa ni las rondas de cinco minutos.

Ronda 2 base acelerada, reporte `reports/http/fire-drill-base-capped-8-round-2-20261028T010235Z.json` (27/10/2026, 20:02, Ecuador): 79 de 80 rescatados, cero mordidos y una persona activa al límite de 150 turnos. `completed: true` indica fin de ronda, no evacuación de todos. Las 1.020 respuestas fueron HTTP 200; una superó el plazo (500,04 ms), sin otros errores ni movimientos inválidos. p95 HTTP 137,13 ms, p95 de cola 993,55 ms y p95 de cola más HTTP 1.112,72 ms; hubo un turno >2 s. El ensayo mejora los fallos observados frente a carga completa con cuota de 10, pero no aprueba la cadencia ni todos los plazos. Supervivencia 100 % significa cero mordidos; la fracción rescatada fue 98,75 %.

Reporte conservado: `reports/http/fire-drill-base-capped-8-round-1-20261028T005911Z.json` (27/10/2026, 19:59, Ecuador). Ronda 1 base acelerada: 20 rescatados, cero mordidos, 19 turnos, 187 consultas, 182 respuestas HTTP 200 y cinco abortos por plazo; no se registraron respuestas 503. p95 HTTP 369,9 ms, máximo 533,23 ms, p95 de cola más HTTP 536,7 ms. Cero pasos inválidos y cero turnos mayores de dos segundos. Los cinco timeouts equivalen al 2,67 % de las consultas: la alternativa funciona para evacuar esta ronda, pero no aprueba el requisito de todas las respuestas dentro del plazo ni acredita concurrencia de 200 o rondas de cinco minutos. No se infiere que haya desaparecido todo throttling de AWS a partir de este ensayo.
