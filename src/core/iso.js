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

// LATTICE_QUANTUM cells of camera movement between two content rebuilds. The
// content is generated for this coarse anchor and the SUB-CELL remainder is
// applied as a CSS transform, so walking does not rewrite the grid: at 10 cells
// per tile and 4.2 tiles/s the screen scrolls ~42 cells/s, and rebuilding the
// whole grid 42 times per second was 5.5 MB/s of HTML (measured).
var LATTICE_QUANTUM = 8;
var LATTICE_BLEED = LATTICE_QUANTUM / 2;   // extra cells kept off screen

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
