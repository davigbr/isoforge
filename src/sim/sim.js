// Simulation: the ONLY thing that advances state. Rendering never mutates it.
// One step = 1/60 s, and the same seed + the same input always produce the same
// state hash (that is what the audit checks).

var SIM_VERSION = 1;
var STEP_SECONDS = 1 / 60;
var PLAYER_SPEED = 4.2;      // tiles per second
var PLAYER_RADIUS = 0.3;
var WANDERER_PERIODS = [100, 120, 150, 200, 300, 600]; // every one divides 600

var WORLD_WIDTH = 64;
var WORLD_HEIGHT = 64;

function createSimulation(seed) {
  var rng = createRng(seed ^ 0x9e3779b9);
  var grid = createGrid(seed, WORLD_WIDTH, WORLD_HEIGHT);
  var entities = [];
  var tick = 0;
  var player = null;

  // --- player ---------------------------------------------------------
  var spawn = findOpenCell(grid, rng);
  player = {
    kind: "player",
    x: spawn.x, y: spawn.y, prevX: spawn.x, prevY: spawn.y,
    radius: PLAYER_RADIUS,
    homeX: spawn.x, homeY: spawn.y,
    targetX: null, targetY: null,
    blocked: false
  };
  entities.push(player);

  // --- wanderers ------------------------------------------------------
  // Determinism probes: they oscillate along a straight walkable segment with a
  // period that divides 600 steps, so step 600 has to equal step 0 exactly.
  for (var i = 0; i < 8; i++) {
    var home = findOpenCell(grid, rng);
    var direction = Math.floor(rng() * 4);
    var dirX = direction === 0 ? 1 : direction === 1 ? -1 : 0;
    var dirY = direction === 2 ? 1 : direction === 3 ? -1 : 0;
    var amplitude = 0;
    var candidate = 4.5;
    // Shrink the walk line until every sampled point is walkable.
    while (candidate >= 0.5) {
      var clear = true;
      for (var s = -4; s <= 4; s++) {
        var px = home.x + dirX * candidate * (s / 4);
        var py = home.y + dirY * candidate * (s / 4);
        if (!grid.isWalkableAt(px, py)) { clear = false; break; }
      }
      if (clear) { amplitude = candidate; break; }
      candidate -= 0.5;
    }
    entities.push({
      kind: "wanderer",
      index: i,
      x: home.x, y: home.y, prevX: home.x, prevY: home.y,
      radius: 0.28,
      homeX: home.x, homeY: home.y,
      dirX: dirX, dirY: dirY,
      amplitude: amplitude,
      period: WANDERER_PERIODS[i % WANDERER_PERIODS.length],
      facing: 0
    });
  }

  // Start every probe at its own tick-0 phase. Initializing at `home` instead
  // put the first simulated frame a whole amplitude away (a visible teleport on
  // frame 1) and made step N land on the opposite extreme, so the loop-closure
  // test could never pass.
  for (var w = 1; w < entities.length; w++) {
    var placed = wandererPosition(entities[w], 0);
    entities[w].x = placed.x;
    entities[w].y = placed.y;
    entities[w].prevX = placed.x;
    entities[w].prevY = placed.y;
  }

  var camera = createCamera(player.x, player.y);

  // --- helpers --------------------------------------------------------
  function canStand(x, y, radius) {
    return grid.isWalkableAt(x - radius, y - radius)
      && grid.isWalkableAt(x + radius, y - radius)
      && grid.isWalkableAt(x - radius, y + radius)
      && grid.isWalkableAt(x + radius, y + radius);
  }

  // Move with wall sliding: full step, then each axis alone.
  function moveWithCollision(entity, dx, dy) {
    if (dx === 0 && dy === 0) return false;
    if (canStand(entity.x + dx, entity.y + dy, entity.radius)) {
      entity.x += dx; entity.y += dy; return true;
    }
    if (dx !== 0 && canStand(entity.x + dx, entity.y, entity.radius)) {
      entity.x += dx; return true;
    }
    if (dy !== 0 && canStand(entity.x, entity.y + dy, entity.radius)) {
      entity.y += dy; return true;
    }
    return false;
  }

  function step(input) {
    tick++;
    input = input || {};

    var moveX = 0;
    var moveY = 0;

    if (input.moveX || input.moveY) {
      // Keyboard wins over a pending click target.
      moveX = input.moveX;
      moveY = input.moveY;
      player.targetX = null;
      player.targetY = null;
    } else if (player.targetX !== null) {
      var toX = player.targetX - player.x;
      var toY = player.targetY - player.y;
      var distance = Math.sqrt(toX * toX + toY * toY);
      if (distance < 0.12) {
        player.targetX = null;
        player.targetY = null;
      } else {
        moveX = toX / distance;
        moveY = toY / distance;
      }
    }

    player.prevX = player.x;
    player.prevY = player.y;
    if (moveX || moveY) {
      var moved = moveWithCollision(
        player,
        moveX * PLAYER_SPEED * STEP_SECONDS,
        moveY * PLAYER_SPEED * STEP_SECONDS
      );
      // Straight-line walking only (A* lands in T9): a wall clears the target
      // instead of grinding against it forever.
      player.blocked = !moved && player.targetX !== null;
      if (player.blocked) { player.targetX = null; player.targetY = null; }
    } else {
      player.blocked = false;
    }

    for (var i = 1; i < entities.length; i++) {
      var wanderer = entities[i];
      wanderer.prevX = wanderer.x;
      wanderer.prevY = wanderer.y;
      var placedNow = wandererPosition(wanderer, tick);
      wanderer.x = placedNow.x;
      wanderer.y = placedNow.y;
      wanderer.facing = Math.sin((2 * Math.PI * tick) / wanderer.period) < 0 ? -1 : 1;
    }

    var follow = 1 - Math.exp(-8 * STEP_SECONDS);
    camera.x += (player.x - camera.x) * follow;
    camera.y += (player.y - camera.y) * follow;
  }

  // Positions only, quantized: the resolution the save uses.
  function stateHash(includeTick) {
    var h = hash32Init();
    h = hash32Mix(h, entities.length);
    for (var i = 0; i < entities.length; i++) {
      var e = entities[i];
      h = hash32Mix(h, quantize(e.x));
      h = hash32Mix(h, quantize(e.y));
      h = hash32Mix(h, e.period || 0);
    }
    if (player.targetX !== null) {
      h = hash32Mix(h, quantize(player.targetX));
      h = hash32Mix(h, quantize(player.targetY));
    }
    if (includeTick) h = hash32Mix(h, tick);
    return hash32Finish(h);
  }

  return {
    version: SIM_VERSION,
    seed: seed,
    grid: grid,
    entities: entities,
    player: player,
    camera: camera,
    step: step,
    stateHash: stateHash,
    getTick: function () { return tick; },
    tileAtWorld: function (x, y) {
      var tx = Math.floor(x);
      var ty = Math.floor(y);
      return { x: tx, y: ty, walkable: grid.isWalkableTile(tx, ty) };
    },
    setTarget: function (worldX, worldY) {
      if (!grid.isWalkableAt(worldX, worldY)) return false;
      player.targetX = worldX;
      player.targetY = worldY;
      return true;
    }
  };
}

// Single source of truth for the probe trajectory: the position depends only on
// `tick`, never on accumulated state, so a whole number of cycles lands back
// exactly on the starting point. Loop-closure (step N == step 0) is checked
// with N a multiple of every period (600 covers 100/120/150/200/300/600).
function wandererPosition(wanderer, tickValue) {
  var offset = Math.cos((2 * Math.PI * tickValue) / wanderer.period) * wanderer.amplitude;
  return {
    x: wanderer.homeX + wanderer.dirX * offset,
    y: wanderer.homeY + wanderer.dirY * offset
  };
}

// Find a walkable cell with a 1-tile clearance, deterministically.
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

// --- headless entry points (audited by tools/audit_phase0.py) ----------
function createHeadless() {
  // Two runs of the same seed and the same scripted input must agree.
  function determinism(seed, steps) {
    function run() {
      var sim = createSimulation(seed);
      var plan = createRng(seed + 999);
      var hashes = [];
      var moveX = 0;
      var moveY = 0;
      for (var i = 0; i < steps; i++) {
        if (i % 40 === 0) {
          var pick = Math.floor(plan() * 4);
          moveX = pick === 0 ? 1 : pick === 1 ? -1 : 0;
          moveY = pick === 2 ? 1 : pick === 3 ? -1 : 0;
        }
        sim.step({ moveX: moveX, moveY: moveY });
        hashes.push(sim.stateHash(true));
      }
      return { hashes: hashes, sim: sim };
    }
    var first = run();
    var second = run();
    var divergentAt = -1;
    for (var i = 0; i < first.hashes.length; i++) {
      if (first.hashes[i] !== second.hashes[i]) { divergentAt = i; break; }
    }
    return {
      steps: steps,
      seed: seed,
      firstHash: first.hashes[0],
      finalHash: first.hashes[first.hashes.length - 1],
      secondFinalHash: second.hashes[second.hashes.length - 1],
      identical: divergentAt === -1,
      divergentAt: divergentAt,
      playerTile: { x: Math.floor(first.sim.player.x), y: Math.floor(first.sim.player.y) },
      walkableTiles: first.sim.grid.countWalkable()
    };
  }

  // Loop closure: no input, and every oscillator closes an integer number of
  // cycles in `steps` -> the position hash at `steps` must equal the one at 0.
  function loopClosure(seed, steps) {
    var sim = createSimulation(seed);
    var start = sim.stateHash(false);
    for (var i = 0; i < steps; i++) sim.step({});
    var end = sim.stateHash(false);
    return { steps: steps, seed: seed, startHash: start, endHash: end, closed: start === end };
  }

  // Projection round trip over a spread of world points.
  function projectionRoundTrip(samples) {
    var worst = 0;
    var rng = createRng(4242);
    for (var i = 0; i < samples; i++) {
      var x = rng() * 200 - 100;
      var y = rng() * 200 - 100;
      var sx = worldToScreenX(x, y);
      var sy = worldToScreenY(x, y);
      var backX = screenToWorldX(sx, sy);
      var backY = screenToWorldY(sx, sy);
      worst = Math.max(worst, Math.abs(backX - x), Math.abs(backY - y));
    }
    return { samples: samples, maxErrorTiles: worst };
  }

  // Culling: every tile whose diamond touches the viewport must be inside the
  // iterated rectangle (no holes), and the rectangle is only the starting
  // bound -- the renderer rejects the rest with an exact diamond test, which is
  // measured live from the frame stats.
  function culling(viewportW, viewportH, camX, camY) {
    var margin = 2;
    var bounds = visibleTileBounds(camX, camY, viewportW, viewportH, margin);
    var drawn = {};
    var iteratedInWorld = 0;
    for (var ty = bounds.y0; ty <= bounds.y1; ty++) {
      for (var tx = bounds.x0; tx <= bounds.x1; tx++) {
        if (tx < 0 || ty < 0 || tx >= WORLD_WIDTH || ty >= WORLD_HEIGHT) continue;
        drawn[tx + ":" + ty] = true;
        iteratedInWorld++;
      }
    }
    var halfW = HALF_TILE_W * RENDER_SCALE;
    var halfH = HALF_TILE_H * RENDER_SCALE;
    var missing = [];
    var visibleCount = 0;
    for (var gy = 0; gy < WORLD_HEIGHT; gy++) {
      for (var gx = 0; gx < WORLD_WIDTH; gx++) {
        var sx = worldToScreenX(gx + 0.5 - camX, gy + 0.5 - camY);
        var sy = worldToScreenY(gx + 0.5 - camX, gy + 0.5 - camY);
        var touches = sx + halfW > -viewportW / 2 && sx - halfW < viewportW / 2
          && sy + halfH > -viewportH / 2 && sy - halfH < viewportH / 2;
        if (!touches) continue;
        visibleCount++;
        if (!drawn[gx + ":" + gy]) missing.push(gx + ":" + gy);
      }
    }
    return {
      viewport: { w: viewportW, h: viewportH },
      renderScale: RENDER_SCALE,
      camera: { x: camX, y: camY },
      bounds: bounds,
      iteratedInWorld: iteratedInWorld,
      visibleTiles: visibleCount,
      missingTiles: missing.length,
      missingSample: missing.slice(0, 5),
      iterationOverVisible: visibleCount ? iteratedInWorld / visibleCount : 0,
      coversViewport: missing.length === 0
    };
  }

  return {
    determinism: determinism,
    loopClosure: loopClosure,
    projectionRoundTrip: projectionRoundTrip,
    culling: culling
  };
}
