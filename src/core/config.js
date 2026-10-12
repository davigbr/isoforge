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

var ENGINE_VERSION = "0.4.0";

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
