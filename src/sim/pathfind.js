// Pathfinding on the tile grid: A* with integer costs, plus the line-of-sight test
// that both the route smoothing and (later) ranged attacks need.
//
// Why integer costs: floats make two different routes compare equal by accident,
// and the engine promises that the same grid and the same endpoints always produce
// the same route (the audit checks it). Straight step = 1000, diagonal = 1414 (the
// integer form of sqrt(2) * 1000), so every comparison is exact.
//
// Why the search runs on command and not per frame: it is called when the player
// clicks, so a per-call scratch allocation is free in practice. Nothing here may
// touch the frame budget.
//
// Kept out of `actor`: movement is "how do I get there", pathfinding is "where do
// I go", and a game may want the second without the first (turn-based, AI planning).

var PATH_VERSION = 1;
var PATH_MAX_NODES = 4000;
var PATH_STRAIGHT = 1000;
var PATH_DIAGONAL = 1414;

var PATH_NEIGHBOURS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1]
];

function pathTileOf(grid, x, y) {
  return {
    x: Math.max(0, Math.min(grid.width - 1, Math.floor(x))),
    y: Math.max(0, Math.min(grid.height - 1, Math.floor(y)))
  };
}

// Nearest walkable tile, searched in rings so the result is stable: clicking a wall
// walks you to the floor beside it, which is what the player expects.
function nearestWalkable(grid, tx, ty, maxRadius) {
  if (grid.isWalkableTile(tx, ty)) return { x: tx, y: ty };
  var limit = maxRadius === undefined ? 8 : maxRadius;
  for (var r = 1; r <= limit; r++) {
    for (var dy = -r; dy <= r; dy++) {
      for (var dx = -r; dx <= r; dx++) {
        // Ring only: skip what an inner ring already covered.
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        var nx = tx + dx;
        var ny = ty + dy;
        if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
        if (grid.isWalkableTile(nx, ny)) return { x: nx, y: ny };
      }
    }
  }
  return null;
}

// Can a straight line go from one tile centre to another without crossing a wall?
// Diagonals are rejected when both orthogonal neighbours are blocked, which is the
// conservative side of the corner-cutting question: better to route around than to
// clip a corner the body cannot pass.
function hasLineOfSight(grid, ax, ay, bx, by) {
  var x0 = Math.floor(ax);
  var y0 = Math.floor(ay);
  var x1 = Math.floor(bx);
  var y1 = Math.floor(by);
  var dx = Math.abs(x1 - x0);
  var dy = Math.abs(y1 - y0);
  var sx = x0 < x1 ? 1 : -1;
  var sy = y0 < y1 ? 1 : -1;
  var x = x0;
  var y = y0;
  if (!grid.isWalkableTile(x, y) || !grid.isWalkableTile(x1, y1)) return false;
  var guard = 0;
  while ((x !== x1 || y !== y1) && guard++ < 4096) {
    if (dx > dy) {
      x += sx;
      if (dx !== dy && !grid.isWalkableTile(x, y)) return false;
      if (dx === dy && !grid.isWalkableTile(x, y - sy)) return false;
    } else if (dy > dx) {
      y += sy;
      if (dx !== dy && !grid.isWalkableTile(x, y)) return false;
      if (dx === dy && !grid.isWalkableTile(x - sx, y)) return false;
    } else {
      if (!grid.isWalkableTile(x + sx, y) || !grid.isWalkableTile(x, y + sy)) return false;
      x += sx;
      y += sy;
    }
    if (!grid.isWalkableTile(x, y)) return false;
  }
  return true;
}

// Binary heap keyed on (f, id): the id tie-break is what makes the route stable
// across runs when two nodes cost exactly the same.
function createHeap() {
  var items = [];
  function less(a, b) { return a.f === b.f ? a.id < b.id : a.f < b.f; }
  return {
    size: function () { return items.length; },
    push: function (item) {
      items.push(item);
      var i = items.length - 1;
      while (i > 0) {
        var parent = (i - 1) >> 1;
        if (less(items[i], items[parent])) {
          var swap = items[i]; items[i] = items[parent]; items[parent] = swap;
          i = parent;
        } else break;
      }
    },
    pop: function () {
      var top = items[0];
      var last = items.pop();
      if (items.length) {
        items[0] = last;
        var i = 0;
        for (;;) {
          var l = 2 * i + 1;
          var r = l + 1;
          var best = i;
          if (l < items.length && less(items[l], items[best])) best = l;
          if (r < items.length && less(items[r], items[best])) best = r;
          if (best === i) break;
          var swap = items[i]; items[i] = items[best]; items[best] = swap;
          i = best;
        }
      }
      return top;
    }
  };
}

// A* over tiles. Returns tile-centre waypoints, with the exact requested point as
// the last one when the request itself was walkable (so the body stops where the
// player clicked, not at the centre of the tile).
function findPath(grid, fromX, fromY, toX, toY, options) {
  options = options || {};
  var allowDiagonal = options.allowDiagonal !== false;
  var smooth = options.smooth !== false;
  var maxNodes = options.maxNodes || PATH_MAX_NODES;
  var width = grid.width;
  var size = width * grid.height;

  var start = pathTileOf(grid, fromX, fromY);
  var requested = pathTileOf(grid, toX, toY);
  var goal = requested;
  var snapped = false;
  if (!grid.isWalkableTile(goal.x, goal.y)) {
    var near = nearestWalkable(grid, goal.x, goal.y, options.snapRadius === undefined ? 8 : options.snapRadius);
    if (!near) return { found: false, points: [], reason: "goal blocked" };
    goal = near;
    snapped = true;
  }
  if (!grid.isWalkableTile(start.x, start.y)) {
    var from = nearestWalkable(grid, start.x, start.y, 8);
    if (!from) return { found: false, points: [], reason: "start blocked" };
    start = from;
  }

  var gScore = new Int32Array(size).fill(0x7fffffff);
  var cameFrom = new Int32Array(size).fill(-1);
  var closed = new Uint8Array(size);
  var startId = start.y * width + start.x;
  var goalId = goal.y * width + goal.x;

  function heuristic(x, y) {
    var dx = Math.abs(x - goal.x);
    var dy = Math.abs(y - goal.y);
    var min = dx < dy ? dx : dy;
    var max = dx < dy ? dy : dx;
    return PATH_DIAGONAL * min + PATH_STRAIGHT * (max - min);
  }

  var open = createHeap();
  gScore[startId] = 0;
  open.push({ id: startId, x: start.x, y: start.y, g: 0, f: heuristic(start.x, start.y) });
  var expanded = 0;
  var found = false;
  var neighbours = allowDiagonal ? PATH_NEIGHBOURS.length : 4;

  while (open.size() > 0 && expanded < maxNodes) {
    var current = open.pop();
    if (closed[current.id]) continue;
    closed[current.id] = 1;
    expanded++;
    if (current.id === goalId) { found = true; break; }
    for (var n = 0; n < neighbours; n++) {
      var step = PATH_NEIGHBOURS[n];
      var nx = current.x + step[0];
      var ny = current.y + step[1];
      if (nx < 0 || ny < 0 || nx >= width || ny >= grid.height) continue;
      if (!grid.isWalkableTile(nx, ny)) continue;
      var diagonal = step[0] !== 0 && step[1] !== 0;
      if (diagonal && !options.cornerCut) {
        // No cutting between two blocked tiles: a body with width cannot pass.
        if (!grid.isWalkableTile(current.x + step[0], current.y) ||
            !grid.isWalkableTile(current.x, current.y + step[1])) continue;
      }
      var id = ny * width + nx;
      if (closed[id]) continue;
      var cost = current.g + (diagonal ? PATH_DIAGONAL : PATH_STRAIGHT);
      if (cost >= gScore[id]) continue;
      gScore[id] = cost;
      cameFrom[id] = current.id;
      open.push({ id: id, x: nx, y: ny, g: cost, f: cost + heuristic(nx, ny) });
    }
  }

  if (!found) {
    return { found: false, points: [], expanded: expanded, reason: "no route", snapped: snapped };
  }

  // Reconstruct goal -> start, then flip.
  var tiles = [];
  var walk = goalId;
  var guard = 0;
  while (walk !== -1 && guard++ < size) {
    tiles.push({ x: walk % width, y: Math.floor(walk / width) });
    walk = cameFrom[walk];
  }
  tiles.reverse();

  var points = [];
  if (smooth && tiles.length > 2) {
    // String pulling: keep a waypoint only when the next tile is not directly
    // visible from the last kept one.
    var kept = 0;
    points.push({ x: tiles[0].x + 0.5, y: tiles[0].y + 0.5 });
    for (var i = 1; i < tiles.length - 1; i++) {
      var anchor = tiles[kept];
      var candidate = tiles[i + 1];
      if (!hasLineOfSight(grid, anchor.x + 0.5, anchor.y + 0.5, candidate.x + 0.5, candidate.y + 0.5)) {
        points.push({ x: tiles[i].x + 0.5, y: tiles[i].y + 0.5 });
        kept = i;
      }
    }
    points.push({ x: tiles[tiles.length - 1].x + 0.5, y: tiles[tiles.length - 1].y + 0.5 });
  } else {
    for (var k = 0; k < tiles.length; k++) {
      points.push({ x: tiles[k].x + 0.5, y: tiles[k].y + 0.5 });
    }
  }

  // The exact click wins over the tile centre when the player aimed at open floor.
  if (!snapped && points.length) {
    points[points.length - 1] = { x: toX, y: toY };
  }
  return {
    found: true, points: points, expanded: expanded, snapped: snapped,
    tiles: tiles.length, start: start, goal: goal
  };
}

// A stable signature of a route, for the audit to compare two runs.
function pathSignature(points) {
  var h = 0x811c9dc5;
  for (var i = 0; i < points.length; i++) {
    h = Math.imul(h ^ Math.round(points[i].x * 1000), 0x01000193) >>> 0;
    h = Math.imul(h ^ Math.round(points[i].y * 1000), 0x01000193) >>> 0;
  }
  return ("0000000" + h.toString(16)).slice(-8);
}
