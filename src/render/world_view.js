// Walks the visible tiles and paints them into the character grid: floors first,
// then walls, props and entities in painter's order (x + y, tie broken by x) --
// the phase 0 draw order, now in cells.
//
// The per-tile visibility test is the SAME function the audit calls, so the
// number of tiles drawn and the number of tiles that geometrically touch the
// viewport have to come out identical.

function createWorldView(renderer) {
  var pool = [];
  for (var i = 0; i < 8192; i++) {
    pool.push({ depth: 0, tie: 0, kind: 0, tileX: 0, tileY: 0, cx: 0, cy: 0, variant: 0 });
  }
  var active = [];
  var stats = {
    iterated: 0, culled: 0, tilesDrawn: 0, blocksDrawn: 0, propsDrawn: 0,
    spritesDrawn: 0, drawables: 0, bounds: null, sortMs: 0
  };
  var KIND_PROP = 1;
  var KIND_WALL = 2;
  var KIND_ENTITY = 3;

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
    active.push(slot);
  }

  function draw(sim, camera, alpha, hoveredTile) {
    var metrics = renderer.metrics();
    var cols = metrics.cols;
    var rows = metrics.rows;
    var grid = sim.grid;
    var bounds = visibleTileBounds(camera.x, camera.y, cols, rows, 2);
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
        var center = tileCenterCell(tx + 0.5, ty + 0.5, camera, cols, rows);
        var variant = grid.floorVariant(tx, ty);
        if (grid.walkable[ty * grid.width + tx]) {
          drawFloorTile(renderer, tx, ty, variant, center.x, center.y);
          stats.tilesDrawn++;
          var prop = propKindFor(tx, ty);
          if (prop) {
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

    for (var e = 0; e < sim.entities.length; e++) {
      var entity = sim.entities[e];
      var ix = entity.prevX + (entity.x - entity.prevX) * alpha;
      var iy = entity.prevY + (entity.y - entity.prevY) * alpha;
      var cell = tileCenterCell(ix, iy, camera, cols, rows);
      push(ix + iy, ix, KIND_ENTITY, e, 0, cell.x, cell.y, entity.kind === "player" ? 0 : 1);
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
        drawWallBlock(renderer, item.cx, item.cy, item.variant);
      } else if (item.kind === KIND_PROP) {
        if (item.prop === "pillar") drawPillar(renderer, item.cx, item.cy);
        else if (item.prop === "torch") drawTorch(renderer, item.cx, item.cy);
        else if (item.prop === "bones") drawBones(renderer, item.cx, item.cy, item.tileX, item.tileY);
        else if (item.prop === "water") drawWater(renderer, item.cx, item.cy);
        else drawRubble(renderer, item.cx, item.cy, item.tileX, item.tileY);
      } else {
        var who = sim.entities[item.tileX];
        if (who.kind === "player") drawHero(renderer, item.cx, item.cy);
        else drawMonster(renderer, item.cx, item.cy, who.index);
      }
    }
    stats.drawables = active.length;

    if (hoveredTile && hoveredTile.inside) {
      var hover = tileCenterCell(hoveredTile.x + 0.5, hoveredTile.y + 0.5, camera, cols, rows);
      drawCursor(renderer, hover.x, hover.y, !hoveredTile.walkable);
    }
  }

  return { draw: draw, stats: stats };
}

// Decor per tile: deterministic, no state, so the crypt is reproducible.
function propKindFor(tx, ty) {
  var n = hashNoise(tx, ty, 11, 13);
  if (n > 0.985) return "torch";
  if (n > 0.955) return "pillar";
  if (n > 0.930) return "bones";
  if (n > 0.912) return "water";
  if (n > 0.870) return "rubble";
  return null;
}
