// HUD: plain HTML/CSS on top of the canvas. Text is Portuguese (it is visible
// to the player); every id and data attribute is English (it is code).

function createHud() {
  var fields = {};
  var ids = [
    "fps", "frame-p50", "frame-p95", "draw-p95", "tiles", "blocks",
    "sprites", "tick", "seed", "state", "mouse-tile", "player-tile",
    "move-mode", "scale", "steps", "bounds", "drawables", "world"
  ];
  for (var i = 0; i < ids.length; i++) {
    fields[ids[i]] = document.getElementById("hud-" + ids[i]);
  }
  var debugPanel = document.getElementById("debug-panel");
  var seedBadge = document.getElementById("hud-seed-badge");
  var frameCounter = 0;

  function set(id, value) {
    var element = fields[id];
    if (element && element.textContent !== value) element.textContent = value;
  }

  function update(data) {
    frameCounter++;
    if (seedBadge && seedBadge.textContent !== String(data.seed)) {
      seedBadge.textContent = String(data.seed);
    }
    if (frameCounter % 6 !== 0) return;
    var stats = data.stats;
    set("fps", stats.fps.toFixed(0) + " fps");
    set("frame-p50", stats.p50.toFixed(1) + " ms");
    set("frame-p95", stats.p95.toFixed(1) + " ms");
    set("draw-p95", stats.renderP95.toFixed(2) + " ms");
    set("tiles", String(data.render.tilesDrawn));
    set("blocks", String(data.render.blocksDrawn));
    set("sprites", String(data.render.spritesDrawn));
    set("tick", String(data.tick));
    set("seed", String(data.seed));
    set("state", data.stateHash);
    set("mouse-tile", data.mouseTile);
    set("player-tile", data.playerTile);
    set("move-mode", data.moveMode);
    set("scale", data.scale + "x");
    set("steps", String(stats.lastSteps));
    set("bounds", data.bounds);
    set("drawables", String(data.render.drawables));
    set("world", data.worldSize);
  }

  return {
    update: update,
    setDebugVisible: function (visible) {
      if (debugPanel) debugPanel.dataset.visible = visible ? "true" : "false";
    }
  };
}
