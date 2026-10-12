// HUD drawn in characters, into the same grid as the world: box drawing plus
// text with a solid background. No DOM overlay at all -- a text panel can never
// overflow, because it is clamped to the grid it is drawn into.
//
// Every identifier, comment and key in this file is English, like the rest of
// the source. The one exception is HUD_TEXT below: that is the copy the player
// reads on screen, which the project keeps in Portuguese (the ship page and all
// other player-facing text are Portuguese too). Changing the language of the
// interface is editing this table, nothing else.

var HUD_TEXT = {
  title: "isoforge",
  debugTitle: "detalhes",
  fps: "fps",
  frameP50: "quadro p50",
  frameP95: "quadro p95",
  drawP95: "desenho p95",
  cells: "células",
  tick: "tique",
  seed: "semente",
  state: "estado",
  mouseTile: "sob o mouse",
  playerTile: "jogador",
  grid: "grade",
  font: "fonte",
  rebuiltRows: "linhas reconstruídas",
  spans: "spans/quadro",
  kilobytes: "kb/quadro",
  bounds: "faixa",
  drawables: "ordenados",
  culled: "descartados",
  tiles: "tiles",
  world: "mundo",
  moveMode: "movimento",
  wallSuffix: " parede",
  hint: "W A S D andar · clique no chão caminha até o tile · F tela cheia · H detalhes · R semente · G regerar",
  moveClick: "clique",
  moveKeys: "teclado"
};

function createHud(renderer) {
  var debugVisible = false;
  var frameCounter = 0;
  var last = null;

  function pad(text, width) {
    text = String(text);
    if (text.length > width) return text.slice(0, width);
    return text + "                                        ".slice(0, width - text.length);
  }

  function panel(x, y, width, height, title) {
    var metrics = renderer.metrics();
    var w = Math.max(10, Math.min(width, metrics.cols - x - 1));
    renderer.text(x, y, "╔" + "═".repeat(w - 2) + "╗", PALETTE.panelLine, PALETTE.panelBg);
    for (var j = 1; j < height - 1; j++) {
      renderer.text(x, y + j, "║" + " ".repeat(w - 2) + "║", PALETTE.panelLine, PALETTE.panelBg);
    }
    renderer.text(x, y + height - 1, "╚" + "═".repeat(w - 2) + "╝", PALETTE.panelLine, PALETTE.panelBg);
    if (title) renderer.text(x + 2, y, " " + title + " ", PALETTE.gold, PALETTE.panelBg);
    return { x: x, y: y, width: w, inner: w - 4 };
  }

  function row(box, index, label, value) {
    var valueText = String(value);
    var labelWidth = Math.max(1, box.inner - valueText.length - 1);
    var left = pad(label, labelWidth);
    renderer.text(box.x + 2, box.y + 1 + index, left, PALETTE.bone2, PALETTE.panelBg);
    renderer.text(box.x + 2 + left.length, box.y + 1 + index, valueText, PALETTE.gold, PALETTE.panelBg);
  }

  function draw(data) {
    frameCounter++;
    // Numbers refresh every few frames: rewriting them every frame costs more
    // than it shows.
    if (frameCounter % 4 === 1 || !last) last = data;
    var info = last;
    var metrics = renderer.metrics();

    var box = panel(1, 1, 30, 12, HUD_TEXT.title);
    row(box, 0, HUD_TEXT.fps, info.fpsText);
    row(box, 1, HUD_TEXT.frameP50, info.p50Text);
    row(box, 2, HUD_TEXT.frameP95, info.p95Text);
    row(box, 3, HUD_TEXT.drawP95, info.drawText);
    row(box, 4, HUD_TEXT.cells, info.cellsText);
    row(box, 5, HUD_TEXT.tick, info.tick);
    row(box, 6, HUD_TEXT.seed, info.seed);
    row(box, 7, HUD_TEXT.state, info.stateHash);
    row(box, 8, HUD_TEXT.mouseTile, info.mouseTile);
    row(box, 9, HUD_TEXT.playerTile, info.playerTile);

    if (debugVisible) {
      // Per-frame feedback (spans, bytes, rebuilt rows) lives HERE and not in the
      // main panel: those values change every frame, so showing them always keeps
      // the grid from ever being quiet.
      var debug = panel(Math.max(1, metrics.cols - 29), 1, 28, 13, HUD_TEXT.debugTitle);
      row(debug, 0, HUD_TEXT.grid, info.gridText);
      row(debug, 1, HUD_TEXT.font, info.fontText);
      row(debug, 2, HUD_TEXT.rebuiltRows, info.rebuiltText);
      row(debug, 3, HUD_TEXT.spans, info.spanText);
      row(debug, 4, HUD_TEXT.kilobytes, info.kbText);
      row(debug, 5, HUD_TEXT.bounds, info.boundsText);
      row(debug, 6, HUD_TEXT.drawables, info.drawables);
      row(debug, 7, HUD_TEXT.culled, info.culled);
      row(debug, 8, HUD_TEXT.tiles, info.tilesText);
      row(debug, 9, HUD_TEXT.world, info.worldText);
      row(debug, 10, HUD_TEXT.moveMode, info.moveMode);
    }

    var hint = HUD_TEXT.hint;
    var hintStart = Math.max(1, Math.floor((metrics.cols - hint.length) / 2));
    renderer.text(hintStart, metrics.rows - 2, pad(hint, metrics.cols - hintStart - 1),
      PALETTE.bone2, PALETTE.panelBg);
  }

  return {
    draw: draw,
    setDebugVisible: function (value) { debugVisible = value; },
    isDebugVisible: function () { return debugVisible; }
  };
}
