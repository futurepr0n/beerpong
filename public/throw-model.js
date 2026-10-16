// Maps a player's throw (power 0-1, aim in degrees) to a launch velocity.
// Shared by the controller, the game's aim guide and the Node tests.
(function (root) {
  const LAUNCH_ELEVATION_DEGREES = 48;
  const MIN_SPEED = 4.5;
  const MAX_SPEED = 8.5;
  const MAX_AIM_DEGREES = 10;
  const AIM_DEAD_ZONE_DEGREES = 3;
  const AIM_PER_TILT_DEGREE = 0.25;
  // Calibrated from iPhone captures: gentle 18 m/s^2 / 380 deg/s falls short, medium 27 / 630 reaches
  // the cups, firm 50-60 / 900 overshoots the table
  const ACCELERATION_FLOOR = 5;
  const ACCELERATION_CEILING = 60;
  const ROTATION_FLOOR = 150;
  const ROTATION_CEILING = 1000;
  const FULL_CHARGE_MS = 1500;
  const GRAVITY = 9.82;
  // Ball leaves the hand this high above the table; distances are measured to where it meets the table
  const LAUNCH_HEIGHT = 1;
  // Calibration targets, in metres from the throw spot along the table
  const CALIBRATION_NEAR_DISTANCE = 3;
  const CALIBRATION_FAR_DISTANCE = 6;
  // How far past the player's calibrated soft/full swings a throw may extrapolate
  const MIN_EFFORT = -0.6;
  const MAX_EFFORT = 1.4;
  const MIN_SPREAD = { acceleration: 3, rotation: 60 };

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const toRadians = degrees => degrees * Math.PI / 180;

  const scale = (value, floor, ceiling) => clamp((value - floor) / (ceiling - floor), 0, 1);

  // Throw strength from the phone's peak linear acceleration (m/s^2, gravity removed) and peak
  // total rotation rate (deg/s, all axes), averaged so a quick wrist twist alone can't max it out
  function powerFromMotion(peakAcceleration, peakRotationRate) {
    return (scale(peakAcceleration, ACCELERATION_FLOOR, ACCELERATION_CEILING) +
      scale(peakRotationRate, ROTATION_FLOOR, ROTATION_CEILING)) / 2;
  }

  // Hold-to-charge fallback for devices without motion sensors: power rises to full, then falls
  // back again, so the player has to time the release
  function powerFromHold(heldMs) {
    const phase = (Math.max(heldMs, 0) % (2 * FULL_CHARGE_MS)) / FULL_CHARGE_MS;
    return phase <= 1 ? phase : 2 - phase;
  }

  // Sideways phone tilt (degrees) while holding Aim; positive aims to the thrower's right. Small
  // tilts are ignored so a slightly crooked grip still aims straight.
  function aimFromTilt(tiltDegrees) {
    const beyondDeadZone = Math.max(Math.abs(tiltDegrees) - AIM_DEAD_ZONE_DEGREES, 0);
    if (beyondDeadZone === 0) return 0;
    return clamp(Math.sign(tiltDegrees) * beyondDeadZone * AIM_PER_TILT_DEGREE, -MAX_AIM_DEGREES, MAX_AIM_DEGREES);
  }

  // The camera looks down +z, so the thrower's right is -x
  function launchVelocity(power, aimDegrees) {
    const speed = MIN_SPEED + clamp(power, 0, 1) * (MAX_SPEED - MIN_SPEED);
    const elevation = toRadians(LAUNCH_ELEVATION_DEGREES);
    const aim = toRadians(clamp(aimDegrees, -MAX_AIM_DEGREES, MAX_AIM_DEGREES));
    const horizontal = speed * Math.cos(elevation);
    return {
      x: -horizontal * Math.sin(aim),
      y: speed * Math.sin(elevation),
      z: horizontal * Math.cos(aim)
    };
  }

  // Power that lands the ball on the table this far from the throw spot (inverse of launchVelocity)
  function powerForDistance(distance) {
    const elevation = toRadians(LAUNCH_ELEVATION_DEGREES);
    const cos = Math.cos(elevation);
    const speed = Math.sqrt(GRAVITY * distance * distance /
      (2 * cos * cos * (distance * Math.tan(elevation) + LAUNCH_HEIGHT)));
    return clamp((speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED), 0, 1);
  }

  // Peak of a sensor stream that survives a single-sample glitch (a knock on the phone, a dropped
  // reading): the second-highest sample once there is more than one
  function createPeakTracker() {
    let highest = 0;
    let second = 0;
    let count = 0;
    return {
      add(value) {
        if (!Number.isFinite(value) || value < 0) return;
        count++;
        if (value > highest) {
          second = highest;
          highest = value;
        } else if (value > second) {
          second = value;
        }
      },
      get value() {
        return count > 1 ? second : highest;
      }
    };
  }

  const mean = values => values.reduce((sum, v) => sum + v, 0) / values.length;

  // Builds a per-player calibration from soft swings at the near target and full swings at the far
  // target; each swing is { acceleration, rotation } peaks. Returns null when the two sets of swings
  // can't be told apart, so the player can redo it.
  function createCalibration(nearSwings, farSwings) {
    const near = { acceleration: mean(nearSwings.map(s => s.acceleration)), rotation: mean(nearSwings.map(s => s.rotation)) };
    const far = { acceleration: mean(farSwings.map(s => s.acceleration)), rotation: mean(farSwings.map(s => s.rotation)) };
    const usable = ['acceleration', 'rotation'].filter(k => far[k] - near[k] >= MIN_SPREAD[k]);
    if (usable.length === 0) return null;
    return { near, far, usable, nearDistance: CALIBRATION_NEAR_DISTANCE, farDistance: CALIBRATION_FAR_DISTANCE };
  }

  // Where a swing sends the ball, interpolating between the player's own soft and full swings
  function distanceFromCalibration(calibration, acceleration, rotation) {
    const peaks = { acceleration, rotation };
    const effort = clamp(mean(calibration.usable.map(k =>
      (peaks[k] - calibration.near[k]) / (calibration.far[k] - calibration.near[k]))), MIN_EFFORT, MAX_EFFORT);
    return calibration.nearDistance + effort * (calibration.farDistance - calibration.nearDistance);
  }

  const api = {
    powerFromMotion, powerFromHold, aimFromTilt, launchVelocity, powerForDistance,
    createCalibration, distanceFromCalibration, createPeakTracker,
    MAX_AIM_DEGREES, CALIBRATION_NEAR_DISTANCE, CALIBRATION_FAR_DISTANCE
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.ThrowModel = api;
  }
})(this);
