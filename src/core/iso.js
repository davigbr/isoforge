// Fixed 2:1 dimetric projection. The screen is NEVER rotated: one projection
// matrix, one tile orientation, for the whole life of the game.
//
//   screen.x = (world.x - world.y) * HALF_TILE_W * scale
//   screen.y = (world.x + world.y) * HALF_TILE_H * scale
//
// RENDER_SCALE is an integer so every art pixel maps to a whole number of
// device pixels (pixel art stays crisp on Retina).
var TILE_W = 64;
var TILE_H = 32;
var HALF_TILE_W = TILE_W / 2;
var HALF_TILE_H = TILE_H / 2;
var RENDER_SCALE = 1;

function setRenderScale(devicePixelRatio) {
  RENDER_SCALE = Math.max(1, Math.round(devicePixelRatio || 1));
}

function worldToScreenX(x, y) { return (x - y) * HALF_TILE_W * RENDER_SCALE; }
function worldToScreenY(x, y) { return (x + y) * HALF_TILE_H * RENDER_SCALE; }
function screenToWorldX(sx, sy) {
  return (sx / (HALF_TILE_W * RENDER_SCALE) + sy / (HALF_TILE_H * RENDER_SCALE)) / 2;
}
function screenToWorldY(sx, sy) {
  return (sy / (HALF_TILE_H * RENDER_SCALE) - sx / (HALF_TILE_W * RENDER_SCALE)) / 2;
}

function createCamera(x, y) {
  return { x: x, y: y };
}

// Half extents, in world tiles, of the viewport rectangle around the camera.
function viewHalfExtents(viewportW, viewportH) {
  var hx = viewportW / 2;
  var hy = viewportH / 2;
  return {
    x: (hx / (HALF_TILE_W * RENDER_SCALE) + hy / (HALF_TILE_H * RENDER_SCALE)) / 2,
    y: (hy / (HALF_TILE_H * RENDER_SCALE) + hx / (HALF_TILE_W * RENDER_SCALE)) / 2
  };
}

// Tile rectangle whose diamonds cover the viewport (viewport in device pixels).
function visibleTileBounds(camX, camY, viewportW, viewportH, margin) {
  var ext = viewHalfExtents(viewportW, viewportH);
  margin = margin || 0;
  return {
    x0: Math.floor(camX - ext.x) - margin,
    y0: Math.floor(camY - ext.y) - margin,
    x1: Math.ceil(camX + ext.x) + margin,
    y1: Math.ceil(camY + ext.y) + margin
  };
}

function clampCamera(camera, gridW, gridH, viewportW, viewportH) {
  var ext = viewHalfExtents(viewportW, viewportH);
  camera.x = clamp(camera.x, ext.x - 0.5, gridW - 0.5 - ext.x);
  camera.y = clamp(camera.y, ext.y - 0.5, gridH - 0.5 - ext.y);
}

// Screen point (device pixels) where the tile's diamond center lands.
function tileAnchorX(worldX, worldY, camX, camY, viewportW) {
  return (worldToScreenX(worldX, worldY) - worldToScreenX(camX, camY) + viewportW / 2) * 1;
}
function tileAnchorY(worldX, worldY, camX, camY, viewportH) {
  return (worldToScreenY(worldX, worldY) - worldToScreenY(camX, camY) + viewportH / 2) * 1;
}
