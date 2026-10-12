#!/usr/bin/env python3
"""Audit for the TEXT engine: opens isoforge.html in a real browser and asserts
the engine's contracts. Exits 1 if any check fails.

Run:
  PYTHONPATH= ~/.hermes/hermes-agent/venv/bin/python3 tools/audit_text.py

Writes reports/audit.json and reports/screen.png.

Why a real browser: rAF pacing, text layout, localStorage under file:// and the
cost of rewriting a 15k cell grid cannot be measured anywhere else.

Headless traps this script works around (each one cost a round):
  - a background tab has visibilityState "hidden" and requestAnimationFrame is
    suspended -> the loop looks dead (0 frames, 0 ticks); the audit brings the
    page to the front and asserts visibilityState first.
  - capacity claims must come from a live frame's stats, never from a copy of
    the algorithm: the renderer's drawn-tile count is compared against the
    geometric count here.
  - a movement test needs a corridor verified in the grid; assuming a clear path
    measures a wall slide instead of the speed.
"""

import json
import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILT = os.path.join(BASE, "isoforge.html")
PAGE_URL = "file://" + BUILT + "#seed=1234"
REPORT_JSON = os.path.join(BASE, "reports", "audit.json")
REPORT_PNG = os.path.join(BASE, "reports", "screen.png")

PLAYER_SPEED = 4.2          # tiles per second, must match src/sim/sim.js
FIXED_STEP = 1 / 60
RENDER_BUDGET_MS = 8.0      # p95 of the whole render call, from the plan

CHECKS = []
CONSOLE_ERRORS = []


def check(name, ok, detail):
    CHECKS.append({"check": name, "ok": bool(ok), "detail": detail})
    print(("PASS  " if ok else "FAIL  ") + name + " :: " + json.dumps(detail)[:190])


def data(page, expression):
    return json.loads(page.evaluate("JSON.stringify(%s)" % expression))


def culling_row(page, cam):
    page.evaluate("window.ISO.teleport(%f, %f)" % cam)
    page.wait_for_timeout(700)
    live = data(page, "({camera: {x: window.ISO.camera.x, y: window.ISO.camera.y}, metrics: window.ISO.metrics(), world: window.ISO.world.stats})")
    metrics = live["metrics"]
    geo = data(page,
               "window.ISO.headless.culling(%d, %d, %f, %f)"
               % (metrics["cols"], metrics["rows"], live["camera"]["x"], live["camera"]["y"]))
    drawn = live["world"]["tilesDrawn"] + live["world"]["blocksDrawn"]
    return {
        "grid": "%dx%d" % (metrics["cols"], metrics["rows"]),
        "iterated": live["world"]["iterated"],
        "culled": live["world"]["culled"],
        "drawn": drawn,
        "geometricVisible": geo["visibleTiles"],
        "diff": drawn - geo["visibleTiles"],
        "missingTiles": geo["missingTiles"],
        "coversViewport": geo["coversViewport"],
        "iterationOverVisible": round(geo["iterationOverVisible"], 3),
    }


def layout(page):
    return data(page, """(() => {
      var doc = document.documentElement;
      var pre = document.getElementById('screen');
      var r = pre.getBoundingClientRect();
      var m = window.ISO.metrics();
      return {
        viewport: [window.innerWidth, window.innerHeight],
        overflowX: doc.scrollWidth - doc.clientWidth,
        overflowY: doc.scrollHeight - doc.clientHeight,
        gridPx: [Math.round(r.width), Math.round(r.height)],
        gridCells: [m.cols, m.rows],
        fontPx: m.fontPx,
        coverageX: r.width / window.innerWidth,
        coverageY: r.height / window.innerHeight
      };
    })()""")


def run(page):
    page.goto(PAGE_URL, wait_until="load")
    page.bring_to_front()
    page.wait_for_timeout(1500)

    # 1. boot ---------------------------------------------------------------
    boot = data(page, "({mode: window.ISO.mode, visible: document.visibilityState, errors: window.ISO.debug.errors, constants: window.ISO.debug.constants})")
    check("boot: motor em modo texto, sem erro", boot["mode"] == "text" and boot["errors"] == [], boot["errors"])
    check("boot: aba visível (rAF não suspenso)", boot["visible"] == "visible", boot["visible"])
    tag = data(page, "({tag: document.getElementById('screen').tagName, children: document.getElementById('screen').children.length})")
    check("boot: a tela é um <pre>", tag["tag"] == "PRE", tag)

    # 2. o arquivo entregue não tem imagem nem canvas ------------------------
    with open(BUILT, encoding="utf-8") as handle:
        html = handle.read()
    check("arquivo único: sem <canvas>, sem data:image, sem http", 
          "<canvas" not in html and "data:image" not in html and "http://" not in html and "https://" not in html,
          {"kb": round(len(html.encode()) / 1024, 1)})

    # 3. projeção e determinismo (inalterados pelo pivô) ---------------------
    check("projeção 2:1 ida-e-volta < 0,001 tile",
          data(page, "window.ISO.headless.projectionRoundTrip(2000)")["maxErrorTiles"] < 0.001, "2000 amostras")
    determinism = data(page, "window.ISO.headless.determinism(1234, 600)")
    check("mesma semente + mesma entrada = mesmo hash (600 passos, 2 execuções)",
          determinism["identical"] and determinism["firstHash"] != determinism["finalHash"], determinism["finalHash"])
    closure = data(page, "window.ISO.headless.loopClosure(1234, 600)")
    check("emenda: passo 600 ≡ passo 0", closure["closed"], closure)

    # 4. culling em células --------------------------------------------------
    center = culling_row(page, (32.5, 32.5))
    check("culling centro: tiles desenhados == tiles que tocam a tela",
          center["diff"] == 0 and center["missingTiles"] == 0, center)
    edge = culling_row(page, (4.5, 4.5))
    check("culling borda do mundo: sem furo na tela",
          edge["diff"] == 0 and edge["missingTiles"] == 0, edge)

    # 5. custo de quadro e de escrita no DOM --------------------------------
    page.evaluate("window.ISO.teleport(32.5, 32.5)")
    page.wait_for_timeout(600)
    page.evaluate("window.ISO.loop.stats.frames = 0")
    page.wait_for_timeout(6000)
    stats = data(page, "window.ISO.loop.stats")
    render = data(page, "window.ISO.debug.renderStats()")
    check("60 fps: p95 de quadro <= 25 ms (piso pedido: 30 fps)",
          stats["p95"] <= 25.0, {"fps": round(stats["fps"], 1), "p50": round(stats["p50"], 2), "p95": round(stats["p95"], 2)})
    check("custo de render p95 <= 8 ms", stats["renderP95"] <= RENDER_BUDGET_MS,
          {"renderP95": round(stats["renderP95"], 3), "present": round(stats["presentMs"], 3)})
    check("rodando, o redesenho é parcial (só as linhas com movimento)",
          render["rebuiltRows"] < render["rows"] and render["htmlBytes"] < render["gridBytes"],
          {"rebuiltRows": render["rebuiltRows"], "rows": render["rows"],
           "kbEscritos": round(render["htmlBytes"] / 1024), "kbGrade": round(render["gridBytes"] / 1024)})

    # parado de verdade (loop parado, render forçado): zero bytes no DOM
    page.evaluate("window.ISO.loop.stop()")
    page.wait_for_timeout(200)
    page.evaluate("window.ISO.renderOnce()")
    page.wait_for_timeout(120)
    frozen = data(page, """(() => {
      var before = window.ISO.debug.lastPresent;
      for (var i = 0; i < 8; i++) window.ISO.renderOnce();
      var after = window.ISO.debug.renderStats();
      return {rows: after.rows, rebuiltRows: after.rebuiltRows, bytes: after.htmlBytes,
              firstBytes: before.htmlBytes, cells: after.cells};
    })()""")
    check("parado: zero linhas reconstruídas e zero bytes escritos no DOM",
          frozen["rebuiltRows"] == 0 and frozen["bytes"] == 0, frozen)
    page.evaluate("window.ISO.loop.start()")
    page.wait_for_timeout(300)

    # Pior caso: a câmera anda, então todas as linhas mudam a cada quadro.
    # The player must start in a verified corridor NEAR THE CENTRE of the map:
    # at the border the camera is clamped, so walking does not scroll the grid
    # and this would measure a standing-still frame (0 rows rebuilt).
    corridor = data(page, """(() => {
      var g = window.ISO.grid;
      var cx = Math.floor(g.width / 2), cy = Math.floor(g.height / 2);
      for (var dy = 0; dy < 10; dy++) {
        for (var sx = -1; sx <= 1; sx += 2) {
          for (var sy = -1; sy <= 1; sy += 2) {
            var tx = cx + sx * dy, ty = cy + sy * dy;
            var clear = true;
            for (var i = 0; i < 9; i++) if (!g.isWalkableTile(tx + i, ty - i)) { clear = false; break; }
            if (clear) return {x: tx + 0.5, y: ty + 0.5};
          }
        }
      }
      return null;
    })()""")
    page.evaluate("window.ISO.teleport(%f, %f)" % (corridor["x"], corridor["y"]))
    page.wait_for_timeout(400)
    page.evaluate("window.ISO.loop.stats.frames = 0")
    page.keyboard.down("d")
    page.wait_for_timeout(4000)
    walking = data(page, "({fps: window.ISO.loop.stats.fps, p50: window.ISO.loop.stats.p50, p95: window.ISO.loop.stats.p95, renderP95: window.ISO.loop.stats.renderP95, stats: window.ISO.debug.renderStats(), moved: [window.ISO.sim.player.x, window.ISO.sim.player.y]})")
    page.keyboard.up("d")
    page.wait_for_timeout(300)
    check("andando (câmera rolando): 60 fps, p95 <= 25 ms e escrita proporcional ao que mudou na tela",
          walking["p95"] <= 25.0 and walking["fps"] >= 45
          and walking["stats"]["rebuiltRows"] >= 5
          and walking["stats"]["htmlBytes"] < walking["stats"]["gridBytes"] * 0.5,
          {"fps": round(walking["fps"], 1), "p50": round(walking["p50"], 2), "p95": round(walking["p95"], 2),
           "renderP95": round(walking["renderP95"], 2),
           "kbPorQuadro": "%.0f de %.0f" % (walking["stats"]["htmlBytes"] / 1024, walking["stats"]["gridBytes"] / 1024),
           "linhas": "%d/%d" % (walking["stats"]["rebuiltRows"], walking["stats"]["rows"])})
    check("pior caso: o custo de render fica dentro do orçamento de 8 ms",
          walking["renderP95"] <= RENDER_BUDGET_MS, {"renderP95": round(walking["renderP95"], 3)})

    # 6. teclado: direção pura na tela e velocidade exata --------------------
    page.evaluate("window.ISO.teleport(%f, %f)" % (corridor["x"], corridor["y"]))
    page.wait_for_timeout(300)
    before = data(page, "({x: window.ISO.sim.player.x, y: window.ISO.sim.player.y, tick: window.ISO.sim.getTick()})")
    page.keyboard.down("d")
    page.wait_for_timeout(1000)
    page.keyboard.up("d")
    after = data(page, "({x: window.ISO.sim.player.x, y: window.ISO.sim.player.y, tick: window.ISO.sim.getTick()})")
    ticks = after["tick"] - before["tick"]
    travel = ((after["x"] - before["x"]) ** 2 + (after["y"] - before["y"]) ** 2) ** 0.5
    expected = PLAYER_SPEED * ticks * FIXED_STEP
    tolerance = 0.02 * expected + 2 * PLAYER_SPEED * FIXED_STEP
    screen_dx = (after["x"] - after["y"]) - (before["x"] - before["y"])
    screen_dy = (after["x"] + after["y"]) - (before["x"] + before["y"])
    check("tecla D anda para a direita na tela, sem deriva vertical",
          screen_dx > 0 and abs(screen_dy) < 0.05, {"screenDx": round(screen_dx, 3), "screenDy": round(screen_dy, 3)})
    check("velocidade exata: 4,2 tiles/s (tolerância = 2% + 2 tiques)",
          expected > 0 and abs(travel - expected) <= tolerance,
          {"travel": round(travel, 3), "expected": round(expected, 3), "ticks": ticks})

    # 7. parede --------------------------------------------------------------
    spot = data(page, """(() => {
      var g = window.ISO.grid;
      for (var ty = 1; ty < g.height - 2; ty++) for (var tx = 1; tx < g.width - 2; tx++) {
        if (!g.isWalkableTile(tx, ty)) continue;
        if (g.isWalkableTile(tx + 1, ty + 1)) continue;
        return {x: tx + 0.5, y: ty + 0.5, wall: [tx + 1, ty + 1]};
      }
      return null;
    })()""")
    page.evaluate("window.ISO.teleport(%f, %f)" % (spot["x"], spot["y"]))
    page.wait_for_timeout(300)
    page.keyboard.down("s")
    page.wait_for_timeout(1400)
    page.keyboard.up("s")
    wall = data(page, """(() => {
      var p = window.ISO.sim.player, g = window.ISO.grid;
      var tile = [Math.floor(p.x), Math.floor(p.y)];
      return {tile: tile, walkable: g.isWalkableTile(tile[0], tile[1]),
              corners: g.isWalkableAt(p.x - 0.3, p.y - 0.3) && g.isWalkableAt(p.x + 0.3, p.y - 0.3)
                    && g.isWalkableAt(p.x - 0.3, p.y + 0.3) && g.isWalkableAt(p.x + 0.3, p.y + 0.3),
              insideWall: tile[0] === %d && tile[1] === %d};
    })()""" % (spot["wall"][0], spot["wall"][1]))
    check("parede: empurrar não coloca o jogador dentro do bloco",
          wall["walkable"] and wall["corners"] and not wall["insideWall"], {"end": wall["tile"]})

    # 8. clique: a célula clicada vira o tile do destino ----------------------
    page.evaluate("window.ISO.teleport(32.5, 32.5)")
    page.wait_for_timeout(500)
    target_tile = data(page, """(() => {
      var ISO = window.ISO, g = ISO.grid, cam = ISO.camera;
      for (var d = 7; d >= 4; d--) {
        var tx = Math.floor(cam.x) + d, ty = Math.floor(cam.y) - 2;
        if (g.isWalkableTile(tx, ty)) return {x: tx, y: ty};
      }
      return null;
    })()""")
    point = data(page, "window.ISO.clientPointForTile(%d, %d)" % (target_tile["x"], target_tile["y"]))
    page.mouse.click(point["x"], point["y"])
    page.wait_for_timeout(300)
    sent = data(page, "({tx: window.ISO.sim.player.targetX, ty: window.ISO.sim.player.targetY, x: window.ISO.sim.player.x, y: window.ISO.sim.player.y})")
    page.wait_for_timeout(1200)
    walked = data(page, "({x: window.ISO.sim.player.x, y: window.ISO.sim.player.y})")
    hit_tile = [int(sent["tx"] or -1), int(sent["ty"] or -1)]
    check("clique: a célula clicada corresponde ao tile do destino (projeção inversa exata)",
          hit_tile == [target_tile["x"], target_tile["y"]],
          {"clickedCell": point["cell"], "wanted": [target_tile["x"], target_tile["y"]], "target": hit_tile})
    distance_before = ((sent["tx"] - sent["x"]) ** 2 + (sent["ty"] - sent["y"]) ** 2) ** 0.5
    distance_after = ((sent["tx"] - walked["x"]) ** 2 + (sent["ty"] - walked["y"]) ** 2) ** 0.5
    check("clique: o jogador caminha até o destino",
          distance_after < distance_before - 2, {"before": round(distance_before, 2), "after": round(distance_after, 2)})

    # 9. HUD é texto desenhado na mesma grade --------------------------------
    hud_probe = data(page, """(() => {
      var grid = window.ISO.gridText().split("\\n");
      var box = 0, inked = 0, total = 0;
      var glyphs = {};
      for (var y = 0; y < grid.length; y++) {
        for (var x = 0; x < grid[y].length; x++) {
          var ch = grid[y].charAt(x);
          total++;
          if (ch !== ' ') { inked++; glyphs[ch] = (glyphs[ch] || 0) + 1; }
          if ("╔╗╚╝═║│".indexOf(ch) >= 0) box++;
        }
      }
      return {rows: grid.length, cols: grid[0].length, inked: inked, boxGlyphs: box,
              distinct: Object.keys(glyphs).length,
              hasTitle: grid[1].indexOf("isoforge") >= 0};
    })()""")
    check("HUD em texto: moldura de box-drawing e título na grade",
          hud_probe["boxGlyphs"] > 20 and hud_probe["hasTitle"], hud_probe)
    check("arte: grade com tinta suficiente e variedade de glifos",
          hud_probe["inked"] > hud_probe["rows"] * hud_probe["cols"] * 0.15 and hud_probe["distinct"] > 25,
          {"inked": hud_probe["inked"], "cells": hud_probe["rows"] * hud_probe["cols"], "distinct": hud_probe["distinct"]})

    # 10. layout: nada de barra de rolagem, grade preenchendo a tela ---------
    desktop = layout(page)
    check("layout 1280x633: sem barra de rolagem e grade cobrindo a tela",
          desktop["overflowX"] == 0 and desktop["overflowY"] == 0
          and desktop["coverageX"] > 0.9 and desktop["coverageY"] > 0.9, desktop)

    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(700)
    mobile = layout(page)
    check("layout 390x844: sem barra de rolagem",
          mobile["overflowX"] == 0 and mobile["overflowY"] == 0 and mobile["coverageY"] > 0.9, mobile)
    mobile_cull = data(page, """({drawn: window.ISO.world.stats.tilesDrawn + window.ISO.world.stats.blocksDrawn,
        visible: window.ISO.headless.culling(window.ISO.metrics().cols, window.ISO.metrics().rows,
                 window.ISO.camera.x, window.ISO.camera.y).visibleTiles})""")
    check("layout 390x844: culling continua exato", mobile_cull["drawn"] == mobile_cull["visible"], mobile_cull)

    page.set_viewport_size({"width": 1440, "height": 900})
    page.wait_for_timeout(900)
    page.screenshot(path=REPORT_PNG)

    check("console e window.onerror limpos",
          data(page, "window.ISO.debug.errors") == [] and CONSOLE_ERRORS == [],
          {"iso": data(page, "window.ISO.debug.errors"), "page": CONSOLE_ERRORS})

    return {
        "boot": boot, "determinism": determinism, "loopClosure": closure,
        "cullingCenter": center, "cullingEdge": edge, "fps": stats,
        "render": {k: render[k] for k in ("cols", "rows", "cells", "fontPx", "cellW", "cellH", "spans", "htmlBytes", "rebuiltRows", "presentMs")},
        "hud": hud_probe, "layoutDesktop": desktop, "layoutMobile": mobile
    }


def main():
    with sync_playwright() as playwright:
        try:
            browser = playwright.chromium.launch()
        except Exception:
            browser = playwright.chromium.launch(channel="chrome")
        page = browser.new_page(viewport={"width": 1280, "height": 633}, device_scale_factor=1)
        page.on("console", lambda message: CONSOLE_ERRORS.append(message.text) if message.type == "error" else None)
        page.on("pageerror", lambda error: CONSOLE_ERRORS.append(str(error)))
        detail = run(page)
        browser.close()

    passed = sum(1 for c in CHECKS if c["ok"])
    failed = [c for c in CHECKS if not c["ok"]]
    os.makedirs(os.path.dirname(REPORT_JSON), exist_ok=True)
    with open(REPORT_JSON, "w", encoding="utf-8") as handle:
        json.dump({"passed": passed, "failed": len(failed), "checks": CHECKS, "measurements": detail},
                  handle, indent=2, ensure_ascii=False)
    print("\n%d/%d verificações passaram" % (passed, len(CHECKS)))
    print("relatório: %s" % REPORT_JSON)
    for item in failed:
        print("  FALHA: %s" % item["check"])
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
