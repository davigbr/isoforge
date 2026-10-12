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
  var rafHandle = 0;
  var frameSamples = [];
  var renderSamples = [];
  var sampleLimit = 240;
  var stats = {
    frames: 0, fps: 0, frameMs: 0, renderMs: 0,
    p50: 0, p95: 0, renderP95: 0, steps: 0, lastSteps: 0,
    // A single long frame moves p95 around and is indistinguishable from noise.
    // Count frames that miss the budget (>25 ms, one vsync) and frames that
    // really stutter (>33 ms, two vsyncs) -- the second is what a player sees,
    // and it is what the audit asserts on.
    drops: 0, stutters: 0, budgetMs: 25, stutterMs: 33.4
  };

  function resetStats() {
    frameSamples.length = 0;
    renderSamples.length = 0;
    stats.frames = 0;
    stats.drops = 0;
    stats.stutters = 0;
    stats.p50 = 0;
    stats.p95 = 0;
    stats.renderP95 = 0;
  }

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
    if (frameMs > stats.budgetMs) stats.drops++;
    if (frameMs > stats.stutterMs) stats.stutters++;
    stats.frameMs = frameMs;
    stats.renderMs = renderMs;
    // fps from the MEDIAN frame, not from the last one: two rAF callbacks can
    // land in the same millisecond and an instantaneous 1000/frameMs then reads
    // 0 fps on a perfectly healthy loop (that is how a green run reported 0).
    stats.p50 = percentile(frameSamples, 0.5);
    stats.p95 = percentile(frameSamples, 0.95);
    stats.fps = stats.p50 > 0 ? 1000 / stats.p50 : 0;
    stats.renderP95 = percentile(renderSamples, 0.95);
  }

  function frame(now) {
    if (!running) { rafHandle = 0; return; }
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
    rafHandle = requestAnimationFrame(frame);
  }

  return {
    stats: stats,
    resetStats: resetStats,
    // The rAF handle is tracked and CANCELLED, not merely ignored. Without this,
    // a stop() followed by a start() before the pending callback fires leaves TWO
    // chains running: every frame is then processed twice, half the frame deltas
    // are 0 ms, `fps` (the median) reads 0 on a perfectly healthy loop, and the
    // frame counter reports double. Measured: 468 frames in a 5 s window.
    start: function () {
      if (running) return;
      running = true;
      lastTime = 0;
      if (rafHandle) cancelAnimationFrame(rafHandle);
      rafHandle = requestAnimationFrame(frame);
    },
    stop: function () {
      running = false;
      if (rafHandle) { cancelAnimationFrame(rafHandle); rafHandle = 0; }
    },
    isRunning: function () { return running; }
  };
}
