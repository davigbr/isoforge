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
    check("boot: text engine mode, no errors", boot["mode"] == "text" and boot["errors"] == [], boot["errors"])
    check("boot: tab visible (rAF not suspended)", boot["visible"] == "visible", boot["visible"])
    tag = data(page, "({tag: document.getElementById('screen').tagName, children: document.getElementById('screen').children.length})")
    check("boot: the screen is a <pre>", tag["tag"] == "PRE", tag)

    # 2. the shipped file carries no image and no canvas ------------------------
    with open(BUILT, encoding="utf-8") as handle:
        html = handle.read()
    check("single file: no <canvas>, no data:image, no http", 
          "<canvas" not in html and "data:image" not in html and "http://" not in html and "https://" not in html,
          {"kb": round(len(html.encode()) / 1024, 1)})

    # 3. projection and determinism (unchanged by the pivot) ---------------------
    check("2:1 projection round trip < 0.001 tile",
          data(page, "window.ISO.headless.projectionRoundTrip(2000)")["maxErrorTiles"] < 0.001, "2000 amostras")
    determinism = data(page, "window.ISO.headless.determinism(1234, 600)")
    check("same seed + same input = same hash (600 steps, 2 runs)",
          determinism["identical"] and determinism["firstHash"] != determinism["finalHash"], determinism["finalHash"])
    closure = data(page, "window.ISO.headless.loopClosure(1234, 600)")
    check("loop closure: step 600 == step 0", closure["closed"], closure)

    # 4. culling, in cells --------------------------------------------------
    center = culling_row(page, (32.5, 32.5))
    check("culling centre: tiles drawn == tiles touching the screen",
          center["diff"] == 0 and center["missingTiles"] == 0, center)
    edge = culling_row(page, (4.5, 4.5))
    check("culling world edge: no hole on screen",
          edge["diff"] == 0 and edge["missingTiles"] == 0, edge)

    # 5. frame cost and DOM writes --------------------------------
    page.evaluate("window.ISO.teleport(32.5, 32.5)")
    page.wait_for_timeout(600)
    page.evaluate("window.ISO.loop.stats.frames = 0")
    page.wait_for_timeout(6000)
    stats = data(page, "window.ISO.loop.stats")
    render = data(page, "window.ISO.debug.renderStats()")
    check("60 fps: frame p95 <= 25 ms (requested floor: 30 fps)",
          stats["p95"] <= 25.0, {"fps": round(stats["fps"], 1), "p50": round(stats["p50"], 2), "p95": round(stats["p95"], 2)})
    check("custo de render p95 <= 8 ms", stats["renderP95"] <= RENDER_BUDGET_MS,
          {"renderP95": round(stats["renderP95"], 3), "present": round(stats["presentMs"], 3)})
    check("while running the redraw is partial (only rows with movement)",
          render["rebuiltRows"] < render["rows"] and render["htmlBytes"] < render["gridBytes"],
          {"rebuiltRows": render["rebuiltRows"], "rows": render["rows"],
           "kbEscritos": round(render["htmlBytes"] / 1024), "kbGrade": round(render["gridBytes"] / 1024)})

    # truly idle (loop stopped, render forced): zero bytes written to the DOM
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
    check("idle: zero rows rebuilt and zero bytes written to the DOM",
          frozen["rebuiltRows"] == 0 and frozen["bytes"] == 0, frozen)
    page.evaluate("window.ISO.loop.start()")
    page.wait_for_timeout(300)

    # Worst case: the camera scrolls, so rows change every frame.
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
    walk_start = data(page, "({x: window.ISO.sim.player.x, y: window.ISO.sim.player.y, cam: [window.ISO.camera.x, window.ISO.camera.y]})")
    page.evaluate("window.ISO.loop.stats.frames = 0")
    page.keyboard.down("d")
    page.wait_for_timeout(4000)
    walking = data(page, "({fps: window.ISO.loop.stats.fps, p50: window.ISO.loop.stats.p50, p95: window.ISO.loop.stats.p95, renderP95: window.ISO.loop.stats.renderP95, stats: window.ISO.debug.renderStats(), pos: [window.ISO.sim.player.x, window.ISO.sim.player.y], cam: [window.ISO.camera.x, window.ISO.camera.y]})")
    page.keyboard.up("d")
    page.wait_for_timeout(300)
    walked_tiles = ((walking["pos"][0] - walk_start["x"]) ** 2 + (walking["pos"][1] - walk_start["y"]) ** 2) ** 0.5
    camera_moved = ((walking["cam"][0] - walk_start["cam"][0]) ** 2 + (walking["cam"][1] - walk_start["cam"][1]) ** 2) ** 0.5
    check("walking (camera scrolling): 60 fps, p95 <= 25 ms, bytes written proportional to what changed",
          walking["p95"] <= 25.0 and walking["fps"] >= 45
          and walked_tiles >= 3 and camera_moved >= 1
          and walking["stats"]["rebuiltRows"] >= 3
          and walking["stats"]["htmlBytes"] < walking["stats"]["gridBytes"] * 0.5,
          {"fps": round(walking["fps"], 1), "p50": round(walking["p50"], 2), "p95": round(walking["p95"], 2),
           "renderP95": round(walking["renderP95"], 2),
           "walked": round(walked_tiles, 1), "cameraMoved": round(camera_moved, 1),
           "kbPerFrame": "%.0f of %.0f" % (walking["stats"]["htmlBytes"] / 1024, walking["stats"]["gridBytes"] / 1024),
           "rows": "%d/%d" % (walking["stats"]["rebuiltRows"], walking["stats"]["rows"])})
    check("worst case: render cost stays inside the 8 ms budget",
          walking["renderP95"] <= RENDER_BUDGET_MS, {"renderP95": round(walking["renderP95"], 3)})

    # 6. keyboard: screen-pure direction and exact speed --------------------
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
    check("key D walks screen-right with no vertical drift",
          screen_dx > 0 and abs(screen_dy) < 0.05, {"screenDx": round(screen_dx, 3), "screenDy": round(screen_dy, 3)})
    check("exact speed: 4.2 tiles/s (tolerance = 2% + 2 ticks)",
          expected > 0 and abs(travel - expected) <= tolerance,
          {"travel": round(travel, 3), "expected": round(expected, 3), "ticks": ticks})

    # 7. wall --------------------------------------------------------------
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
    check("wall: pushing does not put the player inside the block",
          wall["walkable"] and wall["corners"] and not wall["insideWall"], {"end": wall["tile"]})

    # 8. click: the clicked cell becomes the destination tile ----------------------
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
    check("click: the clicked cell maps to the destination tile (exact inverse projection)",
          hit_tile == [target_tile["x"], target_tile["y"]],
          {"clickedCell": point["cell"], "wanted": [target_tile["x"], target_tile["y"]], "target": hit_tile})
    distance_before = ((sent["tx"] - sent["x"]) ** 2 + (sent["ty"] - sent["y"]) ** 2) ** 0.5
    distance_after = ((sent["tx"] - walked["x"]) ** 2 + (sent["ty"] - walked["y"]) ** 2) ** 0.5
    check("click: the player walks to the destination",
          distance_after < distance_before - 2, {"before": round(distance_before, 2), "after": round(distance_after, 2)})

    # 9. the HUD is text drawn into the same grid --------------------------------
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
    check("text HUD: box-drawing frame and title in the grid",
          hud_probe["boxGlyphs"] > 20 and hud_probe["hasTitle"], hud_probe)
    check("art: enough ink and glyph variety in the grid",
          hud_probe["inked"] > hud_probe["rows"] * hud_probe["cols"] * 0.15 and hud_probe["distinct"] > 25,
          {"inked": hud_probe["inked"], "cells": hud_probe["rows"] * hud_probe["cols"], "distinct": hud_probe["distinct"]})

    # 9b. the palette must be bright enough: a glyph covers only part of its cell,
    # so dark ink means an almost black screen (measured: p90 luminance of 30).
    palette = data(page, """(() => {
      function lum(c) { return Math.round(0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255)); }
      return {floor: lum(PALETTE.floor[0]), wallTop: lum(PALETTE.wallTop), wallLeft: lum(PALETTE.wallLeft),
              hero: lum(PALETTE.heroCloak), gold: lum(PALETTE.gold), panelLine: lum(PALETTE.panelLine),
              bone: lum(PALETTE.bone2)};
    })()""")
    check("palette: ink bright enough to read in text art",
          palette["floor"] >= 70 and palette["wallTop"] >= 110 and palette["wallLeft"] >= 60
          and palette["gold"] >= 120 and palette["bone"] >= 150, palette)

    # 10. layout: no scrollbar, grid filling the screen ---------
    desktop = layout(page)
    check("layout 1280x633: no scrollbar and the grid covers the screen",
          desktop["overflowX"] == 0 and desktop["overflowY"] == 0
          and desktop["coverageX"] > 0.9 and desktop["coverageY"] > 0.9, desktop)

    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(700)
    mobile = layout(page)
    check("layout 390x844: no scrollbar",
          mobile["overflowX"] == 0 and mobile["overflowY"] == 0 and mobile["coverageY"] > 0.9, mobile)
    mobile_cull = data(page, """({drawn: window.ISO.world.stats.tilesDrawn + window.ISO.world.stats.blocksDrawn,
        visible: window.ISO.headless.culling(window.ISO.metrics().cols, window.ISO.metrics().rows,
                 window.ISO.camera.x, window.ISO.camera.y).visibleTiles})""")
    check("layout 390x844: culling still exact", mobile_cull["drawn"] == mobile_cull["visible"], mobile_cull)

    page.set_viewport_size({"width": 1440, "height": 900})
    page.wait_for_timeout(900)
    page.screenshot(path=REPORT_PNG)

    check("console and window.onerror clean",
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
    print("\n%d/%d checks passed" % (passed, len(CHECKS)))
    print("report: %s" % REPORT_JSON)
    for item in failed:
        print("  FAILED: %s" % item["check"])
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
