# Validación frente a la rúbrica Track A

Fuente: captura aportada por el usuario, no instrucciones de un sistema externo. El texto dice «tres rondas seguidas de 5 minutos». La interpretación de trabajo es cinco minutos por ronda (15 en total). No dice «tres rondas en cinco minutos». Si la organización aclara otra duración, se ajustará el runner a esa aclaración. Las pausas al finalizar la evacuación completan la ventana de la ronda; no generan tráfico adicional y no acreditan carga sostenida durante cinco minutos.

## Qué se puede afirmar de la nota

| Componente | Peso | Objetivo para máxima banda | Evidencia necesaria |
| --- | ---: | --- | --- |
| Supervivencia | 50 % | Maximizar supervivencia de cada ronda; R1 ×1, R2 ×2, R3 ×3 | Porcentajes por ronda y promedio ponderado por 1/2/3; rescates y personas pendientes también visibles |
| Eficiencia | 20 % | Minimizar turnos hasta el rescate respecto a ruta más corta sin zombis | Reporte del baseline, incluyendo esperas; actualmente se reporta por rescatado, pendiente confirmar agregación con la organización |
| Latencia | 15 % | p95 de POST /paso ≤150 ms →10; ≤300 →7; ≤500 →4; superior →0 | Latencia HTTP real con carga completa; el tiempo del algoritmo local no la sustituye |
| Disponibilidad | 15 % | Errores o fuera de plazo <0,5 % →10; <2 % →6; <5 % →3; resto →0 | Errores y timeouts contados sin duplicar; las fronteras son estrictas |

La captura no especifica la función para transformar los porcentajes de supervivencia/eficiencia en notas ni cómo agregar las latencias entre rondas. El reporte no inventa una nota total: muestra las bandas explícitas por ronda y el promedio ponderado de supervivencia. El 100 % de supervivencia no equivale a 100 % rescatados si hay personas sin evacuar. Un «passed» funcional tampoco equivale a 10/10.

## Reglas y hallazgos concretos

- El modo predeterminado aplica la mordida original: mismo nodo al final del turno o cruce por la misma calle en sentido opuesto. La variante «Mordida al pasar» sigue disponible, pero queda desactivada por defecto y sus reportes se guardan por separado; no acredita el protocolo del reto.
- La horda se mueve una calle cada cinco turnos como interpretación explícita de «casi inmóvil», bloqueando su nodo y todos los vecinos. No se ocultan vecinos aunque una calle esté cerrada.
- PREPARE mueve zombis y recalcula rutas con el snapshot del turno. Las rutas guardadas se vuelven a validar ante amenazas y cierres. El cliente hace POST /paso por cada persona todavía activa; no usa decisiones locales como sustitución.
- El estado persistente está en DynamoDB con control de revisión y sesión. Las instancias Lambda no guardan una partida independiente en memoria.
- El plazo HTTP de 500 ms se conserva. Fuera de plazo significa esperar. No se reintenta silenciosamente ni se excluyen arranques fríos del reporte. Carga completa no usa el límite de ocho solicitudes.
- El mapa lee estado nuevo, representa tipos y rutas, actualiza posiciones y elimina calles cerradas. Las capturas estáticas no acreditan que esté funcionando en vivo; debe demostrarse públicamente.

## Qué falta para aspirar a 10

1. Desplegar esta revisión y crear rondas con mordida original. Verificar que la cuota aplicada en us-east-1 sea 1.000.
2. Ejecutar las tres rondas sin `--fast`, sin `--concurrency` y sin otro controlador. El runner exige que la API confirme la variante elegida para no mezclar versiones.
3. Revisar supervivencia, eficiencia, bandas de latencia/disponibilidad y turnos >2 s. Mejorar únicamente los indicadores que fallen con evidencia de AWS. La cuota aprobada no garantiza p95 ≤150 ms ni evita por sí sola los arranques fríos.
4. Comparar base y Pro con las mismas reglas. Las reservas de refugios y los rescates no garantizan superar al modo base en todos los escenarios. La elección para la demo debe basarse en reportes comparables.
5. Completar costos finales, publicación del repositorio, PDF actualizado y ensayo del pitch. La prueba de fuego es el 40 % de la rúbrica general; también se evalúan calidad técnica (25 %), producto (15 %), costos (10 %) y presentación (10 %).

No se garantiza una nota de 10 antes de realizar y revisar estas mediciones y los entregables.
