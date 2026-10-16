const socket = io();
const throwButton = document.getElementById('throwButton');
const statusDisplay = document.getElementById('statusDisplay');
const joinForm = document.getElementById('joinForm');
const roomInput = document.getElementById('roomInput');

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
      throwButton.hidden = true;
      statusDisplay.textContent = `${response.error}. Check the code on the game screen.`;
      return;
    }
    roomCode = response.code;
    joinForm.hidden = true;
    throwButton.hidden = false;
    statusDisplay.textContent = `Joined room ${roomCode}. ${warning || 'Hold to throw.'}`;
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

let motionReceived = false;
let currentTilt = 0;
let isThrowing = false;
let throwStart = null;
let peakFlickRate = 0;
let lastAimSent = 0;
let lastPointerX = 0;

window.addEventListener('deviceorientation', (event) => {
  if (event.gamma === null) return;
  orientationReceived = true;
  currentTilt = event.gamma;
});

// Forward wrist flick is rotation around the phone's x axis
window.addEventListener('devicemotion', (event) => {
  const rate = event.rotationRate && event.rotationRate.beta;
  if (typeof rate !== 'number') return;
  motionReceived = true;
  if (isThrowing) peakFlickRate = Math.max(peakFlickRate, Math.abs(rate));
});

function currentAim(pointerX) {
  if (orientationReceived) return ThrowModel.aimFromTilt(currentTilt - throwStart.tilt);
  const aim = (pointerX - throwStart.pointerX) * DRAG_AIM_DEGREES_PER_PX;
  return Math.min(Math.max(aim, -ThrowModel.MAX_AIM_DEGREES), ThrowModel.MAX_AIM_DEGREES);
}

function currentPower() {
  return motionReceived
    ? ThrowModel.powerFromFlick(peakFlickRate)
    : ThrowModel.powerFromHold(performance.now() - throwStart.time);
}

// Stream the aim to the game screen so it can draw the predicted arc
function sendAim(pointerX, force = false) {
  const now = performance.now();
  if (!force && now - lastAimSent < AIM_SEND_INTERVAL_MS) return;
  lastAimSent = now;
  const power = motionReceived ? PREVIEW_POWER_WITH_MOTION : currentPower();
  socket.emit('aim', { power, aim: currentAim(pointerX) });
  if (!motionReceived) throwButton.textContent = `Power ${Math.round(power * 100)}%`;
}

function resetThrowButton() {
  isThrowing = false;
  throwButton.textContent = 'Hold to Throw';
}

throwButton.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  throwButton.setPointerCapture(e.pointerId);
  isThrowing = true;
  peakFlickRate = 0;
  throwStart = { time: performance.now(), tilt: currentTilt, pointerX: e.clientX };
  statusDisplay.textContent = motionReceived
    ? 'Tilt to aim, flick your wrist forward and let go.'
    : 'Hold to charge power, drag left/right to aim, release to throw.';
  sendAim(e.clientX, true);

  const chargeLoop = () => {
    if (!isThrowing) return;
    sendAim(lastPointerX);
    requestAnimationFrame(chargeLoop);
  };
  lastPointerX = e.clientX;
  requestAnimationFrame(chargeLoop);
});

throwButton.addEventListener('pointermove', (e) => {
  if (isThrowing) lastPointerX = e.clientX;
});

// Abort the throw if the OS interrupts the touch
throwButton.addEventListener('pointercancel', () => {
  resetThrowButton();
  socket.emit('aim', null);
  statusDisplay.textContent = 'Throw cancelled. Hold to throw.';
});

throwButton.addEventListener('pointerup', (e) => {
  e.preventDefault();
  if (!isThrowing) return;
  const power = currentPower();
  const aim = currentAim(e.clientX);
  resetThrowButton();
  socket.emit('throw', ThrowModel.launchVelocity(power, aim));
  statusDisplay.textContent = `Thrown: power ${Math.round(power * 100)}%, aim ${aim.toFixed(1)}°`;
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
  throwButton.hidden = true;
  statusDisplay.textContent = 'Game screen closed. Enter a new room code.';
});

socket.on('disconnect', () => {
  statusDisplay.textContent = 'Disconnected from server.';
});