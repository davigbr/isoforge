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
// Accented Latin is part of the TEXT set on purpose: the game's player-facing copy
// is Portuguese, and a character with no glyph is replaced by a SPACE in silence
// (that is how "resolução" rendered as "resolu o" until the audit learned to look
// at the copy the game declares). A game in another language adds its glyphs here.
var GLYPH_TEXT = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ .,:%+-/()[]<>!?*#♥"
  + "áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑºª"
  + "−–—…’‘“”";   // typographic minus/dashes/quotes: they creep into player copy
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

// Characters that would be drawn as a SPACE because the set has no glyph for
// them. A game should call this over its own copy at boot: a missing accent is
// invisible in code review and very visible on screen.
function missingGlyphs(text) {
  var absent = [];
  var seen = {};
  text = String(text);
  for (var i = 0; i < text.length; i++) {
    var character = text.charAt(i);
    if (character === " " || seen[character]) continue;
    seen[character] = true;
    if (GLYPH_INDEX[character] === undefined) absent.push(character);
  }
  return absent;
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
  // Background read-back. Same convention as the other accessors: -1 means "no
  // background" (the page shows through), -3 means "outside the buffer". Without
  // this the background was write-only, so nothing could verify that a HUD panel
  // is opaque or that the overlay stays transparent where it draws nothing.
  function backgroundAt(x, y) {
    var bx = x + bleed;
    var by = y + bleed;
    if (bx < 0 || by < 0 || bx >= bufferCols || by >= bufferRows) return -3;
    return bg[by * bufferCols + bx];
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
    backgroundAt: backgroundAt,
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
