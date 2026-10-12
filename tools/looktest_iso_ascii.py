#!/usr/bin/env python3
"""Look test: an isometric crypt sampled down to a character grid at two tile
scales, through the SAME pipeline as the pirate ship (PIL supersampled 4x ->
area average -> character by luminance with gamma 1.9 -> colour per cell).

It exists to choose the tile geometry before writing the engine: the grid is
identical in both variants (214x69 cells); only the number of cells one tile
occupies changes.

Run: PYTHONPATH= /usr/bin/python3 tools/looktest_iso_ascii.py
"""

import math
import os
import random

from PIL import Image, ImageChops, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, "looktest-iso-ascii.html")

# --- metrics measured in the browser (font-size 11px, SF Mono) ----------------
CELL_W, CELL_H = 6.62, 11.0
COLS, ROWS = 214, 69
SS = 4                      # supersampling

# --- ramp and curve from the ship (ship.py) ----------------------------------
RAMP = " .'-:_,^=;><+!rc*/z?sLTv)J7(|Fi{C}fI31tlu[neoZ5Yxjya]2ESwqkP6h9d4VpOGbUAKXHm8RD#$Bg0MNWQ%&@"
GAMMA = 1.9
QUANT = 4
CELL_ASPECT = 1.67

WORLD_W, WORLD_H = 40, 26

FLOOR = [(58, 54, 46), (68, 63, 53), (50, 46, 40), (76, 70, 58)]
FLOOR_LINE = (26, 24, 21)
WALL_TOP = (96, 88, 72)
WALL_L = (44, 40, 35)
WALL_R = (28, 26, 23)
HERO_CLOAK = (150, 44, 38)
HERO_TRIM = (214, 178, 92)
SKIN = (224, 187, 146)
BONE = (226, 218, 198)
CREATURE = (56, 72, 56)
EYE = (236, 96, 64)
FIRE = (255, 168, 72)
IRON = (72, 74, 80)
PICK_FLOOR = None           # decided per variant


def lum(c):
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def boost(c, sat=1.24, gain=1.06, lift=5):
    m = (c[0] + c[1] + c[2]) / 3.0
    out = []
    for i in range(3):
        v = (m + (c[i] - m) * sat) * gain + lift
        out.append(0 if v < 0 else (255 if v > 255 else v))
    return out


def quant(c, q=QUANT):
    return tuple(min(255, int(round(v / q)) * q) for v in c)


def glyph(c):
    v = (lum(boost(c)) / 255.0) ** GAMMA
    k = min(len(RAMP) - 1, int(v * (len(RAMP) + 1)))
    return RAMP[k]


# --- world -------------------------------------------------------------------
def build_world(seed=20261012):
    rng = random.Random(seed)
    solid = [[True] * WORLD_W for _ in range(WORLD_H)]
    floor = [[False] * WORLD_W for _ in range(WORLD_H)]
    kind = [[""] * WORLD_W for _ in range(WORLD_H)]
    tint = [[0.0] * WORLD_W for _ in range(WORLD_H)]
    variant = [[0] * WORLD_W for _ in range(WORLD_H)]

    # main hall + two corridors + one chamber
    rooms = [(8, 5, 24, 16), (2, 9, 10, 15), (24, 2, 38, 9), (30, 12, 39, 22)]
    for (x0, y0, x1, y1) in rooms:
        for y in range(y0, y1):
            for x in range(x0, x1):
                floor[y][x] = True
    for (ax, ay, bx, by) in [(10, 10, 30, 10), (14, 6, 14, 20), (30, 14, 34, 14)]:
        for t in range(21):
            x = ax + (bx - ax) * t // 20
            y = ay + (by - ay) * t // 20
            floor[y][x] = True

    for y in range(WORLD_H):
        for x in range(WORLD_W):
            if not floor[y][x]:
                continue
            variant[y][x] = (x * 7 + y * 13) % len(FLOOR)
            tint[y][x] = rng.uniform(0.82, 1.12)
            # torch on two walls, pool, bones
            if (x, y) in ((12, 6), (26, 14), (33, 10)):
                kind[y][x] = "torch"
            elif (x, y) in ((16, 12), (22, 8)):
                kind[y][x] = "rubble"
            elif (x, y) in ((19, 13), (19, 12), (20, 13)):
                kind[y][x] = "bones"
            elif (x, y) in ((11, 14), (12, 14), (11, 15)):
                kind[y][x] = "pool"
    # pillars
    for (px, py) in ((14, 8), (18, 8), (14, 14), (18, 14), (34, 6), (34, 16)):
        if floor[py][px]:
            kind[py][px] = "pillar"
    heroes = [(16, 11)]
    monsters = [(21, 9), (20, 14), (17, 15), (24, 11)]
    for (mx, my) in monsters:
        if floor[my][mx]:
            kind[my][mx] = "monster"
    for (hx, hy) in heroes:
        kind[hy][hx] = "hero"
    return {"floor": floor, "kind": kind, "tint": tint, "variant": variant,
            "solid": solid}


def iso(tx, ty, tw, th, ox, oy):
    """Canto superior esquerdo do losango do tile (tx, ty) em pixels."""
    sx = (tx - ty) * tw / 2.0 + ox
    sy = (tx + ty) * th / 2.0 + oy
    return sx, sy


def diamond(d, cx, cy, w, h, fill, outline=None):
    pts = [(cx, cy - h / 2.0), (cx + w / 2.0, cy), (cx, cy + h / 2.0), (cx - w / 2.0, cy)]
    d.polygon(pts, fill=fill, outline=outline)


def draw_scene(tile_cells_w, tile_cells_h, world, seed=7):
    tw = tile_cells_w * CELL_W
    th = tile_cells_h * CELL_H
    W = int(COLS * CELL_W)
    H = int(ROWS * CELL_H)
    img = Image.new("RGB", (W, H), (14, 13, 12))
    glow = Image.new("RGB", (W, H), (0, 0, 0))
    d = ImageDraw.Draw(img)
    g = ImageDraw.Draw(glow)

    ox = W / 2.0 - (WORLD_W - WORLD_H) * tw / 4.0
    oy = H / 2.0 - (WORLD_W + WORLD_H) * th / 4.0

    rng = random.Random(seed + tile_cells_w * 977)
    wall_h = th * 1.15

    for depth in range(WORLD_W + WORLD_H):
        for ty in range(WORLD_H):
            tx = depth - ty
            if tx < 0 or tx >= WORLD_W:
                continue
            if not world["floor"][ty][tx]:
                continue
            sx, sy = iso(tx, ty, tw, th, ox, oy)
            cx, cy = sx, sy
            if cx < -tw or cx > W + tw or cy < -th * 3 or cy > H + th * 3:
                continue

            base = FLOOR[world["variant"][ty][tx]]
            k = world["tint"][ty][tx]
            col = tuple(max(0, min(255, int(c * k))) for c in base)
            diamond(d, cx, cy, tw, th, col)

            kind = world["kind"][ty][tx]
            if kind == "pool":
                diamond(d, cx, cy, tw * 0.7, th * 0.7, (24, 34, 40))
            if kind in ("rubble", "bones"):
                n = 7 if kind == "bones" else 5
                for i in range(n):
                    a = rng.uniform(0, math.pi * 2)
                    r = rng.uniform(0.05, 0.34)
                    px = cx + math.cos(a) * r * tw
                    py = cy + math.sin(a) * r * th
                    c = BONE if kind == "bones" else (86, 80, 68)
                    d.ellipse([px - 1.6, py - 1.2, px + 1.6, py + 1.2], fill=c)

            # wall: everything bordering a floor becomes a block next door
            for (nx, ny) in ((tx + 1, ty), (tx, ty + 1)):
                if nx < WORLD_W and ny < WORLD_H and not world["floor"][ny][nx]:
                    wx, wy = iso(nx, ny, tw, th, ox, oy)
                    top = WALL_TOP
                    d.polygon([(wx - tw / 2.0, wy), (wx, wy - th / 2.0),
                               (wx, wy - th / 2.0 - wall_h), (wx - tw / 2.0, wy - wall_h)],
                              fill=WALL_L)
                    d.polygon([(wx, wy - th / 2.0), (wx + tw / 2.0, wy),
                               (wx + tw / 2.0, wy - wall_h), (wx, wy - th / 2.0 - wall_h)],
                              fill=WALL_R)
                    diamond(d, wx, wy - th / 2.0 - wall_h, tw, th, top)
                    d.line([(wx, wy - th / 2.0), (wx, wy - th / 2.0 - wall_h)], fill=(18, 16, 15), width=1)

            if kind == "pillar":
                h = wall_h * 0.85
                d.polygon([(cx - tw * 0.22, cy), (cx, cy - th * 0.22),
                           (cx, cy - th * 0.22 - h), (cx - tw * 0.22, cy - h)], fill=WALL_L)
                d.polygon([(cx, cy - th * 0.22), (cx + tw * 0.22, cy),
                           (cx + tw * 0.22, cy - h), (cx, cy - th * 0.22 - h)], fill=WALL_R)
                diamond(d, cx, cy - th * 0.22 - h, tw * 0.44, th * 0.44, WALL_TOP)

            if kind == "torch":
                h = wall_h * 0.5
                bx, by = cx, cy - h
                d.rectangle([bx - tw * 0.06, by - th * 0.5, bx + tw * 0.06, by + th * 0.2], fill=IRON)
                d.ellipse([bx - tw * 0.12, by - th * 0.85, bx + tw * 0.12, by - th * 0.35], fill=FIRE)
                for r in (tw * 0.5, tw * 0.95, tw * 1.5):
                    g.ellipse([bx - r, by - th * 0.6 - r * th / tw, bx + r, by - th * 0.6 + r * th / tw],
                              fill=(int(70 * (tw * 0.5) / r), int(42 * (tw * 0.5) / r), int(12 * (tw * 0.5) / r)))

            if kind == "hero":
                fw, fh = tw * 0.30, th * 1.15
                fx = cx
                fy = cy - fh * 0.42
                d.polygon([(fx, fy - fh * 0.95), (fx + fw * 0.85, fy - fh * 0.55),
                           (fx + fw, fy + fh * 0.45), (fx - fw, fy + fh * 0.45),
                           (fx - fw * 0.85, fy - fh * 0.55)], fill=HERO_CLOAK)
                d.polygon([(fx - fw * 0.5, fy - fh * 0.15), (fx + fw * 0.5, fy - fh * 0.15),
                           (fx + fw * 0.62, fy - fh * 0.02), (fx - fw * 0.62, fy - fh * 0.02)], fill=HERO_TRIM)
                d.ellipse([fx - fw * 0.34, fy - fh * 1.34, fx + fw * 0.34, fy - fh * 0.78], fill=SKIN)
                d.line([(fx - fw * 1.5, fy - fh * 0.5), (fx - fw * 0.7, fy - fh * 1.2)], fill=(198, 202, 210), width=max(1, int(tw * 0.03)))

            if kind == "monster":
                fw, fh = tw * 0.28, th * 1.0
                fx = cx
                fy = cy - fh * 0.35
                d.ellipse([fx - fw, fy - fh * 0.55, fx + fw, fy + fh * 0.75], fill=CREATURE)
                d.ellipse([fx - fw * 0.62, fy - fh * 1.25, fx + fw * 0.62, fy - fh * 0.45], fill=CREATURE)
                e = max(1.2, fw * 0.20)
                d.ellipse([fx - fw * 0.42 - e, fy - fh * 0.95 - e, fx - fw * 0.42 + e, fy - fh * 0.95 + e], fill=EYE)
                d.ellipse([fx + fw * 0.42 - e, fy - fh * 0.95 - e, fx + fw * 0.42 + e, fy - fh * 0.95 + e], fill=EYE)

    # vignette: darken the edges so the eye goes to the centre
    mask = Image.new("L", (W, H), 0)
    md = ImageDraw.Draw(mask)
    md.ellipse([-W * 0.25, -H * 0.35, W * 1.25, H * 1.35], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(W * 0.06))
    dark = Image.new("RGB", (W, H), (6, 6, 7))
    img = Image.composite(img, dark, mask)

    glow = glow.filter(ImageFilter.GaussianBlur(tw * 0.35))
    return ImageChops.add(img, glow)


def to_cells(img):
    resample = getattr(Image, "Resampling", Image).BOX
    small = img.resize((COLS, ROWS), resample)
    px = small.load()
    cells = []
    for y in range(ROWS):
        row = []
        for x in range(COLS):
            c = px[x, y]
            row.append((glyph(c), quant(c)))
        cells.append(row)
    return cells


def panel_html(cells):
    rows = []
    ink = 0
    for row in cells:
        parts = []
        start = 0
        key = None
        for x in range(len(row) + 1):
            col = row[x][1] if x < len(row) else (-1, -1, -1)
            if col != key:
                if key is not None and x > start:
                    text = "".join(row[i][0] for i in range(start, x))
                    if key == (0, 0, 0) or text.strip() == "":
                        parts.append(" " * len(text))
                    else:
                        ink += len(text.strip())
                        hexc = "#%02x%02x%02x" % key
                        parts.append('<i style="color:%s">%s</i>' % (hexc, text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")))
                start = x
                key = col
        rows.append("".join(parts))
    return "\n".join(rows), ink


HEAD = """<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Isoforge — teste de olhar: cripta isométrica em ASCII</title>
<style>
  :root {{
    --panelw: min(1180px, calc(100vw - 56px));
    --ratio: {ratio:.6f};
    --bg: #05060a; --panel: #0a0c12; --line: #1d2230;
    --ink: #e8e3d6; --dim: #8d897c; --accent: #d8b25e;
    --mono: "SFMono-Regular", Menlo, Consolas, "DejaVu Sans Mono", monospace;
  }}
  * {{ box-sizing: border-box; }}
  body {{ margin: 0; padding: 38px 28px 60px; background: radial-gradient(120% 80% at 50% 0%, #0e1017 0%, var(--bg) 60%, #030406 100%);
         color: var(--ink); font-family: var(--mono); line-height: 1.5; }}
  .wrap {{ width: var(--panelw); margin: 0 auto; }}
  h1 {{ font-size: 21px; margin: 0 0 6px; letter-spacing: .01em; }}
  .lede {{ color: var(--dim); font-size: 12.5px; margin: 0 0 22px; max-width: 92ch; }}
  .card {{ border: 1px solid var(--line); border-radius: 10px; background: var(--panel); margin-bottom: 22px; overflow: hidden; }}
  .cap {{ display: flex; flex-wrap: wrap; gap: 6px 18px; align-items: baseline; padding: 10px 14px; border-bottom: 1px solid var(--line);
          font-size: 11.5px; color: var(--dim); }}
  .cap b {{ color: var(--accent); font-weight: 600; }}
  .artwrap {{ overflow-x: auto; padding: 14px 16px 16px; }}
  pre {{ margin: 0; font-family: var(--mono); font-size: calc(var(--panelw) * var(--ratio)); line-height: 1;
         white-space: pre; font-variant-ligatures: none; -webkit-font-smoothing: antialiased; }}
  pre i {{ font-style: normal; }}
  footer {{ color: var(--dim); font-size: 11.5px; border-top: 1px solid var(--line); padding-top: 14px; }}
  code {{ color: var(--accent); }}
</style></head><body><div class="wrap">
<h1>Cripta isométrica em ASCII colorido — teste de escala do tile</h1>
<p class="lede">Mesma grade nos dois painéis (<b>214 × 69 caracteres</b>, rampa de 91 caracteres do navio, cor por célula,
gama 1.9). Muda só quantas células cada tile ocupa: no primeiro o tile é pequeno e se vê mais mundo; no segundo o tile
é grande e cada tile tem mais detalhe. Escolha qual câmera você quer para o jogo.</p>
"""


def main():
    world = build_world()
    ratio = 0.92 / (COLS * 0.6)
    html = [HEAD.format(ratio=ratio)]
    variants = [(10, 3), (20, 6)]
    stats = []
    for (tw, th) in variants:
        img = draw_scene(tw, th, world)
        cells = to_cells(img)
        body, ink = panel_html(cells)
        seen = len({c for row in cells for (_, c) in row})
        tiles_x = COLS / float(tw)
        tiles_y = ROWS / float(th)
        stats.append((tw, th, seen, ink))
        html.append('<section class="card">\n  <div class="cap">'
                    '<span><b>tile %d × %d células</b> (%d × %d px com fonte de 11 px)</span>'
                    '<span>tiles na tela: ~%d × %d</span>'
                    '<span>cores distintas: %d</span>'
                    '<span>pixels de arte por tile: %d × %d</span>'
                    '</div>\n  <div class="artwrap"><pre>%s</pre></div>\n</section>'
                    % (tw, th, int(tw * CELL_W), int(th * CELL_H), int(tiles_x), int(tiles_y), seen,
                       int(tw * CELL_W), int(th * CELL_H), body))
    html.append("<footer>Ambos os painéis: mesma cena, mesma semente, mesmo número de caracteres. "
                "O primeiro é a câmera ampla (mais tiles, menos detalhe por tile); o segundo é a câmera fechada "
                "(menos tiles, cada um com o triplo de caracteres). Gerado por <code>tools/looktest_iso_ascii.py</code>.</footer>")
    html.append("</div></body></html>")
    page = "\n".join(html)
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write(page)
    print("escrito %s (%.0f KB)" % (OUT, os.path.getsize(OUT) / 1024.0))
    for (tw, th, seen, ink) in stats:
        print("  tile %dx%d cells: %d colours, %d inked glyphs" % (tw, th, seen, ink))


if __name__ == "__main__":
    main()
