#!/usr/bin/env python3
"""Infographic: the three ways to register a DbContext in EF Core.

Writes public/img/diagrams/08-dbcontext-registration-{light,dark}.svg with the blog colors.
Usage: python3 diagrams/infographics/08-dbcontext-registration.py

The SVG carries its own styles and uses system fonts, so it works inside an <img>.
"""
from pathlib import Path
from xml.sax.saxutils import escape

OUT = Path(__file__).resolve().parents[2] / "public" / "img" / "diagrams"
NAME = "08-dbcontext-registration"

W, H = 1200, 650
MARGIN, GAP = 24, 24
CARD_W, CARD_H, CARD_Y = 368, 500, 84

SANS = "'Geist', 'Segoe UI', system-ui, -apple-system, sans-serif"
MONO = "'Geist Mono', 'Cascadia Code', Consolas, ui-monospace, monospace"

PALETTES = {
    "dark": dict(
        surface="#0B0E14", box="#141925", border="#232B3B", text="#E6EDF3", muted="#8B96A5",
        accents=["#B8F25B", "#5CC8FF", "#B39CFF"], on_accent="#0B0E14",
    ),
    "light": dict(
        surface="#FFFFFF", box="#ECEFF3", border="#D9DEE5", text="#0B0E14", muted="#556070",
        accents=["#3B7A00", "#0B6FB8", "#6D4ED8"], on_accent="#FFFFFF",
    ),
}

# Each card: method, subtitle, diagram kind, "use it when" lines, "watch out" lines, measured median.
CARDS = [
    dict(
        name="AddDbContext",
        subtitle="Una instancia nueva por petición",
        kind="scoped",
        use=["API web o MVC: una petición es", "una unidad de trabajo."],
        watch=["No es seguro para hilos: nada de", "consultas en paralelo."],
        median="496 ms",
    ),
    dict(
        name="AddDbContextPool",
        subtitle="Una por petición, reutilizada del pool",
        kind="pool",
        use=["Mucho tráfico y consultas muy", "cortas, y lo has medido."],
        watch=["No guardes estado propio en el", "contexto (p. ej. el tenant)."],
        median="196 ms",
    ),
    dict(
        name="AddDbContextFactory",
        subtitle="Tú creas y liberas cada contexto",
        kind="factory",
        use=["BackgroundService, Blazor Server", "o trabajo en paralelo."],
        watch=["El contenedor no lo libera:", "usa siempre await using."],
        median="458 ms",
    ),
]

BOX_W, BOX_H = 120, 34
ROWS = [20, 70, 120]  # top of each diagram row, relative to the diagram zone


def text(x, y, content, size, fill, family=SANS, weight=400, anchor="start", spacing=None):
    extra = f' letter-spacing="{spacing}"' if spacing else ""
    return (
        f'<text x="{x}" y="{y}" font-family="{family}" font-size="{size}" font-weight="{weight}" '
        f'fill="{fill}" text-anchor="{anchor}"{extra}>{escape(content)}</text>'
    )


def box(x, y, label, p, stroke, w=BOX_W, h=BOX_H, mono=False):
    return (
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="{p["box"]}" stroke="{stroke}" stroke-width="1.5"/>'
        + text(x + w / 2, y + h / 2 + 5, label, 13, p["text"], MONO if mono else SANS, 500, "middle")
    )


def arrow(x1, y1, x2, y2, p, index):
    return (
        f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{p["muted"]}" stroke-width="1.5" '
        f'marker-end="url(#arrow)"/>'
    )


def diagram(kind, x0, zy, p, accent, index):
    parts = []
    left, right = x0 + 24, x0 + CARD_W - 24 - BOX_W
    mid = [zy + row + BOX_H / 2 for row in ROWS]

    if kind == "scoped":
        for i, row in enumerate(ROWS):
            parts.append(box(left, zy + row, f"Petición {i + 1}", p, p["border"]))
            parts.append(box(right, zy + row, f"instancia {'ABC'[i]}", p, accent))
            parts.append(arrow(left + BOX_W + 6, mid[i], right - 8, mid[i], p, index))
    elif kind == "pool":
        pool_x, pool_y, pool_w, pool_h = right - 12, zy + 4, BOX_W + 24, 166
        parts.append(
            f'<rect x="{pool_x}" y="{pool_y}" width="{pool_w}" height="{pool_h}" rx="10" fill="none" '
            f'stroke="{accent}" stroke-width="1.5" stroke-dasharray="5 4"/>'
        )
        parts.append(text(pool_x + pool_w / 2, pool_y + 22, "pool", 12, accent, MONO, 600, "middle"))
        parts.append(box(right, zy + ROWS[1], "instancia A", p, accent))
        parts.append(text(pool_x + pool_w / 2, pool_y + pool_h - 14, "reset al devolver", 12, p["muted"], SANS, 400, "middle"))
        for i, row in enumerate(ROWS):
            parts.append(box(left, zy + row, f"Petición {i + 1}", p, p["border"]))
            parts.append(arrow(left + BOX_W + 6, mid[i], right - 8, mid[1] + (i - 1) * 8, p, index))
    else:
        parts.append(box(left, zy + ROWS[1], "factoría", p, p["border"]))
        for i, row in enumerate(ROWS):
            parts.append(box(right, zy + row, f"instancia {'ABC'[i]}", p, accent))
            parts.append(arrow(left + BOX_W + 6, mid[1] + (i - 1) * 8, right - 8, mid[i], p, index))

    return "".join(parts)


def card(index, data, p):
    x0 = MARGIN + index * (CARD_W + GAP)
    y0 = CARD_Y
    accent = p["accents"][index]
    tx = x0 + 24
    parts = [
        f'<rect x="{x0}" y="{y0}" width="{CARD_W}" height="{CARD_H}" rx="14" fill="{p["surface"]}" stroke="{p["border"]}"/>',
        f'<rect x="{x0}" y="{y0}" width="{CARD_W}" height="5" rx="2.5" fill="{accent}"/>',
        f'<circle cx="{tx + 13}" cy="{y0 + 40}" r="13" fill="{accent}"/>',
        text(tx + 13, y0 + 45, str(index + 1), 14, p["on_accent"], MONO, 700, "middle"),
        text(tx + 38, y0 + 47, data["name"], 21, p["text"], MONO, 600),
        text(tx, y0 + 78, data["subtitle"], 14.5, p["muted"]),
        diagram(data["kind"], x0, y0 + 96, p, accent, index),
        text(tx, y0 + 300, "ÚSALO CUANDO", 12, accent, MONO, 600, spacing="1.2"),
        text(tx, y0 + 324, data["use"][0], 15.5, p["text"]),
        text(tx, y0 + 345, data["use"][1], 15.5, p["text"]),
        text(tx, y0 + 383, "OJO", 12, accent, MONO, 600, spacing="1.2"),
        text(tx, y0 + 407, data["watch"][0], 15.5, p["text"]),
        text(tx, y0 + 428, data["watch"][1], 15.5, p["text"]),
        f'<line x1="{tx}" y1="{y0 + 450}" x2="{x0 + CARD_W - 24}" y2="{y0 + 450}" stroke="{p["border"]}"/>',
        text(tx, y0 + 482, data["median"], 22, accent, MONO, 700),
        text(x0 + CARD_W - 24, y0 + 481, "5.000 peticiones seguidas", 13, p["muted"], SANS, 400, "end"),
    ]
    return "".join(parts)


def build(theme):
    p = PALETTES[theme]
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img">',
        f'<defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">'
        f'<path d="M0 0L10 5L0 10z" fill="{p["muted"]}"/></marker></defs>',
        text(MARGIN, 44, "Tres formas de registrar tu DbContext", 28, p["text"], SANS, 700),
        text(MARGIN, 68, "EF Core: qué instancia recibe tu código y quién la libera", 15, p["muted"]),
    ]
    parts += [card(i, data, p) for i, data in enumerate(CARDS)]
    parts.append(text(W - MARGIN, H - 26, "mookiefumi.com", 13, p["muted"], MONO, 500, "end"))
    parts.append("</svg>")
    return "".join(parts)


for theme in PALETTES:
    (OUT / f"{NAME}-{theme}.svg").write_text(build(theme) + "\n", encoding="utf-8")
