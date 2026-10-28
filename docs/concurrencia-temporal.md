# Opción temporal de concurrencia aprovisionada

El usuario autorizó la prueba temporal el 27/10/2026. La activación real queda pendiente de ejecutar el script desde su PowerShell, donde conserva las variables de autenticación; el proceso del agente no comparte esas variables.

## Ejecución autorizada con retirada

Desde la carpeta del proyecto y con el controlador web pausado: `./scripts/test-provisioned.ps1`. Conserva la clave de la terminal (la solicita enmascarada si falta), mantiene las variables de Budget existentes o los valores acordados, configura 1024 MB y alias prepared con 200 entornos, despliega, ejecuta R3 con HTTP/2 durante 12 turnos y archiva el reporte con nombre provisioned y fecha. El código de salida 1 por ronda incompleta no impide el archivo ni la retirada.

El bloque finally configura concurrencia 0 y vuelve a desplegar, tanto si el ensayo falla como si falla la activación. Se verificaron ambos caminos con comandos simulados en una copia aislada, sin cambios en AWS. Se guarda `reports/http/provisioned-trial-cleanup-latest.json` con el resultado del despliegue de retirada. Mantener abierta la terminal hasta `RETIRADA COMPLETADA`; un cierre del proceso o fallo de red puede impedir la limpieza. Si aparece `RETIRADA FALLIDA`, comprobar y retirar de inmediato la configuración del alias en Lambda; los cargos pueden continuar.

## Configuración concreta

CDK conserva el comportamiento bajo demanda mientras `SPOOKYTHON_PROVISIONED_CONCURRENCY` sea 0 o no esté definida. Admite 50, 100, 150 y 200 para preparación gradual: crea una versión publicada y alias `prepared`, asigna los entornos solicitados e integra API Gateway con ese alias. El script espera cada etapa y solo ejecuta el ensayo cuando alcanza 200. No basta con preparar un alias si el API sigue invocando $LATEST. No se cambia la cuota ni se reserva toda la cuenta.

Esta opción prepara el entorno de ejecución antes de recibir la carga. No garantiza p95 HTTP ≤150 ms: la red, API Gateway y la primera conexión de DynamoDB aún pueden consumir tiempo. Tampoco garantiza ausencia absoluta de reinicializaciones. Medir el primer turno, sin excluirlo.

## Costo verificable

Fuente primaria: catálogo AWSLambda para us-east-1, publicado 22/10/2026, consultado 27/10/2026:
https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/current/us-east-1/index.json

Uso `Lambda-Provisioned-Concurrency-ARM`, tarifa `0.0000033334 USD/Lambda-GB-Second`.

Para 200 entornos a 1024 MB (=1 GB):

- 15 minutos: 200 × 1 × 900 × 0,0000033334 = USD 0,600012.
- 30 minutos: USD 1,200024.
- Una hora: USD 2,400048.
- Un día: USD 57,601152.

Estos importes son solo capacidad; se suman duración de ejecución, solicitudes, inicializaciones cobrables y demás servicios/impuestos. La facturación de capacidad redondea hacia arriba a cinco minutos e incluye el tiempo activo de preparación/despliegue y retirada; «una prueba de 15 minutos» no garantiza exactamente 15 minutos facturados. Los créditos y descuentos no se presuponen. El Budget avisa, no detiene servicios.

Fuentes complementarias:
https://aws.amazon.com/lambda/pricing/
https://docs.aws.amazon.com/lambda/latest/dg/provisioned-concurrency.html

## Secuencia después de autorizar la opción

Conservar clave, hash, correo y monto del Budget y etiqueta de despliegue en la terminal. Configurar memoria 1024 y concurrencia 200; revisar diff y desplegar. Comprobar en Lambda que el alias prepared tenga estado READY antes de ejecutar el diagnóstico de R3. No se envían consultas ocultas de calentamiento. Revisar p95 HTTP, timeouts y métricas ProvisionedConcurrencySpilloverInvocations del alias.

El script intenta automáticamente la retirada al terminar con `SPOOKYTHON_PROVISIONED_CONCURRENCY = '0'` y un despliegue nuevo. Comprobar en la consola que ya no existe configuración aprovisionada. Hasta que termine esa retirada, el cargo puede continuar. Si el despliegue falla, revisar de inmediato el estado del alias y su capacidad. No se promete apagado fuera de la vida del proceso local: el usuario ejecuta el script en esta sesión. Mantener 0 en las siguientes publicaciones salvo que se autorice otra ventana pagada.

## Evidencia previa

## Resultado de la prueba autorizada

### Ensayo con paquete corregido, conexión preparada y dos sesiones

Reporte `reports/http/fire-drill-base-provisioned-20261028T050843Z.json`: 1.730 consultas, todas HTTP 200, cero timeouts/errores, cero movimientos inválidos y cero turnos >2 s. Confirmó 1024 MB, tipo provisioned-concurrency y alias prepared; se observaron 194 primeras invocaciones. p95 HTTP total 298,72 ms (banda 7), p95 handler recibido 80,17 ms; T1 p95 303,05 ms sin timeouts. El ensayo fue de 12 turnos de R3, no una aceptación completa de las tres rondas. La banda de disponibilidad es 10 en esta muestra; no se afirma 10 global ni p95 ≤150 ms.

El comprobante `reports/http/provisioned-trial-cleanup-20261028T050943Z.json` registra retirada desplegada correctamente. La ventana del script fue 23:50 del 27/10 a 00:09 del 28/10, Ecuador (aproximadamente 19 minutos, incluyendo preparación gradual y retirada); no se toma esa ventana como tiempo completo de 200 entornos ni como facturación exacta. La API vuelve al modo bajo demanda después de la retirada: el resultado aprovisionado no certifica el comportamiento actual de arranque del sitio. Se conservan ambas configuraciones y reportes por separado.

### Causa de inicialización confirmada y corrección del artefacto

La consulta de logs corregida mostró Runtime.UserCodeSyntaxError: Unexpected identifier 'node'. Se reprodujo leyendo el index.mjs exacto de cdk.out y ejecutando `node --check`: la línea generada era `import { createRequire } from node:module;`, sin comillas. El banner de CDK con comillas dobles internas fue alterado en la invocación esbuild por Windows. El uso de comillas simples internas conserva el literal y el paquete generado realmente por CDK ahora pasa sintaxis/importación/GET /health local sin llamadas AWS.

Se corrige la hipótesis anterior: CreateLogStream throttling fue una observación secundaria, no la causa confirmada del fallo de inicialización. La prueba local anterior usó una compilación directa de esbuild y no reprodujo la invocación de CDK en Windows; fue una verificación insuficiente. Hay regresión automatizada para rechazar el banner inválido y aceptar el correcto.

Antes de cualquier activación, el script hace synth sin lookups y ejecuta `scripts/validate-lambda-bundle.mjs` contra el manifiesto real de CDK. Un fallo de sintaxis/importación detiene el flujo antes de crear entornos pagados. El recibo distingue activationAttempted para no confundir una validación previa fallida con una retirada fallida. Las 28 pruebas, compilación y validación del artefacto CDK pasan. No se ha medido aún el rendimiento de la versión corregida con capacidad aprovisionada.

El usuario aportó después el evento original del fallo: PreparedApiAlias CREATE_FAILED con NotStabilized al aplicar concurrencia; CDK detectó además ThrottlingException de logs:CreateLogStream (cuatro ocurrencias). La cuota publicada de esa operación es 50 TPS por cuenta/región, independiente de la cuota Lambda de 1000. Es una pista correlacionada, no prueba suficiente de causa única sin INIT_REPORT. El diagnóstico de kms:Decrypt DryRunOperationException decía que habría tenido éxito: no se trata como un AccessDenied.

Se corrigió la preparación de conexión para leer solo una clave de metadatos ausente (`INITIALIZATION_CHECK`), sin acceder al snapshot grande ni escribir datos. La preparación pagada incorpora dispersión inicial y hasta cuatro intentos solo para fallos transitorios; permisos y errores no transitorios fallan inmediatamente. Los reintentos son de inicialización, nunca de POST /paso ni una ampliación de su plazo. El script prepara 50/100/150/200 con despliegues separados, conserva transcripción y retira todo si cualquier etapa falla. Estas correcciones están verificadas localmente; no se solicita otro intento pagado hasta revisar los errores de inicialización del intento fallido. La fase gradual puede tardar más que la activación directa y se factura el tiempo de cada nivel.

El siguiente intento, iniciado el 27/10/2026 a las 23:01 de Ecuador, falló durante activación antes de producir reporte. El comprobante archivado `reports/http/provisioned-trial-failed-20261028T040139Z.json` registra retirada CDK completada a las 23:10 y `report: null`; la captura coincide. No se deduce la causa de activación del mensaje genérico del wrapper. DescribeStackEvents fue denegado al perfil cdk-developer. Se requiere el error original de CDK o el evento de CloudFormation antes de reintentar; no se declara esta variante como validada. El script ahora guarda transcripción después de introducir la clave y calcular su hash, para conservar los errores de activación y retirada sin registrar la clave cruda.

### Comparación con dos conexiones bajo demanda

`reports/http/fire-drill-base-r3-1024mb-http2-2connections-20261028T035635Z.json`: 1.817 consultas, 182 timeouts en T1 y cuatro HTTP 500 en T4, p95 total 510,11 ms. Del turno 3 al 12, todos los p95 por turno quedaron entre 120,27 y 144,36 ms; no se usa esto para excluir T1/T2 ni los errores de las bandas globales. El cliente confirmó inicialización on-demand y ninguna cualificación de alias. El diagnóstico respalda reducir cola de streams con dos sesiones, pero no resuelve el inicio bajo demanda.

### Variante preparada para el siguiente ensayo temporal

El script temporal utiliza ahora dos conexiones HTTP/2 y archiva el reporte correspondiente con el mismo esquema provisioned y fecha. La entrada Lambda es ESM con top-level await. Solo cuando AWS indica provisioned-concurrency se espera una lectura de DynamoDB durante inicialización y se descarta su resultado; no se modifica ni cachea el estado del mundo. Esta lectura prepara credenciales/conexión SDK y puede generar cargo de inicialización y lectura. No se hace calentamiento oculto de POST /paso ni se eliminan muestras del reporte. Bajo demanda no se ejecuta esa lectura adicional.

El log `provisioned_connection_ready` acredita finalización de la conexión, no éxito del SLO. Los códigos seguros de error distinguen DYNAMODB_THROTTLED, DYNAMODB_LIMIT y fallos genéricos sin exponer mensajes internos ni claves. Las 25 pruebas, compilación y smoke test del bundle ESM pasan; el efecto real de esta variante está pendiente. AWS documenta completar tareas asíncronas con top-level await durante inicialización para concurrencia aprovisionada: https://docs.aws.amazon.com/lambda/latest/dg/nodejs-handler.html .

`reports/http/fire-drill-base-provisioned-20261028T035049Z.json`: 1.730 solicitudes, todas HTTP 200, cero timeouts/errores y cero turnos >2 s. Confirmó `provisioned-concurrency`, alias `prepared`, memoria 1024 MB y 127 primeras invocaciones recibidas. T1 p95 HTTP 468,33 ms, p95 total 358,04 ms, p95 handler recibido 142,64 ms. En este ensayo corto, disponibilidad en banda 10 y latencia en banda 4; no certifica la ronda completa ni el objetivo 150 ms.

El comprobante `reports/http/provisioned-trial-cleanup-latest.json` registra `cleanupDeploymentSucceeded: true`; la captura del usuario también confirma RETIRADA COMPLETADA. La ventana del proceso fue aproximadamente seis minutos, no una medición exacta del periodo facturado. No se afirma un costo final sin facturación AWS. El script devolvió CDK a concurrencia 0 y la API a bajo demanda.

Una consulta aislada a la sesión HTTP/2 negoció `maxConcurrentStreams: 128`, frente a las 200 solicitudes lanzadas; un ping de transporte aislado midió aproximadamente 86 ms, no el p95 de POST /paso. Se añade al runner `--http2-connections=2` para separar el efecto de la cola de streams, sin reactivar capacidad pagada. Los arranques bajo demanda siguen posibles; no se atribuirá toda mejora a este parámetro sin controlar la reutilización de entornos.

La carga diferida no resolvió el primer lote: reporte `reports/http/fire-drill-base-r3-1024mb-http2-lazy-20261028T033355Z.json`, 1.849 consultas, 186 timeouts (todos en T1), p95 HTTP 502,77 ms, cero errores HTTP. No se presenta como mejora. La comparación con concurrencia aprovisionada queda pendiente de autorización, despliegue y medición.

## Resultado final comprobado - 28/10/2026 05:08 UTC

Ensayo `reports/http/fire-drill-base-provisioned-20261028T050843Z.json`: 1.730 respuestas HTTP 200, cero errores, timeouts, pasos inválidos o turnos mayores de 2 s; p95 HTTP 298,72 ms. Confirmó alias prepared e inicialización provisioned-concurrency. Se incluyeron 194 primeras invocaciones recibidas. Ensayo base parcial de 12 turnos; no certifica las tres rondas completas ni la meta 150 ms. El comprobante archivado `provisioned-trial-cleanup-20261028T050943Z.json` acredita retirada correcta y regreso a bajo demanda. Los párrafos anteriores describen intentos históricos, no pendientes de esta ejecución. El fallo de inicialización anterior se reprodujo como error de sintaxis del banner ESM sin comillas y quedó corregido y validado sobre el artefacto CDK real.
