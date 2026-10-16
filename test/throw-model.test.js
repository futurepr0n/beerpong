const test = require('node:test');
const assert = require('node:assert');
const { powerFromFlick, powerFromHold, aimFromTilt, launchVelocity, MAX_AIM_DEGREES } = require('../public/throw-model');

const BALL_START = { y: 1, z: -2.6 };
const RIM_HEIGHT = 0.5;
const FRONT_CUP_Z = 1.8;
const BACK_ROW_Z = 1.8 + 2 * 0.42 * Math.sqrt(3) / 2;

// Horizontal distance travelled when the falling ball reaches rim height
function distanceAtRimHeight(velocity) {
  const g = 9.82;
  const drop = BALL_START.y - RIM_HEIGHT;
  const time = (velocity.y + Math.sqrt(velocity.y * velocity.y + 2 * g * drop)) / g;
  return { forward: velocity.z * time, sideways: velocity.x * time };
}

test('power range spans short of the front cup to past the back row', () => {
  assert.ok(distanceAtRimHeight(launchVelocity(0, 0)).forward < FRONT_CUP_Z - BALL_START.z - 0.3);
  assert.ok(distanceAtRimHeight(launchVelocity(1, 0)).forward > BACK_ROW_Z - BALL_START.z + 0.3);
});

test('every cup in the rack is reachable at some power between 0 and 1', () => {
  for (const cupZ of [FRONT_CUP_Z, BACK_ROW_Z]) {
    const target = cupZ - BALL_START.z;
    const reachable = Array.from({ length: 101 }, (_, i) => distanceAtRimHeight(launchVelocity(i / 100, 0)).forward)
      .some(distance => Math.abs(distance - target) < 0.05);
    assert.ok(reachable, `no power lands within 5 cm of z=${cupZ}`);
  }
});

test('aim to the right moves the ball toward -x, and aim is clamped', () => {
  assert.ok(launchVelocity(0.5, 5).x < 0);
  assert.ok(launchVelocity(0.5, -5).x > 0);
  assert.deepStrictEqual(launchVelocity(0.5, 90), launchVelocity(0.5, MAX_AIM_DEGREES));
});

test('full aim reaches the outer back cups', () => {
  const { sideways } = distanceAtRimHeight(launchVelocity(1, MAX_AIM_DEGREES));
  assert.ok(Math.abs(sideways) > 0.42, `max sideways reach only ${sideways.toFixed(2)} m`);
});

test('power inputs are clamped to 0..1', () => {
  assert.strictEqual(powerFromFlick(0), 0);
  assert.strictEqual(powerFromFlick(5000), 1);
  assert.strictEqual(powerFromHold(-10), 0);
});

test('hold-to-charge power rises to full and falls back so release timing matters', () => {
  assert.strictEqual(powerFromHold(0), 0);
  assert.strictEqual(powerFromHold(750), 0.5);
  assert.strictEqual(powerFromHold(1500), 1);
  assert.strictEqual(powerFromHold(2250), 0.5);
  assert.strictEqual(powerFromHold(3000), 0);
  assert.strictEqual(powerFromHold(3750), 0.5);
});

test('aimFromTilt scales and clamps sideways tilt', () => {
  assert.strictEqual(aimFromTilt(10), 3);
  assert.strictEqual(aimFromTilt(-200), -MAX_AIM_DEGREES);
});
