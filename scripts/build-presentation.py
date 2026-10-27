from pathlib import Path
import json
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output' / 'pdf' / 'presentacion-spookython.pdf'
OUT.parent.mkdir(parents=True, exist_ok=True)
pdfmetrics.registerFont(TTFont('Arial', 'C:/Windows/Fonts/arial.ttf'))
pdfmetrics.registerFont(TTFont('ArialBold', 'C:/Windows/Fonts/arialbd.ttf'))
report = json.loads((ROOT / 'reports/audit/fire-drill-latest.json').read_text(encoding='utf-8-sig'))
http = json.loads((ROOT / 'reports/audit/http-local-200-latest.json').read_text(encoding='utf-8-sig'))
c = canvas.Canvas(str(OUT), pagesize=(960, 540))
c.setTitle('Spookython - Motor de evacuación de Manta')
BG, PANEL, TEXT, MUTED, CYAN, GOLD = map(colors.HexColor, ['#0b1220', '#142238', '#f2f6ff', '#b5c5dd', '#6ee7f9', '#ffce6c'])

def para(text, x, top, width, size=18, color=TEXT, bold=False):
    p = Paragraph(text, ParagraphStyle('p', fontName='ArialBold' if bold else 'Arial', fontSize=size,
        leading=size*1.35, textColor=color))
    _, height = p.wrap(width, 500)
    p.drawOn(c, x, top-height)
    return top-height

def page(number, eyebrow, title):
    c.setFillColor(BG); c.rect(0, 0, 960, 540, fill=1, stroke=0)
    para(eyebrow.upper(), 44, 505, 850, 11, CYAN, True)
    para(title, 44, 468, 870, 32, TEXT, True)
    c.setStrokeColor(colors.HexColor('#30415b')); c.line(44, 52, 916, 52)
    para('SPOOKYTHON 2026 | MANTA | Revisión local 26/10/2026', 44, 35, 700, 9, MUTED)
    para(f'{number}/6', 880, 35, 40, 10, MUTED)

def card(x, top, width, title, text, height=230):
    c.setFillColor(PANEL); c.roundRect(x, top-height, width, height, 12, fill=1, stroke=0)
    end = para(title, x+18, top-18, width-36, 21, CYAN, True)
    para(text, x+18, end-18, width-36, 16)

page(1, 'Track A - Escape de Manta zombi', 'Cada turno cambia la ruta')
para('Un motor que guía a cada sobreviviente hacia un refugio mientras cambian las calles y se mueven los peligros.', 44, 373, 485, 24)
para('300 intersecciones reales<br/>424 calles - 4 refugios<br/>Rondas de 20, 80 y 200 personas', 44, 244, 470, 21, CYAN)
para('Panel en vivo, API de decisión y simulador desplegables en AWS.', 44, 124, 500, 15, MUTED)
nodes = [(610,330),(710,385),(815,330),(710,250),(835,190)]
c.setStrokeColor(MUTED); c.setLineWidth(2)
for a,b in [(0,1),(1,2),(0,3),(3,2),(3,4),(2,4)]: c.line(*nodes[a], *nodes[b])
for index,(x,y) in enumerate(nodes):
    c.setFillColor(GOLD if index==2 else CYAN); c.circle(x,y,11,fill=1,stroke=0)
para('PELIGRO', 780, 305, 130, 13, GOLD, True)
para('REFUGIO', 794, 162, 140, 13, CYAN, True)
c.showPage()

page(2, 'Mundo del juego', 'La seguridad se decide paso a paso')
card(44, 383, 276, 'Reglas del turno', '2 segundos por turno.<br/><br/>Primero zombis, luego sobrevivientes.<br/><br/>Una respuesta tardía o inválida significa quedarse quieto.')
card(342, 383, 276, 'Amenazas móviles', 'Caminante cada 2 turnos.<br/>Corredor: 2 calles y persecución.<br/><br/>Horda: nodo y vecinos.<br/>Dormido: oculto hasta despertar.')
card(640, 383, 276, 'Mapa que cambia', 'Puente colapsado o avenida cerrada.<br/><br/>La arista deja de ser transitable y la ruta se revisa.<br/><br/>Nodo compartido o cruce opuesto: mordida.')
para('El grafo usa distancias y velocidades por tipo de calle; las rutas se ponderan con Dijkstra.', 44, 120, 870, 16, MUTED)
c.showPage()

page(3, 'Arquitectura y contrato', 'HTTP medible, estado compartido')
labels = [('Navegador','Mapa + simulador'),('API Gateway','POST /paso'),('Lambda','Snapshot + rutas'),('DynamoDB','Estado + reservas')]
for index,(title, subtitle) in enumerate(labels):
    x = 44+index*224
    card(x, 377, 200, title, subtitle, 100)
    if index<3:
        c.setStrokeColor(CYAN); c.line(x+203,328,x+219,328)
para('PREPARE', 44, 242, 200, 20, CYAN, True)
para('Mover zombis y guardar el turno.', 44, 207, 245, 16)
para('/paso por persona', 350, 242, 260, 20, CYAN, True)
para('Solicitudes paralelas con un plazo de 500 ms cada una.', 350, 207, 250, 16)
para('RESOLVE', 665, 242, 250, 20, CYAN, True)
para('Validar pasos, mordidas, cupos y estado final.', 665, 207, 250, 16)
para('Panel HTTPS: CloudFront + S3 privado. POST autenticados por x-api-key; hash en el servidor.', 44, 130, 865, 16, MUTED)
para('API: gkzb014d54.execute-api.us-east-1.amazonaws.com/paso', 44, 91, 870, 13, CYAN)
c.showPage()

page(4, 'Nivel Pro opcional', 'Prever, repartir y recoger')
card(44, 383, 276, 'Predicción', 'Proyecta los dos pasos del corredor usando su regla de persecución.<br/><br/>Evita el riesgo inmediato y vuelve a estimar cada turno.')
card(342, 383, 276, 'Cupos con reserva', 'Asigna un refugio con espacio para cada persona.<br/><br/>La reserva se libera al perderse una persona y se comprueba al ingresar.')
card(640, 383, 276, '5 camionetas', 'Cuatro plazas por vehículo.<br/>Dos calles por turno.<br/><br/>Ordena recogidas por cercanía y riesgo, y limita desvíos durante las entregas.')
para('Supuestos declarados: cupos 5/20/50 por refugio según ronda; predicción condicionada al snapshot; sin combate de vehículos.', 44, 122, 866, 15, MUTED)
c.showPage()

page(5, 'Evidencia y límites', 'Reglas probadas; nube por medir')
headers = [('Modo',44),('Personas',210),('Rescatadas',370),('Mordidas',550),('Sin evacuar',720)]
for title,x in headers: para(title,x,388,160,16,CYAN,True)
for index,row in enumerate(report['rounds']):
    top = 352-index*32
    for text,x in [('Pro' if row['pro'] else 'Base',44),(str(row['survivorCount']),210),(str(row['rescued']),370),(str(row['bitten']),550),(str(row['activeAtEnd']),720)]: para(text,x,top,160,16)
para('15 pruebas funcionales - 6 rondas locales sin movimientos inválidos ni refugios desbordados.',44,145,865,16,CYAN)
para(f"HTTP local, 200 simultáneas: p95 {http['p95HttpMs']:.0f} ms; {http['timeouts']} fuera de plazo. No aprueba la meta de latencia; AWS sigue pendiente.",44,112,865,15,GOLD)
c.showPage()

page(6, 'Demo y entrega', 'Medir antes de afirmar cumplimiento')
card(44, 383, 420, 'Demostración', '1. Elegir ronda y crear el mundo.<br/>2. Mostrar posiciones, rutas y cierres.<br/>3. Activar Pro: cupos y camionetas.<br/>4. Revisar métricas y evidencia HTTP.',205)
card(486, 383, 430, 'Costos y pendientes', 'Budget mensual de USD 5 con alertas.<br/><br/>Cost Explorer muestra neto de cuenta redondeado a 0,00 USD; incluye el sistema anterior.<br/><br/>Falta desplegar y medir esta revisión en AWS.',205)
para('Código, arquitectura, instrucciones, costos y reportes:',44,148,870,16,MUTED)
para('github.com/29129/Spookython',44,118,870,20,CYAN,True)
para('El equipo debe poder explicar cada regla y ensayar 5 minutos de pitch + 3 de preguntas.',44,82,870,13,MUTED)
c.save()
print(OUT)
