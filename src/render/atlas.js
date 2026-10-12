// Placeholder art, baked procedurally in the browser at boot.
// Phase 2 replaces this with the deterministic PIL atlas injected as
// ATLAS_DATA_URI (see tools/gen_art.py + build.py); the renderer only ever
// touches the sheet object, so nothing else has to change.

var ATLAS_DATA_URI = null;  // Phase 2 injects the generated PNG here.

function createSurface(width, height) {
  var surface = document.createElement("canvas");
  surface.width = width;
  surface.height = height;
  return surface;
}

function diamondPath(g, cx, cy, width, height) {
  g.beginPath();
  g.moveTo(cx, cy - height / 2);
  g.lineTo(cx + width / 2, cy);
  g.lineTo(cx, cy + height / 2);
  g.lineTo(cx - width / 2, cy);
  g.closePath();
}

var CRYPT_PALETTE = {
  floors: ["#3a342c", "#332e27", "#413a30", "#2e2a24"],
  floorLine: "rgba(0,0,0,0.16)",
  wallTop: "#433c32",
  wallLeft: "#292420",
  wallRight: "#1b1714",
  outline: "#0a0908",
  gold: "#c8a45c",
  blood: "#8f2f2f",
  bone: "#d8cbb0",
  creatureBody: "#3f4a3a",
  creatureEye: "#e2543f"
}

function buildPlaceholderAtlas() {
  var palette = CRYPT_PALETTE;
  var floors = [];

  for (var variant = 0; variant < palette.floors.length; variant++) {
    var tile = createSurface(TILE_W, TILE_H);
    var g = tile.getContext("2d");
    diamondPath(g, TILE_W / 2, TILE_H / 2, TILE_W, TILE_H);
    g.fillStyle = palette.floors[variant];
    g.fill();
    var rng = createRng(1000 + variant);
    for (var i = 0; i < 26; i++) {
      var x = rng() * TILE_W;
      var y = rng() * TILE_H;
      g.fillStyle = "rgba(255,255,255," + (0.03 + rng() * 0.05).toFixed(3) + ")";
      g.fillRect(Math.floor(x), Math.floor(y), 1, 1);
    }
    diamondPath(g, TILE_W / 2, TILE_H / 2, TILE_W, TILE_H);
    g.strokeStyle = palette.floorLine;
    g.lineWidth = 1;
    g.stroke();
    floors.push(tile);
  }

  var wall = createSurface(TILE_W, TILE_W);
  var wg = wall.getContext("2d");
  // left face
  wg.beginPath();
  wg.moveTo(0, 16); wg.lineTo(32, 32); wg.lineTo(32, 64); wg.lineTo(0, 48);
  wg.closePath();
  wg.fillStyle = palette.wallLeft;
  wg.fill();
  // right face
  wg.beginPath();
  wg.moveTo(32, 32); wg.lineTo(64, 16); wg.lineTo(64, 48); wg.lineTo(32, 64);
  wg.closePath();
  wg.fillStyle = palette.wallRight;
  wg.fill();
  // top face
  diamondPath(wg, 32, 16, TILE_W, TILE_H);
  wg.fillStyle = palette.wallTop;
  wg.fill();
  var wrng = createRng(77);
  for (var s = 0; s < 40; s++) {
    wg.fillStyle = "rgba(255,255,255," + (0.02 + wrng() * 0.05).toFixed(3) + ")";
    wg.fillRect(Math.floor(wrng() * TILE_W), Math.floor(wrng() * 16), 1, 1);
  }
  diamondPath(wg, 32, 16, TILE_W, TILE_H);
  wg.strokeStyle = "rgba(0,0,0,0.35)";
  wg.stroke();
  // mortar seam between the two faces
  wg.strokeStyle = "rgba(0,0,0,0.45)";
  wg.beginPath();
  wg.moveTo(32, 32); wg.lineTo(32, 64);
  wg.stroke();

  var shadow = createSurface(TILE_W, 24);
  var sg = shadow.getContext("2d");
  sg.save();
  sg.translate(TILE_W / 2, 12);
  sg.scale(1, 0.36);
  var gradient = sg.createRadialGradient(0, 0, 1, 0, 0, 26);
  gradient.addColorStop(0, "rgba(0,0,0,0.45)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  sg.fillStyle = gradient;
  sg.beginPath();
  sg.arc(0, 0, 26, 0, Math.PI * 2);
  sg.fill();
  sg.restore();

  var player = createSurface(32, 44);
  var pg = player.getContext("2d");
  pg.fillStyle = palette.outline;
  pg.beginPath();
  pg.moveTo(16, 10); pg.lineTo(25, 18); pg.lineTo(27, 42); pg.lineTo(5, 42); pg.lineTo(7, 18);
  pg.closePath();
  pg.fill();
  pg.fillStyle = palette.blood;
  pg.beginPath();
  pg.moveTo(16, 12); pg.lineTo(23.5, 19); pg.lineTo(25, 40); pg.lineTo(7, 40); pg.lineTo(8.5, 19);
  pg.closePath();
  pg.fill();
  pg.fillStyle = "rgba(255,255,255,0.10)";
  pg.beginPath();
  pg.moveTo(16, 13); pg.lineTo(21, 19); pg.lineTo(16, 22); pg.closePath();
  pg.fill();
  pg.fillStyle = palette.outline;
  pg.beginPath(); pg.arc(16, 9, 6.5, 0, Math.PI * 2); pg.fill();
  pg.fillStyle = "#e0bb92";
  pg.beginPath(); pg.arc(16, 9, 5, 0, Math.PI * 2); pg.fill();
  pg.fillStyle = palette.outline;
  pg.fillRect(12, 8, 8, 2);
  pg.fillStyle = palette.gold;
  pg.fillRect(13, 27, 6, 2);

  var creature = createSurface(28, 40);
  var cg = creature.getContext("2d");
  cg.fillStyle = palette.outline;
  cg.beginPath(); cg.ellipse(14, 26, 11, 13, 0, 0, Math.PI * 2); cg.fill();
  cg.fillStyle = palette.creatureBody;
  cg.beginPath(); cg.ellipse(14, 26, 9, 11, 0, 0, Math.PI * 2); cg.fill();
  cg.fillStyle = palette.outline;
  cg.beginPath(); cg.arc(14, 14, 7, 0, Math.PI * 2); cg.fill();
  cg.fillStyle = palette.creatureBody;
  cg.beginPath(); cg.arc(14, 14, 5.5, 0, Math.PI * 2); cg.fill();
  cg.fillStyle = palette.creatureEye;
  cg.fillRect(10, 13, 3, 2);
  cg.fillRect(16, 13, 3, 2);
  cg.fillStyle = "rgba(0,0,0,0.35)";
  cg.beginPath(); cg.ellipse(14, 37, 10, 3, 0, 0, Math.PI * 2); cg.fill();

  var cursor = createSurface(TILE_W, TILE_H);
  var kg = cursor.getContext("2d");
  diamondPath(kg, TILE_W / 2, TILE_H / 2, TILE_W - 2, TILE_H - 2);
  kg.strokeStyle = palette.gold;
  kg.lineWidth = 2;
  kg.stroke();

  var cursorBlocked = createSurface(TILE_W, TILE_H);
  var bg = cursorBlocked.getContext("2d");
  diamondPath(bg, TILE_W / 2, TILE_H / 2, TILE_W - 2, TILE_H - 2);
  bg.strokeStyle = "#c0392b";
  bg.lineWidth = 2;
  bg.stroke();

  return {
    source: "placeholder",
    floors: floors,
    wall: wall,
    shadow: shadow,
    cursor: cursor,
    cursorBlocked: cursorBlocked,
    sprites: { player: player, wanderer: creature }
  };
}
