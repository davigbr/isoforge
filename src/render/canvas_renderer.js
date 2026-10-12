// Canvas 2D renderer behind a stable contract: drawTile / drawSprite / flush.
// A WebGL2 backend would implement the same four calls and nothing else in the
// engine would change.
//
// Draw order: floors -> shadows -> [sprites + wall blocks sorted by depth].
// The painter's algorithm key is (x + y) with x as the tie breaker, which is
// correct for a uniform 2:1 grid.

function createCanvasRenderer(canvas) {
  var ctx = canvas.getContext("2d", { alpha: false });
  ctx.imageSmoothingEnabled = false;
  var atlas = buildPlaceholderAtlas();
  var viewportWidth = 0;
  var viewportHeight = 0;
  var pool = [];
  var active = [];
  var cameraRef = null;

  for (var i = 0; i < 8192; i++) {
    pool.push({ depth: 0, tie: 0, sx: 0, sy: 0, imageX: 0, imageY: 0, image: null, offsetY: 0 });
  }

  var stats = {
    tilesDrawn: 0, blocksDrawn: 0, shadowsDrawn: 0, spritesDrawn: 0,
    drawables: 0, bounds: null, viewport: null, sortMs: 0
  };

  function resize(cssWidth, cssHeight, devicePixelRatio) {
    setRenderScale(devicePixelRatio);
    canvas.width = Math.round(cssWidth * RENDER_SCALE);
    canvas.height = Math.round(cssHeight * RENDER_SCALE);
    canvas.style.width = cssWidth + "px";
    canvas.style.height = cssHeight + "px";
    viewportWidth = canvas.width;
    viewportHeight = canvas.height;
    ctx.imageSmoothingEnabled = false;
    stats.viewport = { w: viewportWidth, h: viewportHeight, scale: RENDER_SCALE };
  }

  function anchorX(worldX, worldY) {
    return worldToScreenX(worldX, worldY) - worldToScreenX(cameraRef.x, cameraRef.y) + viewportWidth / 2;
  }
  function anchorY(worldX, worldY) {
    return worldToScreenY(worldX, worldY) - worldToScreenY(cameraRef.x, cameraRef.y) + viewportHeight / 2;
  }

  function push(depth, tie, image, x, y, offsetY) {
    if (active.length >= pool.length) return;
    var slot = pool[active.length];
    slot.depth = depth;
    slot.tie = tie;
    slot.image = image;
    slot.sx = Math.round(x);
    slot.sy = Math.round(y + (offsetY || 0));
    active.push(slot);
  }

  function scale() { return RENDER_SCALE; }

  function drawImageAt(image, x, y) {
    ctx.drawImage(
      image,
      Math.round(x), Math.round(y),
      image.width * scale(), image.height * scale()
    );
  }

  function beginFrame(camera) {
    cameraRef = camera;
    active.length = 0;
    stats.tilesDrawn = 0;
    stats.blocksDrawn = 0;
    stats.shadowsDrawn = 0;
    stats.spritesDrawn = 0;
    ctx.fillStyle = "#070605";
    ctx.fillRect(0, 0, viewportWidth, viewportHeight);
  }

  // Floors go straight out; walls are queued so entities can be occluded.
  function drawGround(grid, camera) {
    var bounds = visibleTileBounds(camera.x, camera.y, viewportWidth, viewportHeight, 2);
    stats.bounds = bounds;
    for (var ty = bounds.y0; ty <= bounds.y1; ty++) {
      for (var tx = bounds.x0; tx <= bounds.x1; tx++) {
        if (tx < 0 || ty < 0 || tx >= grid.width || ty >= grid.height) continue;
        var ax = anchorX(tx + 0.5, ty + 0.5);
        var ay = anchorY(tx + 0.5, ty + 0.5);
        if (grid.walkable[ty * grid.width + tx]) {
          var tile = atlas.floors[grid.floorVariant(tx, ty)];
          drawImageAt(tile, ax - TILE_W / 2, ay - TILE_H / 2);
          stats.tilesDrawn++;
        } else {
          push(tx + ty + 1, tx, atlas.wall, ax - TILE_W / 2, ay - TILE_H - TILE_H / 2);
          stats.blocksDrawn++;
        }
      }
    }
  }

  function drawGroundCursor(worldX, worldY, blocked) {
    var ax = anchorX(worldX, worldY);
    var ay = anchorY(worldX, worldY);
    drawImageAt(blocked ? atlas.cursorBlocked : atlas.cursor, ax - TILE_W / 2, ay - TILE_H / 2);
  }

  // Shadow is flat on the floor, so it is painted immediately (it can never
  // occlude anything); only the body enters the depth sort.
  function submitEntity(kind, prevX, prevY, x, y, alpha) {
    var ix = prevX + (x - prevX) * alpha;
    var iy = prevY + (y - prevY) * alpha;
    var ax = anchorX(ix, iy);
    var ay = anchorY(ix, iy);
    var sprite = atlas.sprites[kind] || atlas.sprites.wanderer;
    drawImageAt(atlas.shadow, ax - atlas.shadow.width / 2, ay - atlas.shadow.height / 2 + 2);
    stats.shadowsDrawn++;
    push(ix + iy, ix, sprite, ax - sprite.width / 2, ay - sprite.height + 3, 0);
    stats.spritesDrawn++;
  }

  function flush() {
    var started = performance.now();
    active.sort(function (a, b) {
      if (a.depth === b.depth) return a.tie - b.tie;
      return a.depth - b.depth;
    });
    stats.sortMs = performance.now() - started;
    for (var i = 0; i < active.length; i++) {
      var slot = active[i];
      drawImageAt(slot.image, slot.sx, slot.sy);
    }
    stats.drawables = active.length;
  }

  return {
    resize: resize,
    beginFrame: beginFrame,
    drawGround: drawGround,
    drawGroundCursor: drawGroundCursor,
    submitEntity: submitEntity,
    flush: flush,
    stats: stats,
    atlas: atlas,
    viewportWidth: function () { return viewportWidth; },
    viewportHeight: function () { return viewportHeight; },
    context: ctx
  };
}
