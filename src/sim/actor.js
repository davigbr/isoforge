// Locomotion primitives: how an actor moves over a tile grid and how the camera
// follows it. A game composes these into its own step(); the engine does not
// assume a player, a monster, or even that anything is moving.
//
// Collision is axis separated (full step, then each axis alone), which is what
// gives wall sliding for free: pushing diagonally into a wall keeps the free
// axis and loses the blocked one.

function canStand(grid, x, y, radius) {
  return grid.isWalkableAt(x - radius, y - radius)
    && grid.isWalkableAt(x + radius, y - radius)
    && grid.isWalkableAt(x - radius, y + radius)
    && grid.isWalkableAt(x + radius, y + radius);
}

// Returns true when the actor actually moved (on either axis).
function moveWithCollision(grid, actor, dx, dy) {
  if (dx === 0 && dy === 0) return false;
  var radius = actor.radius || 0;
  if (canStand(grid, actor.x + dx, actor.y + dy, radius)) {
    actor.x += dx;
    actor.y += dy;
    return true;
  }
  if (dx !== 0 && canStand(grid, actor.x + dx, actor.y, radius)) {
    actor.x += dx;
    return true;
  }
  if (dy !== 0 && canStand(grid, actor.x, actor.y + dy, radius)) {
    actor.y += dy;
    return true;
  }
  return false;
}

// Directional movement (keyboard, d-pad, an AI steering vector). `moveX` and
// `moveY` are expected to be normalised by the caller when both are non-zero.
function moveByInput(grid, actor, moveX, moveY, speed, dt) {
  actor.prevX = actor.x;
  actor.prevY = actor.y;
  var moved = moveWithCollision(grid, actor, moveX * speed * dt, moveY * speed * dt);
  actor.blocked = false;
  return moved;
}

// Walk toward actor.targetX / targetY at `speed`, clearing the target on
// arrival. `blockedWhenStuck` clears the target when a wall stops the actor,
// which is what keeps a click-to-move game from grinding against a wall
// forever when there is no pathfinder yet.
function stepTowardTarget(grid, actor, speed, dt, options) {
  options = options || {};
  var arrive = options.arrive === undefined ? 0.12 : options.arrive;
  var blockedWhenStuck = options.blockedWhenStuck !== false;
  actor.prevX = actor.x;
  actor.prevY = actor.y;
  actor.blocked = false;
  if (actor.targetX === null || actor.targetX === undefined) return false;

  var toX = actor.targetX - actor.x;
  var toY = actor.targetY - actor.y;
  var distance = Math.sqrt(toX * toX + toY * toY);
  if (distance < arrive) {
    actor.targetX = null;
    actor.targetY = null;
    return false;
  }
  var moved = moveWithCollision(grid, actor, (toX / distance) * speed * dt, (toY / distance) * speed * dt);
  if (!moved && blockedWhenStuck) {
    actor.blocked = true;
    actor.targetX = null;
    actor.targetY = null;
  }
  return moved;
}

function clearTarget(actor) {
  actor.targetX = null;
  actor.targetY = null;
  actor.blocked = false;
}

// Frame rate independent easing: the camera keeps the same feel at 30 and at
// 144 fps, and it never overshoots.
function followCamera(camera, targetX, targetY, dt, rate) {
  var follow = 1 - Math.exp(-(rate === undefined ? 8 : rate) * dt);
  camera.x += (targetX - camera.x) * follow;
  camera.y += (targetY - camera.y) * follow;
}
