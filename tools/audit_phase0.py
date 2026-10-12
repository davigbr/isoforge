#!/usr/bin/env python3
"""Phase 0 audit: opens isoforge.html in a real browser and asserts the
engine's contracts. Exits 1 if any check fails.

Run:
  ~/.hermes/hermes-agent/venv/bin/python3 tools/audit_phase0.py

Writes reports/phase0-audit.json and reports/phase0-screen.png.

Why a real browser: rAF pacing, device-pixel scaling, localStorage under
file:// and canvas throughput cannot be measured anywhere else. Headless
LIMITATIONS this script works around (each one cost a round):
  - a background tab has visibilityState "hidden" and the browser suspends
    requestAnimationFrame -> the loop looks dead (0 frames, 0 ticks). The
    audit forces the page to the front and asserts visibilityState/visible.
  - capacity claims must come from a live frame's stats, not from a copy of
    the algorithm: the renderer and the geometric check are compared here.
"""

import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE_URL = "file://" + os.path.join(BASE, "isoforge.html") + "#seed=1234"
REPORT_JSON = os.path.join(BASE, "reports", "phase0-audit.json")
REPORT_PNG = os.path.join(BASE, "reports", "phase0-screen.png")

PLAYER_SPEED = 4.2          # tiles per second, must match src/sim/sim.js
FIXED_STEP = 1 / 60
FRAME_BUDGET_MS = 8.0       # p95 of the draw call, from the plan's contract

CHECKS = []
CONSOLE_ERRORS = []


def check(name, ok, detail):
    CHECKS.append({"check": name, "ok": bool(ok), "detail": detail})
    print(("PASS  " if ok else "FAIL  ") + name + " :: " + json.dumps(detail)[:180])


def data(page, expression):
    return json.loads(page.evaluate("JSON.stringify(%s)" % expression))


def culling_row(page, cam):
    page.evaluate("window.ISO.teleport(%f, %f)" % cam)
    page.wait_for_timeout(700)
    live = data(page, "({camera: {x: window.ISO.camera.x, y: window.ISO.camera.y}, stats: window.ISO.renderer.stats})")
    viewport = live["stats"]["viewport"]
    geo = data(page, "window.ISO.headless.culling(%d, %d, %f, %f)" % (
        viewport["w"], viewport["h"], live["camera"]["x"], live["camera"]["y"]))
    rendered = live["stats"]["tilesDrawn"] + live["stats"]["blocksDrawn"]
    return {
        "viewport": viewport,
        "iterated": live["stats"]["iterated"],
        "culled": live["stats"]["culled"],
        "rendered": rendered,
        "geometricVisible": geo["visibleTiles"],
        "diff": rendered - geo["visibleTiles"],
        "missingTiles": geo["missingTiles"],
        "coversViewport": geo["coversViewport"],
        "iterationOverVisible": round(geo["iterationOverVisible"], 3),
    }


def run(page):
    page.goto(PAGE_URL, wait_until="load")
    page.bring_to_front()
    page.wait_for_timeout(1500)

    # 1. boot -----------------------------------------------------------------
    boot = data(page, "({iso: typeof window.ISO, visible: document.visibilityState, errors: window.ISO.debug.errors, constants: window.ISO.debug.constants})")
    check("boot: window.ISO exposto sem erro", boot["iso"] == "object" and boot["errors"] == [], boot["errors"])
    check("boot: aba visível (rAF não suspenso)", boot["visible"] == "visible", boot["visible"])
    check("boot: fullscreen API disponível", page.evaluate("typeof document.documentElement.requestFullscreen === 'function'"), True)

    # 2. projeção -------------------------------------------------------------
    projection = data(page, "window.ISO.headless.projectionRoundTrip(2000)")
    check("projeção 2:1 ida-e-volta < 0,001 tile", projection["maxErrorTiles"] < 0.001, projection)

    # 3. determinismo ---------------------------------------------------------
    determinism = data(page, "window.ISO.headless.determinism(1234, 600)")
    check("mesma semente + mesma entrada = mesmo hash (600 passos, 2 execuções)",
          determinism["identical"] and determinism["firstHash"] != determinism["finalHash"], determinism)

    # 4. fechamento do loop ---------------------------------------------------
    closure = data(page, "window.ISO.headless.loopClosure(1234, 600)")
    check("emenda: passo 600 ≡ passo 0 (osciladores fecham ciclos inteiros)", closure["closed"], closure)

    # 5. culling, dpr 1, centro e borda ---------------------------------------
    center = culling_row(page, (32.5, 32.5))
    check("culling dpr1 centro: desenhados == visíveis, sem buraco",
          center["diff"] == 0 and center["missingTiles"] == 0, center)
    edge = culling_row(page, (4.5, 4.5))
    check("culling dpr1 borda do mundo: desenhados == visíveis, sem buraco",
          edge["diff"] == 0 and edge["missingTiles"] == 0, edge)

    # 6. dpr 2 ----------------------------------------------------------------
    page.set_viewport_size({"width": 1280, "height": 633})
    cdp = page.context.new_cdp_session(page)
    cdp.send("Emulation.setDeviceMetricsOverride", {"width": 1280, "height": 633, "deviceScaleFactor": 2, "mobile": False})
    page.wait_for_timeout(400)
    page.evaluate("window.dispatchEvent(new Event('resize'))")
    page.wait_for_timeout(900)
    retina = culling_row(page, (32.5, 32.5))
    check("dpr 2: escala de pixel inteira e mesma área de mundo",
          retina["viewport"]["scale"] == 2 and abs(retina["viewport"]["w"] - 2 * 1280) <= 2, retina)
    check("dpr 2: desenhados == visíveis", retina["diff"] == 0 and retina["missingTiles"] == 0, retina)

    # 7. 60 Hz real -----------------------------------------------------------
    page.evaluate("window.ISO.loop.stats.frames = 0")
    page.wait_for_timeout(6000)
    stats = data(page, "window.ISO.loop.stats")
    check("60 fps: p95 de quadro <= 25 ms (piso 30 fps)", stats["p95"] <= 25.0, {"fps": round(stats["fps"], 1), "p50": round(stats["p50"], 2), "p95": round(stats["p95"], 2)})
    check("desenho p95 <= 8 ms (contrato de performance)", stats["renderP95"] <= FRAME_BUDGET_MS,
          {"renderP95": round(stats["renderP95"], 3), "frames": stats["frames"]})
    cdp.send("Emulation.clearDeviceMetricsOverride")
    page.wait_for_timeout(400)
    page.evaluate("window.dispatchEvent(new Event('resize'))")
    page.wait_for_timeout(400)

    # 8. teclado: direção pura na tela e velocidade exata ---------------------
    # The run must be clear: KeyD is world (+x, -y), so pick a diagonal corridor
    # verified in the grid instead of assuming the spawn is open (it is not --
    # the first version of this audit compared a wall-slide against free travel).
    corridor = data(page, """(() => {
      var g = window.ISO.grid;
      for (var ty = 9; ty < g.height - 1; ty++) for (var tx = 1; tx < g.width - 10; tx++) {
        var clear = true;
        for (var i = 0; i < 9; i++) if (!g.isWalkableTile(tx + i, ty - i)) { clear = false; break; }
        if (clear) return {x: tx + 0.5, y: ty + 0.5};
      }
      return null;
    })()""")
    page.evaluate("window.ISO.teleport(%f, %f)" % (corridor["x"], corridor["y"]))
    page.wait_for_timeout(300)
    before = data(page, "({x: window.ISO.sim.player.x, y: window.ISO.sim.player.y, tick: window.ISO.sim.getTick()})")
    page.keyboard.down("d")
    page.wait_for_timeout(1000)
    page.keyboard.up("d")
    # Read position and tick together, right after the key is released: waiting
    # first would count the idle ticks after the press as if they were travel
    # (that is how the first version of this check reported a 4.27 tile walk
    # against 5.53 expected for 79 ticks).
    after = data(page, "({x: window.ISO.sim.player.x, y: window.ISO.sim.player.y, tick: window.ISO.sim.getTick()})")
    ticks = after["tick"] - before["tick"]
    travel = ((after["x"] - before["x"]) ** 2 + (after["y"] - before["y"]) ** 2) ** 0.5
    expected = PLAYER_SPEED * ticks * FIXED_STEP
    # One or two ticks at each edge belong to input latency, not to the engine.
    tolerance = 0.02 * expected + 2 * PLAYER_SPEED * FIXED_STEP
    screen_dx = (after["x"] - after["y"]) - (before["x"] - before["y"])
    screen_dy = (after["x"] + after["y"]) - (before["x"] + before["y"])
    check("tecla D anda para a direita na tela, sem deriva vertical",
          screen_dx > 0 and abs(screen_dy) < 0.05, {"screenDx": round(screen_dx, 3), "screenDy": round(screen_dy, 3)})
    check("velocidade exata: 4,2 tiles/s (tolerância = 2% + 2 tiques de latência)",
          expected > 0 and abs(travel - expected) <= tolerance,
          {"corridor": corridor, "travel": round(travel, 3), "expected": round(expected, 3),
           "ticks": ticks, "tolerance": round(tolerance, 3)})

    # 9. parede: nunca entra em tile bloqueado -------------------------------
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
    page.wait_for_timeout(300)
    wall = data(page, """(() => {
      var p = window.ISO.sim.player, g = window.ISO.grid;
      var tile = [Math.floor(p.x), Math.floor(p.y)];
      return {tile: tile, walkable: g.isWalkableTile(tile[0], tile[1]),
              corners: g.isWalkableAt(p.x - 0.3, p.y - 0.3) && g.isWalkableAt(p.x + 0.3, p.y - 0.3)
                    && g.isWalkableAt(p.x - 0.3, p.y + 0.3) && g.isWalkableAt(p.x + 0.3, p.y + 0.3),
              insideWall: tile[0] === %d && tile[1] === %d};
    })()""" % (spot["wall"][0], spot["wall"][1]))
    check("parede: empurrar contra o bloco não coloca o jogador dentro dele",
          wall["walkable"] and wall["corners"] and not wall["insideWall"], {"spawn": spot, "end": wall})

    # 10. clique: caminhar até o tile ---------------------------------------
    click = data(page, """(() => {
      var ISO = window.ISO, cam = ISO.camera, g = ISO.grid, vp = ISO.renderer.stats.viewport;
      var cx = Math.floor(cam.x), cy = Math.floor(cam.y);
      for (var d = 9; d >= 4; d--) {
        var tx = cx + d, ty = cy - 2;
        if (!g.isWalkableTile(tx, ty)) continue;
        var sx = ((tx + 0.5 - cam.x) - (ty + 0.5 - cam.y)) * 32 + vp.w / 2;
        var sy = ((tx + 0.5 - cam.x) + (ty + 0.5 - cam.y)) * 16 + vp.h / 2;
        if (sy > vp.h - 60) continue;
        return {clientX: sx, clientY: sy, tile: [tx, ty]};
      }
      return null;
    })()""")
    page.mouse.click(click["clientX"], click["clientY"])
    page.wait_for_timeout(300)
    target = data(page, "({tx: window.ISO.sim.player.targetX, ty: window.ISO.sim.player.targetY, x: window.ISO.sim.player.x, y: window.ISO.sim.player.y})")
    page.wait_for_timeout(1400)
    walked = data(page, "({x: window.ISO.sim.player.x, y: window.ISO.sim.player.y})")
    distance_before = ((target["tx"] - target["x"]) ** 2 + (target["ty"] - target["y"]) ** 2) ** 0.5
    distance_after = ((target["tx"] - walked["x"]) ** 2 + (target["ty"] - walked["y"]) ** 2) ** 0.5
    check("clique define destino e o jogador caminha até ele",
          target["tx"] is not None and distance_after < distance_before - 2, 
          {"tile": click["tile"], "distanceBefore": round(distance_before, 2), "distanceAfter": round(distance_after, 2)})

    # 11. layout --------------------------------------------------------------
    def layout():
        return data(page, """(() => {
          var doc = document.documentElement;
          var bar = document.getElementById('control-bar').getBoundingClientRect();
          var panels = [].map.call(document.querySelectorAll('.panel[data-visible="true"], #status-panel'), function (el) {
            var r = el.getBoundingClientRect();
            return {id: el.id, right: r.right, bottom: r.bottom, overflowX: r.left < 0 || r.right > window.innerWidth, overflowY: r.bottom > window.innerHeight};
          });
          return {viewport: [window.innerWidth, window.innerHeight], overflowX: doc.scrollWidth - doc.clientWidth,
                  overflowY: doc.scrollHeight - doc.clientHeight,
                  barInside: bar.left >= 0 && bar.right <= window.innerWidth && bar.bottom <= window.innerHeight,
                  panels: panels};
        })()""")

    desktop = layout()
    check("layout 1280x633: sem barra de rolagem e HUD dentro da tela",
          desktop["overflowX"] == 0 and desktop["overflowY"] == 0 and desktop["barInside"]
          and all(not p["overflowX"] and not p["overflowY"] for p in desktop["panels"]), desktop)

    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(600)
    mobile = layout()
    check("layout 390x844: rodapé quebra linha, nada estoura",
          mobile["overflowX"] == 0 and mobile["overflowY"] == 0 and mobile["barInside"]
          and all(not p["overflowX"] and not p["overflowY"] for p in mobile["panels"]), mobile)
    mobile_render = data(page, """({rendered: window.ISO.renderer.stats.tilesDrawn + window.ISO.renderer.stats.blocksDrawn,
        visible: window.ISO.headless.culling(window.ISO.renderer.stats.viewport.w, window.ISO.renderer.stats.viewport.h,
                 window.ISO.camera.x, window.ISO.camera.y).visibleTiles})""")
    check("layout 390x844: culling continua exato", mobile_render["rendered"] == mobile_render["visible"], mobile_render)

    page.set_viewport_size({"width": 1280, "height": 800})
    page.wait_for_timeout(800)
    page.screenshot(path=REPORT_PNG)

    # 12. erros ---------------------------------------------------------------
    errors = data(page, "window.ISO.debug.errors")
    page_errors = CONSOLE_ERRORS
    check("console e window.onerror limpos", errors == [] and page_errors == [], {"iso": errors, "page": page_errors})

    return {
        "boot": boot, "projection": projection, "determinism": determinism, "loopClosure": closure,
        "cullingCenter": center, "cullingEdge": edge, "cullingRetina": retina,
        "fps": stats, "wall": wall, "click": click
    }


def main():
    console_errors = []
    with sync_playwright() as playwright:
        try:
            browser = playwright.chromium.launch()
        except Exception:
            browser = playwright.chromium.launch(channel="chrome")
        page = browser.new_page(viewport={"width": 1280, "height": 633}, device_scale_factor=1)
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        page.on("pageerror", lambda error: console_errors.append(str(error)))
        CONSOLE_ERRORS.extend(console_errors)
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
    if failed:
        print("FALHAS:")
        for item in failed:
            print("  - %s" % item["check"])
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
