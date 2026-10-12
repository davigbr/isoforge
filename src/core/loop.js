// Fixed timestep loop: 60 Hz simulation, render decoupled with interpolation.
var FIXED_STEP_MS = 1000 / 60;
var MAX_CATCHUP_STEPS = 5;

// FNV-1a, 32 bit. Used both for the per-step state hash and the frame checksum.
function hash32Init() { return 0x811c9dc5 >>> 0; }
function hash32Mix(h, value) {
  h = (h ^ (value | 0)) >>> 0;
  return Math.imul(h, 0x01000193) >>> 0;
}
function hash32Finish(h) { return ("0000000" + h.toString(16)).slice(-8); }

function createLoop(handlers) {
  var accumulator = 0;
  var lastTime = 0;
  var running = false;
  var frameSamples = [];
  var renderSamples = [];
  var sampleLimit = 240;
  var stats = {
    frames: 0, fps: 0, frameMs: 0, renderMs: 0,
    p50: 0, p95: 0, renderP95: 0, steps: 0, lastSteps: 0
  };

  function percentile(samples, p) {
    if (!samples.length) return 0;
    var sorted = samples.slice().sort(function (a, b) { return a - b; });
    var index = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
    return sorted[index];
  }

  function record(frameMs, renderMs) {
    frameSamples.push(frameMs);
    renderSamples.push(renderMs);
    if (frameSamples.length > sampleLimit) frameSamples.shift();
    if (renderSamples.length > sampleLimit) renderSamples.shift();
    stats.frames++;
    stats.frameMs = frameMs;
    stats.renderMs = renderMs;
    stats.fps = frameMs > 0 ? 1000 / frameMs : 0;
    stats.p50 = percentile(frameSamples, 0.5);
    stats.p95 = percentile(frameSamples, 0.95);
    stats.renderP95 = percentile(renderSamples, 0.95);
  }

  function frame(now) {
    if (!running) return;
    var delta = lastTime ? now - lastTime : FIXED_STEP_MS;
    lastTime = now;
    // A hidden tab (or a long GC pause) must not trigger a catch-up burst.
    if (delta > 250) delta = FIXED_STEP_MS;
    accumulator += delta;

    var steps = 0;
    while (accumulator >= FIXED_STEP_MS && steps < MAX_CATCHUP_STEPS) {
      handlers.step();
      accumulator -= FIXED_STEP_MS;
      steps++;
    }
    if (steps >= MAX_CATCHUP_STEPS) accumulator = 0;

    var alpha = accumulator / FIXED_STEP_MS;
    var renderStart = performance.now();
    handlers.render(alpha);
    record(delta, performance.now() - renderStart);

    stats.lastSteps = steps;
    stats.steps += steps;
    requestAnimationFrame(frame);
  }

  return {
    stats: stats,
    start: function () {
      if (running) return;
      running = true;
      lastTime = 0;
      requestAnimationFrame(frame);
    },
    stop: function () { running = false; },
    isRunning: function () { return running; }
  };
}
