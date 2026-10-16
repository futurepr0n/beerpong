const test = require('node:test');
const assert = require('node:assert');
const {
  powerFromMotion, powerFromHold, aimFromTilt, launchVelocity, powerForDistance, createCalibration,
  distanceFromCalibration, createPeakTracker, MAX_AIM_DEGREES, CALIBRATION_NEAR_DISTANCE, CALIBRATION_FAR_DISTANCE
} = require('../public/throw-model');

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
  assert.strictEqual(powerFromMotion(0, 0), 0);
  assert.strictEqual(powerFromMotion(500, 50000), 1);
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

test('aimFromTilt ignores small tilts, then scales and clamps', () => {
  assert.strictEqual(aimFromTilt(2), 0);
  assert.strictEqual(aimFromTilt(-2.9), 0);
  assert.strictEqual(aimFromTilt(15), 3);
  assert.strictEqual(aimFromTilt(-15), -3);
  assert.strictEqual(aimFromTilt(-200), -MAX_AIM_DEGREES);
});

test('aim reaches the outer cups with a comfortable tilt', () => {
  const outerCupDegrees = Math.atan2(0.42, BACK_ROW_Z - BALL_START.z) * 180 / Math.PI;
  assert.ok(aimFromTilt(40) >= outerCupDegrees, `40 degrees of tilt only aims ${aimFromTilt(40)} degrees`);
});

// Peaks captured from real iPhone throws: [m/s^2, deg/s]
const GENTLE = [17.8, 384];
const MEDIUM = [27.3, 629];
const FIRM = [48.5, 923];
const forwardFor = ([acceleration, rotation]) =>
  distanceAtRimHeight(launchVelocity(powerFromMotion(acceleration, rotation), 0)).forward;

test('captured gentle throw falls short of the rack', () => {
  assert.ok(forwardFor(GENTLE) < FRONT_CUP_Z - BALL_START.z - 0.3);
});

test('captured medium throw lands in the rack', () => {
  const forward = forwardFor(MEDIUM);
  assert.ok(forward > FRONT_CUP_Z - BALL_START.z - 0.25 && forward < BACK_ROW_Z - BALL_START.z + 0.25,
    `medium throw lands ${forward.toFixed(2)} m out`);
});

test('captured firm throw overshoots the rack', () => {
  assert.ok(forwardFor(FIRM) > BACK_ROW_Z - BALL_START.z + 0.5);
});

test('a quick wrist twist alone does not reach full power', () => {
  assert.ok(powerFromMotion(5, 1000) <= 0.5);
});

test('a phone held still while pressing the button gives zero power', () => {
  assert.strictEqual(powerFromMotion(0.5, 20), 0);
});

// Horizontal distance until the ball comes down to table level (y = 0)
function distanceAtTable(velocity) {
  const g = 9.82;
  const time = (velocity.y + Math.sqrt(velocity.y * velocity.y + 2 * g * BALL_START.y)) / g;
  return velocity.z * time;
}

test('powerForDistance lands the ball at the requested distance', () => {
  for (const distance of [CALIBRATION_NEAR_DISTANCE, 4.4, CALIBRATION_FAR_DISTANCE]) {
    const landed = distanceAtTable(launchVelocity(powerForDistance(distance), 0));
    assert.ok(Math.abs(landed - distance) < 0.01, `asked for ${distance} m, landed at ${landed.toFixed(3)} m`);
  }
});

test('both calibration targets are within the throwable power range', () => {
  assert.ok(powerForDistance(CALIBRATION_NEAR_DISTANCE) > 0);
  assert.ok(powerForDistance(CALIBRATION_FAR_DISTANCE) < 1);
});

const near = [{ acceleration: 15, rotation: 350 }, { acceleration: 19, rotation: 410 }];
const far = [{ acceleration: 45, rotation: 880 }, { acceleration: 51, rotation: 960 }];

test('calibration maps the player\'s own soft and full swings onto the near and far targets', () => {
  const calibration = createCalibration(near, far);
  assert.deepStrictEqual(calibration.usable, ['acceleration', 'rotation']);
  assert.strictEqual(distanceFromCalibration(calibration, 17, 380), CALIBRATION_NEAR_DISTANCE);
  assert.strictEqual(distanceFromCalibration(calibration, 48, 920), CALIBRATION_FAR_DISTANCE);
  const halfway = distanceFromCalibration(calibration, 32.5, 650);
  assert.ok(Math.abs(halfway - (CALIBRATION_NEAR_DISTANCE + CALIBRATION_FAR_DISTANCE) / 2) < 1e-9);
});

test('calibrated throws extrapolate only a limited way past the calibrated swings', () => {
  const calibration = createCalibration(near, far);
  const span = CALIBRATION_FAR_DISTANCE - CALIBRATION_NEAR_DISTANCE;
  assert.strictEqual(distanceFromCalibration(calibration, 500, 5000), CALIBRATION_NEAR_DISTANCE + 1.4 * span);
  assert.strictEqual(distanceFromCalibration(calibration, 0, 0), CALIBRATION_NEAR_DISTANCE - 0.6 * span);
});

test('calibration ignores a sensor that did not separate soft from full swings', () => {
  const calibration = createCalibration(near, [{ acceleration: 47, rotation: 390 }]);
  assert.deepStrictEqual(calibration.usable, ['acceleration']);
  assert.strictEqual(distanceFromCalibration(calibration, 47, 9999), CALIBRATION_FAR_DISTANCE);
});

test('calibration is rejected when soft and full swings are indistinguishable', () => {
  assert.strictEqual(createCalibration(near, near), null);
});

test('peak tracker ignores a single-sample spike but keeps a sustained peak', () => {
  const spiked = createPeakTracker();
  [2, 3, 60, 4, 3].forEach(v => spiked.add(v));
  assert.strictEqual(spiked.value, 4);
  const swing = createPeakTracker();
  [5, 12, 26, 27, 20].forEach(v => swing.add(v));
  assert.strictEqual(swing.value, 26);
});

test('peak tracker reports the only sample, starts at zero and skips bad readings', () => {
  const tracker = createPeakTracker();
  assert.strictEqual(tracker.value, 0);
  tracker.add(NaN);
  tracker.add(-1);
  assert.strictEqual(tracker.value, 0);
  tracker.add(9);
  assert.strictEqual(tracker.value, 9);
});
