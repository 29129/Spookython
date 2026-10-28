# Diseño y entorno local: Refugio 593

**Estado actual:** vista 3D, modelos opacos y corrección de evacuación desplegados en producción el 28/10/2026. Ver `reports/deployments/release-3d-600-20261028.json`. Tras actualizar, preparar otra ronda con la clave vigente. Las secciones siguientes conservan el proceso de desarrollo y validación local.

La nueva interfaz es una revisión posterior a la entrega inicial. Conserva un entorno local aislado para probar cambios; el script `scripts/deploy-production.ps1` realiza su publicación en AWS. Esta revisión se desplegó el 28/10/2026 y los recursos públicos devolvieron HTTP 200; ver `reports/deployments/release-600-20261028.json`. Se requiere preparar una nueva ronda con la clave para reemplazar el estado anterior.

## Abrir la propuesta

Desde la raíz del repositorio:

```powershell
npm run preview:local
```

Abrir http://127.0.0.1:4180. El servidor escucha solo en la interfaz local y usa un adaptador de datos en memoria; los reinicios y turnos no modifican AWS. La clave de prueba se completa en la página local. La partida inicial es ronda 2 con Pro. La red ampliada incluye las 300 intersecciones anteriores y mantiene cuatro refugios distribuidos por el nuevo recorte. Para cerrar el servidor, Ctrl+C en su terminal. Si el puerto ya está ocupado por esta vista, abrir el enlace sin iniciar una segunda instancia.

`npm run web:serve` conserva su propósito anterior: sirve el frontend en 4173 conectado a la API AWS. Para esta revisión usar **preview:local**.

## Diseño y controles

- Mapa como superficie principal, encabezado con métricas y panel flotante de control.
- Colores originales: carbón, ámbar, cian, verde, coral, naranja y violeta.
- Iconos SVG para sobrevivientes, caminantes, corredores, hordas, refugios y camionetas. Los dormidos no se muestran hasta despertar.
- Zoom con rueda o botones, arrastre y botón para centrar la red de evacuación.
- Seleccionar un sobreviviente resalta su ruta en ámbar y muestra un detalle. También se puede seleccionar con teclado.
- Botón de red operativa, refugios con ocupación, eventos y ayuda. Ajustes y telemetría en un panel desplegable.
- En pantallas pequeñas el mapa queda arriba y los controles debajo para conservar espacio de lectura.

## Fondo y geometría

Se usa MapLibre GL JS 6.16.0, con su distribución y licencia en `web/vendor/`, y el estilo Dark de OpenFreeMap. Los datos del fondo son de OpenStreetMap; se conserva su atribución visible. El navegador requiere conexión a Internet y WebGL para ese fondo. El código SVG de la red y la simulación sigue funcionando si el estilo externo no carga; se muestra un aviso. Si WebGL no está disponible, se usa la proyección SVG anterior.

El fondo incluye más calles como contexto visual. La variante local del motor usa 600 nodos y 868 calles: no permite circular por calles que solo aparecen en el fondo. Los refugios siguen siendo ubicaciones de demostración.

Fuentes: https://openfreemap.org/quick_start/ y https://maplibre.org/ . La dependencia se instala con npm; los archivos servidos están versionados localmente para no depender de un CDN de JavaScript.

## Verificación

28 pruebas automatizadas y compilación TypeScript aprobadas. Se verificaron HTTP 200 para HTML, CSS, módulos y worker MapLibre; un turno completo contra el servidor aislado avanzó correctamente sin movimientos inválidos. El estilo Dark respondió con JSON válido. La revisión visual automatizada no pudo completarse porque Computer Use bloqueó el navegador al no poder verificar su URL; revisar el resultado en el enlace local antes de desplegar.

## Comprobación de la ampliación

La red de 600 nodos y 868 calles está conectada. Los escenarios de puente, avenida, dormido y cruce opuesto pasaron. Se ejecutaron seis rondas deterministas de 20/80/200 personas en base y Pro sin pasos inválidos, errores de motor ni sobrecupos. Las rondas base rescataron 20/80/200 personas; en Pro rescataron 20/77/197, con 0/2/2 mordidos y 0/1/1 personas aún activas al finalizar. El límite de 150 turnos no equivale a evacuar a todos. El reporte mide ejecución local y no certifica latencia AWS. La copia de la entrega inicial de 300 nodos queda archivada; la revisión de producción usa 600 nodos.

## Vista 3D experimental (solo local)

Abrir http://127.0.0.1:4180 y usar el selector **2D / 3D** junto al encabezado del mapa. La vista inicial sigue siendo 2D. En 3D se muestran edificios con volumen, una inclinación inicial de 55 grados y controles para girar o ajustar la inclinación entre 25 y 65 grados. También se puede girar con arrastre derecho; en pantallas táctiles se habilita la rotación e inclinación con dos dedos. Volver a 2D restablece la orientación norte y desactiva esos gestos.

Las alturas usan `render_height`/`height` de las teselas cuando existen. Para huellas sin altura válida se usa una estimación visual de 6 metros; no es una medición real de edificios. Acercarse permite apreciar mejor los volúmenes. En 2D se conservan los iconos planos; en 3D, la revisión local posterior los reemplaza por modelos low poly. Sus coordenadas y las rutas se reproyectan con la cámara de MapLibre en cada movimiento; se superponen para conservar legibilidad.

La vista 3D no cambia nodos, reglas, refugios, partidas ni solicitudes al planificador. Las transiciones respetan la preferencia del sistema de reducir movimiento. Requiere el mismo acceso al fondo geográfico y soporte WebGL de la vista 2D. Si no se carga el estilo, el selector queda deshabilitado y se conserva la representación de la red.

Referencia de implementación: https://maplibre.org/maplibre-gl-js/docs/examples/display-buildings-in-3d/ . La capa se valida contra la especificación de estilos de MapLibre y una prueba comprueba la vuelta segura a 2D, la rotación y los límites de inclinación. Esta ampliación ya está incluida en la publicación 3D de producción.

## Avatares con volumen (solo local)

La revisión local incorpora modelos propios construidos con geometría: persona cian, caminante coral, corredor naranja, horda violeta de tres zombis, camioneta amarilla, refugio verde y barricada roja. No descarga modelos ni texturas externos. Three.js 0.186.1 queda empaquetado en `web/vendor/three.mjs`, con licencia MIT adjunta; se puede regenerar con `npm run web:vendor:3d`.

Los modelos comparten una geometría por tipo y usan instancias GPU para evitar un objeto de dibujo por persona. Sus colores y la orientación siguen los datos de la simulación, con interpolación visual breve entre posiciones. Las personas inactivas, pasajeros y dormidos no se muestran. El tamaño está exagerado como símbolo cartográfico para que se distingan al alejarse; no representa escala humana real.

La capa comparte cámara y profundidad con MapLibre y libera recursos al retirarse. Al cambiar a 2D vuelven los iconos, y si falla el renderizador se mantienen como alternativa. No hay sombras dinámicas ni animaciones continuas con el mundo detenido. La preferencia de reducir movimiento desactiva la interpolación.

33 pruebas y compilación correctas. El reporte `reports/audit/avatars-3d-200-local.json` mide preparación CPU, presupuesto de triángulos y un turno HTTP aislado con 200 personas; no acredita FPS ni rendimiento GPU. La forma de los modelos se revisó con una proyección estática de su geometría. La revisión visual dentro del navegador queda pendiente porque el acceso automático está deshabilitado. Esta revisión ya está incluida en la publicación 3D de producción.

Referencias: https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/CustomRenderMethodInput/ y https://threejs.org/docs/ .

### Acabado opaco de los modelos

Los materiales de los avatares se configuran explícitamente con opacidad 1, sin mezcla alfa y con escritura de profundidad. La luz ambiental se redujo para conservar colores más intensos. En 3D, las calles y rutas ahora se dibujan como capas nativas del mapa por debajo de los modelos, evitando que las líneas SVG crucen sus cuerpos y produzcan apariencia de transparencia. La representación SVG se conserva para 2D. Se validaron los estilos de las capas y las 33 pruebas siguen aprobadas.

## Corrección de atascos observados después del turno 40

Se capturó la partida local del usuario en el turno 83: 22 activos, sin errores HTTP ni timeouts. El puente `osm:67834869:0` aislaba un ramal de tres nodos donde estaba el refugio 2 con 20 cupos disponibles. Los otros refugios se llenaban y quedaban personas sin cupo alcanzable. Además, la asignación de recogidas de las camionetas marcaba el objetivo como reclamado tras el primer paso y lo excluía incluso para la propia camioneta en el segundo paso.

La variante local mantiene 600 nodos/868 calles y redistribuye cuatro refugios en cruces con accesos redundantes, excluyendo ramales de acceso único. La asignación de recogidas identifica el vehículo propietario y mantiene su objetivo mientras siga siendo válido. No se incrementan capacidades ni se ignoran peligros o cierres. Se conservó el mapa de producción para comparar; la nueva distribución local requiere comenzar otra ronda.

Reproducción con `worldId: manta-demo`, igual que la web: antes, R2 Pro terminaba a los 150 turnos con 58 rescatados, tres mordidos y 19 personas sin evacuar; después termina con 80 rescatados en 51 turnos. Las seis combinaciones locales 20/80/200 y base/Pro terminan sin personas activas ni movimientos inválidos. En R3 hubo mordidos: 199 rescatados/1 mordido en base y 196/4 en Pro. No es una promesa de supervivencia total frente a cualquier escenario.

Evidencia: `reports/audit/evacuation-progress-local.json`. Se añadieron regresiones de recogida, ubicación de refugios y la ronda 80 Pro; las 36 pruebas y la compilación pasan. Esta corrección ya está incluida en la publicación 3D de producción.
