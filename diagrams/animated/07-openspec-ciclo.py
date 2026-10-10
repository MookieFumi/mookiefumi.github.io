#!/usr/bin/env python3
"""Diagrama animado del ciclo de un change de OpenSpec, en vertical.

Genera public/img/diagrams/07-openspec-ciclo-{light,dark}.svg con los colores del blog.
Uso: python3 diagrams/animated/07-openspec-ciclo.py

El SVG lleva sus propios estilos y animaciones (SMIL y CSS), así que funciona
dentro de un <img> sin cargar nada. Con prefers-reduced-motion se queda estático.
"""
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / "public" / "img" / "diagrams"
NAME = "07-openspec-ciclo"

VX, W, H = 45, 510, 690   # recorte horizontal del lienzo (x inicial y ancho) y alto
CX = 190            # eje de la columna principal
SIDE = 440          # eje de la columna de pasos opcionales
CYCLE = 11          # segundos que dura una vuelta
PAUSE = 0.07        # fracción del ciclo que el punto se detiene en cada paso

PALETTES = {
    "light": dict(
        node="#FFFFFF", stroke="#5B2EE0", text="#1B1633", muted="#6B6785",
        line="#8C86A8", store="#ECE8FB", glow="#FFC940", glow_fill="#FFC940",
        glow_opacity="0.22",
    ),
    "dark": dict(
        node="#1C1832", stroke="#A58BFF", text="#ECE9F8", muted="#A39EC0",
        line="#7E77A3", store="#262043", glow="#FFC940", glow_fill="#FFC940",
        glow_opacity="0.2",
    ),
}

# Pasos de la columna principal: (id, comando, descripción, opcional, y superior)
MAIN = [
    ("explore", "/opsx-explore", "pensar antes de comprometerse", True, 24),
    ("propose", "/opsx-propose", "proposal, design, tasks y deltas", False, 144),
    ("apply", "/opsx-apply", "código y tests, tarea a tarea", False, 264),
    ("archive", "/opsx-archive", "los deltas pasan a la spec viva", False, 404),
]
NODE_W, NODE_H = 230, 64
SIDE_W, SIDE_H = 170, 56
STORE_Y, STORE_H = 548, 84

# Pasos opcionales laterales: (id, comando, descripción, y superior)
SIDE_NODES = [
    ("update", "/opsx-update", "reconcilia los artefactos", 208),
    ("sync", "/opsx-sync", "fusiona los deltas antes", 338),
]


def center_y(top, h=NODE_H):
    return top + h / 2


def build(theme):
    p = PALETTES[theme]
    parts = []
    add = parts.append

    add(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{VX} 0 {W} {H}" width="{W}" height="{H}" '
        f'role="img" aria-labelledby="t d">')
    add('<title id="t">Ciclo de un change en OpenSpec</title>')
    add('<desc id="d">De arriba abajo: explore (opcional), propose, apply y archive; al archivar, '
        'los deltas pasan a openspec/specs. Update vuelve de apply a propose y sync fusiona los '
        'deltas antes de archivar; los dos son opcionales.</desc>')

    add(f'''<style>
  text {{ font-family: "Bricolage Grotesque", "Segoe UI", system-ui, -apple-system, sans-serif; }}
  .cmd {{ font-size: 15px; font-weight: 700; fill: {p["text"]}; }}
  .sub {{ font-size: 12px; fill: {p["muted"]}; }}
  .tag {{ font-size: 11px; fill: {p["muted"]}; font-style: italic; }}
  .node {{ fill: {p["node"]}; stroke: {p["stroke"]}; stroke-width: 2; }}
  .optional {{ stroke-dasharray: 6 5; }}
  .store {{ fill: {p["store"]}; stroke: {p["stroke"]}; stroke-width: 2; }}
  .edge {{ fill: none; stroke: {p["line"]}; stroke-width: 2; }}
  .flow {{ stroke-dasharray: 6 6; animation: flow 1.4s linear infinite; }}
  .arrow {{ fill: {p["line"]}; }}
  .ring {{ fill: {p["glow_fill"]}; fill-opacity: {p["glow_opacity"]}; stroke: {p["glow"]}; stroke-width: 3; opacity: 0; }}
  .appear {{ opacity: 0; animation: appear .6s ease-out forwards; }}
  @keyframes flow {{ to {{ stroke-dashoffset: -12; }} }}
  @keyframes appear {{ from {{ opacity: 0; transform: translateY(10px); }} to {{ opacity: 1; transform: none; }} }}
  @media (prefers-reduced-motion: reduce) {{
    .flow, .appear {{ animation: none; opacity: 1; }}
    .motion {{ display: none; }}
  }}
</style>''')

    add(f'''<defs>
  <marker id="head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
    <path class="arrow" d="M1 1 L9 5 L1 9 z"/>
  </marker>
  <filter id="soft" x="-30%" y="-30%" width="160%" height="160%">
    <feGaussianBlur stdDeviation="4"/>
  </filter>
</defs>''')

    # ---- aristas (debajo de los nodos)
    main_c = {m[0]: center_y(m[4]) for m in MAIN}
    main_top = {m[0]: m[4] for m in MAIN}
    main_bot = {k: main_top[k] + NODE_H for k in main_top}
    side_c = {s[0]: center_y(s[3], SIDE_H) for s in SIDE_NODES}

    def vline(a, b):
        return f'M{CX} {main_bot[a]} L{CX} {main_top[b]}'

    edges = [
        ("explore", "propose"), ("propose", "apply"), ("apply", "archive"),
    ]
    for a, b in edges:
        add(f'<path class="edge" d="{vline(a, b)}" marker-end="url(#head)"/>')
    add(f'<path class="edge" d="M{CX} {main_bot["archive"]} L{CX} {STORE_Y + 14}" marker-end="url(#head)"/>')

    left_side = SIDE - SIDE_W / 2          # borde izquierdo de los nodos laterales
    right_main = CX + NODE_W / 2           # borde derecho de los nodos principales
    mid = (left_side + right_main) / 2

    # apply -> update (sale por la derecha de apply) y update -> propose (vuelve)
    ya = main_c["apply"] + 10
    yu = side_c["update"]
    yp = main_c["propose"] + 10
    add(f'<path class="edge flow" d="M{right_main} {ya} C{mid} {ya} {mid} {yu + 10} {left_side} {yu + 10}" marker-end="url(#head)"/>')
    add(f'<path class="edge flow" d="M{left_side} {yu - 10} C{mid} {yu - 10} {mid} {yp} {right_main} {yp}" marker-end="url(#head)"/>')
    # sync -> archive
    ys = side_c["sync"]
    yr = main_c["archive"]
    add(f'<path class="edge flow" d="M{left_side} {ys} C{mid} {ys} {mid} {yr} {right_main} {yr}" marker-end="url(#head)"/>')

    # ---- nodos
    delay = 0.0
    for key, cmd, sub, optional, top in MAIN:
        x = CX - NODE_W / 2
        cls = "node optional" if optional else "node"
        add(f'<g class="appear" style="animation-delay:{delay:.2f}s">')
        add(f'<rect class="{cls}" x="{x}" y="{top}" width="{NODE_W}" height="{NODE_H}" rx="12"/>')
        add(f'<text class="cmd" x="{CX}" y="{top + 28}" text-anchor="middle">{cmd}</text>')
        add(f'<text class="sub" x="{CX}" y="{top + 48}" text-anchor="middle">{sub}</text>')
        add('</g>')
        delay += 0.12

    for key, cmd, sub, top in SIDE_NODES:
        x = SIDE - SIDE_W / 2
        add(f'<g class="appear" style="animation-delay:{delay:.2f}s">')
        add(f'<rect class="node optional" x="{x}" y="{top}" width="{SIDE_W}" height="{SIDE_H}" rx="12"/>')
        add(f'<text class="cmd" x="{SIDE}" y="{top + 24}" text-anchor="middle">{cmd}</text>')
        add(f'<text class="sub" x="{SIDE}" y="{top + 43}" text-anchor="middle">{sub}</text>')
        add('</g>')
        delay += 0.12

    # almacén de specs (cilindro)
    sx, sw, ry = CX - NODE_W / 2, NODE_W, 12
    sy, sh = STORE_Y, STORE_H
    add(f'<g class="appear" style="animation-delay:{delay:.2f}s">')
    add(f'<path class="store" d="M{sx} {sy + ry} A{sw / 2} {ry} 0 0 1 {sx + sw} {sy + ry} '
        f'V{sy + sh - ry} A{sw / 2} {ry} 0 0 1 {sx} {sy + sh - ry} Z"/>')
    add(f'<path class="store" d="M{sx} {sy + ry} A{sw / 2} {ry} 0 0 0 {sx + sw} {sy + ry}" style="fill:none"/>')
    add(f'<text class="cmd" x="{CX}" y="{sy + 44}" text-anchor="middle">openspec/specs</text>')
    add(f'<text class="sub" x="{CX}" y="{sy + 64}" text-anchor="middle">la fuente de verdad</text>')
    add('</g>')

    # leyenda
    ly = H - 34
    add(f'<g class="appear" style="animation-delay:{delay + .2:.2f}s">')
    add(f'<rect class="node optional" x="{SIDE - SIDE_W / 2}" y="{ly}" width="26" height="16" rx="5" style="stroke-width:1.5"/>')
    add(f'<text class="tag" x="{SIDE - SIDE_W / 2 + 36}" y="{ly + 12}">paso opcional</text>')
    add('</g>')

    # ---- movimiento: halo en cada paso y un punto que recorre la columna
    stops = [(m[0], main_c[m[0]]) for m in MAIN] + [("store", STORE_Y + STORE_H / 2)]
    y0, y1 = stops[0][1], stops[-1][1]
    total = y1 - y0
    travel_share = 1 - PAUSE * len(stops)
    times, points = [0.0], [0.0]
    t = 0.0
    glow_windows = []
    for i, (key, y) in enumerate(stops):
        frac = (y - y0) / total
        # llegada
        if i > 0:
            dist = (y - stops[i - 1][1]) / total
            t += travel_share * dist
            times.append(t)
            points.append(frac)
        start = t
        t += PAUSE
        times.append(t)
        points.append(frac)
        glow_windows.append((key, start, t))
    # normaliza por si el redondeo se aleja de 1
    scale = 1 / times[-1]
    times = [round(x * scale, 4) for x in times]
    glow_windows = [(k, a * scale, b * scale) for k, a, b in glow_windows]
    times[-1] = 1.0

    add('<g class="motion">')

    def ring(key, a, b):
        if key == "store":
            shape = (f'<rect class="ring" x="{sx - 4}" y="{sy - 4}" width="{sw + 8}" height="{sh + 8}" rx="16">')
        else:
            top = main_top[key]
            shape = (f'<rect class="ring" x="{CX - NODE_W / 2 - 4}" y="{top - 4}" '
                     f'width="{NODE_W + 8}" height="{NODE_H + 8}" rx="15">')
        fade = 0.03
        kt = [0, max(a - fade, 0), a, b, min(b + fade, 1), 1]
        vals = ["0", "0", "1", "1", "0", "0"]
        add(shape)
        add(f'<animate attributeName="opacity" dur="{CYCLE}s" repeatCount="indefinite" '
            f'calcMode="linear" keyTimes="{";".join(str(round(v, 4)) for v in kt)}" values="{";".join(vals)}"/>')
        add('</rect>')

    for key, a, b in glow_windows:
        ring(key, a, b)

    # punto (con estela difusa)
    path = f'M{CX} {y0} L{CX} {y1}'
    kt = ";".join(str(v) for v in times)
    kp = ";".join(str(round(v, 4)) for v in points)
    for r, extra in ((9, ' filter="url(#soft)" opacity="0.7"'), (5, "")):
        add(f'<circle r="{r}" fill="{p["glow"]}"{extra}>')
        add(f'<animateMotion dur="{CYCLE}s" repeatCount="indefinite" calcMode="linear" '
            f'keyPoints="{kp}" keyTimes="{kt}" path="{path}"/>')
        add('</circle>')
    add('</g>')

    add('</svg>')
    return "\n".join(parts) + "\n"


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for theme in PALETTES:
        target = OUT / f"{NAME}-{theme}.svg"
        target.write_text(build(theme), encoding="utf-8")
        print("escrito", target.relative_to(OUT.parents[1]))


if __name__ == "__main__":
    main()
