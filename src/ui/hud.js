// HUD drawn in characters, into its own grid layered over the world: box
// drawing plus text with a solid background. A text panel can never overflow,
// because it is clamped to the grid it is drawn into.
//
// The engine owns the FRAME algorithm; the game owns the CONTENT. A game hands
// over a layout and nothing here changes when the panels change:
//
//   var hud = Isoforge.hud.createHud(hudRenderer, {
//     colors: { line: c1, background: c2, title: c3, label: c4, value: c5 },
//     panels: function (metrics, state) {
//       return [{ x: 1, y: 1, width: 30, height: 6, title: "arena",
//                 rows: [{ label: "fps", value: state.fps }] }];
//     },
//     hint: function (metrics, state) { return "WASD move"; },
//     hintColor: c6
//   });
//
// `state` is whatever the game passes to draw(): the HUD never reads the world.
// Rows are label-on-the-left, value-on-the-right, which is what makes a metrics
// panel readable at a glance. A panel taller than the grid is clamped, and a row
// that would fall outside the frame is dropped instead of drawn over the border.

function createHud(renderer, layout) {
  var colors = layout.colors;

  function repeat(character, count) {
    var out = "";
    for (var i = 0; i < count; i++) out += character;
    return out;
  }

  function pad(text, width) {
    text = String(text);
    if (text.length > width) return text.slice(0, width);
    return text + repeat(" ", width - text.length);
  }

  function panelFrame(box) {
    var metrics = renderer.metrics();
    var width = Math.max(10, Math.min(box.width, metrics.cols - box.x - 1));
    var height = Math.max(3, Math.min(box.height, metrics.rows - box.y - 2));
    var background = colors.background;
    renderer.text(box.x, box.y, "╔" + repeat("═", width - 2) + "╗", colors.line, background);
    for (var j = 1; j < height - 1; j++) {
      renderer.text(box.x, box.y + j, "║" + repeat(" ", width - 2) + "║", colors.line, background);
    }
    renderer.text(box.x, box.y + height - 1, "╚" + repeat("═", width - 2) + "╝", colors.line, background);
    if (box.title) renderer.text(box.x + 2, box.y, " " + box.title + " ", colors.title, background);
    return { x: box.x, y: box.y, width: width, height: height, inner: width - 4 };
  }

  function row(box, index, label, value) {
    if (index + 2 > box.height - 1) return;
    var valueText = String(value === undefined || value === null ? "—" : value);
    var labelWidth = Math.max(1, box.inner - valueText.length - 1);
    var left = pad(label, labelWidth);
    var y = box.y + 1 + index;
    renderer.text(box.x + 2, y, left, colors.label, colors.background);
    renderer.text(box.x + 2 + left.length, y, valueText, colors.value, colors.background);
  }

  function draw(state) {
    var metrics = renderer.metrics();
    var panels = typeof layout.panels === "function" ? layout.panels(metrics, state) : (layout.panels || []);
    for (var i = 0; i < panels.length; i++) {
      var box = panelFrame(panels[i]);
      var rows = panels[i].rows || [];
      for (var r = 0; r < rows.length; r++) row(box, r, rows[r].label, rows[r].value);
    }
    var hint = layout.hint;
    if (typeof hint === "function") hint = hint(metrics, state);
    if (hint) {
      hint = String(hint);
      var start = Math.max(1, Math.floor((metrics.cols - hint.length) / 2));
      renderer.text(start, metrics.rows - 2, pad(hint, metrics.cols - start - 1),
        layout.hintColor === undefined ? colors.value : layout.hintColor, colors.background);
    }
  }

  return { draw: draw, layout: layout };
}
