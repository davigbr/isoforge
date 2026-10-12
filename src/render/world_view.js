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
//     // pass cursor: false for no hover indicator at all -- a game whose selection
//     // lives on the entity itself does not want a second mark on the floor
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

    if (hoveredTile && hoveredTile.inside && art.cursor !== false) {
      var hover = tileCenterCellInLattice(hoveredTile.x + 0.5, hoveredTile.y + 0.5, lattice, cols, rows);
      if (art.cursor) art.cursor(renderer, hover.x, hover.y, !hoveredTile.walkable);
      else drawDefaultCursor(renderer, hover.x, hover.y, !hoveredTile.walkable, art);
    }
  }

  return { draw: draw, stats: stats };
}

// The engine's cursor: a diamond outline that follows the tile geometry, so a
// game gets a usable hover indicator without writing one. A game that wants its
// own passes art.cursor and this never runs; art.cursor === false disables the
// indicator entirely.
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
