// Tile grid: walkable bitmap, tile queries, connectivity. The generator here is
// a cellular-automaton cave (phase 0 placeholder); rooms and corridors land in
// task T10.

var GRID_VERSION = 1;

function createGrid(seed, width, height) {
  var rng = createRng(seed);
  var wall = new Uint8Array(width * height);

  for (var i = 0; i < wall.length; i++) wall[i] = rng() < 0.45 ? 1 : 0;

  for (var pass = 0; pass < 4; pass++) {
    var next = new Uint8Array(width * height);
    for (var y = 0; y < height; y++) {
      for (var x = 0; x < width; x++) {
        var neighbours = 0;
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            var nx = x + dx;
            var ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) { neighbours++; continue; }
            neighbours += wall[ny * width + nx];
          }
        }
        next[y * width + x] = neighbours > 4 ? 1 : 0;
      }
    }
    wall = next;
  }

  var walkable = new Uint8Array(width * height);
  for (var j = 0; j < walkable.length; j++) walkable[j] = wall[j] ? 0 : 1;

  // Solid border: keeps the camera clamp and the culling tests simple.
  for (var bx = 0; bx < width; bx++) {
    walkable[bx] = 0;
    walkable[(height - 1) * width + bx] = 0;
  }
  for (var by = 0; by < height; by++) {
    walkable[by * width] = 0;
    walkable[by * width + width - 1] = 0;
  }

  var kept = keepLargestRegion(walkable, width, height);

  return {
    version: GRID_VERSION,
    seed: seed,
    width: width,
    height: height,
    walkable: walkable,
    keepLargestRegion: kept,
    isWalkableAt: function (x, y) {
      var tx = Math.floor(x);
      var ty = Math.floor(y);
      if (tx < 0 || ty < 0 || tx >= width || ty >= height) return false;
      return walkable[ty * width + tx] === 1;
    },
    isWalkableTile: function (tx, ty) {
      if (tx < 0 || ty < 0 || tx >= width || ty >= height) return false;
      return walkable[ty * width + tx] === 1;
    },
    // Deterministic floor variant: no storage, no rng order dependency.
    floorVariant: function (tx, ty) { return (tx * 7 + ty * 13) % 4; },
    countWalkable: function () {
      var total = 0;
      for (var k = 0; k < walkable.length; k++) total += walkable[k];
      return total;
    }
  };
}

// Flood fill from the largest region; every other pocket becomes wall, so a
// spawn can never end up sealed. Returns how many cells survived.
function keepLargestRegion(walkable, width, height) {
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
