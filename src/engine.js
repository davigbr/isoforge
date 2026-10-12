// The engine's public surface. build.py concatenates every module into one IIFE
// and returns the object this file describes, so this is the ONLY file a reader
// has to look at to know what the engine offers:
//
//   var Isoforge = (function () { "use strict"; <modules>; return engineSurface(); })();
//
// Nothing else in the engine is global. Modules talk to each other through bare
// names inside that closure, which is what keeps the hot loops free of property
// lookups while the outside world still sees one namespace.

function engineSurface() {
  return {
    version: ENGINE_VERSION,
    mode: "text",
    configure: configure,
    config: function () {
      var copy = {};
      for (var key in EngineConfig) {
        if (Object.prototype.hasOwnProperty.call(EngineConfig, key)) copy[key] = EngineConfig[key];
      }
      return copy;
    },

    // Character grid: the renderer, the glyph ramp and the colour maths.
    text: {
      createTextRenderer: createTextRenderer,
      glyphIndex: glyphIndex,
      missingGlyphs: missingGlyphs,
      rampIndexAt: rampIndexAt,
      glyphs: GLYPHS,
      spaceIndex: SPACE_INDEX,
      pickStep: pickStep,
      boostColor: boostColor,
      rgb: rgb,
      shade: shade,
      mixColor: mixColor,
      hexColor: hexColor,
      hashNoise: hashNoise
    },

    // 2:1 projection in character cells, plus the frame lattice.
    iso: {
      worldToCellX: worldToCellX,
      worldToCellY: worldToCellY,
      cellToWorldX: cellToWorldX,
      cellToWorldY: cellToWorldY,
      createCamera: createCamera,
      viewHalfExtents: viewHalfExtents,
      visibleTileBounds: visibleTileBounds,
      clampCamera: clampCamera,
      snappedCameraCell: snappedCameraCell,
      coarseLatticeCell: coarseLatticeCell,
      tileCenterCellInLattice: tileCenterCellInLattice,
      latticeToWorld: latticeToWorld,
      bufferCellToWorld: bufferCellToWorld,
      tileTouchesViewport: tileTouchesViewport,
      requiredTileMargin: requiredTileMargin,
      // Geometry accessors, so art code reads the live config instead of a copy:
      // a game that changes the tile size gets art that follows without editing.
      halfW: function () { return HALF_TILE_W; },
      halfH: function () { return HALF_TILE_H; },
      diamondHalfW: function () { return TILE_DIAMOND_HALF_W; },
      diamondHalfH: function () { return TILE_DIAMOND_HALF_H; },
      wallHeightCells: function () { return WALL_HEIGHT_CELLS; },
      latticeBleed: function () { return LATTICE_BLEED; }
    },

    grid: {
      createGrid: createGrid,
      solidBorder: solidBorder,
      keepLargestRegion: keepLargestRegion,
      findOpenCell: findOpenCell,
      findOpenCellNear: findOpenCellNear
    },

    // Routes over the tile grid. Separate from `actor` on purpose: a turn-based or
    // planning-only game wants the search without the locomotion, and a click-to-move
    // game wants both, composed by navigate().
    path: {
      find: findPath,
      hasLineOfSight: hasLineOfSight,
      nearestWalkable: nearestWalkable,
      signature: pathSignature
    },

    loop: {
      createLoop: createLoop,
      hash32Init: hash32Init,
      hash32Mix: hash32Mix,
      hash32Finish: hash32Finish
    },

    rng: {
      createRng: createRng,
      randomSeed: randomSeed,
      quantize: quantize,
      clamp: clamp
    },

    view: { createWorldView: createWorldView },
    hud: { createHud: createHud },
    actor: {
      canStand: canStand,
      moveWithCollision: moveWithCollision,
      moveByInput: moveByInput,
      stepTowardTarget: stepTowardTarget,
      setPath: setPath,
      dropPath: dropPath,
      followPath: followPath,
      navigate: navigate,
      clearTarget: clearTarget,
      followCamera: followCamera
    },
    persist: { createStore: createStore },
    headless: createHeadless,

    // Test plumbing, in the engine and not in the games: a game exposes the
    // contract object and the engine's audit can drive any game built this way.
    createContract: createContract,
    contractMembers: CONTRACT_MEMBERS
  };
}

// --- the audit contract ------------------------------------------------------
// What a game has to expose as window.ISO for tools/audit_engine.py to drive it.
// Enforced, not documented-and-hoped: createContract throws at boot naming every
// missing member, so a game cannot silently ship an un-auditable build.
//
// stepScene(input) is the important one: "advance the scene one step exactly the
// way your loop does", camera follow and clamp included. Without it the audit
// would have to reach into engine internals to move the camera, and would then
// be testing its own driver instead of the game.
//
// setDestination(x, y) is its companion: "order your controllable actor to go
// there". The audit drives it to prove the game routes around walls, which is a
// behaviour no amount of reading the grid can establish.

var CONTRACT_MEMBERS = [
  "mode", "version", "seed",
  "scene", "camera", "grid", "renderer", "hudRenderer",
  "metrics", "gridText", "hudText", "cellAt",
  "tileCell", "clientPointForTile",
  "teleport", "setDestination", "actorPosition", "setRows", "getRows", "renderOnce", "reseed",
  "stepScene", "loop", "headless", "debug"
];

var CONTRACT_OPTIONAL = ["hudStats", "world", "sim", "hoveredTile", "text"];

function contractMissing(parts) {
  var missing = [];
  for (var i = 0; i < CONTRACT_MEMBERS.length; i++) {
    var key = CONTRACT_MEMBERS[i];
    if (parts[key] === undefined || parts[key] === null) missing.push(key);
  }
  return missing;
}

function createContract(parts) {
  var missing = contractMissing(parts);
  if (missing.length) {
    throw new Error("Isoforge contract: window.ISO is missing " + missing.join(", "));
  }
  var surface = {};
  var i;
  for (i = 0; i < CONTRACT_MEMBERS.length; i++) surface[CONTRACT_MEMBERS[i]] = parts[CONTRACT_MEMBERS[i]];
  for (i = 0; i < CONTRACT_OPTIONAL.length; i++) {
    if (parts[CONTRACT_OPTIONAL[i]] !== undefined) surface[CONTRACT_OPTIONAL[i]] = parts[CONTRACT_OPTIONAL[i]];
  }
  // Called by the audit before anything else: an empty array means the game
  // satisfies the contract it claims to.
  surface.contract = function () { return contractMissing(surface); };
  return surface;
}
