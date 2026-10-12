// The crypt, drawn in characters. Every routine paints into the cell grid of the
// text renderer: no image, no canvas, just glyphs with colours.
//
// Phase 2 replaces the procedural shapes below with templates sampled from the
// PIL scene through the ship's pipeline (area average -> ramp by luminance with
// gamma 1.9 -> colour per cell), injected as JSON by build.py.

var ART_TEMPLATES = null;

var PALETTE = {
  floor: [rgb(58, 54, 46), rgb(68, 63, 53), rgb(50, 46, 40), rgb(76, 70, 58)],
  floorEdge: rgb(28, 26, 22),
  wallTop: rgb(104, 96, 78),
  wallLeft: rgb(50, 46, 40),
  wallRight: rgb(30, 28, 25),
  mortar: rgb(20, 18, 16),
  heroCloak: rgb(158, 46, 40),
  heroCloakDark: rgb(96, 26, 24),
  heroTrim: rgb(214, 178, 92),
  skin: rgb(226, 190, 148),
  steel: rgb(198, 204, 214),
  bone: rgb(228, 220, 200),
  creature: rgb(58, 76, 58),
  creatureDark: rgb(30, 40, 30),
  eye: rgb(238, 96, 64),
  fire: rgb(255, 186, 88),
  fireCore: rgb(255, 240, 190),
  iron: rgb(74, 76, 82),
  water: rgb(30, 46, 54),
  cursor: rgb(232, 196, 104),
  cursorBlocked: rgb(200, 64, 48),
  gold: rgb(200, 164, 92),
  bone2: rgb(216, 203, 176),
  panelBg: rgb(14, 12, 10),
  panelLine: rgb(96, 78, 44)
};

// --- floor -------------------------------------------------------------------
// A stone texture. The important cost rule: runs of equal COLOUR are what make
// a text frame cheap, and runs break on colour, not on glyph. So the shade is
// quantised to four discrete steps (variety comes from the glyph, which is
// free) -- letting the shade drift per cell made every run one cell long and
// pushed a frame to 100 spans/row and 6 ms.
var FLOOR_SHADES = [0.80, 0.90, 0.99, 1.07];
var EDGE_SHADES = [0.60, 0.70, 0.79];

function pickStep(noise, steps) {
  var index = (noise * steps) | 0;
  return index >= steps ? steps - 1 : index;
}

function drawFloorTile(renderer, tileX, tileY, variant, centerX, centerY) {
  var base = PALETTE.floor[variant % PALETTE.floor.length];
  var cx = Math.round(centerX);
  var cy = Math.round(centerY);
  // ONE colour for the whole tile interior (plus a lighter top row and a darker
  // bottom row), chosen per tile: a per-cell shade, even quantised, gives random
  // 1-2 cell runs and blows the DOM cost up (measured: 162 spans/row, 335 KB per
  // frame, 30 fps). Per tile the runs are 5-9 cells long.
  var tileShade = pickStep(hashNoise(tileX, tileY, 91, 7), 4);
  var interior = shade(base, FLOOR_SHADES[tileShade]);
  var topRow = shade(interior, 1.06);
  var bottomRow = shade(interior, 0.92);
  var edgeColor = shade(base, EDGE_SHADES[pickStep(hashNoise(tileX, tileY, 13, 41), 3)]);
  for (var dy = -2; dy <= 2; dy++) {
    for (var dx = -5; dx <= 5; dx++) {
      if (!renderer.inDiamond(dx, dy, TILE_DIAMOND_HALF_W, TILE_DIAMOND_HALF_H)) continue;
      var glyphNoise = hashNoise(tileX * 7 + 13, tileY * 5 + 3, dx + 8, dy + 8);
      var edge = Math.abs(dx) >= 4 || dy !== 0;
      var glyph = edge ? rampIndexAt(0.09 + glyphNoise * 0.07) : rampIndexAt(0.28 + glyphNoise * 0.24);
      var color = edge ? edgeColor : (dy === -1 ? topRow : dy === 1 ? bottomRow : interior);
      renderer.plot(cx + dx, cy + dy, glyph, color);
    }
  }
}

// --- walls -------------------------------------------------------------------
// Glyph variety is free; only colour breaks runs. So the faces pick a glyph per
// cell for texture but a shade from a four step ramp.
function quadPaint(color, seedA, seedB, steps, glyphs) {
  return function (x, y) {
    var glyphNoise = hashNoise(seedA + x, seedB + y, 3, 7);
    // shade from a COARSE grid (2x2 cell blocks), so runs stay long
    var shadeNoise = hashNoise(seedA + ((x / 2) | 0), seedB + ((y / 2) | 0), 23, 41);
    var index = pickStep(glyphNoise, glyphs.length);
    return {
      glyph: glyphIndex(glyphs[index]),
      color: shade(color, 0.80 + pickStep(shadeNoise, steps) * 0.12)
    };
  };
}

function drawWallBlock(renderer, centerX, centerY, variant) {
  var cx = Math.round(centerX);
  var cy = Math.round(centerY);
  var halfW = TILE_DIAMOND_HALF_W;
  var halfH = TILE_DIAMOND_HALF_H;
  var h = WALL_HEIGHT_CELLS;

  // side faces first, so the top diamond overwrites its own seams
  renderer.fillPolygon([
    [cx - halfW, cy - halfH], [cx, cy], [cx, cy - h], [cx - halfW, cy - halfH - h]
  ], quadPaint(PALETTE.wallLeft, cx * 3, cy * 5, 4, ["▒", "▒", "░", "▓"]));
  renderer.fillPolygon([
    [cx, cy], [cx + halfW, cy - halfH], [cx + halfW, cy - halfH - h], [cx, cy - h]
  ], quadPaint(PALETTE.wallRight, cx * 7, cy * 11, 3, ["▓", "▓", "▒", "▓"]));

  // the vertical mortar seam between the two faces
  renderer.strokeLine(cx, cy - 1, cx, cy - h, glyphIndex("│"), PALETTE.mortar);

  // top diamond
  for (var dy = -2; dy <= 2; dy++) {
    for (var dx = -5; dx <= 5; dx++) {
      if (!renderer.inDiamond(dx, dy, halfW, halfH)) continue;
      var noise = hashNoise(cx + dx, cy + dy, 5, 9);
      var shadeNoise = hashNoise(cx + ((dx / 2) | 0), cy + ((dy / 2) | 0), 29, 13);
      var glyph = rampIndexAt(0.26 + noise * 0.34);
      renderer.plot(cx + dx, cy - h + dy, glyph, shade(PALETTE.wallTop, 0.86 + pickStep(shadeNoise, 4) * 0.09));
    }
  }
}

function drawPillar(renderer, centerX, centerY) {
  var cx = Math.round(centerX);
  var cy = Math.round(centerY);
  var h = WALL_HEIGHT_CELLS + 1;
  renderer.fillPolygon([
    [cx - 2, cy], [cx, cy - 1], [cx, cy - 1 - h], [cx - 2, cy - h]
  ], quadPaint(PALETTE.wallLeft, cx * 13, cy * 17, 3, ["▒", "░", "▒"]));
  renderer.fillPolygon([
    [cx, cy - 1], [cx + 2, cy], [cx + 2, cy - h], [cx, cy - 1 - h]
  ], quadPaint(PALETTE.wallRight, cx * 19, cy * 23, 3, ["▓", "▒", "▓"]));
  renderer.text(cx - 1, cy - 1 - h, "_", PALETTE.wallTop);
  renderer.text(cx, cy - 1 - h, "_", PALETTE.wallTop);
  renderer.text(cx + 1, cy - 1 - h, "_", PALETTE.wallTop);
}

// --- entities ----------------------------------------------------------------
function drawHero(renderer, centerX, centerY) {
  var cx = Math.round(centerX);
  var cy = Math.round(centerY);
  renderer.fillPolygon([
    [cx - 1, cy - 5], [cx + 1, cy - 5], [cx + 2, cy], [cx - 2, cy]
  ], function (x, y) {
    return { glyph: glyphIndex("▓"), color: y >= cy - 1 ? PALETTE.heroCloakDark : PALETTE.heroCloak };
  });
  renderer.text(cx - 2, cy - 4, "▐", PALETTE.heroCloak);
  renderer.text(cx + 2, cy - 4, "▌", PALETTE.heroCloakDark);
  renderer.text(cx - 1, cy - 1, "=", PALETTE.heroTrim);
  renderer.text(cx, cy - 1, "=", PALETTE.heroTrim);
  renderer.text(cx, cy - 6, "@", PALETTE.skin);
  renderer.strokeLine(cx + 2, cy - 3, cx + 4, cy - 7, glyphIndex("/"), PALETTE.steel);
  renderer.plot(cx + 2, cy - 5, glyphIndex("|"), PALETTE.iron);
}

function drawMonster(renderer, centerX, centerY, seed) {
  var cx = Math.round(centerX);
  var cy = Math.round(centerY);
  renderer.fillPolygon([
    [cx - 2, cy - 2], [cx + 2, cy - 2], [cx + 2, cy], [cx - 2, cy]
  ], function (x, y) {
    return { glyph: glyphIndex("▒"), color: PALETTE.creature };
  });
  renderer.text(cx - 1, cy - 3, "▓", PALETTE.creature);
  renderer.text(cx, cy - 3, "▓", PALETTE.creature);
  renderer.text(cx, cy - 4, "▓", PALETTE.creatureDark);
  renderer.plot(cx - 1, cy - 3, glyphIndex(","), PALETTE.eye);
  renderer.plot(cx, cy - 3, glyphIndex(","), PALETTE.eye);
}

function drawTorch(renderer, centerX, centerY) {
  var cx = Math.round(centerX);
  var cy = Math.round(centerY);
  renderer.text(cx, cy - 3, "│", PALETTE.iron);
  renderer.plot(cx, cy - 4, glyphIndex("*"), PALETTE.fire);
  renderer.plot(cx, cy - 5, glyphIndex("°"), PALETTE.fireCore);
  glow(renderer, cx, cy - 4, 6, PALETTE.fire);
}

function drawBones(renderer, centerX, centerY, tileX, tileY) {
  var cx = Math.round(centerX);
  var cy = Math.round(centerY);
  renderer.plot(cx, cy, glyphIndex(","), PALETTE.bone);
  renderer.plot(cx + 1, cy, glyphIndex(","), PALETTE.bone);
  if (hashNoise(tileX, tileY, 1, 1) > 0.5) renderer.plot(cx - 1, cy, glyphIndex("'"), PALETTE.bone);
}

function drawRubble(renderer, centerX, centerY, tileX, tileY) {
  var cx = Math.round(centerX);
  var cy = Math.round(centerY);
  for (var i = -2; i <= 2; i++) {
    if (hashNoise(tileX, tileY, i + 5, 2) < 0.45) continue;
    renderer.plot(cx + i, cy + (i % 2), glyphIndex("."), PALETTE.floorEdge);
  }
}

function drawWater(renderer, centerX, centerY) {
  var cx = Math.round(centerX);
  var cy = Math.round(centerY);
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -3; dx <= 3; dx++) {
      if (!renderer.inDiamond(dx, dy, 3, 1)) continue;
      renderer.plot(cx + dx, cy + dy, rampIndexAt(0.12), PALETTE.water);
    }
  }
}

// A colour wash that only touches cells still empty: light spills around a torch
// without erasing whatever the world already drew.
function glow(renderer, cx, cy, radius, color) {
  for (var dy = -radius; dy <= radius; dy++) {
    for (var dx = -radius * 2; dx <= radius * 2; dx++) {
      var d = Math.sqrt((dx / 2) * (dx / 2) + dy * dy);
      if (d > radius) continue;
      var x = cx + dx;
      var y = cy + dy;
      if (renderer.glyphAt(x, y) !== SPACE_INDEX) continue;
      var strength = 1 - d / radius;
      if (strength < 0.25) continue;
      var glyph = rampIndexAt(strength * 0.22);
      if (glyph === SPACE_INDEX) continue;
      renderer.plot(x, y, glyph, shade(color, 0.25 + strength * 0.35));
    }
  }
}

// --- cursor ------------------------------------------------------------------
function drawCursor(renderer, centerX, centerY, blocked) {
  var cx = Math.round(centerX);
  var cy = Math.round(centerY);
  var color = blocked ? PALETTE.cursorBlocked : PALETTE.cursor;
  var halfW = TILE_DIAMOND_HALF_W;
  var halfH = TILE_DIAMOND_HALF_H;
  for (var dy = -2; dy <= 2; dy++) {
    for (var dx = -5; dx <= 5; dx++) {
      if (!renderer.inDiamond(dx, dy, halfW, halfH)) continue;
      if (renderer.inDiamond(dx, dy, halfW - 1, halfH - 0.4)) continue;
      renderer.plot(cx + dx, cy + dy, glyphIndex(dx < 0 ? "/" : dx > 0 ? "\\" : "_"), color);
    }
  }
}
