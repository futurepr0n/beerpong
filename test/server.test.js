const test = require('node:test');
const assert = require('node:assert');
const { io } = require('socket.io-client');
const server = require('../server');

let url;
const sockets = [];

test.before(() => new Promise(resolve => server.listen(0, () => {
  url = `http://localhost:${server.address().port}`;
  resolve();
})));

test.after(() => {
  sockets.forEach(socket => socket.close());
  return new Promise(resolve => server.close(resolve));
});

function connect() {
  const socket = io(url, { transports: ['websocket'], forceNew: true });
  sockets.push(socket);
  return new Promise(resolve => socket.on('connect', () => resolve(socket)));
}

const request = (socket, event, ...args) => new Promise(resolve => socket.emit(event, ...args, resolve));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function collectThrows(socket) {
  const received = [];
  socket.on('throw', velocity => received.push(velocity));
  return received;
}

async function pairedRoom() {
  const game = await connect();
  const controller = await connect();
  const { code } = await request(game, 'create-room');
  await request(controller, 'join-room', code);
  return { game, controller, code, received: collectThrows(game) };
}

test('game gets a 4-character room code and keeps it on repeat requests', async () => {
  const game = await connect();
  const { code } = await request(game, 'create-room');
  assert.match(code, /^[A-Z2-9]{4}$/);
  assert.strictEqual((await request(game, 'create-room')).code, code);
});

test('joining an unknown room is rejected', async () => {
  const controller = await connect();
  assert.deepStrictEqual(await request(controller, 'join-room', 'ZZZZ'), { error: 'Room not found' });
  assert.deepStrictEqual(await request(controller, 'join-room', 42), { error: 'Room not found' });
});

test('room codes are case-insensitive and trimmed', async () => {
  const game = await connect();
  const controller = await connect();
  const { code } = await request(game, 'create-room');
  assert.deepStrictEqual(await request(controller, 'join-room', ` ${code.toLowerCase()} `), { code });
});

test('throws before joining a room go nowhere', async () => {
  const game = await connect();
  const received = collectThrows(game);
  await request(game, 'create-room');
  const controller = await connect();
  controller.emit('throw', { x: 1, y: 1, z: 1 });
  await wait(100);
  assert.strictEqual(received.length, 0);
});

test('valid throw reaches only its own game, stripped to x/y/z', async () => {
  const { controller, received } = await pairedRoom();
  const other = await pairedRoom();
  controller.emit('throw', { x: 1, y: 2, z: 3, extra: '<script>' });
  await wait(100);
  assert.deepStrictEqual(received, [{ x: 1, y: 2, z: 3 }]);
  assert.strictEqual(other.received.length, 0);
});

test('invalid throws are dropped', async () => {
  const { controller, received } = await pairedRoom();
  for (const bad of [null, 'x', { x: '5', y: 1, z: 1 }, { x: null, y: 1, z: 1 }, { x: Infinity, y: 1, z: 1 },
    { x: NaN, y: 1, z: 1 }, { x: 51, y: 1, z: 1 }, { y: 1, z: 1 }]) {
    controller.emit('throw', bad);
  }
  await wait(100);
  assert.strictEqual(received.length, 0);
});

test('throws inside the cooldown are dropped', async () => {
  const { controller, received } = await pairedRoom();
  controller.emit('throw', { x: 1, y: 1, z: 1 });
  controller.emit('throw', { x: 2, y: 2, z: 2 });
  await wait(100);
  assert.strictEqual(received.length, 1);
  await wait(500);
  controller.emit('throw', { x: 3, y: 3, z: 3 });
  await wait(100);
  assert.strictEqual(received.length, 2);
});

test('controller is told when its game screen closes', async () => {
  const { game, controller } = await pairedRoom();
  const closed = new Promise(resolve => controller.on('room-closed', resolve));
  game.close();
  await wait(100);
  controller.emit('throw', { x: 1, y: 1, z: 1 });
  await closed;
});

function collectAims(socket) {
  const received = [];
  socket.on('aim', aim => received.push(aim));
  return received;
}

test('valid aim is relayed to the game; null clears it', async () => {
  const { game, controller } = await pairedRoom();
  const aims = collectAims(game);
  controller.emit('aim', { power: 0.5, aim: -3, extra: true });
  await wait(100);
  controller.emit('aim', null);
  await wait(100);
  assert.deepStrictEqual(aims, [{ power: 0.5, aim: -3 }, null]);
});

test('invalid or too-frequent aim updates are dropped', async () => {
  const { game, controller } = await pairedRoom();
  const aims = collectAims(game);
  for (const bad of ['x', { power: 2, aim: 0 }, { power: 0.5, aim: 45 }, { power: '0.5', aim: 0 }, { power: 0.5 }]) {
    controller.emit('aim', bad);
  }
  controller.emit('aim', { power: 0.1, aim: 0 });
  controller.emit('aim', { power: 0.2, aim: 0 });
  await wait(100);
  assert.deepStrictEqual(aims, [{ power: 0.1, aim: 0 }]);
});
