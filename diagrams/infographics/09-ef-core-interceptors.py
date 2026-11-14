#!/usr/bin/env python3
"""Infographic: where each of the seven EF Core interceptors runs, on a read and on a write.

Writes public/img/diagrams/09-ef-core-interceptors-{light,dark}.svg with the blog colors.
Usage: python3 diagrams/infographics/09-ef-core-interceptors.py

The SVG carries its own styles and uses system fonts, so it works inside an <img>.
Numbers match the sections of the post.
"""
from pathlib import Path
from xml.sax.saxutils import escape

OUT = Path(__file__).resolve().parents[2] / "public" / "img" / "diagrams"
NAME = "09-ef-core-interceptors"

W = 1200
MARGIN, GAP = 24, 24
LANE_W = (W - 2 * MARGIN - GAP) // 2
LANE_Y = 92
STEP_H, STEP_GAP = 90, 18
STEPS_Y = 150

SANS = "'Geist', 'Segoe UI', system-ui, -apple-system, sans-serif"
MONO = "'Geist Mono', 'Cascadia Code', Consolas, ui-monospace, monospace"

PALETTES = {
    "dark": dict(
        surface="#0B0E14", box="#141925", border="#232B3B", text="#E6EDF3", muted="#8B96A5",
        accents=["#5CC8FF", "#B8F25B"], on_accent="#0B0E14",
    ),
    "light": dict(
        surface="#FFFFFF", box="#ECEFF3", border="#D9DEE5", text="#0B0E14", muted="#556070",
        accents=["#0B6FB8", "#3B7A00"], on_accent="#FFFFFF",
    ),
}

# Each step: number in the post, interface, when it runs, what it is good for.
# repeat=True marks an interceptor already shown in full in the other lane.
LANES = [
    dict(
        title="Leer",
        call="db.Products.Where(...).ToListAsync()",
        steps=[
            dict(n=6, name="IQueryExpressionInterceptor", when="Antes de traducir el LINQ (una vez por forma de consulta)", use="Reescribir la consulta"),
            dict(n=3, name="IDbConnectionInterceptor", when="Al abrir la conexión", use="Base de datos por inquilino, token de acceso"),
            dict(n=2, name="IDbCommandInterceptor", when="Antes y después de ejecutar el SQL", use="Ver el SQL real, consultas lentas"),
            dict(n=5, name="IMaterializationInterceptor", when="Al convertir cada fila en una entidad", use="Propiedades no mapeadas"),
        ],
    ),
    dict(
        title="Escribir",
        call="db.Attach(product); db.SaveChangesAsync()",
        steps=[
            dict(n=7, name="IIdentityResolutionInterceptor", when="Al rastrear una clave que ya está rastreada", use="Fusionar valores en vez de lanzar excepción"),
            dict(n=1, name="ISaveChangesInterceptor", when="Antes y después de SaveChanges", use="Auditoría, borrado lógico, outbox"),
            dict(n=3, name="IDbConnectionInterceptor", when="Al abrir la conexión", use=None),
            dict(n=4, name="IDbTransactionInterceptor", when="Inicio, commit y rollback explícito (con dos o más sentencias)", use="Registrar transacciones"),
            dict(n=2, name="IDbCommandInterceptor", when="Por cada INSERT, UPDATE o DELETE", use=None),
        ],
    ),
]

H = STEPS_Y + 5 * STEP_H + 4 * STEP_GAP + 64


def text(x, y, content, size, fill, family=SANS, weight=400, anchor="start", spacing=None):
    extra = f' letter-spacing="{spacing}"' if spacing else ""
    return (
        f'<text x="{x}" y="{y}" font-family="{family}" font-size="{size}" font-weight="{weight}" '
        f'fill="{fill}" text-anchor="{anchor}"{extra}>{escape(content)}</text>'
    )


def step(x, y, data, p, accent):
    repeat = data["use"] is None
    stroke = p["border"] if repeat else accent
    dash = ' stroke-dasharray="5 4"' if repeat else ""
    parts = [
        f'<rect x="{x}" y="{y}" width="{LANE_W - 32}" height="{STEP_H}" rx="10" fill="{p["box"]}" '
        f'stroke="{stroke}" stroke-width="1.5"{dash}/>',
    ]
    cx, cy = x + 30, y + 30
    if repeat:
        parts.append(f'<circle cx="{cx}" cy="{cy}" r="14" fill="none" stroke="{accent}" stroke-width="1.5"/>')
        parts.append(text(cx, cy + 5, str(data["n"]), 14, accent, MONO, 700, "middle"))
    else:
        parts.append(f'<circle cx="{cx}" cy="{cy}" r="14" fill="{accent}"/>')
        parts.append(text(cx, cy + 5, str(data["n"]), 14, p["on_accent"], MONO, 700, "middle"))
    tx = x + 56
    parts.append(text(tx, y + 34, data["name"], 17, p["text"], MONO, 600))
    parts.append(text(tx, y + 58, data["when"], 14, p["muted"]))
    if not repeat:
        parts.append(text(tx, y + 79, data["use"], 14, accent, SANS, 500))
    return "".join(parts)


def lane(index, data, p):
    x0 = MARGIN + index * (LANE_W + GAP)
    accent = p["accents"][index]
    lane_h = H - LANE_Y - 40
    parts = [
        f'<rect x="{x0}" y="{LANE_Y}" width="{LANE_W}" height="{lane_h}" rx="14" fill="{p["surface"]}" stroke="{p["border"]}"/>',
        f'<rect x="{x0}" y="{LANE_Y}" width="{LANE_W}" height="5" rx="2.5" fill="{accent}"/>',
        text(x0 + 16, LANE_Y + 36, data["title"].upper(), 13, accent, MONO, 600, spacing="1.4"),
        text(x0 + LANE_W - 16, LANE_Y + 36, data["call"], 13, p["muted"], MONO, 400, "end"),
    ]
    for i, s in enumerate(data["steps"]):
        y = STEPS_Y + i * (STEP_H + STEP_GAP)
        parts.append(step(x0 + 16, y, s, p, accent))
        if i < len(data["steps"]) - 1:
            ax = x0 + 16 + 30
            parts.append(
                f'<line x1="{ax}" y1="{y + STEP_H + 2}" x2="{ax}" y2="{y + STEP_H + STEP_GAP - 3}" '
                f'stroke="{p["muted"]}" stroke-width="1.5" marker-end="url(#arrow)"/>'
            )
    return "".join(parts)


def build(theme):
    p = PALETTES[theme]
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img">',
        f'<defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">'
        f'<path d="M0 0L10 5L0 10z" fill="{p["muted"]}"/></marker></defs>',
        text(MARGIN, 44, "Los siete interceptores de EF Core", 28, p["text"], SANS, 700),
        text(MARGIN, 68, "En qué momento entra cada uno al leer y al escribir. Línea discontinua: ya descrito en la otra columna.", 15, p["muted"]),
    ]
    parts += [lane(i, data, p) for i, data in enumerate(LANES)]
    parts.append(text(W - MARGIN, H - 12, "mookiefumi.com", 13, p["muted"], MONO, 500, "end"))
    parts.append("</svg>")
    return "".join(parts)


for theme in PALETTES:
    (OUT / f"{NAME}-{theme}.svg").write_text(build(theme) + "\n", encoding="utf-8")
