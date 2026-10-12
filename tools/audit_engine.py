#!/usr/bin/env python3
"""Isoforge engine audit: opens ANY game built on the engine in a real browser and
asserts the engine's invariants. Game-specific rules live in the game's own audit
(see the cripta project), which imports engine_checks() from this file.

Run from the engine repo:
  PYTHONPATH= ~/.hermes/hermes-agent/venv/bin/python3 tools/audit_engine.py
  PYTHONPATH= ~/.hermes/hermes-agent/venv/bin/python3 tools/audit_engine.py \
      --html /path/to/game.html --report /tmp/audit.json

  --negative-control  also proves the lattice check can FAIL, by building a copy
                      of the page with the camera snap disabled and asserting the
                      rigidity check reports more than one cell distance. A test
                      that has never failed proves nothing.

Everything here goes through window.ISO, the contract documented in
docs/engine.md and enforced at boot by Isoforge.createContract(): a game that
does not expose it cannot even start, so this audit never has to guess.

Why a real browser: rAF pacing, text layout, localStorage under file:// and the
cost of rewriting a 15k cell grid cannot be measured anywhere else.

Headless traps this script works around (each one cost a round):
  - a background tab has visibilityState "hidden" and requestAnimationFrame is
    suspended -> the loop looks dead (0 frames, 0 ticks). The audit brings the
    page to the front and asserts visibilityState before measuring anything.
  - a capacity claim must come from a LIVE frame's stats, never from a copy of
    the algorithm: the renderer's drawn-tile count is compared against the
    geometric count computed by the engine's own test entry point.
  - the audit harness shares the main thread with the page, so a couple of long
    frames are the harness, not the game: the bar is p95 inside the budget plus
    zero stutter (a frame past two vsyncs).
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_HTML = os.path.join(ROOT, "examples", "arena", "arena.html")

RENDER_BUDGET_MS = 8.0     # p95 of the whole render call
FPS_FLOOR = 55.0

CHECKS = []
CONSOLE_ERRORS = []


def check(name, ok, detail):
    CHECKS.append({"check": name, "ok": bool(ok), "detail": detail})
    print(("PASS  " if ok else "FAIL  ") + name + " :: " + json.dumps(detail)[:190])


def data(page, expression):
    return json.loads(page.evaluate("JSON.stringify(%s)" % expression))


DRIVE_STEPS = """(function (steps, moveX, moveY) {
  var ISO = window.ISO;
  var done = 0;
  function tick() {
    ISO.stepScene({ moveX: moveX, moveY: moveY });
    if (++done < steps) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  return true;
})(%d, %f, %f)"""


def settle(page, ms=600):
    page.wait_for_timeout(ms)


def camera_state(page):
    return data(page, "({x: window.ISO.camera.x, y: window.ISO.camera.y})")


def culling_row(page, cam):
    page.evaluate("window.ISO.teleport(%f, %f)" % cam)
    settle(page, 700)
    # Freeze the loop, render one frame, then read: the drawn count belongs to a
    # specific camera, so the camera must not move between drawing and reading.
    # Two evaluates race the render loop and a one-tile drift shows up as a
    # one-tile "culling is wrong" that is really a measurement bug.
    page.evaluate("window.ISO.loop.stop()")
    page.evaluate("window.ISO.renderOnce()")
    live = data(page, """(() => {
      var ISO = window.ISO, m = ISO.metrics(), s = ISO.debug.worldStats();
      var geo = ISO.headless.culling(m.cols, m.rows, ISO.camera.x, ISO.camera.y, ISO.grid);
      return {cols: m.cols, rows: m.rows, iterated: s.iterated, culled: s.culled,
        drawn: s.tilesDrawn + s.blocksDrawn,
        geometricVisible: geo.visibleTiles, missingTiles: geo.missingTiles,
        coversViewport: geo.coversViewport, iterationOverVisible: geo.iterationOverVisible};
    })()""")
    page.evaluate("window.ISO.loop.start()")
    return {
        "grid": "%dx%d" % (live["cols"], live["rows"]),
        "iterated": live["iterated"],
        "culled": live["culled"],
        "drawn": live["drawn"],
        "geometricVisible": live["geometricVisible"],
        "diff": live["drawn"] - live["geometricVisible"],
        "missingTiles": live["missingTiles"],
        "coversViewport": live["coversViewport"],
        "iterationOverVisible": round(live["iterationOverVisible"], 3),
    }


def layout_snapshot(page):
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


def engine_checks(page, html_path, report_png=None):
    """Every invariant the engine promises, for any game. Returns the raw
    measurements so a game's audit can put them in its own report."""
    page.bring_to_front()
    settle(page, 1500)

    # 1. boot and the contract ------------------------------------------------
    boot = data(page, """({mode: window.ISO.mode, version: window.ISO.version,
      visible: document.visibilityState, errors: window.ISO.debug.errors,
      missing: window.ISO.contract(), constants: window.ISO.debug.constants})""")
    check("boot: the game satisfies the engine contract", boot["missing"] == [], {"missing": boot["missing"]})
    check("boot: text mode, engine version reported, no boot errors",
          boot["mode"] == "text" and isinstance(boot["version"], str) and boot["errors"] == [],
          {"mode": boot["mode"], "engine": boot["version"], "errors": boot["errors"]})
    check("boot: tab visible (rAF not suspended)", boot["visible"] == "visible", boot["visible"])
    tag = data(page, "({tag: document.getElementById('screen').tagName, rows: document.getElementById('screen').children.length})")
    check("boot: the world layer is a <pre> with one element per grid row",
          tag["tag"] == "PRE" and tag["rows"] > 20, tag)

    # 2. the shipped file is still offline and text-only ----------------------
    html = open(html_path, encoding="utf-8").read()
    check("single file: no canvas, no image, no network",
          "<canvas" not in html and "data:image" not in html
          and "http://" not in html and "https://" not in html,
          {"kb": round(len(html.encode()) / 1024, 1)})

    # 3. projection and simulation determinism --------------------------------
    projection = data(page, "window.ISO.headless.projectionRoundTrip(2000)")
    check("projection: 2:1 round trip under 0.001 tile over 2000 samples",
          projection["maxErrorTiles"] < 0.001, projection)
    determinism = data(page, "window.ISO.headless.determinism(window.ISO.seed, 600)")
    check("determinism: same seed + same input = same state hash (600 steps, 2 runs)",
          determinism["identical"] and determinism["firstHash"] != determinism["finalHash"],
          {"final": determinism["finalHash"], "identical": determinism["identical"]})
    closure = data(page, "window.ISO.headless.loopClosure(window.ISO.seed, 600)")
    check("loop closure: step 600 == step 0 with no input", closure["closed"], closure)

    # 4. culling, in cells ----------------------------------------------------
    centre = culling_row(page, (32.5, 32.5))
    check("culling centre: tiles drawn == tiles touching the screen",
          centre["diff"] == 0 and centre["missingTiles"] == 0, centre)
    edge = culling_row(page, (3.5, 3.5))
    check("culling world edge: no hole on screen",
          edge["diff"] == 0 and edge["missingTiles"] == 0, edge)

    # 5. idle cost: a static frame must write NOTHING -------------------------
    page.evaluate("window.ISO.teleport(32.5, 32.5)")
    settle(page, 600)
    page.evaluate("window.ISO.loop.resetStats()")
    settle(page, 4000)
    idle_stats = data(page, "window.ISO.loop.stats")
    idle_render = data(page, "window.ISO.debug.renderStats()")
    check("idle: 60 fps and the render inside the budget",
          idle_stats["fps"] >= FPS_FLOOR and idle_stats["renderP95"] <= RENDER_BUDGET_MS,
          {"fps": round(idle_stats["fps"], 1), "renderP95": round(idle_stats["renderP95"], 3)})
    page.evaluate("window.ISO.loop.stop()")
    page.evaluate("window.ISO.renderOnce()")
    first = data(page, "({rows: window.ISO.debug.renderStats().rebuiltRows, bytes: window.ISO.debug.renderStats().htmlBytes})")
    page.evaluate("window.ISO.renderOnce()")
    second = data(page, "({rows: window.ISO.debug.renderStats().rebuiltRows, bytes: window.ISO.debug.renderStats().htmlBytes})")
    page.evaluate("window.ISO.loop.start()")
    check("idle: a static frame rebuilds zero rows and writes zero bytes to the DOM",
          second["rows"] == 0 and second["bytes"] == 0 and first["rows"] <= 3,
          {"rows": second["rows"], "bytes": second["bytes"], "warmupRows": first["rows"]})

    # 6. walking: the grid must not be rebuilt per cell of camera travel ------
    corridor = data(page, """(() => {
      var g = window.ISO.grid, cx = Math.floor(g.width / 2), cy = Math.floor(g.height / 2);
      for (var d = 0; d < 12; d++) {
        for (var sx = -1; sx <= 1; sx += 2) {
          for (var sy = -1; sy <= 1; sy += 2) {
            var tx = cx + sx * d, ty = cy + sy * d, clear = true;
            for (var i = 0; i < 14; i++) if (!g.isWalkableTile(tx + i, ty - i)) { clear = false; break; }
            if (clear) return {x: tx + 0.5, y: ty + 0.5};
          }
        }
      }
      return {x: g.width / 2, y: g.height / 2};
    })()""")
    page.evaluate("window.ISO.teleport(%f, %f)" % (corridor["x"], corridor["y"]))
    settle(page, 500)
    walk_start = data(page, "({cam: [window.ISO.camera.x, window.ISO.camera.y]})")
    page.evaluate("window.ISO.loop.resetStats()")
    page.evaluate(DRIVE_STEPS % (140, 1.0, -1.0))
    settle(page, 2600)
    walking = data(page, """({fps: window.ISO.loop.stats.fps, p95: window.ISO.loop.stats.p95,
      renderP95: window.ISO.loop.stats.renderP95, frames: window.ISO.loop.stats.frames,
      drops: window.ISO.loop.stats.drops, stutters: window.ISO.loop.stats.stutters,
      render: window.ISO.debug.renderStats(), cam: [window.ISO.camera.x, window.ISO.camera.y]})""")
    camera_moved = ((walking["cam"][0] - walk_start["cam"][0]) ** 2
                    + (walking["cam"][1] - walk_start["cam"][1]) ** 2) ** 0.5
    render_stats = walking["render"]
    rows = render_stats["rebuiltRows"]
    total_rows = render_stats["bufferRows"]
    check("walking: 60 fps, p95 inside the budget, no stutter",
          walking["fps"] >= FPS_FLOOR and walking["p95"] <= 25.0
          and walking["stutters"] / max(1, walking["frames"]) <= 0.01,
          {"fps": round(walking["fps"], 1), "p95": round(walking["p95"], 2),
           "stutters": "%d/%d" % (walking["stutters"], walking["frames"]),
           "drops": "%d/%d" % (walking["drops"], walking["frames"]),
           "renderP95": round(walking["renderP95"], 2)})
    check("walking: the camera actually scrolled", camera_moved > 1, {"cameraMoved": round(camera_moved, 2)})
    check("walking: only a minority of rows are rewritten per frame",
          rows < total_rows * 0.5,
          {"rows": "%d/%d" % (rows, total_rows),
           "kb": "%d of %d" % (round(render_stats["htmlBytes"] / 1024), round(render_stats["gridBytes"] / 1024))})
    check("worst case: render cost inside the 8 ms budget",
          walking["renderP95"] <= RENDER_BUDGET_MS, {"renderP95": round(walking["renderP95"], 3)})

    # 7. the lattice is rigid: fixed tiles keep a fixed cell distance ---------
    page.evaluate("""(() => {
      window.__rig = {samples: [], stats: []};
      var ISO = window.ISO, n = 0;
      function sample() {
        var a = ISO.tileCell(10, 10), b = ISO.tileCell(10, 25), c = ISO.tileCell(25, 6);
        var s = ISO.debug.renderStats();
        window.__rig.samples.push({abx: a.x - b.x, aby: a.y - b.y, acx: a.x - c.x, acy: a.y - c.y,
          ax: a.x, ay: a.y, cam: [ISO.camera.x, ISO.camera.y], tx: s.translatePx[0], ty: s.translatePx[1]});
        if (++n < 90) requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    })()""")
    page.evaluate(DRIVE_STEPS % (80, 1.0, 1.0))
    settle(page, 1800)
    samples = data(page, "window.__rig.samples")
    spreads = {}
    for key in ("abx", "aby", "acx", "acy"):
        spreads[key] = sorted({s[key] for s in samples})
    rigid = all(len(values) == 1 for values in spreads.values())
    camera_span = abs(samples[-1]["cam"][0] - samples[0]["cam"][0]) + abs(samples[-1]["cam"][1] - samples[0]["cam"][1])
    # How much power this check HAS depends on the geometry: the shimmer is born
    # from a tile pitch that is a fractional number of cells (10x3 -> 1.5 cells
    # vertically, two groups of tiles crossing the rounding threshold at
    # different phases). With an integer pitch (8x2 -> 1 cell) every lattice is
    # rigid and this check passes trivially -- say so instead of implying proof.
    pitch = data(page, """(() => {
      var a = window.ISO.tileCell(10, 10), b = window.ISO.tileCell(11, 10), c = window.ISO.tileCell(10, 11);
      return {x: Math.abs(b.x - a.x), y: Math.abs(c.y - a.y)};
    })()""")
    fractional_pitch = (pitch["x"] % 1 != 0) or (pitch["y"] % 1 != 0)
    check("rigid lattice: the cell distance between fixed tiles never varies while the camera moves",
          rigid and camera_span > 1,
          {"samples": len(samples), "spreads": spreads, "cameraMoved": round(camera_span, 2),
           "tilePitchCells": pitch,
           "power": "full" if fractional_pitch else "geometry has an integer tile pitch: immune by construction"})

    # 8. smooth scroll: whole-cell content shifts, sub-cell slide every frame --
    steps = data(page, """(() => {
      var s = window.__rig.samples, out = [];
      for (var i = 1; i < s.length; i++) out.push({dx: s[i].ax - s[i-1].ax, dy: s[i].ay - s[i-1].ay});
      var fractional = out.filter(function (d) { return d.dx !== Math.round(d.dx) || d.dy !== Math.round(d.dy); });
      var slides = 0;
      for (var k = 1; k < s.length; k++) if (s[k].tx !== s[k-1].tx || s[k].ty !== s[k-1].ty) slides++;
      return {frames: out.length, shiftedFrames: out.filter(function (d) { return d.dx !== 0 || d.dy !== 0; }).length,
              fractional: fractional.length, slideFrames: slides, translate: [s[s.length-1].tx, s[s.length-1].ty]};
    })()""")
    check("smooth scroll: content shifts by whole cells only, and the sub-cell slide moves on most frames",
          steps["fractional"] == 0 and steps["shiftedFrames"] > 0
          and steps["slideFrames"] >= steps["frames"] * 0.6,
          steps)

    # 9. the art does not depend on where the camera is ----------------------
    # Freeze the scene first: entities that keep walking paint over the sampled
    # cells, which is indistinguishable from unstable art. With the loop stopped
    # and only the CAMERA shifted, every difference is art instability.
    page.evaluate("window.ISO.loop.stop()")
    art = data(page, """(() => {
      var ISO = window.ISO, g = ISO.grid, cam = ISO.camera;
      var offsets = [];
      for (var oy = -4; oy <= 4; oy++) for (var ox = -5; ox <= 5; ox++) offsets.push([ox, oy]);
      function find(wantSolid) {
        for (var r = 1; r < 4; r++) {
          for (var a = -3; a <= 3; a++) {
            var tx = Math.floor(cam.x) + a, ty = Math.floor(cam.y) + (wantSolid ? r : -r);
            if (tx < 1 || ty < 1 || tx >= g.width - 1 || ty >= g.height - 1) continue;
            if (wantSolid === !g.isWalkableTile(tx, ty)) return [tx, ty];
          }
        }
        return null;
      }
      function sample(tile) {
        var c = ISO.tileCell(tile[0], tile[1]), cells = [];
        for (var i = 0; i < offsets.length; i++) {
          var cell = ISO.cellAt(c.x + offsets[i][0], c.y + offsets[i][1]);
          cells.push([cell.glyph, cell.color]);
        }
        return cells;
      }
      var solid = find(true), floor = find(false);
      window.__art = {solid: solid, floor: floor, offsets: offsets,
        before: {solid: sample(solid), floor: sample(floor)}};
      return {solidTile: solid, floorTile: floor, cells: offsets.length,
              entities: ISO.scene.entities.length};
    })()""")

    SAMPLE_DIFF = """(() => {
      var ISO = window.ISO, a = window.__art;
      function sample(tile) {
        var c = ISO.tileCell(tile[0], tile[1]), cells = [];
        for (var i = 0; i < a.offsets.length; i++) {
          var cell = ISO.cellAt(c.x + a.offsets[i][0], c.y + a.offsets[i][1]);
          cells.push([cell.glyph, cell.color]);
        }
        return cells;
      }
      function diff(x, y) {
        var n = 0, first = null;
        for (var i = 0; i < x.length; i++) {
          if (x[i][0] !== y[i][0] || x[i][1] !== y[i][1]) {
            n++;
            if (!first) first = {offset: a.offsets[i], before: x[i], after: y[i]};
          }
        }
        return {n: n, first: first};
      }
      return {solid: diff(a.before.solid, sample(a.solid)),
              floor: diff(a.before.floor, sample(a.floor)), cells: a.offsets.length};
    })()"""

    rounds = []
    # Shifts chosen to cross the content lattice (8 cells) in both axes: the
    # camera moves in tiles, the lattice in cells, and the tile is 8x2 cells here.
    for dx, dy in ((2.2, -1.4), (2.0, 1.1), (-6.5, 2.3)):
        page.evaluate("window.ISO.camera.x += %f; window.ISO.camera.y += %f;" % (dx, dy))
        page.evaluate("window.ISO.renderOnce()")
        rounds.append(data(page, SAMPLE_DIFF))
    page.evaluate("window.ISO.loop.start()")

    solid_diffs = sum(r["solid"]["n"] for r in rounds)
    floor_diffs = sum(r["floor"]["n"] for r in rounds)
    first_diff = next((r["solid"]["first"] or r["floor"]["first"] for r in rounds
                       if (r["solid"]["first"] or r["floor"]["first"])), None)
    check("art stability: the same tile paints the same cells after the camera moves",
          art["solidTile"] is not None and solid_diffs == 0 and floor_diffs == 0,
          {"cells": art["cells"], "rounds": len(rounds), "entitiesFrozen": art["entities"],
           "solidDiff": solid_diffs, "floorDiff": floor_diffs, "firstDiff": first_diff})

    # 10. the HUD is an overlay: it must not travel with the world ------------
    page.evaluate("""(() => {
      window.__hud = {hud: [], world: []};
      var n = 0;
      function sample() {
        var h = document.getElementById('hud').getBoundingClientRect();
        var w = document.getElementById('screen').getBoundingClientRect();
        window.__hud.hud.push([Math.round(h.left * 100) / 100, Math.round(h.top * 100) / 100]);
        window.__hud.world.push([Math.round(w.left * 100) / 100, Math.round(w.top * 100) / 100]);
        if (++n < 60) requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    })()""")
    page.evaluate(DRIVE_STEPS % (70, 1.0, -1.0))
    settle(page, 1600)
    hud = data(page, """(() => {
      function spread(series, axis) {
        var v = series.map(function (p) { return p[axis]; });
        return [Math.min.apply(null, v), Math.max.apply(null, v)];
      }
      var h = window.__hud.hud, w = window.__hud.world;
      return {samples: h.length,
              hudTravel: (spread(h, 0)[1] - spread(h, 0)[0]) + (spread(h, 1)[1] - spread(h, 1)[0]),
              worldTravel: (spread(w, 0)[1] - spread(w, 0)[0]) + (spread(w, 1)[1] - spread(w, 1)[0])};
    })()""")
    check("HUD overlay: the panels stay pinned while the world scrolls underneath",
          hud["worldTravel"] > 4 and hud["hudTravel"] == 0,
          {"hudTravelPx": round(hud["hudTravel"], 2), "worldTravelPx": round(hud["worldTravel"], 2),
           "samples": hud["samples"]})
    hud_probe = data(page, """(() => {
      var grid = window.ISO.hudText().split("\\n"), box = 0, inked = 0, glyphs = {};
      for (var y = 0; y < grid.length; y++) {
        for (var x = 0; x < grid[y].length; x++) {
          var ch = grid[y].charAt(x);
          if (ch === ' ') continue;
          inked++;
          glyphs[ch] = 1;
          if ("╔╗╚╝═║│".indexOf(ch) >= 0) box++;
        }
      }
      return {rows: grid.length, cols: grid[0].length, inked: inked, boxGlyphs: box,
              distinct: Object.keys(glyphs).length};
    })()""")
    check("HUD layer: it is a real character grid with box drawing and text in it",
          hud_probe["boxGlyphs"] > 10 and hud_probe["inked"] > 50, hud_probe)
    world_probe = data(page, """(() => {
      var grid = window.ISO.gridText().split("\\n"), inked = 0, total = 0, glyphs = {};
      for (var y = 0; y < grid.length; y++) {
        for (var x = 0; x < grid[y].length; x++) {
          var ch = grid[y].charAt(x);
          total++;
          if (ch !== ' ') { inked++; glyphs[ch] = 1; }
        }
      }
      var m = window.ISO.metrics();
      return {inked: inked, cells: total, distinct: Object.keys(glyphs).length, expectedCells: m.cols * m.rows};
    })()""")
    check("world layer: enough ink and glyph variety to be art, and the grid matches the metrics",
          world_probe["inked"] > world_probe["cells"] * 0.15 and world_probe["distinct"] > 20
          and world_probe["cells"] == world_probe["expectedCells"],
          world_probe)

    # 11. layout: no scrollbar, grid covering the screen -----------------------
    page.set_viewport_size({"width": 1280, "height": 633})
    settle(page, 700)
    desktop = layout_snapshot(page)
    check("layout 1280x633: no scrollbar and the grid covers the screen",
          desktop["overflowX"] == 0 and desktop["overflowY"] == 0
          and desktop["coverageX"] > 0.9 and desktop["coverageY"] > 0.9, desktop)

    page.set_viewport_size({"width": 390, "height": 844})
    settle(page, 700)
    mobile = layout_snapshot(page)
    check("layout 390x844: no scrollbar",
          mobile["overflowX"] == 0 and mobile["overflowY"] == 0 and mobile["coverageY"] > 0.9, mobile)
    # same freeze-then-render discipline as culling_row: the drawn count belongs
    # to one specific camera, so nothing may move between drawing and reading.
    page.evaluate("window.ISO.loop.stop()")
    page.evaluate("window.ISO.renderOnce()")
    mobile_cull = data(page, """(() => {
      var ISO = window.ISO, s = ISO.debug.worldStats();
      var geo = ISO.headless.culling(ISO.metrics().cols, ISO.metrics().rows,
        ISO.camera.x, ISO.camera.y, ISO.grid);
      return {drawn: s.tilesDrawn + s.blocksDrawn, visible: geo.visibleTiles, missing: geo.missingTiles};
    })()""")
    page.evaluate("window.ISO.loop.start()")
    check("layout 390x844: culling still exact after a resize",
          mobile_cull["drawn"] == mobile_cull["visible"] and mobile_cull["missing"] == 0, mobile_cull)

    if report_png:
        page.set_viewport_size({"width": 1440, "height": 900})
        settle(page, 900)
        page.screenshot(path=report_png)

    check("console and window.onerror clean",
          data(page, "window.ISO.debug.errors") == [] and CONSOLE_ERRORS == [],
          {"game": data(page, "window.ISO.debug.errors"), "browser": CONSOLE_ERRORS})

    render = data(page, """({cols: window.ISO.metrics().cols, rows: window.ISO.metrics().rows,
      cells: window.ISO.metrics().cols * window.ISO.metrics().rows, fontPx: window.ISO.metrics().fontPx,
      spans: window.ISO.debug.renderStats().spans, htmlBytes: window.ISO.debug.renderStats().htmlBytes,
      gridBytes: window.ISO.debug.renderStats().gridBytes})""")
    return {
        "boot": boot, "projection": projection, "determinism": determinism, "loopClosure": closure,
        "cullingCentre": centre, "cullingEdge": edge, "idle": idle_stats,
        "walking": {k: walking[k] for k in ("fps", "p95", "renderP95", "frames", "drops", "stutters")},
        "lattice": {"spreads": spreads, "cameraMoved": round(camera_span, 2)},
        "scroll": steps, "art": {"rounds": len(rounds), "solidDiff": solid_diffs, "floorDiff": floor_diffs}, "hud": hud_probe, "world": world_probe,
        "layoutDesktop": desktop, "layoutMobile": mobile, "render": render
    }


def negative_control(html_path):
    """Break the frame lattice in a copy of the built page and assert the rigidity
    check FAILS there. Without this, a green rigidity check is only an opinion.

    Two things this control has to get right:
      - what has to be broken is the LATTICE, not the snap. The lattice re-rounds
        whatever the snap hands it, so disabling the snap alone still leaves a
        rigid grid (that was the first version of this control, and it was wrong).
      - the geometry has to be ABLE to shimmer. That needs a tile pitch of a
        fractional number of cells (10x3 -> 1.5); with an integer pitch every
        lattice is rigid, so the control reports the immunity instead of asserting
        a failure it can never produce.
    """
    with open(html_path, encoding="utf-8") as handle:
        source = handle.read()

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page(viewport={"width": 1280, "height": 633})
        page.goto("file://" + os.path.abspath(html_path) + "#seed=1234", wait_until="load")
        page.bring_to_front()
        page.wait_for_timeout(1500)
        pitch = json.loads(page.evaluate("""JSON.stringify((() => {
          var a = window.ISO.tileCell(10, 10), b = window.ISO.tileCell(11, 10), c = window.ISO.tileCell(10, 11);
          return {x: Math.abs(b.x - a.x), y: Math.abs(c.y - a.y)};
        })())"""))
        browser.close()

    if pitch["x"] % 1 == 0 and pitch["y"] % 1 == 0:
        check("negative control: not applicable (the tile pitch is a whole number of cells, so this "
              "geometry cannot exhibit the shimmer)",
              True, {"tilePitchCells": pitch})
        return {"applicable": False, "pitch": pitch}

    pattern = r"x:\s*Math\.round\(snapped\.x / LATTICE_QUANTUM\) \* LATTICE_QUANTUM,\s*\n\s*y:\s*Math\.round\(snapped\.y / LATTICE_QUANTUM\) \* LATTICE_QUANTUM"
    if not re.search(pattern, source):
        print("negative control: lattice pattern not found, skipping")
        return None
    broken = re.sub(pattern, "x: snapped.x,\n    y: snapped.y", source, count=1)
    handle, path = tempfile.mkstemp(suffix=".html", dir=os.path.dirname(html_path))
    with os.fdopen(handle, "w", encoding="utf-8") as temp:
        temp.write(broken)
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            page = browser.new_page(viewport={"width": 1280, "height": 633})
            page.goto("file://" + path + "#seed=1234", wait_until="load")
            page.bring_to_front()
            page.wait_for_timeout(1500)
            page.evaluate("""(() => {
              window.__rig = {samples: []};
              var ISO = window.ISO, n = 0;
              function sample() {
                var a = ISO.tileCell(10, 10), b = ISO.tileCell(10, 25), c = ISO.tileCell(25, 6);
                window.__rig.samples.push({aby: a.y - b.y, acy: a.y - c.y});
                if (++n < 80) requestAnimationFrame(sample);
              }
              requestAnimationFrame(sample);
            })()""")
            page.evaluate(DRIVE_STEPS % (70, 1.0, 1.0))
            page.wait_for_timeout(1600)
            samples = json.loads(page.evaluate("JSON.stringify(window.__rig.samples)"))
            browser.close()
    finally:
        os.unlink(path)
    values = sorted({s["aby"] for s in samples})
    check("negative control: with the frame lattice broken the grid DOES shimmer",
          len(values) > 1, {"verticalDistances": values, "samples": len(samples)})
    return {"broken": len(values) > 1, "values": values}


def main():
    parser = argparse.ArgumentParser(description="Isoforge engine audit")
    parser.add_argument("--html", default=DEFAULT_HTML, help="built single-file game to audit")
    parser.add_argument("--report", default=os.path.join(ROOT, "reports", "engine-audit.json"))
    parser.add_argument("--png", default=None, help="also write a screenshot here")
    parser.add_argument("--negative-control", action="store_true",
                        help="prove the lattice check can fail (slower)")
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=633)
    args = parser.parse_args()

    if not os.path.exists(args.html):
        sys.exit("no such build: %s (run: python3 build.py --example arena)" % args.html)

    print("isoforge engine audit -- %s" % os.path.basename(args.html))
    with sync_playwright() as playwright:
        try:
            browser = playwright.chromium.launch()
        except Exception:
            browser = playwright.chromium.launch(channel="chrome")
        page = browser.new_page(viewport={"width": args.width, "height": args.height}, device_scale_factor=1)
        page.on("console", lambda m: CONSOLE_ERRORS.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: CONSOLE_ERRORS.append(str(e)))
        page.goto("file://" + os.path.abspath(args.html) + "#seed=1234", wait_until="load")
        measurements = engine_checks(page, args.html, args.png)
        browser.close()

    if args.negative_control:
        measurements["negativeControl"] = negative_control(os.path.abspath(args.html))

    passed = sum(1 for c in CHECKS if c["ok"])
    failed = [c for c in CHECKS if not c["ok"]]
    os.makedirs(os.path.dirname(args.report), exist_ok=True)
    with open(args.report, "w", encoding="utf-8") as handle:
        json.dump({"passed": passed, "failed": len(failed), "checks": CHECKS, "measurements": measurements},
                  handle, indent=2, ensure_ascii=False)
    print("\n%d/%d checks passed" % (passed, len(CHECKS)))
    print("report: %s" % args.report)
    for item in failed:
        print("  FAILED: %s" % item["check"])
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
