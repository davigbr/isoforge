// Combat: the machinery, not the numbers. A game supplies stats and this module
// answers three questions -- did the blow land, how much did it take, and when.
//
// Three things here are load-bearing:
//
//   - A swing lands EXACTLY ONE blow, at the boundary between windup and hit.
//     Firing once per tick would multiply the damage by the length of the phase, and
//     the bug would only show up as "monsters die too fast".
//   - Phases are counted in TICKS, not milliseconds. The engine runs a fixed step, so
//     ticks are the only unit that replays identically; seconds would depend on how
//     many steps a frame happened to run.
//   - Damage is whole numbers. A blow that drops hp to zero has to drop it by an
//     integer, and rounding at the end (not in the middle) keeps a chain of
//     modifiers from drifting.
//
// Attack timing is what gives a Diablo-like its weight (windup, hit, recovery), so it
// lives here rather than in the game: it is the part that must not differ per game.

var SWING_IDLE = "idle";
var SWING_WINDUP = "windup";
var SWING_HIT = "hit";
var SWING_RECOVERY = "recovery";

function createSwing(spec) {
  spec = spec || {};
  return {
    windup: Math.max(1, spec.windup || 8),
    hit: Math.max(1, spec.hit === undefined ? 2 : spec.hit),
    recovery: Math.max(1, spec.recovery || 10),
    // Waiting between blows. Bearable for the player and cheap to test: a swing
    // cannot start while this is positive.
    cooldown: Math.max(0, spec.cooldown === undefined ? 16 : spec.cooldown),
    ticks: 0,
    phase: SWING_IDLE,
    fired: false,
    ready: 0
  };
}

function totalSwingTicks(swing) {
  return swing.windup + swing.hit + swing.recovery;
}

// Progress through the whole swing in 0..1: what an animation reads. Kept here (and
// not recomputed by the art) so the picture and the blow cannot disagree about when
// the hit happens.
function swingProgress(swing) {
  if (swing.phase === SWING_IDLE) return 0;
  var total = totalSwingTicks(swing);
  return Math.min(1, swing.ticks / total);
}

function beginSwing(swing) {
  if (swing.phase !== SWING_IDLE || swing.ready > 0) return false;
  swing.ticks = 0;
  swing.phase = SWING_WINDUP;
  swing.fired = false;
  return true;
}

// Advance one tick. Returns "hit" on the single tick the blow lands, else null.
function stepSwing(swing) {
  if (swing.phase === SWING_IDLE) {
    if (swing.ready > 0) swing.ready--;
    return null;
  }
  swing.ticks++;
  var was = swing.phase;
  var total = totalSwingTicks(swing);
  if (swing.ticks <= swing.windup) swing.phase = SWING_WINDUP;
  else if (swing.ticks <= swing.windup + swing.hit) swing.phase = SWING_HIT;
  else if (swing.ticks <= total) swing.phase = SWING_RECOVERY;
  else {
    swing.phase = SWING_IDLE;
    swing.ready = swing.cooldown;
    return null;
  }
  if (swing.phase === SWING_HIT && was !== SWING_HIT && !swing.fired) {
    swing.fired = true;
    return "hit";
  }
  return null;
}

// One place where a number becomes damage. Order is fixed and documented: roll the
// base range, add flat bonuses, apply multiplicative modifiers, then the target's
// resistance, then round once. The rng is required -- damage with no roll is a
// constant, and a constant hides every bug that a spread would expose.
function rollDamage(spec, rng) {
  var min = spec.min === undefined ? 1 : spec.min;
  var max = spec.max === undefined ? min : spec.max;
  var base = min + Math.floor(rng() * (max - min + 1));
  var total = base + (spec.add || 0);
  var mods = spec.mods || [];
  for (var i = 0; i < mods.length; i++) total *= mods[i];
  if (spec.resist) total *= (1 - spec.resist);
  var out = Math.round(total);
  return out < 1 ? 1 : out;
}

// A landed blow always takes at least one point and never more than what is left:
// overkill would make a kill depend on the exact hp, which the save has to round.
function applyDamage(stats, amount) {
  if (stats.hp <= 0) return { damage: 0, killed: false, hp: 0 };
  var dealt = Math.min(stats.hp, amount);
  stats.hp -= dealt;
  return { damage: dealt, killed: stats.hp <= 0, hp: stats.hp };
}

// Reach plus line of sight: a blow does not go through a wall. Both halves are
// needed -- range alone lets a player hit through a corner.
function inReach(attacker, target, range, grid) {
  var reach = range + (attacker.radius || 0) + (target.radius || 0);
  var dx = target.x - attacker.x;
  var dy = target.y - attacker.y;
  if (dx * dx + dy * dy > reach * reach) return false;
  if (grid && !hasLineOfSight(grid, attacker.x, attacker.y, target.x, target.y)) return false;
  return true;
}

// What a game asks before drawing the swing: which side the body turns to. Screen
// sides, not world sides: the projection maps world diagonals onto the screen axes,
// so "left" means the world direction (+y, -x) and the art mirrors on that.
function facingFor(attacker, target) {
  var dx = target.x - attacker.x;
  var dy = target.y - attacker.y;
  var screenX = dx - dy;
  var screenY = dx + dy;
  if (Math.abs(screenX) >= Math.abs(screenY)) return screenX >= 0 ? 1 : -1;
  return screenY >= 0 ? 2 : 0;   // 2 = toward the viewer, 0 = away
}

// Uniform buckets over the tile grid. Every swing, pickup and AI tick asks "who is
// near me"; scanning the entity list per query is O(n) per query, which is O(n^2)
// per frame with a few hundred monsters -- the cost that turns a demo into a stall.
function createRegistry(bucketTiles) {
  var size = bucketTiles || 4;
  var cols = 0;
  var rows = 0;
  var buckets = [];
  var members = 0;

  function resize(grid) {
    var nextCols = Math.max(1, Math.ceil(grid.width / size));
    var nextRows = Math.max(1, Math.ceil(grid.height / size));
    if (nextCols === cols && nextRows === rows) return;
    cols = nextCols;
    rows = nextRows;
    buckets = [];
    for (var i = 0; i < cols * rows; i++) buckets.push([]);
  }

  function clear() {
    for (var i = 0; i < buckets.length; i++) buckets[i].length = 0;
    members = 0;
  }

  function add(entity) {
    var bx = Math.floor(entity.x / size);
    var by = Math.floor(entity.y / size);
    if (bx < 0 || by < 0 || bx >= cols || by >= rows) return;
    buckets[by * cols + bx].push(entity);
    members++;
  }

  // Rebuilt every frame from the live entity list: O(n), and it cannot go stale. Pass
  // `out` to reuse an array and keep the frame allocation-free.
  function rebuild(entities) {
    clear();
    for (var i = 0; i < entities.length; i++) add(entities[i]);
  }

  function query(x, y, radius, out) {
    out = out || [];
    out.length = 0;
    var x0 = Math.max(0, Math.floor((x - radius) / size));
    var x1 = Math.min(cols - 1, Math.floor((x + radius) / size));
    var y0 = Math.max(0, Math.floor((y - radius) / size));
    var y1 = Math.min(rows - 1, Math.floor((y + radius) / size));
    var r2 = radius * radius;
    for (var by = y0; by <= y1; by++) {
      for (var bx = x0; bx <= x1; bx++) {
        var bucket = buckets[by * cols + bx];
        for (var i = 0; i < bucket.length; i++) {
          var e = bucket[i];
          var dx = e.x - x;
          var dy = e.y - y;
          if (dx * dx + dy * dy <= r2) out.push(e);
        }
      }
    }
    return out;
  }

  return {
    resize: resize,
    clear: clear,
    rebuild: rebuild,
    query: query,
    members: function () { return members; },
    bucketCount: function () { return cols * rows; },
    bucketSize: function () { return size; }
  };
}
