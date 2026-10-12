// Boot: input, camera follow, render wiring, and the audit hooks.

// Screen-pure directions in world space. W is up on screen, so it steps back on
// both axes; summing two of these and normalizing gives the diagonals.
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
  var canvas = document.getElementById("screen");
  var seed = readSeedFromHash();
  var sim = createSimulation(seed);
  var renderer = createCanvasRenderer(canvas);
  var hud = createHud();
  var camera = sim.camera;
  var keys = Object.create(null);
  var hoveredTile = { x: 0, y: 0, walkable: true, inside: false };
  var debugVisible = false;
  var errors = [];

  window.addEventListener("error", function (event) {
    errors.push(String(event.message));
  });
  var nativeConsoleError = console.error;
  console.error = function () {
    errors.push(Array.prototype.join.call(arguments, " "));
    nativeConsoleError.apply(console, arguments);
  };

  function resize() {
    renderer.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
    clampCamera(camera, sim.grid.width, sim.grid.height, renderer.viewportWidth(), renderer.viewportHeight());
  }

  function mouseToWorld(clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    var sx = (clientX - rect.left) * RENDER_SCALE - renderer.viewportWidth() / 2
      + worldToScreenX(camera.x, camera.y);
    var sy = (clientY - rect.top) * RENDER_SCALE - renderer.viewportHeight() / 2
      + worldToScreenY(camera.x, camera.y);
    return { x: screenToWorldX(sx, sy), y: screenToWorldY(sx, sy) };
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
    if (event.code === "KeyH") {
      debugVisible = !debugVisible;
      hud.setDebugVisible(debugVisible);
    }
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

  canvas.addEventListener("mousemove", function (event) {
    var world = mouseToWorld(event.clientX, event.clientY);
    hoveredTile.x = Math.floor(world.x);
    hoveredTile.y = Math.floor(world.y);
    hoveredTile.walkable = sim.grid.isWalkableTile(hoveredTile.x, hoveredTile.y);
    hoveredTile.inside = true;
  });
  canvas.addEventListener("mouseleave", function () { hoveredTile.inside = false; });
  canvas.addEventListener("mousedown", function (event) {
    if (event.button !== 0) return;
    var world = mouseToWorld(event.clientX, event.clientY);
    sim.setTarget(world.x, world.y);
  });

  var fullscreenButton = document.getElementById("fullscreen-button");
  if (fullscreenButton) {
    fullscreenButton.addEventListener("click", fullscreen);
  }

  function render(alpha) {
    renderer.beginFrame(camera);
    renderer.drawGround(sim.grid, camera);
    if (hoveredTile.inside) {
      renderer.drawGroundCursor(hoveredTile.x + 0.5, hoveredTile.y + 0.5, !hoveredTile.walkable);
    }
    for (var i = 0; i < sim.entities.length; i++) {
      var entity = sim.entities[i];
      renderer.submitEntity(entity.kind, entity.prevX, entity.prevY, entity.x, entity.y, alpha);
    }
    renderer.flush();

    var stats = loop.stats;
    var bounds = renderer.stats.bounds;
    hud.update({
      stats: stats,
      render: renderer.stats,
      tick: sim.getTick(),
      seed: sim.seed,
      stateHash: sim.stateHash(false),
      mouseTile: hoveredTile.inside
        ? hoveredTile.x + "," + hoveredTile.y + (hoveredTile.walkable ? "" : " (parede)")
        : "—",
      playerTile: Math.floor(sim.player.x) + "," + Math.floor(sim.player.y),
      moveMode: sim.player.targetX !== null ? "clique em linha reta" : "teclado",
      scale: RENDER_SCALE,
      bounds: bounds ? bounds.x0 + "," + bounds.y0 + " → " + bounds.x1 + "," + bounds.y1 : "—",
      worldSize: sim.grid.width + "×" + sim.grid.height
    });
  }

  var loop = createLoop({
    step: function () {
      sim.step(currentInput());
      clampCamera(camera, sim.grid.width, sim.grid.height, renderer.viewportWidth(), renderer.viewportHeight());
    },
    render: render
  });

  resize();
  hud.setDebugVisible(false);
  loop.start();

  window.ISO = {
    version: 1,
    seed: seed,
    sim: sim,
    grid: sim.grid,
    renderer: renderer,
    camera: camera,
    loop: loop,
    hud: hud,
    headless: createHeadless(),
    reseed: function (nextSeed) { loadSeed(typeof nextSeed === "number" ? nextSeed : randomSeed()); },
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
      lastFrame: renderer.stats,
      constants: {
        stepMs: FIXED_STEP_MS,
        tileWidth: TILE_W,
        tileHeight: TILE_H,
        world: [sim.grid.width, sim.grid.height],
        walkableTiles: sim.grid.countWalkable(),
        entities: sim.entities.length
      }
    }
  };
}

boot();
