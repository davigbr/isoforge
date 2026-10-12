// examples/arena -- the smallest complete Isoforge game.
//
// It exists to prove the boundary: this file is the ONLY game file, it is ~200
// lines, and it touches no engine module. Everything an isometric game needs is
// here -- a world, a movable body, entities with their own art, a HUD, input,
// deterministic stepping -- and nothing in the engine knows this game exists.
//
// It also proves the engine is configurable: the arena asks for 8x2-cell tiles
// and 2-cell-tall walls, where the crypt game uses 10x3 and 4. Same engine, same
// projection maths, different look and grid density.

Isoforge.configure({ tileCellsW: 8, tileCellsH: 2, wallHeightCells: 2 });

(function () {
  "use strict";

  var T = Isoforge.text;
  var ISO = Isoforge.iso;
  var S = Isoforge.actor;

  var ARENA_W = 120;
  var ARENA_H = 120;
  var HERO_SPEED = 3.6;              // tiles per second
  var HERO_RADIUS = 0.3;
  var DRONE_PERIODS = [100, 150, 200, 300, 600];   // every one divides 600

  // The copy the player reads, in one table. Declared to the engine through
  // debug.text so the audit can check every character of it against the glyph set.
  var ARENA_TEXT = {
    title: "arena",
    fps: "fps",
    p95: "quadro p95",
    tick: "tique",
    seed: "semente",
    hero: "herói",
    panel: "painel",
    hint: "W A S D andar · clique no chão caminha até o tile · − / + resolução · F tela cheia"
  };

  // --- palette ---------------------------------------------------------------
  // Every colour goes through the engine's boost exactly once: a glyph covers
  // only part of its cell, so unboosted ink reads as a near-black screen.
  function ink(color) { return T.boostColor(color, 1.2, 1.55, 14); }
  var COLORS = {
    sand: [ink(T.rgb(74, 66, 48)), ink(T.rgb(84, 74, 54)), ink(T.rgb(64, 58, 44))],
    sandEdge: ink(T.rgb(40, 36, 28)),
    blockTop: ink(T.rgb(112, 104, 86)),
    blockLeft: ink(T.rgb(56, 52, 44)),
    blockRight: ink(T.rgb(34, 32, 28)),
    hero: ink(T.rgb(210, 168, 84)),
    heroDark: ink(T.rgb(120, 88, 40)),
    drone: ink(T.rgb(96, 132, 148)),
    droneDark: ink(T.rgb(40, 62, 74)),
    crate: ink(T.rgb(140, 106, 60)),
    line: ink(T.rgb(96, 78, 44)),
    background: T.rgb(16, 14, 12),
    label: ink(T.rgb(188, 176, 152)),
    value: ink(T.rgb(200, 164, 92)),
    title: ink(T.rgb(200, 164, 92)),
    cursor: ink(T.rgb(232, 196, 104)),
    cursorBlocked: ink(T.rgb(200, 64, 48))
  };

  // --- art -------------------------------------------------------------------
  // The engine calls these with a context object; nothing here knows about the
  // engine's internals beyond the renderer primitives it is handed.
  function floorTile(r, ctx) {
    var cx = Math.round(ctx.cx);
    var cy = Math.round(ctx.cy);
    var base = COLORS.sand[ctx.variant % COLORS.sand.length];
    var halfW = ISO.diamondHalfW();
    var halfH = ISO.diamondHalfH();
    for (var dy = -Math.ceil(halfH); dy <= Math.ceil(halfH); dy++) {
      for (var dx = -Math.ceil(halfW); dx <= Math.ceil(halfW); dx++) {
        if (!r.inDiamond(dx, dy, halfW, halfH)) continue;
        var noise = T.hashNoise(ctx.tileX * 5 + 3, ctx.tileY * 7 + 1, dx + 8, dy + 6);
        var edge = Math.abs(dx) >= Math.ceil(halfW) - 1 || Math.abs(dy) >= Math.ceil(halfH);
        r.plot(cx + dx, cy + dy,
          T.rampIndexAt(edge ? 0.10 + noise * 0.08 : 0.22 + noise * 0.22),
          edge ? COLORS.sandEdge : base);
      }
    }
  }

  function blockTile(r, ctx) {
    var cx = Math.round(ctx.cx);
    var cy = Math.round(ctx.cy);
    var halfW = ISO.diamondHalfW();
    var halfH = ISO.diamondHalfH();
    var h = ISO.wallHeightCells();
    var spanX = Math.ceil(halfW);
    var spanY = Math.ceil(halfH);
    // two side faces first, so the top face overwrites its own seams
    r.fillPolygon([[cx - halfW, cy - halfH], [cx, cy], [cx, cy - h], [cx - halfW, cy - halfH - h]],
      quad(COLORS.blockLeft, ctx.tileX, ctx.tileY, cx, cy));
    r.fillPolygon([[cx, cy], [cx + halfW, cy - halfH], [cx + halfW, cy - halfH - h], [cx, cy - h]],
      quad(COLORS.blockRight, ctx.tileX + 7, ctx.tileY + 3, cx, cy));
    for (var dy = -spanY; dy <= spanY; dy++) {
      for (var dx = -spanX; dx <= spanX; dx++) {
        if (!r.inDiamond(dx, dy, halfW, halfH)) continue;
        var noise = T.hashNoise(ctx.tileX * 131 + 7, ctx.tileY * 197 + 11, dx, dy);
        r.plot(cx + dx, cy - h + dy, T.rampIndexAt(0.3 + noise * 0.3), COLORS.blockTop);
      }
    }
  }

  // Face texture hashed on TILE + LOCAL offset: hashing on the cell's position
  // on screen makes the stone boil whenever the camera moves.
  function quad(color, seedA, seedB, anchorX, anchorY) {
    return function (x, y) {
      var lx = x - anchorX;
      var ly = y - anchorY;
      var noise = T.hashNoise(seedA + lx, seedB + ly, 3, 7);
      return {
        glyph: T.glyphIndex(T.pickStep(noise, 2) ? "▒" : "░"),
        color: T.shade(color, 0.84 + T.pickStep(noise, 4) * 0.05)
      };
    };
  }

  function crate(r, ctx) {
    var cx = Math.round(ctx.cx);
    var cy = Math.round(ctx.cy);
    r.text(cx - 1, cy - 2, "╔══╗".slice(0, 4), COLORS.crate);
    r.text(cx - 1, cy - 1, "║▓▓║", COLORS.crate);
    r.text(cx - 1, cy, "╚══╝", COLORS.crate);
  }

  var ART = {
    floor: floorTile,
    block: blockTile,
    prop: { crate: crate },
    propAt: function (tx, ty) { return T.hashNoise(tx, ty, 21, 5) > 0.965 ? "crate" : null; },
    entity: { hero: heroArt, drone: droneArt },
    cursorColor: COLORS.cursor,
    cursorBlockedColor: COLORS.cursorBlocked
  };

  function heroArt(r, ctx) {
    var cx = Math.round(ctx.cx);
    var cy = Math.round(ctx.cy);
    r.fillPolygon([[cx - 1, cy - 3], [cx + 1, cy - 3], [cx + 1, cy], [cx - 1, cy]],
      function () { return { glyph: T.glyphIndex("▓"), color: COLORS.hero }; });
    r.text(cx, cy - 4, "@", COLORS.heroDark);
    r.plot(cx - 1, cy - 1, T.glyphIndex("="), COLORS.heroDark);
    r.plot(cx + 1, cy - 1, T.glyphIndex("="), COLORS.heroDark);
  }

  function droneArt(r, ctx) {
    var cx = Math.round(ctx.cx);
    var cy = Math.round(ctx.cy);
    var bob = Math.sin(ctx.entity.phase) < 0 ? 0 : 1;
    r.fillPolygon([[cx - 1, cy - 1 - bob], [cx + 1, cy - 1 - bob], [cx + 1, cy - bob], [cx - 1, cy - bob]],
      function () { return { glyph: T.glyphIndex("▒"), color: COLORS.drone }; });
    r.plot(cx, cy - 2 - bob, T.glyphIndex("°"), COLORS.droneDark);
  }

  // --- world and scene -------------------------------------------------------
  var store = Isoforge.persist.createStore("isoforge.arena");

  function readSeed() {
    var match = /seed=(\d+)/.exec(window.location.hash || "");
    if (match) return parseInt(match[1], 10) >>> 0;
    var stored = store.get("seed", null);
    if (typeof stored === "number") return stored >>> 0;
    return 20261012;
  }

  function createArena(seed) {
    var rng = Isoforge.rng.createRng(seed ^ 0x5f3759df);
    var grid = Isoforge.grid.createGrid(ARENA_W, ARENA_H);
    for (var ty = 0; ty < ARENA_H; ty++) {
      for (var tx = 0; tx < ARENA_W; tx++) {
        var pillar = (tx % 7 === 3 && ty % 7 === 3);
        grid.setWalkable(tx, ty, !pillar);
      }
    }
    Isoforge.grid.solidBorder(grid);

    var spawn = Isoforge.grid.findOpenCell(grid, rng);
    var entities = [{
      kind: "hero",
      x: spawn.x, y: spawn.y, prevX: spawn.x, prevY: spawn.y,
      radius: HERO_RADIUS, targetX: null, targetY: null, blocked: false
    }];

    // Drones oscillate along a straight clear line on a period that divides 600:
    // the engine's loop-closure check (step N == step 0) needs that to hold.
    for (var i = 0; i < 5; i++) {
      var home = Isoforge.grid.findOpenCell(grid, rng);
      var angle = rng() * Math.PI * 2;
      var dirX = Math.cos(angle) > 0 ? 1 : -1;
      var dirY = Math.abs(Math.cos(angle)) < 0.5 ? (Math.sin(angle) > 0 ? 1 : -1) : 0;
      var amplitude = 0;
      var candidate = 3;
      while (candidate >= 0.5) {
        var clear = true;
        for (var s = -4; s <= 4 && clear; s++) {
          if (!grid.isWalkableAt(home.x + dirX * candidate * (s / 4), home.y + dirY * candidate * (s / 4))) clear = false;
        }
        if (clear) { amplitude = candidate; break; }
        candidate -= 0.5;
      }
      var period = DRONE_PERIODS[i % DRONE_PERIODS.length];
      entities.push({
        kind: "drone", index: i,
        x: home.x, y: home.y, prevX: home.x, prevY: home.y,
        radius: 0.28, homeX: home.x, homeY: home.y,
        dirX: dirX, dirY: dirY, amplitude: amplitude, period: period, phase: 0
      });
    }

    var hero = entities[0];
    var camera = ISO.createCamera(hero.x, hero.y);
    var tick = 0;
    var WANDER_PERIODS = DRONE_PERIODS;

    function dronePosition(drone, tickValue) {
      var offset = Math.cos((2 * Math.PI * tickValue) / drone.period) * drone.amplitude;
      return { x: drone.homeX + drone.dirX * offset, y: drone.homeY + drone.dirY * offset };
    }

    // Start every drone at its own tick-0 phase, so frame 1 is not a teleport
    // and step N lands back exactly on step 0.
    for (var w = 1; w < entities.length; w++) {
      var placed = dronePosition(entities[w], 0);
      entities[w].x = placed.x;
      entities[w].y = placed.y;
      entities[w].prevX = placed.x;
      entities[w].prevY = placed.y;
    }

    function step(input) {
      tick++;
      input = input || {};
      if (input.moveX || input.moveY) {
        S.clearTarget(hero);
        S.moveByInput(grid, hero, input.moveX, input.moveY, HERO_SPEED, 1 / 60);
      } else {
        S.stepTowardTarget(grid, hero, HERO_SPEED, 1 / 60, { arrive: 0.12 });
      }
      for (var i = 1; i < entities.length; i++) {
        var drone = entities[i];
        drone.prevX = drone.x;
        drone.prevY = drone.y;
        var now = dronePosition(drone, tick);
        drone.x = now.x;
        drone.y = now.y;
        drone.phase = (2 * Math.PI * tick) / drone.period;
      }
      S.followCamera(camera, hero.x, hero.y, 1 / 60, 8);
    }

    function stateHash(includeTick) {
      var h = Isoforge.loop.hash32Init();
      h = Isoforge.loop.hash32Mix(h, entities.length);
      for (var i = 0; i < entities.length; i++) {
        h = Isoforge.loop.hash32Mix(h, Isoforge.rng.quantize(entities[i].x));
        h = Isoforge.loop.hash32Mix(h, Isoforge.rng.quantize(entities[i].y));
      }
      if (hero.targetX !== null) h = Isoforge.loop.hash32Mix(h, Isoforge.rng.quantize(hero.targetX));
      if (includeTick) h = Isoforge.loop.hash32Mix(h, tick);
      return Isoforge.loop.hash32Finish(h);
    }

    return {
      seed: seed, grid: grid, entities: entities, hero: hero, camera: camera,
      step: step, stateHash: stateHash,
      getTick: function () { return tick; },
      setTarget: function (worldX, worldY) {
        if (!grid.isWalkableAt(worldX, worldY)) return false;
        hero.targetX = worldX;
        hero.targetY = worldY;
        return true;
      }
    };
  }

  // --- boot ------------------------------------------------------------------
  function boot() {
    var screen = document.getElementById("screen");
    var hudPre = document.getElementById("hud");
    var seed = readSeed();
    var scene = createArena(seed);
    var renderer = T.createTextRenderer(screen);
    var hudRenderer = T.createTextRenderer(hudPre, { bleed: 0 });
    var view = Isoforge.view.createWorldView(renderer, ART);
    var camera = scene.camera;
    var grid = scene.grid;
    var errors = [];
    var keys = Object.create(null);
    var hoveredTile = { x: 0, y: 0, walkable: true, inside: false };
    var targetRows = store.get("rows", null) || Isoforge.config().defaultTargetRows;
    var lastPresent = { spans: 0, htmlBytes: 0, gridBytes: 0, rebuiltRows: 0, rows: 0, presentMs: 0 };
    var lastHud = { spans: 0, htmlBytes: 0 };

    window.addEventListener("error", function (event) { errors.push(String(event.message)); });
    var nativeConsoleError = console.error;
    console.error = function () {
      errors.push(Array.prototype.join.call(arguments, " "));
      nativeConsoleError.apply(console, arguments);
    };

    var hud = Isoforge.hud.createHud(hudRenderer, {
      colors: {
        line: COLORS.line, background: COLORS.background, title: COLORS.title,
        label: COLORS.label, value: COLORS.value
      },
      panels: function (metrics, state) {
        return [{
          x: 1, y: 1, width: 28, height: 8, title: ARENA_TEXT.title,
          rows: [
            { label: ARENA_TEXT.fps, value: state.fps },
            { label: ARENA_TEXT.p95, value: state.p95 },
            { label: ARENA_TEXT.tick, value: state.tick },
            { label: ARENA_TEXT.seed, value: state.seed },
            { label: ARENA_TEXT.hero, value: state.heroTile },
            { label: ARENA_TEXT.panel, value: state.cells }
          ]
        }];
      },
      hint: ARENA_TEXT.hint
    });

    function metrics() { return renderer.metrics(); }

    function resize() {
      renderer.resize(window.innerWidth, window.innerHeight, targetRows);
      hudRenderer.resize(window.innerWidth, window.innerHeight, targetRows);
      ISO.clampCamera(camera, grid.width, grid.height, metrics().cols, metrics().rows);
    }

    function setRows(next) {
      targetRows = Isoforge.rng.clamp(Math.round(next), Isoforge.config().minTargetRows, Isoforge.config().maxTargetRows);
      store.set("rows", targetRows);
      resize();
    }

    function mouseToWorld(clientX, clientY) {
      var rect = screen.getBoundingClientRect();
      var m = metrics();
      return ISO.bufferCellToWorld(
        Math.floor((clientX - rect.left) / m.cellW),
        Math.floor((clientY - rect.top) / m.cellH),
        camera, m.cols, m.rows
      );
    }

    var KEY_DIRECTIONS = {
      KeyW: [-1, -1], KeyS: [1, 1], KeyA: [-1, 1], KeyD: [1, -1],
      ArrowUp: [-1, -1], ArrowDown: [1, 1], ArrowLeft: [-1, 1], ArrowRight: [1, -1]
    };

    function currentInput() {
      var moveX = 0;
      var moveY = 0;
      for (var code in KEY_DIRECTIONS) {
        if (!keys[code]) continue;
        moveX += KEY_DIRECTIONS[code][0];
        moveY += KEY_DIRECTIONS[code][1];
      }
      var length = Math.sqrt(moveX * moveX + moveY * moveY);
      if (length > 0) { moveX /= length; moveY /= length; }
      return { moveX: moveX, moveY: moveY };
    }

    function render(alpha) {
      var lattice = ISO.coarseLatticeCell(camera);
      renderer.setOrigin(lattice, camera);
      renderer.beginFrame();
      view.draw(scene, camera, alpha, hoveredTile);

      var m = metrics();
      var stats = loop.stats;
      hudRenderer.beginFrame();
      hud.draw({
        fps: stats.fps.toFixed(0) + " fps",
        p95: stats.p95.toFixed(1) + " ms",
        tick: String(scene.getTick()),
        seed: String(seed),
        heroTile: Math.floor(scene.hero.x) + "," + Math.floor(scene.hero.y),
        cells: m.cols + "×" + m.rows
      });
      hudRenderer.lockToViewport();

      lastPresent = renderer.present();
      lastHud = hudRenderer.present();
      stats.presentMs = lastPresent.presentMs;
    }

    var loop = Isoforge.loop.createLoop({
      step: function () {
        scene.step(currentInput());
        ISO.clampCamera(camera, grid.width, grid.height, metrics().cols, metrics().rows);
      },
      render: render
    });

    window.addEventListener("keydown", function (event) {
      keys[event.code] = true;
      if (event.code === "KeyF") {
        if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
          document.documentElement.requestFullscreen();
        } else if (document.exitFullscreen) {
          document.exitFullscreen();
        }
      }
      if (event.code === "BracketLeft" || event.code === "Minus") setRows(targetRows - 8);
      if (event.code === "BracketRight" || event.code === "Equal") setRows(targetRows + 8);
      if (KEY_DIRECTIONS[event.code]) {
        event.preventDefault();
        S.clearTarget(scene.hero);
      }
    });
    window.addEventListener("keyup", function (event) { keys[event.code] = false; });
    window.addEventListener("blur", function () { keys = Object.create(null); });
    window.addEventListener("resize", resize);

    screen.addEventListener("mousemove", function (event) {
      var world = mouseToWorld(event.clientX, event.clientY);
      hoveredTile.x = Math.floor(world.x);
      hoveredTile.y = Math.floor(world.y);
      hoveredTile.walkable = grid.isWalkableTile(hoveredTile.x, hoveredTile.y);
      hoveredTile.inside = true;
    });
    screen.addEventListener("mouseleave", function () { hoveredTile.inside = false; });
    screen.addEventListener("mousedown", function (event) {
      if (event.button !== 0) return;
      var world = mouseToWorld(event.clientX, event.clientY);
      scene.setTarget(world.x, world.y);
    });

    resize();
    loop.start();

    window.ISO = Isoforge.createContract({
      mode: "text",
      version: Isoforge.version,
      seed: seed,
      scene: scene,
      camera: camera,
      grid: grid,
      renderer: renderer,
      hudRenderer: hudRenderer,
      metrics: metrics,
      gridText: function () { return renderer.gridText(); },
      hudText: function () { return hudRenderer.gridText(); },
      hudStats: function () { return hudRenderer.stats; },
      cellAt: function (x, y) { return { glyph: renderer.glyphAt(x, y), color: renderer.colorAt(x, y) }; },
      tileCell: function (tileX, tileY) {
        var m = metrics();
        var cell = ISO.tileCenterCellInLattice(tileX + 0.5, tileY + 0.5, ISO.coarseLatticeCell(camera), m.cols, m.rows);
        var bleed = Isoforge.config().latticeQuantum / 2;
        return { x: Math.round(cell.x) + bleed, y: Math.round(cell.y) + bleed };
      },
      clientPointForTile: function (tileX, tileY) {
        var cell = window.ISO.tileCell(tileX, tileY);
        var m = metrics();
        var rect = screen.getBoundingClientRect();
        return { x: rect.left + (cell.x + 0.5) * m.cellW, y: rect.top + (cell.y + 0.5) * m.cellH, cell: [cell.x, cell.y] };
      },
      teleport: function (x, y) {
        scene.hero.x = x; scene.hero.y = y;
        scene.hero.prevX = x; scene.hero.prevY = y;
        S.clearTarget(scene.hero);
        camera.x = x; camera.y = y;
      },
      setRows: setRows,
      getRows: function () { return targetRows; },
      renderOnce: function () { render(1); },
      // Advance the scene exactly like the loop does, camera clamp included: the
      // engine audit drives the game through this and nothing else.
      stepScene: function (input) {
        scene.step(input || {});
        ISO.clampCamera(camera, grid.width, grid.height, metrics().cols, metrics().rows);
      },
      reseed: function (next) {
        var value = typeof next === "number" ? next : Isoforge.rng.randomSeed();
        store.set("seed", value);
        window.location.hash = "seed=" + value;
        window.location.reload();
      },
      loop: loop,
      headless: Isoforge.headless({ createScene: createArena }),
      text: ARENA_TEXT,
      debug: {
        errors: errors,
        hoveredTile: hoveredTile,
        lastPresent: lastPresent,
        lastHud: lastHud,
        renderStats: function () { return renderer.stats; },
        worldStats: function () { return view.stats; },
        constants: {
          stepMs: 16.666666666666668,
          tileCells: [Isoforge.config().tileCellsW, Isoforge.config().tileCellsH],
          world: [grid.width, grid.height],
          walkableTiles: grid.countWalkable(),
          entities: scene.entities.length
        }
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
