# Pitch de 5 minutos y preguntas

## Guion de presentación (5 minutos)

### 0:00–0:35 — Problema

“Spookython simula una evacuación en Manta durante un brote. Los sobrevivientes necesitan llegar a un refugio por calles que pueden bloquearse, mientras los zombis se mueven. El reto técnico es elegir el siguiente paso rápido y válido para cada sobreviviente.”

### 0:35–1:15 — Demostración del producto

Abrir `WebUrl`. Crear una nueva ronda antes de la demo, con modo base o Pro seleccionado. Mostrar calles y refugios; identificar caminantes, corredores y hordas, y explicar que los dormidos permanecen ocultos hasta despertar. Ingresar la clave operativa solo en la interfaz, iniciar la simulación y señalar turno, posiciones, bloqueos, rescatados y mordidos.

### 1:15–2:10 — Decisión de ruta

Explicar `POST /paso`: recibe `sobrevivienteId`, `nodoActual` y `turno`; entrega `siguienteNodo`. Dijkstra pondera distancia y velocidad; excluye cierres, zombis visibles y el nodo y vecinos de la horda. Se conserva el trabajo del snapshot preparado. El cliente consulta realmente el endpoint por cada persona activa y un timeout superior a 500 ms o un paso inválido deja a la persona quieta.

### 2:10–3:00 — Arquitectura y seguridad

Mostrar [`arquitectura.svg`](arquitectura.svg). CloudFront sirve el panel por HTTPS desde un bucket S3 privado con OAC. API Gateway conecta a una Lambda Node.js 22; DynamoDB comparte estado y caché de rutas entre invocaciones. La API key protege las operaciones POST y se compara mediante hash en el servidor. El mapa se incluye en el paquete para evitar una descarga por turno.

### 3:00–4:00 — Evidencia

Mostrar `reports/http/fire-drill-base-provisioned-20261028T050843Z.json`: ensayo AWS base de 200 personas y 12 turnos, 1.730 HTTP 200, cero errores y timeouts, p95 298,72 ms. Se incluyeron primeras invocaciones. Usó 200 entornos temporales de 1 GB y dos conexiones HTTP/2. Se retiró la capacidad al terminar; la demo actual es bajo demanda y puede sufrir arranques en frío. No afirmar tres rondas oficiales completas ni nota global 10. Hay 28 pruebas automatizadas aprobadas, incluyendo reglas y Pro.

### 4:00–4:35 — Costos y límites

Mostrar el Budget mensual de USD 5 y explicar que solo avisa. Presentar [`costos.md`](costos.md) como estimación y citar el gasto real revisado en Billing. Declarar que la demo comparte un mundo, usa refugios aproximados y velocidades asumidas, y no sustituye un sistema real de emergencias.

### 4:35–5:00 — Cierre

“El resultado es un simulador visible y un endpoint de decisión que se puede probar por separado. La prueba de fuego verifica reglas y carga; la prueba externa verifica el API realmente desplegado. El repositorio contiene código, historial, arquitectura, instrucciones y costos.”

## Preguntas posibles

**¿Qué pasa si se bloquea una calle?** El evento elimina el segmento de las rutas transitables. Se valida la ruta guardada; si ya no es segura, se recalcula.

**¿Por qué el movimiento no depende del mapa dibujado?** El panel solo representa el estado. La API valida nodos y calles con los datos del grafo en el servidor.

**¿Cómo escalaría a cientos de sobrevivientes concurrentes?** Lambda escala por solicitudes y DynamoDB usa capacidad bajo demanda. A mayor tráfico se medirían concurrencia, límites del servicio y contención de escritura sobre el estado compartido; el prototipo no declara esos límites como resueltos.

**¿La API es segura para producción?** Tiene API key para el reto, controles básicos de entrada y permisos IAM limitados. No implementa usuarios, cuotas por cliente, rotación gestionada ni protección avanzada contra abuso; es una demo, no un servicio de emergencia.

**¿Qué significa la latencia p95?** El 95% de las solicitudes medidas finalizó en ese tiempo o menos. Separar siempre latencia local del algoritmo y latencia HTTP observada desde la red externa.

**¿Qué pasa si AWS cuesta más de USD 5?** El Budget manda avisos cuando se alcanzan umbrales; no corta servicios. Se revisa Cost Explorer y se apagan recursos que no se necesiten después del evento.
