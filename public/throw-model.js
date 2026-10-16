// Maps a player's throw (power 0-1, aim in degrees) to a launch velocity.
// Shared by the controller, the game's aim guide and the Node tests.
(function (root) {
  const LAUNCH_ELEVATION_DEGREES = 48;
  const MIN_SPEED = 4.5;
  const MAX_SPEED = 8.5;
  const MAX_AIM_DEGREES = 10;
  const FLICK_RATE_FLOOR = 150;
  const FLICK_RATE_CEILING = 900;
  const FULL_CHARGE_MS = 1500;

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const toRadians = degrees => degrees * Math.PI / 180;

  // Peak forward wrist-flick rate (deg/s) to power
  function powerFromFlick(peakRate) {
    return clamp((peakRate - FLICK_RATE_FLOOR) / (FLICK_RATE_CEILING - FLICK_RATE_FLOOR), 0, 1);
  }

  // Hold-to-charge fallback for devices without motion sensors: power rises to full, then falls
  // back again, so the player has to time the release
  function powerFromHold(heldMs) {
    const phase = (Math.max(heldMs, 0) % (2 * FULL_CHARGE_MS)) / FULL_CHARGE_MS;
    return phase <= 1 ? phase : 2 - phase;
  }

  // Sideways phone tilt (degrees) to aim; positive aims to the thrower's right
  function aimFromTilt(tiltDegrees) {
    return clamp(tiltDegrees * 0.3, -MAX_AIM_DEGREES, MAX_AIM_DEGREES);
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

  const api = { powerFromFlick, powerFromHold, aimFromTilt, launchVelocity, MAX_AIM_DEGREES };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.ThrowModel = api;
  }
})(this);
