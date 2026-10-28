# Vista local: Refugio 593

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
