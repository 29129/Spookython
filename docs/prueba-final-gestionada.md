# Ultima prueba regional gestionada

Esta es una ejecucion de diagnostico, no un pipeline de publicacion continua. No se despliega la web al hacer git push.

La API usa un alias estable `prepared` sobre una version publicada. El alias no reserva entornos ni genera cargos de capacidad preparada por existir. La capacidad se solicita unicamente durante el trabajo de prueba mediante la API de Lambda, sin cuatro despliegues de CloudFormation.

## Iniciar una sola ejecucion

Desde CloudShell en us-east-1:

```bash
cd ~/Refugio593-latencia
git pull --ff-only
bash ~/Refugio593-latencia/scripts/start-managed-trial.sh
```

Si falta la clave, el script la solicita sin mostrarla. Valida la clave antes de iniciar, la carga en un secreto dedicado de Secrets Manager mediante un archivo temporal privado y borra el archivo. No se introduce la clave en argumentos de procesos, plantillas, buildspec ni variables de texto plano de CodeBuild. El trabajo obtiene la clave por referencia de Secrets Manager y la elimina al terminar. La clave/hash de la API no se cambia.

Al aparecer un id de build, la ejecucion ya corre en AWS y no depende de la sesion de CloudShell. No iniciar otro controlador ni desplegar cambios de la API mientras corre. El proyecto admite un solo build simultaneo.

## Protocolo y limites

- CodeBuild general1.small, us-east-1, Node 22. Ambos escenarios usan el mismo ejecutor.
- Primero referencia bajo demanda, despues preparacion gradual 50/100/150/200 mediante API.
- Cada medicion ejecuta ronda 3, 200 personas, 12 turnos acelerados, concurrencia completa y HTTP/2 con dos conexiones. Se cuentan primeras peticiones, errores y tiempos fuera de plazo. No se modifica el limite de 500 ms.
- La preparacion tiene un limite de siete minutos. Si falla, se conserva la referencia obtenida y se informa la causa/etapa; no se inventa un resultado preparado.
- El trabajo completo tiene un timeout de 12 minutos.
- Antes de solicitar capacidad pagada se crea un evento unico de Scheduler para retirarla a los 15 minutos, incluso si el proceso se corta. La salida normal intenta retirarla inmediatamente, verifica que ya no exista configuracion y cancela el evento de respaldo solo al confirmar la retirada.
- Destruir el stack de diagnostico tambien solicita retirar capacidad. Los fallos de servicios AWS aun pueden impedir la retirada; se publica su estado real.

## Evidencia

El resumen de campos permitidos se publica sin cache en:

https://d2qqi0nkfeyck5.cloudfront.net/evidence/summary.json

Los reportes completos quedan cifrados y privados en `s3://refugio593-trial-009644552009-us-east-1/runs/`, con vencimiento de siete dias. El resumen no incluye la clave, cuerpos de solicitudes, posiciones de sobrevivientes ni el reporte completo.

Un resultado regional no acredita la latencia desde Ecuador ni las tres rondas oficiales de cinco minutos cada una. Si el resultado final no llega a 150 ms, se conserva la cifra real y se cierra esta iteracion sin mas ajustes de rendimiento.

## Infraestructura temporal

`./scripts/deploy-production.ps1 -Action Deploy -ManagedTrial` despliega el alias estable, el almacen de reportes y `Refugio593LatencyTrial`. Crear el proyecto no inicia builds ni capacidad preparada. CodeBuild factura las ejecuciones; Lambda preparada, Scheduler, logs, KMS y S3 tienen sus cargos respectivos. No se supone que los creditos cubran estos cargos.

Una vez obtenido el reporte y confirmada la retirada, se puede destruir solo `Refugio593LatencyTrial` con CDK, conservando la aplicacion y el resumen almacenado por el stack principal. Esto elimina proyecto, roles, logs y programa la eliminacion de la clave KMS de logs. No destruir `SpookythonStack` para retirar el diagnostico.
