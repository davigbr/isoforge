// Headless entry points: engine invariants a game can be asked about without a
// browser. The game supplies its own scene factory, so the same checks run
// against any game built on the engine.
//
//   Isoforge.headless({ createScene: function (seed) { ... } })
//
// `scene` must expose: step(input), stateHash(includeTick), getTick(), and a
// plain `grid` -- that is the whole contract.

function createHeadless(options) {
  var createScene = options.createScene;
  if (typeof createScene !== "function") {
    throw new Error("Isoforge.headless: options.createScene is required");
  }

  // Two runs of the same seed and the same scripted input must agree, step by
  // step. Divergence means something is reading wall-clock time, Math.random, or
  // iterating an object with a non-deterministic order.
  function determinism(seed, steps) {
    function run() {
      var scene = createScene(seed);
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
        scene.step({ moveX: moveX, moveY: moveY });
        hashes.push(scene.stateHash(true));
      }
      return { hashes: hashes, scene: scene };
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
      walkableTiles: first.scene.grid.countWalkable()
    };
  }

  // Loop closure with no input: every oscillator that closes a whole number of
  // cycles in `steps` puts the state hash back exactly where it started.
  function loopClosure(seed, steps) {
    var scene = createScene(seed);
    var start = scene.stateHash(false);
    for (var i = 0; i < steps; i++) scene.step({});
    var end = scene.stateHash(false);
    return { steps: steps, seed: seed, startHash: start, endHash: end, closed: start === end };
  }

  // Projection round trip over a spread of world points, in cell units. Proves
  // the inverse used for picking is the exact inverse of the forward transform.
  function projectionRoundTrip(samples) {
    var worst = 0;
    var rng = createRng(4242);
    for (var i = 0; i < samples; i++) {
      var x = rng() * 200 - 100;
      var y = rng() * 200 - 100;
      var cx = worldToCellX(x, y);
      var cy = worldToCellY(x, y);
      var backX = cellToWorldX(cx, cy);
      var backY = cellToWorldY(cx, cy);
      worst = Math.max(worst, Math.abs(backX - x), Math.abs(backY - y));
    }
    return { samples: samples, maxErrorTiles: worst };
  }

  // No holes: every tile whose diamond touches the viewport must be inside the
  // iterated rectangle. The renderer rejects the rest with the very same test,
  // so the audit compares its drawn count with this one for equality.
  function culling(cols, rows, camX, camY, grid, margin) {
    if (margin === undefined) margin = requiredTileMargin();
    var bounds = visibleTileBounds(camX, camY, cols, rows, margin);
    var inside = {};
    var iteratedInWorld = 0;
    for (var ty = bounds.y0; ty <= bounds.y1; ty++) {
      for (var tx = bounds.x0; tx <= bounds.x1; tx++) {
        if (tx < 0 || ty < 0 || tx >= grid.width || ty >= grid.height) continue;
        inside[tx + ":" + ty] = true;
        iteratedInWorld++;
      }
    }
    var missing = [];
    var visibleCount = 0;
    for (var gy = 0; gy < grid.height; gy++) {
      for (var gx = 0; gx < grid.width; gx++) {
        if (!tileTouchesViewport(gx, gy, camX, camY, cols, rows)) continue;
        visibleCount++;
        if (!inside[gx + ":" + gy]) missing.push(gx + ":" + gy);
      }
    }
    return {
      viewport: { cols: cols, rows: rows },
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

  // Routes over the scene's own grid. Two claims: the same endpoints always give
  // the same route (so a replay is faithful), and a route never puts a waypoint
  // inside a wall (so following it cannot walk through one). Goals inside walls
  // are included on purpose: clicking a wall must walk you beside it.
  function paths(seed, cases) {
    var signatures = [];
    var identical = true;
    var routes = 0;
    var refused = 0;
    var wallHits = 0;
    var blockedGoals = 0;
    var snappedGoals = 0;
    var waypoints = 0;
    var longest = 0;

    function search(scene, sx, sy, tx, ty) {
      return findPath(scene.grid, sx + 0.5, sy + 0.5, tx + 0.5, ty + 0.5, { smooth: false });
    }

    function pass(record) {
      var scene = createScene(seed);
      var grid = scene.grid;
      var rng = createRng(seed + 31337);
      var out = [];
      for (var i = 0; i < cases; i++) {
        var from = nearestWalkable(grid, Math.floor(rng() * grid.width), Math.floor(rng() * grid.height), 12);
        if (!from) continue;
        var tx = Math.floor(rng() * grid.width);
        var ty = Math.floor(rng() * grid.height);
        var goalBlocked = !grid.isWalkableTile(tx, ty);
        var first = search(scene, from.x, from.y, tx, ty);
        var again = search(scene, from.x, from.y, tx, ty);
        out.push(pathSignature(first.points) + "|" + pathSignature(again.points) +
                 "|" + (first.found ? 1 : 0) + "|" + (first.snapped ? 1 : 0));
        if (first.points.length !== again.points.length) identical = false;
        else {
          for (var k = 0; k < first.points.length; k++) {
            if (first.points[k].x !== again.points[k].x || first.points[k].y !== again.points[k].y) {
              identical = false;
              break;
            }
          }
        }
        if (!record) continue;
        if (!first.found) { refused++; continue; }
        routes++;
        waypoints += first.points.length;
        if (first.points.length > longest) longest = first.points.length;
        if (goalBlocked) {
          blockedGoals++;
          if (first.snapped) snappedGoals++;
        }
        for (var w = 0; w < first.points.length; w++) {
          if (!grid.isWalkableAt(first.points[w].x, first.points[w].y)) { wallHits++; break; }
        }
      }
      return out;
    }

    // The second pass exists only to compare: counting it too would double every
    // number in the report (`record`).
    var firstPass = pass(true);
    var secondPass = pass(false);
    for (var i = 0; i < firstPass.length && i < secondPass.length; i++) {
      if (firstPass[i] !== secondPass[i]) identical = false;
    }
    if (firstPass.length !== secondPass.length) identical = false;
    var text = firstPass.join(";");
    var h = hash32Init();
    for (var c = 0; c < text.length; c++) h = hash32Mix(h, text.charCodeAt(c));
    return {
      seed: seed,
      cases: cases,
      routes: routes,
      refused: refused,
      wallHits: wallHits,
      blockedGoals: blockedGoals,
      snappedGoals: snappedGoals,
      waypoints: waypoints,
      longest: longest,
      identical: identical,
      signature: hash32Finish(h)
    };
  }

  return {
    determinism: determinism,
    loopClosure: loopClosure,
    projectionRoundTrip: projectionRoundTrip,
    culling: culling,
    paths: paths
  };
}
