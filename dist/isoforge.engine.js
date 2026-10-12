// Isoforge 0.3.0 -- 2:1 isometric, text-mode, deterministic, offline.
// Assembled from src/ by build.py. DO NOT EDIT: edit the modules and rebuild.
var Isoforge = (function () {
"use strict";

// ---- core/config.js ----------------------------------------------------
// Engine configuration: the one place a game changes engine-wide numbers, and it
// has to be called BEFORE the renderer, the grid and the loop are created.
//
//   Isoforge.configure({ tileCellsW: 20, tileCellsH: 6, wallHeightCells: 8 });
//
// Tile geometry is a parameter and not a constant for a reason: 10x3 cells at a
// ~0.6em advance and a 1.67:1 cell is exactly 2:1 in pixels (the Diablo 2 tile
// ratio, which keeps the classic art usable), while 20x6 doubles the detail per
// tile for a game that wants denser art -- measured on this engine, the bigger
// tile carried ~36% more glyphs of detail in the same world footprint.
//
// Everything derived is kept in plain module vars (recomputed by configure())
// so the hot loops read a variable instead of walking an object.

var ENGINE_VERSION = "0.3.0";

var EngineConfig = {
  tileCellsW: 10,          // width of one world tile, in character cells
  tileCellsH: 3,           // height of the floor diamond, in character cells
  wallHeightCells: 4,      // how tall a wall block draws above its tile
  latticeQuantum: 8,       // cells of camera travel between grid rebuilds
  defaultTargetRows: 69,   // grid density: how many rows fill the viewport
  minTargetRows: 40,
  maxTargetRows: 170,
  minFontPx: 5.5,          // below this a glyph stops being legible
  maxFontPx: 22
};

// --- derived (configure() owns these) ---------------------------------------
var TILE_CELLS_W = 0;
var TILE_CELLS_H = 0;
var HALF_TILE_W = 0;
var HALF_TILE_H = 0;
var TILE_DIAMOND_HALF_W = 0;
var TILE_DIAMOND_HALF_H = 0;
var WALL_HEIGHT_CELLS = 0;
var LATTICE_QUANTUM = 0;
var LATTICE_BLEED = 0;
var DEFAULT_TARGET_ROWS = 0;
var MIN_TARGET_ROWS = 0;
var MAX_TARGET_ROWS = 0;
var MIN_FONT_PX = 0;
var MAX_FONT_PX = 0;

function configure(options) {
  options = options || {};
  for (var key in options) {
    if (!Object.prototype.hasOwnProperty.call(options, key)) continue;
    if (!Object.prototype.hasOwnProperty.call(EngineConfig, key)) continue;
    if (options[key] === undefined || options[key] === null) continue;
    EngineConfig[key] = options[key];
  }
  TILE_CELLS_W = Math.max(4, EngineConfig.tileCellsW | 0);
  TILE_CELLS_H = Math.max(2, EngineConfig.tileCellsH | 0);
  HALF_TILE_W = TILE_CELLS_W / 2;
  HALF_TILE_H = TILE_CELLS_H / 2;
  // The floor diamond has a centre column when the tile is odd, so the drawn
  // footprint is (width - 1) / 2 either way.
  TILE_DIAMOND_HALF_W = (TILE_CELLS_W - 1) / 2;
  TILE_DIAMOND_HALF_H = TILE_CELLS_H / 2;
  WALL_HEIGHT_CELLS = Math.max(1, EngineConfig.wallHeightCells | 0);
  LATTICE_QUANTUM = Math.max(1, EngineConfig.latticeQuantum | 0);
  // Hard requirement, not a nicety: the buffer has to cover the viewport even
  // when the content sits a whole quantum away from the camera, so the bleed is
  // half the quantum.
  LATTICE_BLEED = LATTICE_QUANTUM / 2;
  DEFAULT_TARGET_ROWS = EngineConfig.defaultTargetRows;
  MIN_TARGET_ROWS = EngineConfig.minTargetRows;
  MAX_TARGET_ROWS = EngineConfig.maxTargetRows;
  MIN_FONT_PX = EngineConfig.minFontPx;
  MAX_FONT_PX = EngineConfig.maxFontPx;
  return EngineConfig;
}

configure();

// ---- core/rng.js -------------------------------------------------------
// Deterministic PRNG (mulberry32). Same seed -> same world, always.
function createRng(seed) {
  var state = (seed >>> 0) || 1;
  return function next() {
    state = (state + 0x6D2B79F5) >>> 0;
    var t = state;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomSeed() {
  if (window.crypto && window.crypto.getRandomValues) {
    var buf = new Uint32Array(1);
    window.crypto.getRandomValues(buf);
    return buf[0] >>> 0;
  }
  return (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
}

// Positions are hashed and saved at 1/1000 of a tile. Quantizing is what makes
// the loop-closure test exact even though cos/sin carry float error.
function quantize(value) {
  return Math.round(value * 1000) | 0;
}

function clamp(value, low, high) {
  if (low > high) return (low + high) / 2;
  return value < low ? low : (value > high ? high : value);
}

// ---- core/iso.js -------------------------------------------------------
// Isometric geometry in CHARACTER CELLS. Same 2:1 projection as phase 0, but the
// unit is a cell of the <pre> grid instead of a pixel, and the screen is never
// rotated: one projection, one tile orientation, for the whole game.
//
//   cell.x = (world.x - world.y) * HALF_TILE_W
//   cell.y = (world.x + world.y) * HALF_TILE_H
//
// A cell is ~1.67x taller than wide, so an exact 2:1 diamond in PIXELS needs
// tileW / tileH = 2 * CELL_ASPECT = 3.33. 10 x 3 cells gives 66 x 33 px with the
// 11px font measured in the browser -- the same proportion as Diablo 2's 64x32
// tile, which is why the phase 0 numbers (culling, click picking, camera clamp)
// carry over unchanged: only the unit changed.
//
// The tile size is NOT defined here: core/config.js owns it (and every other
// engine-wide number), so a game can ask for 20x6 cells and get twice the art
// detail per tile without touching this file.

function worldToCellX(x, y) { return (x - y) * HALF_TILE_W; }
function worldToCellY(x, y) { return (x + y) * HALF_TILE_H; }
function cellToWorldX(cx, cy) { return (cx / HALF_TILE_W + cy / HALF_TILE_H) / 2; }
function cellToWorldY(cx, cy) { return (cy / HALF_TILE_H - cx / HALF_TILE_W) / 2; }

function createCamera(x, y) { return { x: x, y: y }; }

// Half extents, in world tiles, of a viewport of cols x rows cells.
function viewHalfExtents(cols, rows) {
  return {
    x: (cols / 2 / HALF_TILE_W + rows / 2 / HALF_TILE_H) / 2,
    y: (rows / 2 / HALF_TILE_H + cols / 2 / HALF_TILE_W) / 2
  };
}

// The iterated rectangle must cover the viewport PLUS the bleed ring, and the
// bleed is measured in CELLS while the rectangle is measured in TILES -- so the
// margin has to be derived, not hardcoded. A hardcoded 3 tiles was right for the
// 10x3 tile and wrong for an 8x2 one: a cell is much taller than wide, so the
// vertical axis needs the most slack, and one tile at the edge of the rectangle
// was skipped (drawn came out exactly one short of the geometric count).
function requiredTileMargin() {
  return Math.ceil(LATTICE_BLEED / Math.min(HALF_TILE_W, HALF_TILE_H)) + 1;
}

// Tile rectangle whose diamonds cover the viewport.
function visibleTileBounds(camX, camY, cols, rows, margin) {
  var ext = viewHalfExtents(cols, rows);
  margin = margin === undefined ? requiredTileMargin() : margin;
  return {
    x0: Math.floor(camX - ext.x) - margin,
    y0: Math.floor(camY - ext.y) - margin,
    x1: Math.ceil(camX + ext.x) + margin,
    y1: Math.ceil(camY + ext.y) + margin
  };
}

// Keep the camera inside the world. `clampAxis` handles the case where the
// viewport is WIDER than the world (a small arena, or a tile geometry that shows
// many tiles per screen): the valid range inverts, and pinning the camera to one
// edge would be wrong -- centring the world on screen is what the player expects.
function clampAxis(value, low, high) {
  if (high < low) return (low + high) / 2;
  return clamp(value, low, high);
}

function clampCamera(camera, gridW, gridH, cols, rows) {
  var ext = viewHalfExtents(cols, rows);
  camera.x = clampAxis(camera.x, ext.x - 0.5, gridW - 0.5 - ext.x);
  camera.y = clampAxis(camera.y, ext.y - 0.5, gridH - 0.5 - ext.y);
}

// Cell coordinates (fractional) of a world point on screen; the camera sits at
// the centre of the viewport.
function anchorCellX(worldX, worldY, camera, cols) {
  return worldToCellX(worldX, worldY) - worldToCellX(camera.x, camera.y) + cols / 2;
}
function anchorCellY(worldX, worldY, camera, rows) {
  return worldToCellY(worldX, worldY) - worldToCellY(camera.x, camera.y) + rows / 2;
}

// The character lattice is quantised ONCE per frame, from the camera, and every
// tile, prop, entity and cursor is placed against that single lattice.
//
// Why: rounding each tile's own centre made the lattice non-rigid. Vertically the
// tile pitch is 1.5 cells, so the fractional parts of tile centres are 0 and 0.5
// -- two groups that cross the rounding threshold at different sub-cell phases.
// Walking made half the rows snap while the other half had not, which reads as
// vertical shimmer. With the camera snapped first, the whole screen shifts by
// exactly one cell at a time.
function snappedCameraCell(camera) {
  return {
    x: Math.round(worldToCellX(camera.x, camera.y)),
    y: Math.round(worldToCellY(camera.x, camera.y))
  };
}

// LATTICE_QUANTUM cells of camera movement between two content rebuilds, and
// LATTICE_BLEED = quantum / 2 extra cells kept off screen so the slide never
// reveals a gap. Both come from core/config.js.
//
// Why the content is not generated per frame: at 10 cells per tile and 4.2
// tiles/s the screen scrolls ~42 cells/s, and rebuilding the whole grid 42 times
// per second was 5.5 MB/s of HTML (measured) -- the scenery appeared to be
// regenerating while the player walked. The sub-cell remainder is applied as a
// CSS transform instead, so a rebuild only happens once per quantum.

function coarseLatticeCell(camera) {
  var snapped = snappedCameraCell(camera);
  return {
    x: Math.round(snapped.x / LATTICE_QUANTUM) * LATTICE_QUANTUM,
    y: Math.round(snapped.y / LATTICE_QUANTUM) * LATTICE_QUANTUM
  };
}

function tileCenterCellInLattice(worldX, worldY, lattice, cols, rows) {
  return {
    x: worldToCellX(worldX, worldY) - lattice.x + cols / 2 - 0.5,
    y: worldToCellY(worldX, worldY) - lattice.y + rows / 2 - 0.5
  };
}

// Centre of a tile's diamond in cell indices, on the frame lattice.
function tileCenterCell(worldX, worldY, camera, cols, rows) {
  return tileCenterCellInLattice(worldX, worldY, coarseLatticeCell(camera), cols, rows);
}

// Screen cell -> world coordinates (exact inverse of the placement above). The
// caller passes the cell index inside the BUFFER, hence the bleed subtraction.
function latticeToWorld(cellX, cellY, lattice, cols, rows) {
  var cx = cellX + 0.5 - cols / 2 + lattice.x;
  var cy = cellY + 0.5 - rows / 2 + lattice.y;
  return { x: cellToWorldX(cx, cy), y: cellToWorldY(cx, cy) };
}

function cellToWorld(cellX, cellY, camera, cols, rows) {
  return latticeToWorld(cellX, cellY, coarseLatticeCell(camera), cols, rows);
}

// Screen point -> world, from the index of the BUFFER cell under the cursor. The
// caller gets the index from the element's own rect, so the CSS transform (and
// therefore the coarse lattice and the bleed) cancels out.
function bufferCellToWorld(bufferCellX, bufferCellY, camera, cols, rows) {
  return latticeToWorld(
    bufferCellX - LATTICE_BLEED,
    bufferCellY - LATTICE_BLEED,
    coarseLatticeCell(camera), cols, rows
  );
}

// Does the tile's diamond touch the drawn area? Computed on the same lattice and
// with the same bleed the renderer uses, so nothing visible can be skipped.
function tileTouchesViewport(tileX, tileY, camX, camY, cols, rows) {
  var lattice = coarseLatticeCell({ x: camX, y: camY });
  var cx = worldToCellX(tileX + 0.5, tileY + 0.5) - lattice.x;
  var cy = worldToCellY(tileX + 0.5, tileY + 0.5) - lattice.y;
  var halfCols = cols / 2 + LATTICE_BLEED;
  var halfRows = rows / 2 + LATTICE_BLEED;
  return cx + TILE_DIAMOND_HALF_W > -halfCols && cx - TILE_DIAMOND_HALF_W < halfCols
    && cy + TILE_DIAMOND_HALF_H > -halfRows && cy - TILE_DIAMOND_HALF_H < halfRows;
}

// ---- core/loop.js ------------------------------------------------------
// Fixed timestep loop: 60 Hz simulation, render decoupled with interpolation.
var FIXED_STEP_MS = 1000 / 60;
var MAX_CATCHUP_STEPS = 5;

// FNV-1a, 32 bit. Used both for the per-step state hash and the frame checksum.
function hash32Init() { return 0x811c9dc5 >>> 0; }
function hash32Mix(h, value) {
  h = (h ^ (value | 0)) >>> 0;
  return Math.imul(h, 0x01000193) >>> 0;
}
function hash32Finish(h) { return ("0000000" + h.toString(16)).slice(-8); }

function createLoop(handlers) {
  var accumulator = 0;
  var lastTime = 0;
  var running = false;
  var rafHandle = 0;
  var frameSamples = [];
  var renderSamples = [];
  var sampleLimit = 240;
  var stats = {
    frames: 0, fps: 0, frameMs: 0, renderMs: 0,
    p50: 0, p95: 0, renderP95: 0, steps: 0, lastSteps: 0,
    // A single long frame moves p95 around and is indistinguishable from noise.
    // Count frames that miss the budget (>25 ms, one vsync) and frames that
    // really stutter (>33 ms, two vsyncs) -- the second is what a player sees,
    // and it is what the audit asserts on.
    drops: 0, stutters: 0, budgetMs: 25, stutterMs: 33.4
  };

  function resetStats() {
    frameSamples.length = 0;
    renderSamples.length = 0;
    stats.frames = 0;
    stats.drops = 0;
    stats.stutters = 0;
    stats.p50 = 0;
    stats.p95 = 0;
    stats.renderP95 = 0;
  }

  function percentile(samples, p) {
    if (!samples.length) return 0;
    var sorted = samples.slice().sort(function (a, b) { return a - b; });
    var index = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
    return sorted[index];
  }

  function record(frameMs, renderMs) {
    frameSamples.push(frameMs);
    renderSamples.push(renderMs);
    if (frameSamples.length > sampleLimit) frameSamples.shift();
    if (renderSamples.length > sampleLimit) renderSamples.shift();
    stats.frames++;
    if (frameMs > stats.budgetMs) stats.drops++;
    if (frameMs > stats.stutterMs) stats.stutters++;
    stats.frameMs = frameMs;
    stats.renderMs = renderMs;
    // fps from the MEDIAN frame, not from the last one: two rAF callbacks can
    // land in the same millisecond and an instantaneous 1000/frameMs then reads
    // 0 fps on a perfectly healthy loop (that is how a green run reported 0).
    stats.p50 = percentile(frameSamples, 0.5);
    stats.p95 = percentile(frameSamples, 0.95);
    stats.fps = stats.p50 > 0 ? 1000 / stats.p50 : 0;
    stats.renderP95 = percentile(renderSamples, 0.95);
  }

  function frame(now) {
    if (!running) { rafHandle = 0; return; }
    var delta = lastTime ? now - lastTime : FIXED_STEP_MS;
    lastTime = now;
    // A hidden tab (or a long GC pause) must not trigger a catch-up burst.
    if (delta > 250) delta = FIXED_STEP_MS;
    accumulator += delta;

    var steps = 0;
    while (accumulator >= FIXED_STEP_MS && steps < MAX_CATCHUP_STEPS) {
      handlers.step();
      accumulator -= FIXED_STEP_MS;
      steps++;
    }
    if (steps >= MAX_CATCHUP_STEPS) accumulator = 0;

    var alpha = accumulator / FIXED_STEP_MS;
    var renderStart = performance.now();
    handlers.render(alpha);
    record(delta, performance.now() - renderStart);

    stats.lastSteps = steps;
    stats.steps += steps;
    rafHandle = requestAnimationFrame(frame);
  }

  return {
    stats: stats,
    resetStats: resetStats,
    // The rAF handle is tracked and CANCELLED, not merely ignored. Without this,
    // a stop() followed by a start() before the pending callback fires leaves TWO
    // chains running: every frame is then processed twice, half the frame deltas
    // are 0 ms, `fps` (the median) reads 0 on a perfectly healthy loop, and the
    // frame counter reports double. Measured: 468 frames in a 5 s window.
    start: function () {
      if (running) return;
      running = true;
      lastTime = 0;
      if (rafHandle) cancelAnimationFrame(rafHandle);
      rafHandle = requestAnimationFrame(frame);
    },
    stop: function () {
      running = false;
      if (rafHandle) { cancelAnimationFrame(rafHandle); rafHandle = 0; }
    },
    isRunning: function () { return running; }
  };
}

// ---- core/persist.js ---------------------------------------------------
// localStorage with a namespace, for whatever a game wants to remember between
// sessions (grid density, chosen seed, a save slot).
//
// localStorage does work from file://, but EVERY local page on the machine
// shares one bucket: an unnamespaced key collides with any other artifact the
// user opens, so the namespace is mandatory, and so is tolerating a full or
// blocked store (Safari in private mode throws on write) without breaking boot.

function createStore(namespace) {
  var prefix = String(namespace) + ".";

  function keyOf(name) { return prefix + name; }

  return {
    namespace: namespace,
    keyOf: keyOf,
    available: function () {
      try {
        var probe = prefix + "__probe";
        localStorage.setItem(probe, "1");
        localStorage.removeItem(probe);
        return true;
      } catch (error) {
        return false;
      }
    },
    get: function (name, fallback) {
      try {
        var raw = localStorage.getItem(keyOf(name));
        if (raw === null) return fallback;
        var parsed = JSON.parse(raw);
        return parsed === undefined || parsed === null ? fallback : parsed;
      } catch (error) {
        return fallback;
      }
    },
    set: function (name, value) {
      try {
        localStorage.setItem(keyOf(name), JSON.stringify(value));
        return true;
      } catch (error) {
        return false;
      }
    },
    remove: function (name) {
      try { localStorage.removeItem(keyOf(name)); return true; } catch (error) { return false; }
    },
    keys: function () {
      var out = [];
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var key = localStorage.key(i);
          if (key && key.indexOf(prefix) === 0) out.push(key.slice(prefix.length));
        }
      } catch (error) { /* blocked store: no keys */ }
      return out;
    }
  };
}

// ---- render/text_renderer.js -------------------------------------------
// Text-mode renderer: the whole screen is ONE grid of characters written into a
// single <pre>. There is no canvas and no image anywhere in the game.
//
// Why text and not a glyph atlas on canvas -- measured on this machine, same
// 214x69 grid (14,766 cells), same font:
//   DOM rows with colour runs ..... p50 2.1 ms / p95 3.9 ms per full redraw
//   canvas blitting a glyph atlas . p50 9.4 ms / p95 49.4 ms
//   real crypt art (185 colours) .. 2.54 ms and 135 KB of HTML per frame
// The DOM path is 4x faster at the median and 12x faster at p95, so the engine
// renders text. Everything the player sees is a character with a colour.
//
// SCROLLING: the grid is deliberately larger than the viewport (LATTICE_BLEED
// cells on each side) and the content is generated for a COARSE lattice anchor;
// the sub-cell remainder is applied as a CSS transform, snapped to whole CSS
// pixels so glyphs stay crisp. Walking therefore moves the picture at 60 fps
// without rewriting the grid: rebuilding it 42 times a second cost 5.5 MB/s of
// HTML and made static scenery look like it was being regenerated.

var CELL_ASPECT = 1.67;      // character cell height / width (from ship.py)

var GLYPH_RAMP = " .'-:_,^=;><+!rc*/z?sLTv)J7(|Fi{C}fI31tlu[neoZ5Yxjya]2ESwqkP6h9d4VpOGbUAKXHm8RD#$Bg0MNWQ%&@";
var GLYPH_SOLID = "░▒▓█";
var GLYPH_BOX = "╔╗╚╝═║╠╣╦╩╬┌┐└┘─│├┤┬┴┼";
var GLYPH_MARK = "●○◆◇▪▫°·×÷≠";
var GLYPH_TEXT = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ .,:%+-/()[]<>!?*#♥";
var GLYPHS = GLYPH_RAMP + GLYPH_SOLID + GLYPH_BOX + GLYPH_MARK + GLYPH_TEXT;

// First occurrence wins, so a ramp character always maps back to its ramp index.
var GLYPH_INDEX = (function () {
  var map = {};
  for (var i = 0; i < GLYPHS.length; i++) if (!(GLYPHS[i] in map)) map[GLYPHS[i]] = i;
  return map;
})();

var GLYPH_HTML = (function () {
  var out = [];
  for (var i = 0; i < GLYPHS.length; i++) {
    var g = GLYPHS[i];
    out.push(g === "<" ? "&lt;" : g === ">" ? "&gt;" : g === "&" ? "&amp;" : g);
  }
  return out;
})();

var SPACE_INDEX = GLYPH_INDEX[" "];
var RAMP_LENGTH = GLYPH_RAMP.length;

function glyphIndex(character) {
  var index = GLYPH_INDEX[character];
  return index === undefined ? SPACE_INDEX : index;
}

// Ramp index from a 0..1 intensity: the ASCII recipe from the ship (gamma 1.9).
function rampIndexAt(intensity) {
  var v = intensity <= 0 ? 0 : (intensity >= 1 ? 1 : intensity);
  v = Math.pow(v, 1.9);
  var k = Math.min(RAMP_LENGTH - 1, Math.floor(v * (RAMP_LENGTH + 1)));
  return k;
}

// --- colour helpers (packed 0xRRGGBB) ---------------------------------------
function rgb(r, g, b) {
  return ((r < 0 ? 0 : r > 255 ? 255 : r | 0) << 16)
    | ((g < 0 ? 0 : g > 255 ? 255 : g | 0) << 8)
    | (b < 0 ? 0 : b > 255 ? 255 : b | 0);
}
function shade(color, k) {
  return rgb(((color >> 16) & 255) * k, ((color >> 8) & 255) * k, (color & 255) * k);
}
function mixColor(a, b, t) {
  return rgb(
    ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t,
    ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t,
    (a & 255) + ((b & 255) - (a & 255)) * t
  );
}
function hexColor(color) {
  return "#" + ("00000" + color.toString(16)).slice(-6);
}

function pickStep(noise, steps) {
  var index = (noise * steps) | 0;
  return index >= steps ? steps - 1 : index;
}

// A character only covers part of its cell, so the brightness you perceive is
// well below the ink colour: a dark stone palette renders as an almost black
// screen (measured: p90 luminance 30, 0.4% of pixels above 100). Every text-mode
// palette wants this boost; the numbers are the game's choice.
function boostColor(color, saturation, gain, lift) {
  var channels = [(color >> 16) & 255, (color >> 8) & 255, color & 255];
  var mean = (channels[0] + channels[1] + channels[2]) / 3;
  var out = [0, 0, 0];
  for (var i = 0; i < 3; i++) {
    var v = (mean + (channels[i] - mean) * saturation) * gain + lift;
    out[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  return rgb(out[0], out[1], out[2]);
}

// Deterministic 0..1 noise, no state: same seed -> same world, always.
function hashNoise(a, b, c, d) {
  var h = (a * 374761393 + b * 668265263 + c * 2246822519 + d * 3266489917) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

// Grid density (rows that fill the viewport) is a runtime knob driven by the
// game: keys, a URL hash, a stored preference. The engine only owns the limits
// and the reasoning behind them, in core/config.js.
function createTextRenderer(preElement, options) {
  var pre = preElement;
  // The world needs a bleed ring so it can slide sub-cell without revealing a
  // gap. A static overlay (the HUD) needs the opposite: bleed 0 means its grid
  // starts at the viewport origin, so it needs no transform at all -- and an
  // untransformed layer is not composited, so a HUD update repaints only the
  // rows that changed instead of re-rastering the whole screen.
  var bleed = (options && typeof options.bleed === "number") ? options.bleed : LATTICE_BLEED;
  var cols = 0;                 // VISIBLE cells (what the HUD lays out against)
  var rows = 0;
  var bufferCols = 0;           // drawn cells: visible plus the bleed ring
  var bufferRows = 0;
  var chars = null;
  var fg = null;
  var bg = null;
  var cellW = 0;
  var cellH = 0;
  var fontPx = 0;
  var targetRows = DEFAULT_TARGET_ROWS;
  var advanceRatio = 0.6;     // advance width / font size, measured at boot
  var rowHashes = null;       // one hash per row: unchanged rows are left alone
  var rowCache = null;
  var rowElements = null;     // one <span class="r"> per row inside the <pre>
  var stats = {
    cols: 0, rows: 0, bufferCols: 0, bufferRows: 0, cells: 0, fontPx: 0,
    cellW: 0, cellH: 0, targetRows: 0, drawnCells: 0, spans: 0, htmlBytes: 0,
    gridBytes: 0, rebuiltRows: 0, presentMs: 0, translatePx: [0, 0]
  };

  // Measure the font once so the grid is derived from real metrics, never from
  // an assumed 0.6em advance.
  function measureFont() {
    var probe = document.createElement("span");
    probe.style.fontFamily = "inherit";
    probe.style.fontSize = "100px";
    probe.style.lineHeight = "1";
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.textContent = "MMMMMMMMMMMMMMMMMMMM";
    pre.appendChild(probe);
    var rect = probe.getBoundingClientRect();
    pre.removeChild(probe);
    advanceRatio = rect.width / 20 / 100;
    if (!(advanceRatio > 0.3 && advanceRatio < 1.2)) advanceRatio = 0.6;
  }

  function resize(viewportWidth, viewportHeight, requestedRows) {
    targetRows = requestedRows || targetRows || DEFAULT_TARGET_ROWS;
    fontPx = Math.max(MIN_FONT_PX, Math.min(MAX_FONT_PX, viewportHeight / targetRows));
    cellW = fontPx * advanceRatio;
    cellH = fontPx;
    cols = Math.max(40, Math.floor(viewportWidth / cellW));
    rows = Math.max(20, Math.floor(viewportHeight / cellH));
    bufferCols = cols + 2 * bleed;
    bufferRows = rows + 2 * bleed;
    pre.style.fontSize = fontPx.toFixed(2) + "px";
    pre.style.lineHeight = "1";
    chars = new Uint8Array(bufferCols * bufferRows);
    fg = new Int32Array(bufferCols * bufferRows);
    bg = new Int32Array(bufferCols * bufferRows);
    // Uint32Array, not Int32Array: the FNV-1a result is unsigned, and an
    // int32-backed store silently never matches the computed value for hashes
    // >= 2^31 (that broke the dirty check on ~55% of the rows).
    rowHashes = new Uint32Array(bufferRows);
    rowHashes.fill(4294967295);
    rowCache = new Array(bufferRows);
    // One block element per row: the unit of DOM update.
    pre.textContent = "";
    rowElements = new Array(bufferRows);
    for (var r = 0; r < bufferRows; r++) {
      var rowElement = document.createElement("span");
      rowElement.className = "r";
      pre.appendChild(rowElement);
      rowElements[r] = rowElement;
    }
    stats.cols = cols;
    stats.rows = rows;
    stats.bufferCols = bufferCols;
    stats.bufferRows = bufferRows;
    stats.targetRows = targetRows;
    stats.cells = cols * rows;
    stats.fontPx = fontPx;
    stats.cellW = cellW;
    stats.cellH = cellH;
    beginFrame();
  }

  function beginFrame() {
    chars.fill(SPACE_INDEX);
    fg.fill(-1);
    bg.fill(-1);
    stats.drawnCells = 0;
  }

  // Public coordinates are VISIBLE coordinates: (0,0) is the top-left cell of the
  // viewport. The bleed ring is addressable as -LATTICE_BLEED .. cols+BLEED.
  function plot(x, y, glyph, color, background) {
    var bx = x + bleed;
    var by = y + bleed;
    if (bx < 0 || by < 0 || bx >= bufferCols || by >= bufferRows) return;
    var i = by * bufferCols + bx;
    chars[i] = glyph;
    fg[i] = color;
    if (background !== undefined && background !== null) bg[i] = background;
    if (glyph !== SPACE_INDEX) stats.drawnCells++;
  }

  function fillRect(x, y, w, h, glyph, color, background) {
    for (var j = 0; j < h; j++) {
      for (var i = 0; i < w; i++) plot(x + i, y + j, glyph, color, background);
    }
  }

  // Read-side accessors: the art needs them (a light wash only touches cells
  // that are still empty; the audit reads back what was drawn).
  function glyphAt(x, y) {
    var bx = x + bleed;
    var by = y + bleed;
    if (bx < 0 || by < 0 || bx >= bufferCols || by >= bufferRows) return -3;
    return chars[by * bufferCols + bx];
  }
  function colorAt(x, y) {
    var bx = x + bleed;
    var by = y + bleed;
    if (bx < 0 || by < 0 || bx >= bufferCols || by >= bufferRows) return -3;
    return fg[by * bufferCols + bx];
  }

  function textAt(x, y, string, color, background) {
    for (var i = 0; i < string.length; i++) {
      plot(x + i, y, glyphIndex(string.charAt(i)), color, background);
    }
  }

  // Scanline fill in cell space. `paint(x, y, inside)` decides glyph and colour
  // per cell, which is how the floor gets its stone texture.
  function fillPolygon(points, paint) {
    var minY = Infinity;
    var maxY = -Infinity;
    var i;
    for (i = 0; i < points.length; i++) {
      if (points[i][1] < minY) minY = points[i][1];
      if (points[i][1] > maxY) maxY = points[i][1];
    }
    var y0 = Math.max(-bleed, Math.floor(minY));
    var y1 = Math.min(rows + bleed - 1, Math.ceil(maxY));
    for (var y = y0; y <= y1; y++) {
      var yc = y + 0.5;
      var hits = [];
      for (i = 0; i < points.length; i++) {
        var a = points[i];
        var b = points[(i + 1) % points.length];
        if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) {
          hits.push(a[0] + (yc - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
        }
      }
      if (hits.length < 2) continue;
      hits.sort(function (p, q) { return p - q; });
      for (i = 0; i + 1 < hits.length; i += 2) {
        var xa = Math.round(hits[i] - 0.5);
        var xb = Math.round(hits[i + 1] - 0.5);
        for (var x = Math.max(-bleed, xa); x <= Math.min(cols + bleed - 1, xb); x++) {
          var cell = paint(x, y, true);
          if (cell) plot(x, y, cell.glyph, cell.color, cell.background);
        }
      }
    }
  }

  function strokeLine(x0, y0, x1, y1, glyph, color) {
    var dx = Math.abs(x1 - x0);
    var dy = Math.abs(y1 - y0);
    var sx = x0 < x1 ? 1 : -1;
    var sy = y0 < y1 ? 1 : -1;
    var err = dx - dy;
    var x = x0;
    var y = y0;
    for (var guard = 0; guard < 4096; guard++) {
      plot(x, y, glyph, color);
      if (x === x1 && y === y1) break;
      var e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
  }

  // A diamond footprint, the shape of one tile. Used for both floors and the
  // tops of walls so the isometric grammar stays consistent.
  function inDiamond(dx, dy, halfW, halfH) {
    return Math.abs(dx) / halfW + Math.abs(dy) / halfH <= 1.02;
  }

  // Sub-cell placement. The content was generated for the coarse lattice; the
  // remainder between the lattice and the real camera becomes a translate, so the
  // picture moves smoothly without the grid being rewritten. Snapped to a DEVICE
  // pixel (not a CSS pixel) so glyphs stay crisp and the steps are as fine as the
  // display allows.
  function setOrigin(lattice, camera) {
    if (bleed === 0) return;   // static overlay: never transformed, never composited
    var ratio = window.devicePixelRatio || 1;
    var originX = lattice.x - worldToCellX(camera.x, camera.y) - bleed;
    var originY = lattice.y - worldToCellY(camera.x, camera.y) - bleed;
    var px = Math.round(originX * cellW * ratio) / ratio;
    var py = Math.round(originY * cellH * ratio) / ratio;
    if (px !== stats.translatePx[0] || py !== stats.translatePx[1]) {
      pre.style.transform = "translate(" + px + "px," + py + "px)";
      stats.translatePx = [px, py];
    }
  }

  // A renderer used as a static overlay (the HUD): cancel the bleed so visible
  // cell (0,0) sits exactly at the viewport origin and nothing slides.
  function lockToViewport() {
    if (bleed === 0) return;
    var ratio = window.devicePixelRatio || 1;
    var px = Math.round(-bleed * cellW * ratio) / ratio;
    var py = Math.round(-bleed * cellH * ratio) / ratio;
    if (px !== stats.translatePx[0] || py !== stats.translatePx[1]) {
      pre.style.transform = "translate(" + px + "px," + py + "px)";
      stats.translatePx = [px, py];
    }
  }

  // Row level dirty check, at the DOM level: each row is its own block element,
  // so a frame only touches the rows whose cells changed. Assigning one big
  // innerHTML for the whole grid costs the browser a full parse + layout of the
  // grid every frame even when nothing changed (measured: 30 fps, 335 KB parsed
  // per frame, while the JS render was only 7.8 ms).
  function present() {
    var started = performance.now();
    var spans = 0;
    var bytesWritten = 0;
    var gridBytes = 0;
    var rebuiltRows = 0;
    for (var y = 0; y < bufferRows; y++) {
      var base = y * bufferCols;
      var hash = 0x811c9dc5;
      for (var h = 0; h < bufferCols; h++) {
        hash = hash32Mix(hash, chars[base + h]);
        hash = hash32Mix(hash, fg[base + h]);
        hash = hash32Mix(hash, bg[base + h]);
      }
      if (rowHashes[y] === hash && rowCache[y] !== undefined) {
        gridBytes += rowCache[y].html.length;
        spans += rowCache[y].spans;
        continue;
      }
      var row = [];
      var rowSpans = 0;
      var runStart = 0;
      var runFg = -2;
      var runBg = -2;
      for (var x = 0; x <= bufferCols; x++) {
        var i = base + x;
        var f = x < bufferCols ? fg[i] : -3;
        var b = x < bufferCols ? bg[i] : -3;
        if (f !== runFg || b !== runBg) {
          if (x > runStart) {
            var text = "";
            for (var k = runStart; k < x; k++) text += GLYPH_HTML[chars[base + k]];
            if (runFg === -1 && runBg === -1) {
              row.push(text);
            } else {
              rowSpans++;
              var style = runFg === -1 ? "" : "color:" + hexColor(runFg);
              if (runBg !== -1) style += (style ? ";" : "") + "background:" + hexColor(runBg);
              row.push('<i style="' + style + '">' + text + "</i>");
            }
          }
          runStart = x;
          runFg = f;
          runBg = b;
        }
      }
      var line = row.join("");
      if (line === "") line = " ";
      rowElements[y].innerHTML = line;
      rowHashes[y] = hash;
      rowCache[y] = { spans: rowSpans, html: line };
      bytesWritten += line.length;
      gridBytes += line.length;
      spans += rowSpans;
      rebuiltRows++;
    }
    stats.spans = spans;
    stats.htmlBytes = bytesWritten;
    stats.gridBytes = gridBytes;
    stats.rebuiltRows = rebuiltRows;
    stats.presentMs = performance.now() - started;
    return {
      spans: spans, htmlBytes: bytesWritten, gridBytes: gridBytes, rows: bufferRows,
      presentMs: stats.presentMs, rebuiltRows: rebuiltRows
    };
  }

  return {
    resize: resize,
    beginFrame: beginFrame,
    present: present,
    setOrigin: setOrigin,
    lockToViewport: lockToViewport,
    plot: plot,
    fillRect: fillRect,
    text: textAt,
    glyphAt: glyphAt,
    colorAt: colorAt,
    // The visible window only, so callers (and the audit) see what the player sees.
    gridText: function () {
      var out = [];
      for (var y = 0; y < rows; y++) {
        var line = "";
        for (var x = 0; x < cols; x++) line += GLYPHS[chars[(y + bleed) * bufferCols + (x + bleed)]];
        out.push(line);
      }
      return out.join("\n");
    },
    fillPolygon: fillPolygon,
    strokeLine: strokeLine,
    inDiamond: inDiamond,
    stats: stats,
    metrics: function () {
      return {
        cols: cols, rows: rows, cellW: cellW, cellH: cellH,
        fontPx: fontPx, advanceRatio: advanceRatio, targetRows: targetRows,
        bufferCols: bufferCols, bufferRows: bufferRows,
        latticeQuantum: LATTICE_QUANTUM, latticeBleed: LATTICE_BLEED
      };
    },
    element: pre
  };
}

// ---- render/world_view.js ----------------------------------------------
// Paints the visible tiles into the character grid: floors first, then walls,
// props and entities in painter's order (x + y, tie broken by x) -- the phase 0
// draw order, now in cells.
//
// The engine knows the ORDER and the CULLING; it knows nothing about the art.
// A game hands over a table of callbacks and nothing here changes when the art
// changes:
//
//   var view = Isoforge.view.createWorldView(renderer, {
//     margin: 3,                                  // tiles of slack (optional)
//     floor:  function (r, ctx) {},               // ctx: {tileX, tileY, cx, cy, variant, grid}
//     block:  function (r, ctx) {},               // solid tile; ctx: same shape
//     prop:   { torch: function (r, ctx) },       // one entry per prop kind
//     propAt: function (tileX, tileY, grid) {},   // -> prop kind or null
//     entity: { player: function (r, ctx) },      // ctx: {entity, index, cx, cy, alpha}
//     entityFallback: function (r, ctx),          // optional
//     cursor: function (r, cx, cy, blocked),      // optional, engine default
//     cursorColor: 0xRRGGBB, cursorBlockedColor: 0xRRGGBB
//   });
//
// `draw(scene, camera, alpha, hoveredTile)` takes a scene of the form
// { grid: <tile grid>, entities: [{kind, x, y, prevX, prevY, layer?}] }.
//
// The per-tile visibility test is the SAME function the audit calls, so the
// number of tiles drawn and the number of tiles that geometrically touch the
// viewport have to come out identical.

function createWorldView(renderer, art) {
  var pool = [];
  for (var i = 0; i < 8192; i++) {
    pool.push({ depth: 0, tie: 0, kind: 0, tileX: 0, tileY: 0, cx: 0, cy: 0, variant: 0, prop: null });
  }
  var active = [];
  var stats = {
    iterated: 0, culled: 0, tilesDrawn: 0, blocksDrawn: 0, propsDrawn: 0,
    spritesDrawn: 0, drawables: 0, bounds: null, sortMs: 0
  };
  var KIND_PROP = 1;
  var KIND_WALL = 2;
  var KIND_ENTITY = 3;
  // Slack for the AABB, in tiles, derived from the geometry: the bleed ring is
  // measured in cells and the taller a cell is next to a tile, the more tiles the
  // ring covers.
  var margin = art.margin === undefined ? requiredTileMargin() : art.margin;

  function push(depth, tie, kind, tileX, tileY, cx, cy, variant) {
    if (active.length >= pool.length) return;
    var slot = pool[active.length];
    slot.depth = depth;
    slot.tie = tie;
    slot.kind = kind;
    slot.tileX = tileX;
    slot.tileY = tileY;
    slot.cx = cx;
    slot.cy = cy;
    slot.variant = variant;
    slot.prop = null;
    active.push(slot);
  }

  function draw(scene, camera, alpha, hoveredTile) {
    var metrics = renderer.metrics();
    var cols = metrics.cols;
    var rows = metrics.rows;
    var grid = scene.grid;
    var entities = scene.entities || [];
    var bounds = visibleTileBounds(camera.x, camera.y, cols, rows, margin);
    // One lattice for the whole frame: tiles, props, entities and the cursor are
    // all placed against it, so nothing can shimmer relative to anything else.
    var lattice = coarseLatticeCell(camera);
    stats.bounds = bounds;
    stats.iterated = 0;
    stats.culled = 0;
    stats.tilesDrawn = 0;
    stats.blocksDrawn = 0;
    stats.propsDrawn = 0;
    stats.spritesDrawn = 0;
    active.length = 0;

    for (var ty = bounds.y0; ty <= bounds.y1; ty++) {
      for (var tx = bounds.x0; tx <= bounds.x1; tx++) {
        stats.iterated++;
        if (tx < 0 || ty < 0 || tx >= grid.width || ty >= grid.height) { stats.culled++; continue; }
        if (!tileTouchesViewport(tx, ty, camera.x, camera.y, cols, rows)) { stats.culled++; continue; }
        var center = tileCenterCellInLattice(tx + 0.5, ty + 0.5, lattice, cols, rows);
        var variant = grid.floorVariant(tx, ty);
        var ctx = { tileX: tx, tileY: ty, cx: center.x, cy: center.y, variant: variant, grid: grid };
        if (grid.isWalkableTile(tx, ty)) {
          if (art.floor) art.floor(renderer, ctx);
          stats.tilesDrawn++;
          var prop = art.propAt ? art.propAt(tx, ty, grid) : null;
          if (prop && art.prop && art.prop[prop]) {
            push(tx + ty + 0.1, tx, KIND_PROP, tx, ty, center.x, center.y, variant);
            active[active.length - 1].prop = prop;
            stats.propsDrawn++;
          }
        } else {
          push(tx + ty + 0.5, tx, KIND_WALL, tx, ty, center.x, center.y, variant);
          stats.blocksDrawn++;
        }
      }
    }

    for (var e = 0; e < entities.length; e++) {
      var entity = entities[e];
      var ix = entity.prevX + (entity.x - entity.prevX) * alpha;
      var iy = entity.prevY + (entity.y - entity.prevY) * alpha;
      var cell = tileCenterCellInLattice(ix, iy, lattice, cols, rows);
      push(ix + iy, ix, KIND_ENTITY, e, 0, cell.x, cell.y, entity.layer || 0);
      stats.spritesDrawn++;
    }

    var started = performance.now();
    active.sort(function (a, b) {
      if (a.depth === b.depth) return a.tie - b.tie;
      return a.depth - b.depth;
    });
    stats.sortMs = performance.now() - started;

    for (var k = 0; k < active.length; k++) {
      var item = active[k];
      if (item.kind === KIND_WALL) {
        if (art.block) art.block(renderer, item);
      } else if (item.kind === KIND_PROP) {
        art.prop[item.prop](renderer, item);
      } else {
        var who = entities[item.tileX];
        var painter = art.entity[who.kind] || art.entityFallback;
        if (painter) {
          painter(renderer, { entity: who, index: item.tileX, cx: item.cx, cy: item.cy, alpha: alpha });
        }
      }
    }
    stats.drawables = active.length;

    if (hoveredTile && hoveredTile.inside) {
      var hover = tileCenterCellInLattice(hoveredTile.x + 0.5, hoveredTile.y + 0.5, lattice, cols, rows);
      if (art.cursor) art.cursor(renderer, hover.x, hover.y, !hoveredTile.walkable);
      else drawDefaultCursor(renderer, hover.x, hover.y, !hoveredTile.walkable, art);
    }
  }

  return { draw: draw, stats: stats };
}

// The engine's cursor: a diamond outline that follows the tile geometry, so a
// game gets a usable hover indicator without writing one. A game that wants its
// own passes art.cursor and this never runs.
function drawDefaultCursor(renderer, centerX, centerY, blocked, art) {
  var cx = Math.round(centerX);
  var cy = Math.round(centerY);
  var color = blocked
    ? (art.cursorBlockedColor === undefined ? rgb(200, 64, 48) : art.cursorBlockedColor)
    : (art.cursorColor === undefined ? rgb(232, 196, 104) : art.cursorColor);
  var halfW = TILE_DIAMOND_HALF_W;
  var halfH = TILE_DIAMOND_HALF_H;
  var spanX = Math.ceil(halfW);
  var spanY = Math.ceil(halfH);
  for (var dy = -spanY; dy <= spanY; dy++) {
    for (var dx = -spanX; dx <= spanX; dx++) {
      if (!renderer.inDiamond(dx, dy, halfW, halfH)) continue;
      if (renderer.inDiamond(dx, dy, halfW - 1, halfH - 0.4)) continue;
      renderer.plot(cx + dx, cy + dy, glyphIndex(dx < 0 ? "/" : dx > 0 ? "\\" : "_"), color);
    }
  }
}

// ---- sim/grid.js -------------------------------------------------------
// The tile grid: a walkable bitmap plus tile queries. The engine owns the
// CONTAINER and the connectivity utility; a game owns the generator that fills
// it (a cave automaton, rooms and corridors, a flat arena) and may override
// floorVariant for its floor art.
//
// Two rules the rest of the engine relies on:
//   - every query is a pure function of the bitmap, so the world is identical
//     for the same seed on every machine;
//   - the border is solid, which is what makes the camera clamp and the culling
//     rectangle simple.

var GRID_VERSION = 1;

function createGrid(width, height) {
  var w = Math.max(4, width | 0);
  var h = Math.max(4, height | 0);
  var walkable = new Uint8Array(w * h);

  var grid = {
    version: GRID_VERSION,
    width: w,
    height: h,
    walkable: walkable,
    isWalkableAt: function (x, y) {
      var tx = Math.floor(x);
      var ty = Math.floor(y);
      if (tx < 0 || ty < 0 || tx >= w || ty >= h) return false;
      return walkable[ty * w + tx] === 1;
    },
    isWalkableTile: function (tx, ty) {
      if (tx < 0 || ty < 0 || tx >= w || ty >= h) return false;
      return walkable[ty * w + tx] === 1;
    },
    setWalkable: function (tx, ty, value) {
      if (tx < 0 || ty < 0 || tx >= w || ty >= h) return false;
      walkable[ty * w + tx] = value ? 1 : 0;
      return true;
    },
    // Deterministic floor variant: derived from the coordinates, never stored,
    // so the art cannot depend on the order tiles happen to be generated in.
    // Games that want a different pattern just reassign this function.
    floorVariant: function (tx, ty) { return (tx * 7 + ty * 13) % 4; },
    countWalkable: function () {
      var total = 0;
      for (var i = 0; i < walkable.length; i++) total += walkable[i];
      return total;
    }
  };
  return grid;
}

// Solid border, so a body can never stand half outside the world.
function solidBorder(grid) {
  var w = grid.width;
  var h = grid.height;
  for (var x = 0; x < w; x++) {
    grid.setWalkable(x, 0, false);
    grid.setWalkable(x, h - 1, false);
  }
  for (var y = 0; y < h; y++) {
    grid.setWalkable(0, y, false);
    grid.setWalkable(w - 1, y, false);
  }
}

// Flood fill from the largest region; every other pocket becomes wall, so a
// spawn can never end up sealed. Returns how many cells survived.
function keepLargestRegion(grid) {
  var walkable = grid.walkable;
  var width = grid.width;
  var height = grid.height;
  var label = new Int32Array(width * height);
  var queue = new Int32Array(width * height);
  var best = 0;
  var bestLabel = 0;
  var current = 0;

  for (var start = 0; start < walkable.length; start++) {
    if (!walkable[start] || label[start]) continue;
    current++;
    var head = 0;
    var tail = 0;
    queue[tail++] = start;
    label[start] = current;
    var size = 0;
    while (head < tail) {
      var cell = queue[head++];
      size++;
      var cx = cell % width;
      var cy = (cell - cx) / width;
      for (var d = 0; d < 4; d++) {
        var nx = cx + (d === 0 ? 1 : d === 1 ? -1 : 0);
        var ny = cy + (d === 2 ? 1 : d === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        var neighbour = ny * width + nx;
        if (!walkable[neighbour] || label[neighbour]) continue;
        label[neighbour] = current;
        queue[tail++] = neighbour;
      }
    }
    if (size > best) { best = size; bestLabel = current; }
  }

  var kept = 0;
  for (var k = 0; k < walkable.length; k++) {
    if (walkable[k] && label[k] !== bestLabel) walkable[k] = 0;
    kept += walkable[k];
  }
  return kept;
}

// Find a walkable cell with a 1-tile clearance, deterministically: the same rng
// sequence gives the same spawn on every run, which the determinism audit needs.
function findOpenCell(grid, rng) {
  for (var attempt = 0; attempt < 4000; attempt++) {
    var tx = 2 + Math.floor(rng() * (grid.width - 4));
    var ty = 2 + Math.floor(rng() * (grid.height - 4));
    var clear = true;
    for (var dy = -1; dy <= 1 && clear; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        if (!grid.isWalkableTile(tx + dx, ty + dy)) { clear = false; break; }
      }
    }
    if (clear) return { x: tx + 0.5, y: ty + 0.5 };
  }
  return { x: grid.width / 2, y: grid.height / 2 };
}

// ---- sim/actor.js ------------------------------------------------------
// Locomotion primitives: how an actor moves over a tile grid and how the camera
// follows it. A game composes these into its own step(); the engine does not
// assume a player, a monster, or even that anything is moving.
//
// Collision is axis separated (full step, then each axis alone), which is what
// gives wall sliding for free: pushing diagonally into a wall keeps the free
// axis and loses the blocked one.

function canStand(grid, x, y, radius) {
  return grid.isWalkableAt(x - radius, y - radius)
    && grid.isWalkableAt(x + radius, y - radius)
    && grid.isWalkableAt(x - radius, y + radius)
    && grid.isWalkableAt(x + radius, y + radius);
}

// Returns true when the actor actually moved (on either axis).
function moveWithCollision(grid, actor, dx, dy) {
  if (dx === 0 && dy === 0) return false;
  var radius = actor.radius || 0;
  if (canStand(grid, actor.x + dx, actor.y + dy, radius)) {
    actor.x += dx;
    actor.y += dy;
    return true;
  }
  if (dx !== 0 && canStand(grid, actor.x + dx, actor.y, radius)) {
    actor.x += dx;
    return true;
  }
  if (dy !== 0 && canStand(grid, actor.x, actor.y + dy, radius)) {
    actor.y += dy;
    return true;
  }
  return false;
}

// Directional movement (keyboard, d-pad, an AI steering vector). `moveX` and
// `moveY` are expected to be normalised by the caller when both are non-zero.
function moveByInput(grid, actor, moveX, moveY, speed, dt) {
  actor.prevX = actor.x;
  actor.prevY = actor.y;
  var moved = moveWithCollision(grid, actor, moveX * speed * dt, moveY * speed * dt);
  actor.blocked = false;
  return moved;
}

// Walk toward actor.targetX / targetY at `speed`, clearing the target on
// arrival. `blockedWhenStuck` clears the target when a wall stops the actor,
// which is what keeps a click-to-move game from grinding against a wall
// forever when there is no pathfinder yet.
function stepTowardTarget(grid, actor, speed, dt, options) {
  options = options || {};
  var arrive = options.arrive === undefined ? 0.12 : options.arrive;
  var blockedWhenStuck = options.blockedWhenStuck !== false;
  actor.prevX = actor.x;
  actor.prevY = actor.y;
  actor.blocked = false;
  if (actor.targetX === null || actor.targetX === undefined) return false;

  var toX = actor.targetX - actor.x;
  var toY = actor.targetY - actor.y;
  var distance = Math.sqrt(toX * toX + toY * toY);
  if (distance < arrive) {
    actor.targetX = null;
    actor.targetY = null;
    return false;
  }
  var moved = moveWithCollision(grid, actor, (toX / distance) * speed * dt, (toY / distance) * speed * dt);
  if (!moved && blockedWhenStuck) {
    actor.blocked = true;
    actor.targetX = null;
    actor.targetY = null;
  }
  return moved;
}

function clearTarget(actor) {
  actor.targetX = null;
  actor.targetY = null;
  actor.blocked = false;
}

// Frame rate independent easing: the camera keeps the same feel at 30 and at
// 144 fps, and it never overshoots.
function followCamera(camera, targetX, targetY, dt, rate) {
  var follow = 1 - Math.exp(-(rate === undefined ? 8 : rate) * dt);
  camera.x += (targetX - camera.x) * follow;
  camera.y += (targetY - camera.y) * follow;
}

// ---- sim/headless.js ---------------------------------------------------
// Headless entry points: engine invariants a game can be asked about without a
// browser. The game supplies its own scene factory, so the same checks run
// against any game built on the engine.
//
//   Isoforge.headless({ createScene: function (seed) { ... } })
//
// `scene` must expose: step(input), stateHash(includeTick), getTick(), and a
// plain `grid` -- that is the whole contract.

function createHeadless(options) {
  var createScene = options.createScene;
  if (typeof createScene !== "function") {
    throw new Error("Isoforge.headless: options.createScene is required");
  }

  // Two runs of the same seed and the same scripted input must agree, step by
  // step. Divergence means something is reading wall-clock time, Math.random, or
  // iterating an object with a non-deterministic order.
  function determinism(seed, steps) {
    function run() {
      var scene = createScene(seed);
      var plan = createRng(seed + 999);
      var hashes = [];
      var moveX = 0;
      var moveY = 0;
      for (var i = 0; i < steps; i++) {
        if (i % 40 === 0) {
          var pick = Math.floor(plan() * 4);
          moveX = pick === 0 ? 1 : pick === 1 ? -1 : 0;
          moveY = pick === 2 ? 1 : pick === 3 ? -1 : 0;
        }
        scene.step({ moveX: moveX, moveY: moveY });
        hashes.push(scene.stateHash(true));
      }
      return { hashes: hashes, scene: scene };
    }
    var first = run();
    var second = run();
    var divergentAt = -1;
    for (var i = 0; i < first.hashes.length; i++) {
      if (first.hashes[i] !== second.hashes[i]) { divergentAt = i; break; }
    }
    return {
      steps: steps,
      seed: seed,
      firstHash: first.hashes[0],
      finalHash: first.hashes[first.hashes.length - 1],
      secondFinalHash: second.hashes[second.hashes.length - 1],
      identical: divergentAt === -1,
      divergentAt: divergentAt,
      walkableTiles: first.scene.grid.countWalkable()
    };
  }

  // Loop closure with no input: every oscillator that closes a whole number of
  // cycles in `steps` puts the state hash back exactly where it started.
  function loopClosure(seed, steps) {
    var scene = createScene(seed);
    var start = scene.stateHash(false);
    for (var i = 0; i < steps; i++) scene.step({});
    var end = scene.stateHash(false);
    return { steps: steps, seed: seed, startHash: start, endHash: end, closed: start === end };
  }

  // Projection round trip over a spread of world points, in cell units. Proves
  // the inverse used for picking is the exact inverse of the forward transform.
  function projectionRoundTrip(samples) {
    var worst = 0;
    var rng = createRng(4242);
    for (var i = 0; i < samples; i++) {
      var x = rng() * 200 - 100;
      var y = rng() * 200 - 100;
      var cx = worldToCellX(x, y);
      var cy = worldToCellY(x, y);
      var backX = cellToWorldX(cx, cy);
      var backY = cellToWorldY(cx, cy);
      worst = Math.max(worst, Math.abs(backX - x), Math.abs(backY - y));
    }
    return { samples: samples, maxErrorTiles: worst };
  }

  // No holes: every tile whose diamond touches the viewport must be inside the
  // iterated rectangle. The renderer rejects the rest with the very same test,
  // so the audit compares its drawn count with this one for equality.
  function culling(cols, rows, camX, camY, grid, margin) {
    if (margin === undefined) margin = requiredTileMargin();
    var bounds = visibleTileBounds(camX, camY, cols, rows, margin);
    var inside = {};
    var iteratedInWorld = 0;
    for (var ty = bounds.y0; ty <= bounds.y1; ty++) {
      for (var tx = bounds.x0; tx <= bounds.x1; tx++) {
        if (tx < 0 || ty < 0 || tx >= grid.width || ty >= grid.height) continue;
        inside[tx + ":" + ty] = true;
        iteratedInWorld++;
      }
    }
    var missing = [];
    var visibleCount = 0;
    for (var gy = 0; gy < grid.height; gy++) {
      for (var gx = 0; gx < grid.width; gx++) {
        if (!tileTouchesViewport(gx, gy, camX, camY, cols, rows)) continue;
        visibleCount++;
        if (!inside[gx + ":" + gy]) missing.push(gx + ":" + gy);
      }
    }
    return {
      viewport: { cols: cols, rows: rows },
      camera: { x: camX, y: camY },
      bounds: bounds,
      iteratedInWorld: iteratedInWorld,
      visibleTiles: visibleCount,
      missingTiles: missing.length,
      missingSample: missing.slice(0, 5),
      iterationOverVisible: visibleCount ? iteratedInWorld / visibleCount : 0,
      coversViewport: missing.length === 0
    };
  }

  return {
    determinism: determinism,
    loopClosure: loopClosure,
    projectionRoundTrip: projectionRoundTrip,
    culling: culling
  };
}

// ---- ui/hud.js ---------------------------------------------------------
// HUD drawn in characters, into its own grid layered over the world: box
// drawing plus text with a solid background. A text panel can never overflow,
// because it is clamped to the grid it is drawn into.
//
// The engine owns the FRAME algorithm; the game owns the CONTENT. A game hands
// over a layout and nothing here changes when the panels change:
//
//   var hud = Isoforge.hud.createHud(hudRenderer, {
//     colors: { line: c1, background: c2, title: c3, label: c4, value: c5 },
//     panels: function (metrics, state) {
//       return [{ x: 1, y: 1, width: 30, height: 6, title: "arena",
//                 rows: [{ label: "fps", value: state.fps }] }];
//     },
//     hint: function (metrics, state) { return "WASD move"; },
//     hintColor: c6
//   });
//
// `state` is whatever the game passes to draw(): the HUD never reads the world.
// Rows are label-on-the-left, value-on-the-right, which is what makes a metrics
// panel readable at a glance. A panel taller than the grid is clamped, and a row
// that would fall outside the frame is dropped instead of drawn over the border.

function createHud(renderer, layout) {
  var colors = layout.colors;

  function repeat(character, count) {
    var out = "";
    for (var i = 0; i < count; i++) out += character;
    return out;
  }

  function pad(text, width) {
    text = String(text);
    if (text.length > width) return text.slice(0, width);
    return text + repeat(" ", width - text.length);
  }

  function panelFrame(box) {
    var metrics = renderer.metrics();
    var width = Math.max(10, Math.min(box.width, metrics.cols - box.x - 1));
    var height = Math.max(3, Math.min(box.height, metrics.rows - box.y - 2));
    var background = colors.background;
    renderer.text(box.x, box.y, "╔" + repeat("═", width - 2) + "╗", colors.line, background);
    for (var j = 1; j < height - 1; j++) {
      renderer.text(box.x, box.y + j, "║" + repeat(" ", width - 2) + "║", colors.line, background);
    }
    renderer.text(box.x, box.y + height - 1, "╚" + repeat("═", width - 2) + "╝", colors.line, background);
    if (box.title) renderer.text(box.x + 2, box.y, " " + box.title + " ", colors.title, background);
    return { x: box.x, y: box.y, width: width, height: height, inner: width - 4 };
  }

  function row(box, index, label, value) {
    if (index + 2 > box.height - 1) return;
    var valueText = String(value === undefined || value === null ? "—" : value);
    var labelWidth = Math.max(1, box.inner - valueText.length - 1);
    var left = pad(label, labelWidth);
    var y = box.y + 1 + index;
    renderer.text(box.x + 2, y, left, colors.label, colors.background);
    renderer.text(box.x + 2 + left.length, y, valueText, colors.value, colors.background);
  }

  function draw(state) {
    var metrics = renderer.metrics();
    var panels = typeof layout.panels === "function" ? layout.panels(metrics, state) : (layout.panels || []);
    for (var i = 0; i < panels.length; i++) {
      var box = panelFrame(panels[i]);
      var rows = panels[i].rows || [];
      for (var r = 0; r < rows.length; r++) row(box, r, rows[r].label, rows[r].value);
    }
    var hint = layout.hint;
    if (typeof hint === "function") hint = hint(metrics, state);
    if (hint) {
      hint = String(hint);
      var start = Math.max(1, Math.floor((metrics.cols - hint.length) / 2));
      renderer.text(start, metrics.rows - 2, pad(hint, metrics.cols - start - 1),
        layout.hintColor === undefined ? colors.value : layout.hintColor, colors.background);
    }
  }

  return { draw: draw, layout: layout };
}

// ---- engine.js ---------------------------------------------------------
// The engine's public surface. build.py concatenates every module into one IIFE
// and returns the object this file describes, so this is the ONLY file a reader
// has to look at to know what the engine offers:
//
//   var Isoforge = (function () { "use strict"; <modules>; return engineSurface(); })();
//
// Nothing else in the engine is global. Modules talk to each other through bare
// names inside that closure, which is what keeps the hot loops free of property
// lookups while the outside world still sees one namespace.

function engineSurface() {
  return {
    version: ENGINE_VERSION,
    mode: "text",
    configure: configure,
    config: function () {
      var copy = {};
      for (var key in EngineConfig) {
        if (Object.prototype.hasOwnProperty.call(EngineConfig, key)) copy[key] = EngineConfig[key];
      }
      return copy;
    },

    // Character grid: the renderer, the glyph ramp and the colour maths.
    text: {
      createTextRenderer: createTextRenderer,
      glyphIndex: glyphIndex,
      rampIndexAt: rampIndexAt,
      glyphs: GLYPHS,
      spaceIndex: SPACE_INDEX,
      pickStep: pickStep,
      boostColor: boostColor,
      rgb: rgb,
      shade: shade,
      mixColor: mixColor,
      hexColor: hexColor,
      hashNoise: hashNoise
    },

    // 2:1 projection in character cells, plus the frame lattice.
    iso: {
      worldToCellX: worldToCellX,
      worldToCellY: worldToCellY,
      cellToWorldX: cellToWorldX,
      cellToWorldY: cellToWorldY,
      createCamera: createCamera,
      viewHalfExtents: viewHalfExtents,
      visibleTileBounds: visibleTileBounds,
      clampCamera: clampCamera,
      snappedCameraCell: snappedCameraCell,
      coarseLatticeCell: coarseLatticeCell,
      tileCenterCellInLattice: tileCenterCellInLattice,
      latticeToWorld: latticeToWorld,
      bufferCellToWorld: bufferCellToWorld,
      tileTouchesViewport: tileTouchesViewport,
      requiredTileMargin: requiredTileMargin,
      // Geometry accessors, so art code reads the live config instead of a copy:
      // a game that changes the tile size gets art that follows without editing.
      halfW: function () { return HALF_TILE_W; },
      halfH: function () { return HALF_TILE_H; },
      diamondHalfW: function () { return TILE_DIAMOND_HALF_W; },
      diamondHalfH: function () { return TILE_DIAMOND_HALF_H; },
      wallHeightCells: function () { return WALL_HEIGHT_CELLS; },
      latticeBleed: function () { return LATTICE_BLEED; }
    },

    grid: {
      createGrid: createGrid,
      solidBorder: solidBorder,
      keepLargestRegion: keepLargestRegion,
      findOpenCell: findOpenCell
    },

    loop: {
      createLoop: createLoop,
      hash32Init: hash32Init,
      hash32Mix: hash32Mix,
      hash32Finish: hash32Finish
    },

    rng: {
      createRng: createRng,
      randomSeed: randomSeed,
      quantize: quantize,
      clamp: clamp
    },

    view: { createWorldView: createWorldView },
    hud: { createHud: createHud },
    actor: {
      canStand: canStand,
      moveWithCollision: moveWithCollision,
      moveByInput: moveByInput,
      stepTowardTarget: stepTowardTarget,
      clearTarget: clearTarget,
      followCamera: followCamera
    },
    persist: { createStore: createStore },
    headless: createHeadless,

    // Test plumbing, in the engine and not in the games: a game exposes the
    // contract object and the engine's audit can drive any game built this way.
    createContract: createContract,
    contractMembers: CONTRACT_MEMBERS
  };
}

// --- the audit contract ------------------------------------------------------
// What a game has to expose as window.ISO for tools/audit_engine.py to drive it.
// Enforced, not documented-and-hoped: createContract throws at boot naming every
// missing member, so a game cannot silently ship an un-auditable build.
//
// stepScene(input) is the important one: "advance the scene one step exactly the
// way your loop does", camera follow and clamp included. Without it the audit
// would have to reach into engine internals to move the camera, and would then
// be testing its own driver instead of the game.

var CONTRACT_MEMBERS = [
  "mode", "version", "seed",
  "scene", "camera", "grid", "renderer", "hudRenderer",
  "metrics", "gridText", "hudText", "cellAt",
  "tileCell", "clientPointForTile",
  "teleport", "setRows", "getRows", "renderOnce", "reseed",
  "stepScene", "loop", "headless", "debug"
];

var CONTRACT_OPTIONAL = ["hudStats", "world", "sim", "hoveredTile"];

function contractMissing(parts) {
  var missing = [];
  for (var i = 0; i < CONTRACT_MEMBERS.length; i++) {
    var key = CONTRACT_MEMBERS[i];
    if (parts[key] === undefined || parts[key] === null) missing.push(key);
  }
  return missing;
}

function createContract(parts) {
  var missing = contractMissing(parts);
  if (missing.length) {
    throw new Error("Isoforge contract: window.ISO is missing " + missing.join(", "));
  }
  var surface = {};
  var i;
  for (i = 0; i < CONTRACT_MEMBERS.length; i++) surface[CONTRACT_MEMBERS[i]] = parts[CONTRACT_MEMBERS[i]];
  for (i = 0; i < CONTRACT_OPTIONAL.length; i++) {
    if (parts[CONTRACT_OPTIONAL[i]] !== undefined) surface[CONTRACT_OPTIONAL[i]] = parts[CONTRACT_OPTIONAL[i]];
  }
  // Called by the audit before anything else: an empty array means the game
  // satisfies the contract it claims to.
  surface.contract = function () { return contractMissing(surface); };
  return surface;
}

return engineSurface();
})();
