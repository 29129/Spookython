# Cierre de entrega Track A

Estado al 27/10/2026. Fecha límite indicada por el reto: 28/10/2026, 10:00, Ecuador.

## Acceso para quien evalúa

1. Entregar el enlace público `WebUrl` que imprime CloudFormation/CDK y el repositorio público. Abrir el enlace en una ventana privada para verificar acceso sin sesión de AWS.
2. Compartir la clave de control vigente por un canal privado acordado con el evaluador. No incluirla en README, Git, PDF ni capturas. Sin clave, se puede observar; para controlar la simulación debe ingresarse en el campo «Clave de control».
3. Elegir ronda 1 y modo base, pulsar «Nueva ronda» y después «Iniciar simulación». No operar simultáneamente otro controlador: el mundo es compartido.
4. Para Pro, activar la casilla y crear una ronda nueva. Comprobar ocupación/reservas de refugios y cinco camionetas, además de rescates, errores y timeouts.
5. Con cuota reducida, seleccionar «Hasta 8» solo para ensayo. Explicar esta limitación; la demostración no acredita carga completa. Tras aprobarse el aumento, usar carga completa y obtener los reportes de las tres rondas.

## Acciones que pueden completarse mientras AWS revisa la cuota

Budget comprobado: `docs/budget.png` muestra destinatario Verified asociado a dos alertas: costo real >80 % (USD 4 de USD 5) y costo previsto >100 % (USD 5), ambas sin superar. La captura reemplaza la anterior. `docs/budget-alertas.png` conserva una vista adicional de los umbrales. El pendiente de evidencia de configuración del Budget queda cerrado; no se afirma haber probado la entrega efectiva de un correo de alerta.

- Resumen actualizado guardado en `docs/budget-resumen.png`: `Spookython-Monthly-Cost`, presupuesto USD 5, gasto mostrado USD 0,00 y previsión USD 0,01 (captura del usuario, 27/10/2026). Se complementa con `docs/budget.png`, que acredita alertas y correo verificado. El importe redondeado de la cuenta no acredita costo cero del proyecto.
- Revisar facturación del evento y actualizar `docs/costos.md`. Los servicios del sistema anterior comparten cuenta: no atribuir todo el gasto a esta aplicación ni afirmar costo cero por redondeo.
- Verificar que el repositorio público contenga README, fuentes, diagrama SVG/Mermaid, costos y reportes. Publicar los últimos cambios antes de copiar la URL de entrega.
- Revisar `output/pdf/presentacion-spookython.pdf` y `docs/pitch.md`. El PDF describe evidencia local; no presentarla como latencia o disponibilidad de AWS. Incorporar resultados de AWS solo cuando existan.
- Ensayar cinco minutos de presentación y tres de preguntas. Explicar Dijkstra, hordas y vecinos, predicción condicionada, cupos, flota y estado compartido en DynamoDB.
- Subir PDF, repositorio, URL pública y evidencias a la plataforma del evento. Verificar el acuse de entrega; los archivos locales no equivalen a haberlos entregado.

## Al aprobarse el aumento

Volver a consultar `ConcurrentExecutions` y ejecutar las rondas HTTP base y Pro sin límite de concurrencia. Revisar p95, HTTP 503/otros errores, timeouts, turnos >2 s, pasos inválidos y cupos. Si persisten fallos, no dar por cerrado el rendimiento: correlacionar la prueba con CloudWatch y la integración de API Gateway.
