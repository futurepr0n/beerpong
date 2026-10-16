const crypto = require('crypto');
const path = require('path');
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { maxHttpBufferSize: 1e4 });

const MAX_VELOCITY_COMPONENT = 50;
const THROW_COOLDOWN_MS = 500;
const AIM_MIN_INTERVAL_MS = 50;
const MAX_AIM_DEGREES = 10;
const CALIBRATION_STYLES = ['overhand', 'underhand'];
const CALIBRATION_STAGES = ['point', 'far', 'near'];
const MAX_CALIBRATION_SWINGS = 5;
const THROW_DEBUG = process.env.THROW_DEBUG === '1';
const MAX_DEBUG_LOG_CHARS = 9500;
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 4;

// Room code -> socket id of the game screen hosting it
const rooms = new Map();

// Serve static files from the 'public' directory
// Revalidate app files on every load so phones pick up deploys; pinned vendor builds can cache
const revalidate = { setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') };
const vendorCache = { maxAge: '1d' };
app.use(express.static(path.join(__dirname, 'public'), revalidate));
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules/three/build'), vendorCache));
app.use('/vendor/cannon-es', express.static(path.join(__dirname, 'node_modules/cannon-es/dist'), vendorCache));

function generateRoomCode() {
  let code;
  do {
    code = Array.from(crypto.randomBytes(ROOM_CODE_LENGTH), (b) => ROOM_CODE_CHARS[b % ROOM_CODE_CHARS.length]).join('');
  } while (rooms.has(code));
  return code;
}

function parseThrow(data) {
  if (!data || typeof data !== 'object') return null;
  const velocity = {};
  for (const axis of ['x', 'y', 'z']) {
    const value = data[axis];
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_VELOCITY_COMPONENT) {
      return null;
    }
    velocity[axis] = value;
  }
  return velocity;
}

// null clears the aim guide; otherwise power 0-1 and aim within +/-MAX_AIM_DEGREES
function parseAim(data) {
  if (data === null) return null;
  if (!data || typeof data !== 'object') return undefined;
  const { power, aim } = data;
  if (typeof power !== 'number' || !Number.isFinite(power) || power < 0 || power > 1) return undefined;
  if (typeof aim !== 'number' || !Number.isFinite(aim) || Math.abs(aim) > MAX_AIM_DEGREES) return undefined;
  return { power, aim };
}

// null clears it; otherwise { style, stage, attempt, total } from fixed lists and small integers
function parseCalibrationProgress(data) {
  if (data === null) return null;
  if (!data || typeof data !== 'object') return undefined;
  const { style, stage, attempt, total } = data;
  const isCount = n => Number.isInteger(n) && n >= 0 && n <= MAX_CALIBRATION_SWINGS;
  if (!CALIBRATION_STYLES.includes(style) || !CALIBRATION_STAGES.includes(stage)) return undefined;
  if (!isCount(attempt) || !isCount(total)) return undefined;
  return { style, stage, attempt, total };
}

io.on('connection', (socket) => {

  // A game screen asks for a room code
  socket.on('create-room', (ack) => {
    if (typeof ack !== 'function') return;
    if (!socket.data.hostedRoom) {
      socket.data.hostedRoom = generateRoomCode();
      rooms.set(socket.data.hostedRoom, socket.id);
    }
    ack({ code: socket.data.hostedRoom });
  });

  // A controller pairs with a game screen
  socket.on('join-room', (code, ack) => {
    if (typeof ack !== 'function') return;
    const normalized = typeof code === 'string' ? code.trim().toUpperCase() : '';
    if (!rooms.has(normalized)) {
      ack({ error: 'Room not found' });
      return;
    }
    socket.data.room = normalized;
    ack({ code: normalized, debug: THROW_DEBUG });
  });

  // Calibration progress mirrored on the game screen, or null when the player finishes or cancels
  socket.on('calibration', (data) => {
    const gameSocketId = rooms.get(socket.data.room);
    if (!gameSocketId) return;
    const progress = parseCalibrationProgress(data);
    if (progress === undefined) return;
    io.to(gameSocketId).emit('calibration', progress);
  });

  // Sensor capture from a controller, logged only while THROW_DEBUG=1 for tuning throw input
  socket.on('throw-debug', (data) => {
    if (!THROW_DEBUG || !rooms.has(socket.data.room) || !data || typeof data !== 'object') return;
    const now = Date.now();
    if (now - (socket.data.lastDebugTime || 0) < THROW_COOLDOWN_MS) return;
    socket.data.lastDebugTime = now;
    console.log('[throw-debug]', JSON.stringify(data).slice(0, MAX_DEBUG_LOG_CHARS));
  });

  // Live aim from a controller while the throw button is held
  socket.on('aim', (data) => {
    const gameSocketId = rooms.get(socket.data.room);
    if (!gameSocketId) return;

    const now = Date.now();
    const aim = parseAim(data);
    if (aim === undefined) return;
    if (aim !== null && now - (socket.data.lastAimTime || 0) < AIM_MIN_INTERVAL_MS) return;

    socket.data.lastAimTime = now;
    io.to(gameSocketId).emit('aim', aim);
  });

  // When the controller sends a throw
  socket.on('throw', (data) => {
    const gameSocketId = rooms.get(socket.data.room);
    if (!gameSocketId) {
      if (socket.data.room) socket.emit('room-closed');
      return;
    }

    const now = Date.now();
    if (now - (socket.data.lastThrowTime || 0) < THROW_COOLDOWN_MS) return;

    const velocity = parseThrow(data);
    if (!velocity) {
      console.error('Invalid throw data received from', socket.id);
      return;
    }

    socket.data.lastThrowTime = now;
    io.to(gameSocketId).emit('throw', velocity);
  });

  socket.on('disconnect', () => {
    if (socket.data.hostedRoom) rooms.delete(socket.data.hostedRoom);
  });
});

// Start the server when run directly; tests import it and pick their own port
if (require.main === module) {
  const PORT = process.env.PORT || 9056;
  http.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = http;
