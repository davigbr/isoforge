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

  // Combat machinery, against the engine's own fixtures: no game involved, because
  // this is the part that has to behave identically for every game built on it. Each
  // claim is paired with a fixture that could falsify it.
  function combat(cases) {
    cases = cases || 40;

    // 1. Exactly one blow per swing, landing the tick the windup ends.
    var swing = createSwing({ windup: 6, hit: 2, recovery: 4, cooldown: 3 });
    var hits = [];
    var phases = [];
    beginSwing(swing);
    for (var t = 1; t <= 40; t++) {
      if (stepSwing(swing) === "hit") hits.push(t);
      if (phases.length < 16) phases.push(swing.phase);
    }
    var swingReport = {
      hits: hits.length,
      firstHitTick: hits.length ? hits[0] : null,
      windup: swing.windup,
      landedOnWindupEnd: hits.length === 1 && hits[0] === swing.windup + 1,
      phases: phases.join(",")
    };

    // 2. A swing cannot restart until it has finished AND the cooldown expired. The
    //    first version of this fixture was wrong: it re-began a swing that had already
    //    recovered (so "refused" was false) and that left the later "readyAgain" blocked.
    var swing2 = createSwing({ windup: 3, hit: 1, recovery: 2, cooldown: 4 });
    beginSwing(swing2);
    stepSwing(swing2);                       // mid-windup
    var refusedMidSwing = !beginSwing(swing2);
    for (var f = 0; f < 6; f++) stepSwing(swing2);   // finishes; idle with ready = 4
    var refusedDuringCooldown = !beginSwing(swing2);
    for (var g = 0; g < 4; g++) stepSwing(swing2);   // cooldown drains
    var readyAgain = beginSwing(swing2);
    var cooldownReport = {
      refusedMidSwing: refusedMidSwing,
      refusedDuringCooldown: refusedDuringCooldown,
      readyAgain: readyAgain,
      cooldown: swing2.cooldown
    };

    // 3. Damage replays for a seed and moves with the seed: a constant would hide
    //    every bug a spread exposes.
    function damageRun(seed) {
      var rng = createRng(seed);
      var out = [];
      for (var i = 0; i < cases; i++) out.push(rollDamage({ min: 3, max: 9, add: 2, mods: [1.5] }, rng));
      return out;
    }
    var d1 = damageRun(7);
    var d2 = damageRun(7);
    var d3 = damageRun(99);
    var damageReport = {
      sameSeed: d1.join(",") === d2.join(","),
      otherSeedDiffers: d1.join(",") !== d3.join(","),
      min: Math.min.apply(null, d1),
      max: Math.max.apply(null, d1),
      sample: d1.slice(0, 5)
    };

    // 4. A blow does not go through a wall -- and range alone would allow it, which is
    //    the control that proves the line-of-sight half is doing the work. The grid is
    //    opened explicitly: a fresh grid defaults to solid, so "visibleInReach" would
    //    have failed for a reason that has nothing to do with line of sight.
    var wallGrid = createGrid(11, 3);
    for (var gx = 0; gx < 11; gx++) wallGrid.setWalkable(gx, 1, true);
    wallGrid.setWalkable(5, 1, false);
    var attacker = { x: 1.5, y: 1.5, radius: 0 };
    var visible = { x: 4.5, y: 1.5, radius: 0 };
    var behind = { x: 7.5, y: 1.5, radius: 0 };
    var losReport = {
      visibleInReach: inReach(attacker, visible, 8, wallGrid),
      behindInReach: inReach(attacker, behind, 8, wallGrid),
      behindByRangeAlone: inReach(attacker, behind, 8, null),
      distance: 6
    };

    // 5. The registry returns exactly what is inside the radius, and drops what falls
    //    outside the grid instead of silently mis-bucketing it.
    var registry = createRegistry(4);
    registry.resize(wallGrid);
    var list = [{ x: 1.2, y: 1.2 }, { x: 1.8, y: 2.2 }, { x: 9.5, y: 2.5 }, { x: 20, y: 20 }];
    registry.rebuild(list);
    var registryReport = {
      listed: list.length,
      members: registry.members(),
      droppedOutside: list.length - registry.members(),
      insideRadius1: registry.query(1.5, 1.5, 1.0, []).length,
      insideRadius30: registry.query(1.5, 1.5, 30, []).length,
      bucketSize: registry.bucketSize()
    };

    // 6. A landed blow takes at least one point, never more than what is left, and a
    //    corpse takes nothing.
    var victim = { hp: 10 };
    var first = applyDamage(victim, 7);
    var second = applyDamage(victim, 7);
    var onCorpse = applyDamage(victim, 7);
    var killReport = {
      firstDamage: first.damage, hpAfterFirst: first.hp,
      secondDamage: second.damage, killed: second.killed,
      corpseDamage: onCorpse.damage, corpseKilled: onCorpse.killed
    };

    // 7. Named streams are independent and stable: the loot roll cannot shift the AI.
    var streams = createRngStreams(1234);
    var loot = streams("loot");
    var ai = streams("ai");
    var lootValues = [];
    var aiValues = [];
    for (var k = 0; k < 8; k++) { lootValues.push(loot()); aiValues.push(ai()); }
    var streamsReport = {
      sameNameSameStream: streams("loot") === loot,
      independent: lootValues.join(",") !== aiValues.join(","),
      lootSample: lootValues.slice(0, 3)
    };

    return {
      cases: cases,
      swing: swingReport,
      cooldown: cooldownReport,
      damage: damageReport,
      lineOfSight: losReport,
      registry: registryReport,
      kill: killReport,
      streams: streamsReport
    };
  }

  return {
    determinism: determinism,
    loopClosure: loopClosure,
    projectionRoundTrip: projectionRoundTrip,
    culling: culling,
    paths: paths,
    combat: combat
  };
}
