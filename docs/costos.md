# Estimación de costos

## Alcance y supuestos

Estimación de planificación para `us-east-1`, una demo pequeña, una sola Lambda ARM64 de 512 MB y DynamoDB bajo demanda. No equivale a una cotización ni a un límite de gasto. Las tarifas pueden variar por región, fecha, impuestos, créditos y elegibilidad de la cuenta. Revisar AWS Pricing Calculator y facturación real antes y después del evento.

Supuesto mensual ilustrativo actualizado para el contrato HTTP: una prueba completa base y una Pro, cada una con tres rondas de hasta 150 turnos. Se supone que todas las personas permanecen activas durante todos los turnos para modelar un volumen alto: 90 000 solicitudes a `/paso`, 1 800 solicitudes PREPARE/RESOLVE y seis reinicios, en total 91 806 llamadas. El cálculo es reproducible con `node scripts/estimate-costs.mjs` y queda guardado en [`../reports/audit/cost-model.json`](../reports/audit/cost-model.json).

Cada llamada se modela con 200 ms de duración facturada de Lambda a 512 MB; no se confunde esa hipótesis con la latencia HTTP. Se asume un snapshot de 100 KiB en DynamoDB, lectura consistente de 25 RRU y escritura de 100 WRU. Los estados Pro iniciales medidos localmente ocuparon aproximadamente 9, 24 y 60 KB para 20/80/200 personas; el tamaño real cambia durante la ronda. El modelo reserva margen, no una cota garantizada. El panel no se supone abierto continuamente el resto del mes.

## Cálculo visible

| Servicio | Cálculo de referencia | Estimación para el supuesto |
| --- | --- | ---: |
| API Gateway HTTP API | 91 806 / millón × USD 1 | USD 0,0918 |
| Lambda ARM64 | 91 806 × 0,2 s × 0,5 GB × USD 0,0000133334, más USD 0,20/millón de invocaciones | USD 0,1408 |
| DynamoDB bajo demanda | 2 295 150 RRU × USD 0,125/millón y 180 600 WRU × USD 0,625/millón | USD 0,3998 |
| S3 | Menos de 100 MB y pocas solicitudes para alojar `web/` | Muy bajo; revisar solicitudes y almacenamiento de la región |
| CloudFront | Solicitudes y transferencia de datos del panel | Puede ser USD 0 dentro del plan/nivel disponible o variar con uso y plan |
| CloudWatch Logs | Registros de Lambda con retención de 7 días | Variable según volumen; evitar registrar claves o cuerpos sensibles |
| AWS Budgets | El recurso de budget configurado por el proyecto | Revisar la tarifa vigente de Budgets en la cuenta |

**Subtotal modelado de API, Lambda y DynamoDB: USD 0,6323 al mes**, antes de créditos o descuentos. Faltan S3, CloudFront, CloudWatch, transferencia, despliegues e impuestos; no es un total cerrado. Las tarifas de referencia provienen de las páginas oficiales enlazadas abajo, consultadas el 26/10/2026. El modelo no añade nuevas suscripciones ni capacidad provisionada por activar Pro. Abrir el mapa continuamente, repetir pruebas, superar el tamaño/duración supuestos o recibir tráfico imprevisto cambia el cálculo. El Budget de USD 5 manda alertas, no bloquea ni detiene servicios.

La consola mostró aproximadamente USD 0.01 de gasto previsto al revisar el Budget, pero ese valor corresponde a la fecha de la captura y a toda la cuenta; no se puede presentar como costo final del evento.

## Gasto real del evento

Cost Explorer, agrupado por servicio para el 1–26 de octubre de 2026, mostró un total neto de cuenta de **−USD 0,00** y filas por servicio redondeadas a USD 0,00. Este número es el valor que muestra el reporte, no una medición exacta de costo cero.

La cuenta también contiene recursos del sistema anterior en desarrollo. La tabla incluye CodeBuild y Step Functions, entre otros servicios; por ello, el total es de toda la cuenta y **no se puede atribuir exclusivamente a Spookython**. Algunos servicios usados por ambos proyectos también pueden quedar mezclados. Para la entrega se debe etiquetar esta cifra como gasto neto visible de la cuenta en el periodo, no como costo real aislado del simulador. Revisar nuevamente Cost Explorer/Bills después de que se actualicen los datos y guardar la captura final. El Budget actual también es de cuenta.

## Fuentes oficiales

- [Amazon API Gateway — precios](https://aws.amazon.com/api-gateway/pricing/)
- [AWS Lambda — precios](https://aws.amazon.com/lambda/pricing/)
- [Amazon DynamoDB — precios](https://aws.amazon.com/dynamodb/pricing/)
- [Amazon S3 — precios](https://aws.amazon.com/s3/pricing/)
- [Amazon CloudFront — planes y precios](https://aws.amazon.com/cloudfront/pricing/)
- [AWS Pricing Calculator](https://calculator.aws/)
