// Boot: input, camera follow, render wiring, audit hooks. The engine is text:
// one <pre>, one character grid, no canvas anywhere.

// Screen-pure directions in world space. W is up on screen, so it steps back on
// both axes; summing two of these and normalising gives the diagonals.
var KEY_DIRECTIONS = {
  KeyW: [-1, -1], ArrowUp: [-1, -1],
  KeyS: [1, 1], ArrowDown: [1, 1],
  KeyA: [-1, 1], ArrowLeft: [-1, 1],
  KeyD: [1, -1], ArrowRight: [1, -1]
};

function readSeedFromHash() {
  var match = /seed=(\d+)/.exec(window.location.hash || "");
  return match ? (parseInt(match[1], 10) >>> 0) : randomSeed();
}

function boot() {
  var pre = document.getElementById("screen");
  var seed = readSeedFromHash();
  var sim = createSimulation(seed);
  var renderer = createTextRenderer(pre);
  var world = createWorldView(renderer);
  var hud = createHud(renderer);
  var camera = sim.camera;
  var keys = Object.create(null);
  var hoveredTile = { x: 0, y: 0, walkable: true, inside: false };
  var errors = [];
  var lastPresent = { spans: 0, htmlBytes: 0, presentMs: 0 };

  window.addEventListener("error", function (event) {
    errors.push(String(event.message));
  });
  var nativeConsoleError = console.error;
  console.error = function () {
    errors.push(Array.prototype.join.call(arguments, " "));
    nativeConsoleError.apply(console, arguments);
  };

  function metrics() { return renderer.metrics(); }

  function resize() {
    renderer.resize(window.innerWidth, window.innerHeight);
    clampCamera(camera, sim.grid.width, sim.grid.height, metrics().cols, metrics().rows);
  }

  // Mouse -> world: cell indices come from the measured cell size, then the
  // exact inverse projection turns the cell into world coordinates.
  function mouseToWorld(clientX, clientY) {
    var rect = pre.getBoundingClientRect();
    var m = metrics();
    var cellX = Math.floor((clientX - rect.left) / m.cellW);
    var cellY = Math.floor((clientY - rect.top) / m.cellH);
    return cellToWorld(cellX + 0.5, cellY + 0.5, camera, m.cols, m.rows);
  }

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

  function fullscreen() {
    if (!document.fullscreenElement) {
      if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
    } else if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  }

  function loadSeed(nextSeed) {
    window.location.hash = "seed=" + nextSeed;
    window.location.reload();
  }

  window.addEventListener("keydown", function (event) {
    if (event.code === "F1") event.preventDefault();
    keys[event.code] = true;
    if (event.code === "KeyF") fullscreen();
    if (event.code === "KeyH") hud.setDebugVisible(!hud.isDebugVisible());
    if (event.code === "KeyR") loadSeed(randomSeed());
    if (event.code === "KeyG") loadSeed(sim.seed);
    if (KEY_DIRECTIONS[event.code]) {
      event.preventDefault();
      sim.player.targetX = null;
      sim.player.targetY = null;
    }
  });
  window.addEventListener("keyup", function (event) { keys[event.code] = false; });
  window.addEventListener("blur", function () { keys = Object.create(null); });
  window.addEventListener("resize", resize);

  pre.addEventListener("mousemove", function (event) {
    var world_ = mouseToWorld(event.clientX, event.clientY);
    hoveredTile.x = Math.floor(world_.x);
    hoveredTile.y = Math.floor(world_.y);
    hoveredTile.walkable = sim.grid.isWalkableTile(hoveredTile.x, hoveredTile.y);
    hoveredTile.inside = true;
  });
  pre.addEventListener("mouseleave", function () { hoveredTile.inside = false; });
  pre.addEventListener("mousedown", function (event) {
    if (event.button !== 0) return;
    var world_ = mouseToWorld(event.clientX, event.clientY);
    sim.setTarget(world_.x, world_.y);
  });

  function render(alpha) {
    renderer.beginFrame();
    world.draw(sim, camera, alpha, hoveredTile);

    var m = metrics();
    var stats = loop.stats;
    hud.draw({
      fpsText: stats.fps.toFixed(0) + " fps",
      p50Text: stats.p50.toFixed(1) + " ms",
      p95Text: stats.p95.toFixed(1) + " ms",
      drawText: stats.renderP95.toFixed(2) + " ms",
      cellsText: m.cols + "×" + m.rows,
      spanText: String(lastPresent.spans),
      kbText: (lastPresent.htmlBytes / 1024).toFixed(0) + "/" + (lastPresent.gridBytes / 1024).toFixed(0) + " kb",
      rebuiltText: lastPresent.rebuiltRows + "/" + m.rows,
      tick: String(sim.getTick()),
      seed: String(sim.seed),
      stateHash: sim.stateHash(false),
      mouseTile: hoveredTile.inside
        ? hoveredTile.x + "," + hoveredTile.y + (hoveredTile.walkable ? "" : " parede")
        : "—",
      playerTile: Math.floor(sim.player.x) + "," + Math.floor(sim.player.y),
      gridText: m.cols + "×" + m.rows,
      fontText: m.fontPx.toFixed(1) + " px",
      boundsText: world.stats.bounds
        ? world.stats.bounds.x0 + "," + world.stats.bounds.y0 + "→" + world.stats.bounds.x1 + "," + world.stats.bounds.y1
        : "—",
      drawables: String(world.stats.drawables),
      culled: String(world.stats.culled),
      tilesText: world.stats.tilesDrawn + "+" + world.stats.blocksDrawn,
      worldText: sim.grid.width + "×" + sim.grid.height,
      moveMode: sim.player.targetX !== null ? "clique" : "teclado"
    });

    lastPresent = renderer.present();
    stats.presentMs = lastPresent.presentMs;
  }

  var loop = createLoop({
    step: function () {
      sim.step(currentInput());
      clampCamera(camera, sim.grid.width, sim.grid.height, metrics().cols, metrics().rows);
    },
    render: render
  });

  resize();
  loop.start();

  window.ISO = {
    version: 2,
    mode: "text",
    seed: seed,
    sim: sim,
    grid: sim.grid,
    renderer: renderer,
    world: world,
    hud: hud,
    camera: camera,
    loop: loop,
    headless: createHeadless(),
    metrics: metrics,
    gridText: function () { return renderer.gridText(); },
    cellAt: function (x, y) { return { glyph: renderer.glyphAt(x, y), color: renderer.colorAt(x, y) }; },
    // Test plumbing: the exact inverse of mouseToWorld, so the audit can click
    // the centre of a known tile and check where the player was sent.
    clientPointForTile: function (tileX, tileY) {
      var m = metrics();
      var rect = pre.getBoundingClientRect();
      var center = tileCenterCell(tileX + 0.5, tileY + 0.5, camera, m.cols, m.rows);
      var cellX = Math.round(center.x);
      var cellY = Math.round(center.y);
      return {
        x: rect.left + (cellX + 0.5) * m.cellW,
        y: rect.top + (cellY + 0.5) * m.cellH,
        cell: [cellX, cellY]
      };
    },
    reseed: function (nextSeed) { loadSeed(typeof nextSeed === "number" ? nextSeed : randomSeed()); },
    // Test plumbing: force a render without advancing the simulation, so the
    // audit can prove that a static frame writes zero bytes to the DOM.
    renderOnce: function () { render(1); },
    teleport: function (x, y) {
      sim.player.x = x;
      sim.player.y = y;
      sim.player.prevX = x;
      sim.player.prevY = y;
      sim.player.targetX = null;
      sim.player.targetY = null;
      camera.x = x;
      camera.y = y;
    },
    debug: {
      errors: errors,
      hoveredTile: hoveredTile,
      lastPresent: lastPresent,
      renderStats: function () { return renderer.stats; },
      worldStats: function () { return world.stats; },
      constants: {
        stepMs: FIXED_STEP_MS,
        tileCells: [TILE_CELLS_W, TILE_CELLS_H],
        targetRows: TARGET_ROWS,
        world: [sim.grid.width, sim.grid.height],
        walkableTiles: sim.grid.countWalkable(),
        entities: sim.entities.length
      }
    }
  };
}

boot();
