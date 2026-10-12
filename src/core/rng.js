// Deterministic PRNG (mulberry32). Same seed -> same world, always.
function createRng(seed) {
  var state = (seed >>> 0) || 1;
  return function next() {
    state = (state + 0x6D2B79F5) >>> 0;
    var t = state;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomSeed() {
  if (window.crypto && window.crypto.getRandomValues) {
    var buf = new Uint32Array(1);
    window.crypto.getRandomValues(buf);
    return buf[0] >>> 0;
  }
  return (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
}

// Positions are hashed and saved at 1/1000 of a tile. Quantizing is what makes
// the loop-closure test exact even though cos/sin carry float error.
function quantize(value) {
  return Math.round(value * 1000) | 0;
}

function clamp(value, low, high) {
  if (low > high) return (low + high) / 2;
  return value < low ? low : (value > high ? high : value);
}

// Independent streams out of one seed, named rather than numbered. This is what keeps
// a loot roll from consuming a number the monster AI would have consumed: with a
// single stream, adding a feature that draws a random number shifts every creature
// after it and the determinism audit breaks somewhere unrelated -- and very hard to
// find. Names survive reordering; indices do not.
function createRngStreams(seed) {
  var cache = {};
  return function stream(name) {
    var key = String(name);
    if (!cache[key]) {
      var h = hash32Init();
      for (var i = 0; i < key.length; i++) h = hash32Mix(h, key.charCodeAt(i));
      cache[key] = createRng((seed ^ h) >>> 0);
    }
    return cache[key];
  };
}
