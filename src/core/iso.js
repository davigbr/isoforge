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

var TILE_CELLS_W = 10;
var TILE_CELLS_H = 3;
var HALF_TILE_W = TILE_CELLS_W / 2;
var HALF_TILE_H = TILE_CELLS_H / 2;
var TILE_DIAMOND_HALF_W = 4.5;    // drawn footprint, in cells
var TILE_DIAMOND_HALF_H = 1.5;
var WALL_HEIGHT_CELLS = 4;

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

// Tile rectangle whose diamonds cover the viewport.
function visibleTileBounds(camX, camY, cols, rows, margin) {
  var ext = viewHalfExtents(cols, rows);
  margin = margin || 0;
  return {
    x0: Math.floor(camX - ext.x) - margin,
    y0: Math.floor(camY - ext.y) - margin,
    x1: Math.ceil(camX + ext.x) + margin,
    y1: Math.ceil(camY + ext.y) + margin
  };
}

function clampCamera(camera, gridW, gridH, cols, rows) {
  var ext = viewHalfExtents(cols, rows);
  camera.x = clamp(camera.x, ext.x - 0.5, gridW - 0.5 - ext.x);
  camera.y = clamp(camera.y, ext.y - 0.5, gridH - 0.5 - ext.y);
}

// Cell coordinates (fractional) of a world point on screen; the camera sits at
// the centre of the viewport.
function anchorCellX(worldX, worldY, camera, cols) {
  return worldToCellX(worldX, worldY) - worldToCellX(camera.x, camera.y) + cols / 2;
}
function anchorCellY(worldX, worldY, camera, rows) {
  return worldToCellY(worldX, worldY) - worldToCellY(camera.x, camera.y) + rows / 2;
}

// Centre of a tile's diamond in cell indices: half a cell shift so the diamond's
// centre lands on a cell centre rather than on a cell boundary.
function tileCenterCell(worldX, worldY, camera, cols, rows) {
  return {
    x: anchorCellX(worldX, worldY, camera, cols) - 0.5,
    y: anchorCellY(worldX, worldY, camera, rows) - 0.5
  };
}

// Screen cell -> world coordinates (exact inverse of the two above).
function cellToWorld(cellX, cellY, camera, cols, rows) {
  var cx = cellX - cols / 2 + worldToCellX(camera.x, camera.y);
  var cy = cellY - rows / 2 + worldToCellY(camera.x, camera.y);
  return { x: cellToWorldX(cx, cy), y: cellToWorldY(cx, cy) };
}

// Does the tile's diamond touch the viewport? Used by the culling audit; the
// renderer applies the same test per tile while walking the bounds rectangle.
function tileTouchesViewport(tileX, tileY, camX, camY, cols, rows) {
  var cx = worldToCellX(tileX + 0.5 - camX, tileY + 0.5 - camY);
  var cy = worldToCellY(tileX + 0.5 - camX, tileY + 0.5 - camY);
  return cx + TILE_DIAMOND_HALF_W > -cols / 2 && cx - TILE_DIAMOND_HALF_W < cols / 2
    && cy + TILE_DIAMOND_HALF_H > -rows / 2 && cy - TILE_DIAMOND_HALF_H < rows / 2;
}
