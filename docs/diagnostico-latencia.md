# Diagnóstico de latencia

Actualización: la reducción de carga inicial no produjo una mejora medible en el arranque (186 timeouts, frente a 184). No se siguen aumentando recursos sin evidencia. Está preparada una [opción temporal de concurrencia aprovisionada](concurrencia-temporal.md), desactivada por defecto y sin desplegar, con costo explícito y retirada manual documentada. El usuario debe decidir antes de activarla.

La muestra REPORT aportada por el usuario durante el ensayo del 27/10/2026 muestra Duration de 669,09 y 402,49 ms seguidos por 54,77, 14,41, 28,41 y 14,46 ms en el mismo flujo. No muestra Init Duration ni identifica las rutas. Confirma tiempo elevado dentro de la invocación; no prueba que las llamadas lentas fueran POST /paso ni identifica por sí sola el cuello de botella. Uso máximo observado de 115–116 MB sobre 512 MB: no hay evidencia de agotamiento de memoria.

## Instrumentación incorporada

La respuesta incluye `x-app-duration-ms`, `x-first-invocation` y `x-lambda-memory-mb`. Handler mide desde la entrada al manejador; excluye inicialización del módulo, API Gateway y red. Primera invocación no equivale a una medición de Init Duration. En Lambda se emite JSON `api_timing` con ruta permitida, requestId, duración, estado, memoria y primera invocación. No se registran claves, cabeceras de entrada ni cuerpos. La diferencia entre duración HTTP y handler no debe llamarse simplemente «red»: incluye otras etapas.

El reporte conserva p95 del handler solo entre respuestas recibidas. Las peticiones abortadas no aportan esta medición y siguen contabilizando como timeouts; un p95 bajo de las respuestas recibidas no permite descartar lentitud del servidor entre las abortadas. Los logs api_timing y REPORT permiten completar esa evidencia desde CloudWatch.

## Ensayo de configuración

### Primera medición instrumentada: 512 MB

### Comparación exploratoria: 1024 MB

### HTTP/2 sobre entornos reutilizados: 1024 MB

### HTTP/2 después de despliegue nuevo

Reporte `reports/http/fire-drill-base-r3-1024mb-http2-newdeploy-20261028T032134Z.json`: 1.819 consultas, 184 timeouts (todos en T1), cero errores HTTP, p95 HTTP 502,99 ms; T1 tuvo p95 508,82 ms y T2–T12 cero timeouts. Se recibieron dos primeras invocaciones; las abortadas no permiten conocer ese dato desde el cliente. La mejora de la ejecución anterior no permite dar por resuelto el inicio ni atribuirla solo al protocolo.

Se preparó carga diferida de engine/rescue/planner para que el camino de /paso con snapshot DECIDING ya preparado no evalúe esos módulos al iniciar. Las rutas de control, estado inicial y consultas sin snapshot conservan el motor y planificador completos cuando hacen falta. Se conservan la lectura consistente y el estado compartido en DynamoDB, los clientes SDK reutilizables y el plazo de 500 ms. Una comprobación local verificó que un paso válido de snapshot puede responder sin cargar engine/rescue/planner; las 23 pruebas y compilación pasan. El impacto real de esta reducción de inicialización sigue pendiente de medir tras desplegar.

Reporte preservado `reports/http/fire-drill-base-r3-1024mb-http2-20261028T031551Z.json`: 1.730 consultas, todas HTTP 200, cero errores y timeouts, p95 HTTP 291,34 ms, p95 handler recibido 48,38 ms, cero turnos >2 s. Memoria confirmada 1024 MB y cero primeras invocaciones registradas. La banda de latencia del ensayo es 7 y disponibilidad 10; no es la aceptación de una ronda completa. No se atribuye causalidad solo al transporte porque los entornos estaban reutilizados, a diferencia de las pruebas posteriores a los despliegues de memoria.

Para comprobar el inicio tras un despliegue, CDK permite `SPOOKYTHON_DEPLOYMENT_LABEL`: una etiqueta nueva actualiza la configuración de Lambda y aparece en los logs api_timing. No prepara peticiones /paso ni excluye errores. Mantener memoria 1024, elegir una etiqueta nueva, revisar diff y desplegar; ejecutar directamente el ensayo HTTP/2 sin calentamiento de /paso. La etiqueta permite correlacionar logs, no garantiza por sí sola que todas las peticiones observadas ejecuten una inicialización; comprobar firstInvocationsWithResponse y REPORT/Init Duration, incluyendo los logs de llamadas abortadas. Conservar la etiqueta en futuros despliegues si se quiere evitar otro cambio innecesario de configuración.

Reporte `reports/http/fire-drill-base-r3-1024mb-20261028T031053Z.json`: memoria confirmada 1024 MB, 1.831 consultas, p95 HTTP 523,04 ms, p95 handler entre respuestas recibidas 26,47 ms; 202 timeouts y diez respuestas HTTP 500. El turno 1 concentró 194 timeouts. T4 añadió cinco y T6 tres; los errores 500 ocurrieron en T4 (siete) y T6 (tres). El tiempo de handler observado bajó frente a 512 MB, pero el resultado HTTP global no mejoró; no se declara esta configuración como solución.

Se incorpora `--http2` como transporte alternativo del runner para investigar las conexiones. Reutiliza una sesión con una petición/stream por persona; cada plazo incluye el tiempo de espera de stream. No hay fallback silencioso a HTTP/1, reintentos ni calentamiento añadido. El endpoint respondió correctamente a una consulta aislada GET /health mediante HTTP/2. Prueba: `npm run fire-drill:http -- --round=3 --fast --max-turns=12 --http2`. Se guarda aparte con sufijo `-http2`; repetir con condiciones de inicio comparables para no atribuir una mejora por reutilización de entornos Lambda solo al cambio de protocolo.

El snapshot preparado de R3 medido localmente fue aproximadamente 53 KB JSON y el servicio lo lee completo por cada /paso. Esto sugiere presión concentrada sobre la misma clave de DynamoDB, pero el tamaño JSON no equivale exactamente al tamaño facturable DynamoDB y los 500 no demuestran throttling sin logs. No se cambia a lectura eventualmente consistente ni se guarda la partida en memoria para ocultar el problema.

Archivo preservado: `reports/http/fire-drill-base-r3-512mb-20261028T030648Z.json`. Carga completa de R3 limitada a 12 turnos, 1.820 consultas, p95 HTTP 514,36 ms y 195 timeouts (10,71 %). Los 195 ocurrieron en el primer turno de 200 consultas; del turno 2 al 12 hubo cero timeouts. p95 HTTP por turno: 558,34 / 235,68 / 183,92 / 185,93 / 224,00 / 166,33 / 149,33 / 166,86 / 164,84 / 153,22 / 146,10 / 129,18 ms.

La memoria observada confirma 512 MB. El p95 del handler entre las 1.625 respuestas recibidas fue 64,08 ms. Solo cinco respuestas registraron primera invocación; no se conoce esa medición entre las 195 peticiones abortadas. La evidencia concentra el problema en el comienzo de la ronda, pero todavía no permite atribuirlo completamente a inicialización Lambda frente a conexiones nuevas del cliente/API Gateway. El resultado no pasa disponibilidad ni latencia máxima de la rúbrica. Se comparará con 1024 MB sin descartar el primer turno y sin calentamiento oculto.

Conservar las variables de autenticación y Budget antes de usar CDK. `SPOOKYTHON_LAMBDA_MEMORY_MB` admite 512 (valor predeterminado), 1024 y 1769 MB. Es una comparación de capacidad CPU/memoria, no un arreglo demostrado. Omitirla en un despliegue posterior vuelve a 512 MB.

1. Desplegar instrumentación a 512 MB y ejecutar `npm run fire-drill:http -- --round=3 --fast --max-turns=12` con el controlador web pausado. Guardar el reporte con un nombre que indique 512 MB antes de repetir.
2. Configurar `$env:SPOOKYTHON_LAMBDA_MEMORY_MB = '1024'`, revisar diff y desplegar. Repetir el mismo ensayo; comparar timeouts por turno, p95 HTTP, p95 handler, primeras invocaciones recibidas y memoria observada. El despliegue puede crear entornos nuevos: no se descartan sus llamadas lentas.
3. Conservar la configuración que mejore los resultados medidos considerando costo. Los 12 turnos son un diagnóstico incompleto, marcado acelerado y no aprobado como ronda completa. Código de salida 1 puede indicar que quedan personas activas; revisar el reporte. No simula cinco minutos ni sustituye aceptación.

Se mantiene un POST por persona activa y el plazo de 500 ms. No hay reintentos ocultos, calentamiento excluido de métricas ni concurrencia aprovisionada.

AWS asigna CPU proporcionalmente a memoria: aumentar memoria puede mejorar rendimiento aunque no se agote la RAM; no garantiza reducir la latencia de red. Fuente: https://docs.aws.amazon.com/lambda/latest/dg/configuration-memory.html . Al mismo tiempo facturado, 1024 MB duplica el componente GB-segundo frente a 512 MB; la duración real puede variar. El modelo de costos actual sigue siendo una referencia a 512 MB y debe actualizarse si se elige permanentemente otra configuración.
