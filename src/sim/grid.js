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
