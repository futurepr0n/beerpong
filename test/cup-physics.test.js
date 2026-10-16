const test = require('node:test');
const assert = require('node:assert');
const CANNON = require('cannon');
const { createCupBody, isBallInCup } = require('../public/cup-physics');

const CUP_RADIUS = 0.2;
const CUP_HEIGHT = 0.5;
const BALL_RADIUS = 0.05;
const TIME_STEP = 1 / 480;

function simulate(ballStart, ballVelocity, seconds = 2) {
  const world = new CANNON.World();
  world.gravity.set(0, -9.82, 0);

  const table = new CANNON.Body({ mass: 0 });
  table.addShape(new CANNON.Plane());
  table.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
  world.addBody(table);

  const cup = createCupBody(CANNON, CUP_RADIUS, CUP_HEIGHT, 0, 2);
  world.addBody(cup);

  const ball = new CANNON.Body({ mass: 1 });
  ball.addShape(new CANNON.Sphere(BALL_RADIUS));
  ball.position.set(...ballStart);
  ball.velocity.set(...ballVelocity);
  world.addBody(ball);

  let sunk = false;
  for (let i = 0; i < seconds / TIME_STEP && !sunk; i++) {
    world.step(TIME_STEP);
    sunk = isBallInCup(ball.position, BALL_RADIUS, cup.position, CUP_RADIUS, CUP_HEIGHT);
  }
  return { sunk, ball };
}

test('ball dropped into the cup opening is sunk', () => {
  assert.strictEqual(simulate([0, 1, 2], [0, 0, 0]).sunk, true);
});

test('ball dropped onto the rim is stopped by the rim instead of falling through', () => {
  // Free fall from y=1 reaches the rim (y=0.55 contact) at ~0.30 s; check just after impact
  const { ball } = simulate([CUP_RADIUS, 1, 2], [0, 0, 0], 0.35);
  assert.ok(ball.position.y > CUP_HEIGHT - BALL_RADIUS, `ball fell through the rim to y=${ball.position.y}`);
});

test('fast ball hitting the side of the cup bounces off and is not sunk', () => {
  const { sunk, ball } = simulate([0, 0.25, 0.5], [0, 0, 20], 0.5);
  assert.strictEqual(sunk, false);
  assert.ok(ball.position.z < 2 - CUP_RADIUS, `ball ended inside the cup wall at z=${ball.position.z}`);
});

test('arcing throw from the throw spot can land in the cup', () => {
  // Projectile from (0,1,-3) to (0,0.4,2): 5 m in 1 s needs vz=5, vy=(-0.6 + 4.91)/1
  assert.strictEqual(simulate([0, 1, -3], [0, 4.31, 5]).sunk, true);
});

test('isBallInCup rejects a ball above the rim or outside the ring', () => {
  const cupPosition = { x: 0, y: CUP_HEIGHT / 2, z: 0 };
  assert.strictEqual(isBallInCup({ x: 0, y: 0.6, z: 0 }, BALL_RADIUS, cupPosition, CUP_RADIUS, CUP_HEIGHT), false);
  assert.strictEqual(isBallInCup({ x: 0.3, y: 0.2, z: 0 }, BALL_RADIUS, cupPosition, CUP_RADIUS, CUP_HEIGHT), false);
  assert.strictEqual(isBallInCup({ x: 0.1, y: 0.2, z: 0 }, BALL_RADIUS, cupPosition, CUP_RADIUS, CUP_HEIGHT), true);
});
