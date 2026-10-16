const socket = io();
const throwButton = document.getElementById('throwButton');
const statusDisplay = document.getElementById('statusDisplay');
const joinForm = document.getElementById('joinForm');
const roomInput = document.getElementById('roomInput');
const playControls = document.getElementById('playControls');
const styleButtons = [...document.querySelectorAll('.styleButton')];
const calibrationStatus = document.getElementById('calibrationStatus');
const calibrateButton = document.getElementById('calibrateButton');
const calibrationModal = document.getElementById('calibrationModal');
const calibrationTitle = document.getElementById('calibrationTitle');
const calibrationProgress = document.getElementById('calibrationProgress');
const calibrationText = document.getElementById('calibrationText');
const calibrationSetButton = document.getElementById('calibrationSetButton');
const calibrationStartButton = document.getElementById('calibrationStartButton');
const calibrationSwingButton = document.getElementById('calibrationSwingButton');
const calibrationCancelButton = document.getElementById('calibrationCancelButton');
const swingButtons = [throwButton, calibrationSwingButton];
const aimButton = document.getElementById('aimButton');
const aimDisplay = document.getElementById('aimDisplay');

let roomCode = null;
let orientationReceived = false;

roomInput.value = new URLSearchParams(location.search).get('room') || '';

// iOS 13+ only delivers motion and orientation events after permission is granted from a user gesture
async function requestSensorPermission(SensorEvent) {
  if (typeof SensorEvent === 'undefined' || typeof SensorEvent.requestPermission !== 'function') {
    return true;
  }
  try {
    return (await SensorEvent.requestPermission()) === 'granted';
  } catch (err) {
    console.error('Sensor permission request failed:', err);
    return false;
  }
}

async function requestMotionPermissions() {
  const orientationGranted = await requestSensorPermission(window.DeviceOrientationEvent);
  const motionGranted = await requestSensorPermission(window.DeviceMotionEvent);
  return orientationGranted && motionGranted;
}

function joinRoom(code, warning = '') {
  socket.emit('join-room', code, (response) => {
    if (response.error) {
      roomCode = null;
      joinForm.hidden = false;
      playControls.hidden = true;
      statusDisplay.textContent = `${response.error}. Check the code on the game screen.`;
      return;
    }
    roomCode = response.code;
    debugEnabled = response.debug === true;
    joinForm.hidden = true;
    playControls.hidden = false;
    statusDisplay.textContent = `Joined room ${roomCode}. ${warning || 'Hold to throw.'}`;
    renderStyle();
    setTimeout(offerCalibrationIfNeeded, 800);
  });
}

joinForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  let warning = '';
  if (!window.isSecureContext) {
    warning = 'Motion sensors need HTTPS; hold to charge, drag to aim.';
  } else if (!(await requestMotionPermissions())) {
    warning = 'Motion access denied; hold to charge, drag to aim.';
  }
  joinRoom(roomInput.value, warning);
});

const AIM_SEND_INTERVAL_MS = 100;
const DRAG_AIM_DEGREES_PER_PX = 0.05;
const PREVIEW_POWER_WITH_MOTION = 0.5;
// Arc preview while aiming lands around the middle of the rack
const PREVIEW_DISTANCE = 4.6;
// The throw motion peaks around the moment the button is released, so keep reading briefly after
const POST_RELEASE_CAPTURE_MS = 120;
// A little over the server's 500 ms cooldown, which silently drops faster throws
const THROW_COOLDOWN_MS = 600;
const GRAVITY = 9.81;

let motionReceived = false;
let currentTilt = 0;
let currentOrientation = { alpha: null, beta: null, gamma: null };
let orientationAtPeak = null;
let isThrowing = false;
let throwStart = null;
let isCapturing = false;
let swingPointerId = null;
let lastThrowTime = -Infinity;
let accelerationPeak = ThrowModel.createPeakTracker();
let rotationPeak = ThrowModel.createPeakTracker();
let peakAcceleration = 0;
let peakRotationRate = 0;
// Aim is set with the Aim button and stays locked for every throw until re-aimed; tilt during a
// throw is ignored
let lockedAim = 0;
let aimStart = null;
let lastAimSent = 0;

window.addEventListener('deviceorientation', (event) => {
  if (event.gamma === null) return;
  orientationReceived = true;
  currentTilt = event.gamma;
  currentOrientation = { alpha: event.alpha, beta: event.beta, gamma: event.gamma };
});

const magnitude = (v, keys) => Math.sqrt(keys.reduce((sum, k) => sum + (v[k] || 0) ** 2, 0));

// Linear acceleration without gravity; some devices only report it with gravity included
function accelerationMagnitude(event) {
  const a = event.acceleration;
  if (a && typeof a.x === 'number') return magnitude(a, ['x', 'y', 'z']);
  const g = event.accelerationIncludingGravity;
  if (g && typeof g.x === 'number') return Math.abs(magnitude(g, ['x', 'y', 'z']) - GRAVITY);
  return null;
}

window.addEventListener('devicemotion', (event) => {
  const acceleration = accelerationMagnitude(event);
  const rotation = event.rotationRate && typeof event.rotationRate.alpha === 'number'
    ? magnitude(event.rotationRate, ['alpha', 'beta', 'gamma'])
    : null;
  if (acceleration === null && rotation === null) return;
  motionReceived = true;
  if (!isCapturing) return;

  if (acceleration !== null) accelerationPeak.add(acceleration);
  if (rotation !== null) rotationPeak.add(rotation);
  if (accelerationPeak.value > peakAcceleration) orientationAtPeak = { ...currentOrientation };
  peakAcceleration = accelerationPeak.value;
  peakRotationRate = rotationPeak.value;
  if (debugEnabled) recordDebugSample(event);
});

// Throw tuning: when the server has THROW_DEBUG=1, send raw sensor samples recorded during each throw
const DEBUG_MAX_SAMPLES = 60;
let debugEnabled = false;
let debugSamples = [];
let debugInterval = null;

const round = value => (typeof value === 'number' ? Math.round(value * 10) / 10 : null);

function recordDebugSample(event) {
  const r = event.rotationRate || {};
  const a = event.acceleration || {};
  const g = event.accelerationIncludingGravity || {};
  debugInterval = event.interval;
  debugSamples.push([Math.round(performance.now() - throwStart.time),
    round(r.alpha), round(r.beta), round(r.gamma), round(a.x), round(a.y), round(a.z), round(g.x), round(g.y), round(g.z),
    round(currentOrientation.alpha), round(currentOrientation.beta), round(currentOrientation.gamma)]);
}

const roundOrientation = o => (o ? { alpha: round(o.alpha), beta: round(o.beta), gamma: round(o.gamma) } : null);

function sendThrowDebug(power, aim, extra = {}) {
  if (!debugEnabled) return;
  const step = Math.max(1, Math.ceil(debugSamples.length / DEBUG_MAX_SAMPLES));
  const reference = screenYaw[swingStyle];
  socket.emit('throw-debug', {
    style: swingStyle,
    calibrated: Boolean(calibrations[swingStyle]),
    ...extra,
    startOrientation: roundOrientation(throwStart.orientation),
    peakOrientation: roundOrientation(orientationAtPeak),
    releaseOrientation: roundOrientation(currentOrientation),
    yawAtPeakFromScreen: reference !== undefined && orientationAtPeak ? round(yawDifference(orientationAtPeak.alpha, reference)) : null,
    heldMs: Math.round(performance.now() - throwStart.time),
    power: round(power), aim: round(aim),
    peakAcceleration: round(peakAcceleration), peakRotationRate: round(peakRotationRate),
    lockedAim: round(lockedAim), startTilt: round(throwStart.tilt), releaseTilt: round(currentTilt),
    motionReceived, orientationReceived, interval: debugInterval,
    sampleCount: debugSamples.length,
    fields: 't,rotA,rotB,rotG,accX,accY,accZ,gX,gY,gZ,oA,oB,oG',
    samples: debugSamples.filter((_, i) => i % step === 0),
    ua: navigator.userAgent.slice(0, 120)
  });
}

function currentPower() {
  if (!motionReceived) return ThrowModel.powerFromHold(performance.now() - throwStart.time);
  const calibration = calibrations[swingStyle];
  if (!calibration) return ThrowModel.powerFromMotion(peakAcceleration, peakRotationRate);
  return ThrowModel.powerForDistance(
    ThrowModel.distanceFromCalibration(calibration, peakAcceleration, peakRotationRate));
}

// Swing styles and per-player calibration, saved on this phone
const STYLES = ['overhand', 'underhand'];
const SWINGS_PER_TARGET = 2;
const storageKey = style => `beerpong.calibration.${style}`;
let swingStyle = 'overhand';
const calibrations = {};
// Compass heading of the game screen per style; device yaw is only meaningful within this page load
const screenYaw = {};
let calibrationSession = null;

function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch (err) {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    console.error('Could not save calibration:', err);
  }
}

function isValidCalibration(c) {
  const finitePeaks = p => p && Number.isFinite(p.acceleration) && Number.isFinite(p.rotation);
  return Boolean(c) && finitePeaks(c.near) && finitePeaks(c.far) && Array.isArray(c.usable) &&
    c.usable.length > 0 && c.usable.every(k => ['acceleration', 'rotation'].includes(k) && c.far[k] > c.near[k]) &&
    Number.isFinite(c.nearDistance) && Number.isFinite(c.farDistance) && c.farDistance > c.nearDistance;
}

for (const style of STYLES) {
  try {
    const saved = JSON.parse(readStorage(storageKey(style)));
    if (isValidCalibration(saved)) calibrations[style] = saved;
  } catch (err) {
    console.error('Ignoring unreadable calibration for', style);
  }
}
if (STYLES.includes(readStorage('beerpong.style'))) swingStyle = readStorage('beerpong.style');

const yawDifference = (alpha, reference) => ((alpha - reference + 540) % 360) - 180;

function renderStyle() {
  styleButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.style === swingStyle)));
  const calibrated = Boolean(calibrations[swingStyle]);
  calibrationStatus.textContent = calibrated
    ? `Using your saved ${swingStyle} calibration`
    : `${swingStyle} swing not calibrated yet; calibrate for accurate throws`;
  calibrateButton.textContent = calibrated ? 'Recalibrate' : 'Calibrate';
}

styleButtons.forEach(button => button.addEventListener('click', () => {
  if (calibrationSession) return;
  swingStyle = button.dataset.style;
  writeStorage('beerpong.style', swingStyle);
  renderStyle();
  offerCalibrationIfNeeded();
}));

const capitalize = word => word[0].toUpperCase() + word.slice(1);
const CALIBRATION_STEP_COUNT = 1 + 2 * SWINGS_PER_TARGET;

// Full-screen calibration modal; the same progress is mirrored on the game screen
function showCalibrationStep(text, { set = false, start = false, swing = false } = {}) {
  const { stage, swings } = calibrationSession;
  calibrationModal.hidden = false;
  calibrationTitle.textContent = `${capitalize(swingStyle)} calibration`;
  calibrationText.textContent = text;
  calibrationSetButton.hidden = !set;
  calibrationStartButton.hidden = !start;
  calibrationSwingButton.hidden = !swing;
  calibrationCancelButton.textContent = stage === 'intro' ? 'Skip for now' : 'Cancel';

  const done = stage === 'intro' || stage === 'point' ? 0
    : 1 + swings.far.length + (stage === 'near' ? swings.near.length : 0);
  calibrationProgress.textContent = stage === 'intro' ? '' : `Step ${done + 1} of ${CALIBRATION_STEP_COUNT}`;

  if (stage === 'intro') return;
  const attempt = stage === 'point' ? 0 : swings[stage].length + 1;
  socket.emit('calibration', { style: swingStyle, stage, attempt, total: SWINGS_PER_TARGET });
}

function openCalibration({ intro = false } = {}) {
  if (!motionReceived) {
    statusDisplay.textContent = 'Calibration needs motion sensors (HTTPS and motion access).';
    return;
  }
  if (isCapturing) return;
  calibrationSession = { stage: intro ? 'intro' : 'point', swings: { far: [], near: [] } };
  socket.emit('aim', null);
  if (intro) {
    showCalibrationStep(`Calibrate your ${swingStyle} swing so throws match how you move. It takes about 30 seconds ` +
      'and is saved on this phone for every game.', { start: true });
  } else {
    promptPointStep();
  }
}

function promptPointStep() {
  calibrationSession.stage = 'point';
  showCalibrationStep(`Hold your phone in your ${swingStyle} starting position, point it at the game screen, then tap Set.`,
    { set: true });
}

function closeCalibration() {
  if (!calibrationSession) return;
  calibrationSession = null;
  socket.emit('calibration', null);
  calibrationModal.hidden = true;
  renderStyle();
}

function promptCalibrationSwing(prefix = '') {
  const { stage, swings } = calibrationSession;
  const attempt = swings[stage].length + 1;
  showCalibrationStep(prefix + (stage === 'far'
    ? `Far target: hold the button and do a full swing that feels good (${attempt} of ${SWINGS_PER_TARGET}).`
    : `Near target: hold the button and do a softer swing (${attempt} of ${SWINGS_PER_TARGET}).`),
  { swing: true });
}

calibrateButton.addEventListener('click', () => openCalibration());
calibrationStartButton.addEventListener('click', promptPointStep);
calibrationCancelButton.addEventListener('click', () => {
  if (!isCapturing) closeCalibration();
});

calibrationSetButton.addEventListener('click', () => {
  if (!calibrationSession || calibrationSession.stage !== 'point') return;
  if (currentOrientation.alpha !== null) screenYaw[swingStyle] = currentOrientation.alpha;
  calibrationSession.startOrientation = { ...currentOrientation };
  calibrationSession.stage = 'far';
  promptCalibrationSwing();
});

// New phones (or a style never calibrated on this phone) get offered calibration after joining
const calibrationOffered = new Set();
function offerCalibrationIfNeeded() {
  if (!motionReceived || calibrations[swingStyle] || calibrationSession || calibrationOffered.has(swingStyle)) return;
  calibrationOffered.add(swingStyle);
  openCalibration({ intro: true });
}

// One calibration swing: the ball is sent onto the target so the player sees what the swing means
function recordCalibrationSwing() {
  const session = calibrationSession;
  const stage = session.stage;
  const distance = stage === 'far' ? ThrowModel.CALIBRATION_FAR_DISTANCE : ThrowModel.CALIBRATION_NEAR_DISTANCE;
  session.swings[stage].push({ acceleration: peakAcceleration, rotation: peakRotationRate });
  socket.emit('throw', ThrowModel.launchVelocity(ThrowModel.powerForDistance(distance), 0));
  sendThrowDebug(null, 0, { calibrationStage: stage, calibrationAttempt: session.swings[stage].length });

  if (session.swings[stage].length < SWINGS_PER_TARGET) {
    promptCalibrationSwing();
  } else if (stage === 'far') {
    session.stage = 'near';
    promptCalibrationSwing();
  } else {
    finishCalibration();
  }
}

function finishCalibration() {
  const calibration = ThrowModel.createCalibration(calibrationSession.swings.near, calibrationSession.swings.far);
  if (!calibration) {
    calibrationSession.swings = { far: [], near: [] };
    calibrationSession.stage = 'far';
    promptCalibrationSwing('Your soft and full swings came out too similar, so let\'s redo them. ');
    return;
  }
  calibration.startOrientation = calibrationSession.startOrientation;
  calibrations[swingStyle] = calibration;
  writeStorage(storageKey(swingStyle), JSON.stringify(calibration));
  // Delayed past the server's debug cooldown, which the last calibration swing just used
  if (debugEnabled) setTimeout(() => socket.emit('throw-debug', { calibrationResult: swingStyle, calibration }), 700);
  closeCalibration();
  statusDisplay.textContent = `${capitalize(swingStyle)} swing calibrated and saved on this phone. Hold to throw.`;
}

renderStyle();

// Stream the aim to the game screen so it can draw the predicted arc
function sendAim(force = false) {
  if (calibrationSession) return;
  const now = performance.now();
  if (!force && now - lastAimSent < AIM_SEND_INTERVAL_MS) return;
  lastAimSent = now;
  const power = motionReceived ? previewPower() : currentPower();
  socket.emit('aim', { power, aim: lockedAim });
  if (!motionReceived) activeSwingButton.textContent = `Power ${Math.round(power * 100)}%`;
}

function resetThrowButton() {
  isThrowing = false;
  throwButton.textContent = 'Hold to Throw';
  calibrationSwingButton.textContent = 'Hold to Swing';
}

let activeSwingButton = throwButton;

function onSwingStart(e) {
  e.preventDefault();
  if (isCapturing) return;
  if (performance.now() - lastThrowTime < THROW_COOLDOWN_MS) {
    (calibrationSession ? calibrationText : statusDisplay).textContent = 'Wait a moment before the next throw.';
    return;
  }
  // Lock any aim still being held so tilting during the swing can't move it
  finishAiming();
  activeSwingButton = e.currentTarget;
  activeSwingButton.setPointerCapture(e.pointerId);
  swingPointerId = e.pointerId;
  isThrowing = true;
  isCapturing = true;
  accelerationPeak = ThrowModel.createPeakTracker();
  rotationPeak = ThrowModel.createPeakTracker();
  peakAcceleration = 0;
  peakRotationRate = 0;
  orientationAtPeak = null;
  debugSamples = [];
  throwStart = { time: performance.now(), tilt: currentTilt, orientation: { ...currentOrientation } };
  if (!calibrationSession) statusDisplay.textContent = motionReceived
    ? 'Swing and let go.'
    : 'Hold to charge power, drag left/right to aim, release to throw.';
  sendAim(true);

  const chargeLoop = () => {
    if (!isThrowing) return;
    sendAim();
    requestAnimationFrame(chargeLoop);
  };
  requestAnimationFrame(chargeLoop);
}

// Stop long-press and drags anywhere on the page from selecting text, opening the copy/context
// menu, scrolling or zooming; only the join form keeps normal touch behaviour
const allowsNativeTouch = target =>
  joinForm.contains(target) ||
  Boolean(target.closest && target.closest('button') && !swingButtons.includes(target) && target !== aimButton);
for (const type of ['touchstart', 'touchmove', 'touchend']) {
  document.addEventListener(type, (e) => {
    if (!allowsNativeTouch(e.target) && e.cancelable) e.preventDefault();
  }, { passive: false });
}
document.addEventListener('contextmenu', (e) => {
  if (!allowsNativeTouch(e.target)) e.preventDefault();
});
document.addEventListener('selectstart', (e) => {
  if (e.target !== roomInput) e.preventDefault();
});

// Abort the throw if the OS interrupts the touch
function onSwingCancel(e) {
  if (e && e.pointerId !== swingPointerId) return;
  if (!isCapturing) return;
  isCapturing = false;
  swingPointerId = null;
  resetThrowButton();
  socket.emit('aim', null);
  statusDisplay.textContent = 'Throw cancelled. Hold to throw.';
}

function finishThrow() {
  // Cancelled during the post-release capture window
  if (!isCapturing) return;
  swingPointerId = null;
  lastThrowTime = performance.now();
  if (calibrationSession) {
    isCapturing = false;
    resetThrowButton();
    recordCalibrationSwing();
    return;
  }
  const power = currentPower();
  const aim = lockedAim;
  isCapturing = false;
  resetThrowButton();
  socket.emit('throw', ThrowModel.launchVelocity(power, aim));
  sendThrowDebug(power, aim, calibrations[swingStyle]
    ? { distance: round(ThrowModel.distanceFromCalibration(calibrations[swingStyle], peakAcceleration, peakRotationRate)) }
    : {});
  statusDisplay.textContent = `Thrown: power ${Math.round(power * 100)}%, aim ${aim.toFixed(1)}°`;
}

function onSwingEnd(e) {
  e.preventDefault();
  if (!isThrowing || e.pointerId !== swingPointerId) return;
  isThrowing = false;
  if (motionReceived) {
    activeSwingButton.textContent = 'Throwing...';
    setTimeout(finishThrow, POST_RELEASE_CAPTURE_MS);
  } else {
    finishThrow();
  }
}

function previewPower() {
  return calibrations[swingStyle] ? ThrowModel.powerForDistance(PREVIEW_DISTANCE) : PREVIEW_POWER_WITH_MOTION;
}

function describeAim(aim) {
  if (aim === 0) return 'Aim: straight';
  return `Aim: ${Math.abs(aim).toFixed(1)}° ${aim > 0 ? 'right' : 'left'}`;
}

function aimFromInput(pointerX) {
  if (orientationReceived) return ThrowModel.aimFromTilt(currentTilt - aimStart.tilt);
  const aim = (pointerX - aimStart.pointerX) * DRAG_AIM_DEGREES_PER_PX;
  return Math.min(Math.max(aim, -ThrowModel.MAX_AIM_DEGREES), ThrowModel.MAX_AIM_DEGREES);
}

function updateAim(pointerX) {
  lockedAim = Math.round(aimFromInput(pointerX) * 10) / 10;
  aimDisplay.textContent = describeAim(lockedAim);
  const now = performance.now();
  if (now - lastAimSent < AIM_SEND_INTERVAL_MS) return;
  lastAimSent = now;
  socket.emit('aim', { power: previewPower(), aim: lockedAim });
}

aimButton.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (isCapturing || aimStart) return;
  aimButton.setPointerCapture(e.pointerId);
  aimStart = { tilt: currentTilt, pointerX: e.clientX, lastPointerX: e.clientX, pointerId: e.pointerId };
  aimButton.classList.add('aiming');
  aimButton.textContent = orientationReceived ? 'Tilt left/right...' : 'Drag left/right...';
  const aimLoop = () => {
    if (!aimStart) return;
    updateAim(aimStart.lastPointerX);
    requestAnimationFrame(aimLoop);
  };
  requestAnimationFrame(aimLoop);
});

aimButton.addEventListener('pointermove', (e) => {
  if (aimStart && e.pointerId === aimStart.pointerId) aimStart.lastPointerX = e.clientX;
});

function finishAiming(e) {
  if (!aimStart || (e && e.pointerId !== aimStart.pointerId)) return;
  updateAim(aimStart.lastPointerX);
  aimStart = null;
  aimButton.classList.remove('aiming');
  aimButton.textContent = 'Hold to Aim';
  // Keep the locked arc on the big screen until the next throw
  socket.emit('aim', { power: previewPower(), aim: lockedAim });
  statusDisplay.textContent = `${describeAim(lockedAim)} locked. Hold Throw and swing.`;
}

aimButton.addEventListener('pointerup', finishAiming);
aimButton.addEventListener('pointercancel', finishAiming);

for (const button of swingButtons) {
  button.addEventListener('pointerdown', onSwingStart);
  button.addEventListener('pointercancel', onSwingCancel);
  button.addEventListener('pointerup', onSwingEnd);
}

// Backgrounding the page (call, app switch) stops sensor events; drop whatever was in progress
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  finishAiming();
  if (isCapturing) onSwingCancel();
});

// Connection feedback
socket.on('connect', () => {
  if (roomCode) {
    joinRoom(roomCode);
  } else {
    statusDisplay.textContent = 'Connected. Enter the room code shown on the game screen.';
  }
});

socket.on('room-closed', () => {
  roomCode = null;
  joinForm.hidden = false;
  playControls.hidden = true;
  closeCalibration();
  statusDisplay.textContent = 'Game screen closed. Enter a new room code.';
});

socket.on('disconnect', () => {
  statusDisplay.textContent = 'Disconnected from server.';
});