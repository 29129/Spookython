# Objetivo de latencia de Refugio 593

El objetivo es p95 HTTP de POST /paso <=150 ms con 200 sobrevivientes simultaneos. El limite funcional sigue siendo 500 ms. No basta medir el algoritmo ni GET /health.

## Cambios

- PREPARE publica las decisiones en 16 registros independientes, distribuidos por clave de particion. Una transaccion de 17 escrituras actualiza STATE y los 16 grupos de forma atomica, con condicion sobre turno, revision y sesion del estado anterior.
- /paso usa GetItem fuertemente consistente con proyeccion del sobreviviente solicitado, turno, sesion, fase y peligros/cierres. Valida posicion, turno, estado, vecindad y peligros antes de responder. No mantiene estado mutable del mundo en RAM de Lambda.
- Los snapshots anteriores sin decisiones compactas mantienen compatibilidad. PREPARE/RESOLVE/reinicio publican el formato compacto al siguiente cambio.
- /paso ya no lee STATE en el camino habitual: lee un grupo pequeno, fuertemente consistente, y proyecta solo el sobreviviente solicitado. La prueba de 200 personas verifica que cada grupo completo serializado como AttributeValue ocupa menos de 4 KiB. La lectura se cobra por ese grupo, no por el mundo completo. Las transacciones agregan costo de escritura; no hay cache mutable en RAM.
- Ante una transaccion rechazada no se publica ningun grupo. Los logs registran razones de throttling y cancelacion, sin cuerpos ni claves, para distinguir concentracion de lecturas de otros limites de DynamoDB.
- CloudFront /api/* reenvia a API Gateway por HTTPS, elimina solamente el prefijo /api, preserva x-api-key y no reenvia Host del navegador. Cache deshabilitada y TTL de errores 5xx cero. Cada POST llega al origen.
- La web publicada conserva el endpoint directo como predeterminado. Abrir https://d2qqi0nkfeyck5.cloudfront.net/?api=edge permite probar /api. El preview local conserva su API aislada.
- El despliegue normal deja concurrencia aprovisionada en cero. Prepararla requiere una prueba temporal explicita; no hay capacidad pagada permanente nueva.

## Comparar desde el equipo del evaluador

Con SIMULATOR_API_KEY ya configurada en esa terminal, pausar el controlador web y ejecutar desde la raiz:

```powershell
$env:MEASUREMENT_LOCATION = 'Ecuador-equipo-evaluador'
npm run latency:compare
```

Reinicia el mundo cuatro veces: directo, CloudFront, CloudFront, directo. Cada muestra usa ronda 3, 200 personas, 12 turnos acelerados y HTTP/2 con dos conexiones. Reportes independientes y resumen en reports/http/comparison-FECHA/. Se incluyen primeros accesos, errores y tiempos fuera de plazo. Una ronda incompleta no se presenta como prueba oficial completa.

Para comparar eliminando arranques en frio durante ese ensayo:

```powershell
./scripts/test-provisioned.ps1 -CompareEdge
```

Este comando tiene cargos: prepara gradualmente hasta 200 entornos de 1 GB, ejecuta A-B-B-A y usa finally para desplegar capacidad cero incluso si falla el ensayo. No cerrar la terminal ni detener el proceso: un cierre forzado o fallo de AWS puede impedir la retirada. Comprobar el recibo reports/http/provisioned-trial-cleanup-latest.json; si cleanupDeploymentSucceeded no es true, revisar y retirar capacidad. No se activa automaticamente con npm run latency:compare.

## Comparacion regional

Ejecutar el mismo repositorio actualizado en AWS CloudShell con la region us-east-1 seleccionada, Node >=22 y npm ci. Configurar la clave sin mostrarla ni guardarla en el historial:

```bash
read -r -s -p 'Clave de control: ' SIMULATOR_API_KEY; echo
export SIMULATOR_API_KEY
export MEASUREMENT_LOCATION='AWS-CloudShell-us-east-1'
npm run latency:compare
unset SIMULATOR_API_KEY
```

Se puede subir un ZIP del codigo local excluyendo node_modules, cdk.out, tmp, .git y secretos en lugar de clonar. No ejecutar las dos comparaciones simultaneamente: ambas controlan el mismo mundo. El resumen registra el lugar declarado; no lo verifica por geolocalizacion. Una buena cifra regional no certifica la experiencia desde Ecuador.

## Comprobacion sin clave

```powershell
npm run latency:network
```

Hace 25 GET /health por endpoint, secuenciales por HTTP/2, sin cambiar el mundo. Es diagnostico del trayecto; no demuestra rendimiento de /paso ni sustituye el ensayo autenticado.

## Criterio de aceptacion

El primer diagnostico desde este equipo dio GET /health p95 directo 138,22 ms y CloudFront 166,05 ms (reports/http/network-probe-latest.json). No demuestra una mejora de CloudFront ni mide /paso; por eso no se promueve como recorrido predeterminado antes del A-B-B-A autenticado.

Solo declarar el objetivo alcanzado despues de que las muestras autenticadas desde el equipo relevante den p95 <=150 ms, sin movimientos invalidos ni fallos ocultos. Confirmar despues las tres rondas completas con la cadencia oficial. La mejora de CloudFront depende del trayecto y no garantiza por si sola ese umbral.
