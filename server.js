const crypto = require('crypto');
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { maxHttpBufferSize: 1e4 });

const MAX_VELOCITY_COMPONENT = 50;
const THROW_COOLDOWN_MS = 500;
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 4;

// Room code -> socket id of the game screen hosting it
const rooms = new Map();

// Serve static files from the 'public' directory
app.use(express.static('public'));

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

io.on('connection', (socket) => {
  console.log('A client connected:', socket.id);

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
    ack({ code: normalized });
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
    console.log('Client disconnected:', socket.id);
  });
});

// Start the server
const PORT = process.env.PORT || 9056;
http.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
