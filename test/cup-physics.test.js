const test = require('node:test');
const assert = require('node:assert');
const CANNON = require('cannon-es');
const { createCupBody, innerRadiusAt, isBallInCup, rackPositions } = require('../public/cup-physics');

const CUP = { topRadius: 0.2, bottomRadius: 0.14, height: 0.5 };
const BALL_RADIUS = 0.08;
const TIME_STEP = 1 / 480;

function simulate(ballStart, ballVelocity, seconds = 3) {
  const world = new CANNON.World();
  world.gravity.set(0, -9.82, 0);
  const ballMaterial = new CANNON.Material();
  const cupMaterial = new CANNON.Material();
  world.addContactMaterial(new CANNON.ContactMaterial(ballMaterial, cupMaterial, { restitution: 0.4, friction: 0.3 }));

  const table = new CANNON.Body({ mass: 0 });
  table.addShape(new CANNON.Plane());
  table.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
  world.addBody(table);

  const cup = createCupBody(CANNON, CUP, 0, 0, cupMaterial);
  world.addBody(cup);

  const ball = new CANNON.Body({ mass: 0.054, material: ballMaterial });
  ball.addShape(new CANNON.Sphere(BALL_RADIUS));
  ball.position.set(...ballStart);
  ball.velocity.set(...ballVelocity);
  world.addBody(ball);

  let revolutions = 0;
  let lastAngle = Math.atan2(ball.position.z, ball.position.x);
  for (let i = 0; i < seconds / TIME_STEP; i++) {
    world.step(TIME_STEP);
    const angle = Math.atan2(ball.position.z, ball.position.x);
    let delta = angle - lastAngle;
    if (delta > Math.PI) delta -= 2 * Math.PI;
    if (delta < -Math.PI) delta += 2 * Math.PI;
    lastAngle = angle;
    if (isBallInCup(ball.position, BALL_RADIUS, cup.position, CUP)) {
      return { sunk: true, revolutions, seconds: i * TIME_STEP, ball };
    }
    if (ball.position.y < CUP.height) revolutions += Math.abs(delta) / (2 * Math.PI);
  }
  return { sunk: false, revolutions, ball };
}

test('ball dropped into the cup opening falls to the bottom and is sunk', () => {
  assert.strictEqual(simulate([0, 1, 0], [0, 0, 0]).sunk, true);
});

test('ball entering along the wall swirls around the cup before sinking', () => {
  const { sunk, revolutions, seconds } = simulate([0.09, 0.45, 0], [0, -0.5, 3]);
  assert.strictEqual(sunk, true);
  assert.ok(revolutions > 1, `expected the ball to circle the cup, got ${revolutions.toFixed(2)} revolutions`);
  assert.ok(seconds > 0.5, `expected a slow spiral down, sank after ${seconds.toFixed(2)} s`);
});

test('centered lob from the throw distance lands in the cup', () => {
  // Reaches the cup at t=1 s just above the rim: vz = 5, vy = 0.55 - 1 + g/2
  assert.strictEqual(simulate([0, 1, -5], [0, 4.46, 5]).sunk, true);
});

test('lob that clips the rim bounces out', () => {
  assert.strictEqual(simulate([0, 1, -5], [0.12, 4.46, 5]).sunk, false);
});

test('lob that overshoots misses', () => {
  assert.strictEqual(simulate([0, 1, -5], [0, 4.46, 5.6]).sunk, false);
});

test('fast ball hitting the side of the cup bounces off instead of passing through', () => {
  const { sunk, ball } = simulate([0, 0.25, -1.5], [0, 0, 20], 0.5);
  assert.strictEqual(sunk, false);
  assert.ok(ball.position.z < -CUP.topRadius, `ball ended at z=${ball.position.z}, past the cup wall`);
});

test('ball still inside the cup but above the bottom is not yet sunk', () => {
  const cupPosition = { x: 0, y: CUP.height / 2, z: 0 };
  assert.strictEqual(isBallInCup({ x: 0, y: 0.3, z: 0 }, BALL_RADIUS, cupPosition, CUP), false);
  assert.strictEqual(isBallInCup({ x: 0, y: BALL_RADIUS, z: 0 }, BALL_RADIUS, cupPosition, CUP), true);
  assert.strictEqual(isBallInCup({ x: 0.3, y: BALL_RADIUS, z: 0 }, BALL_RADIUS, cupPosition, CUP), false);
});

test('innerRadiusAt tapers from bottom to top radius', () => {
  assert.strictEqual(innerRadiusAt(CUP, 0), CUP.bottomRadius);
  assert.strictEqual(innerRadiusAt(CUP, CUP.height), CUP.topRadius);
  assert.strictEqual(innerRadiusAt(CUP, -1), CUP.bottomRadius);
});

test('rackPositions builds a 1-2-3 triangle with no overlapping cups', () => {
  const spacing = CUP.topRadius * 2 + 0.02;
  const positions = rackPositions(3, 1.8, spacing);
  assert.strictEqual(positions.length, 6);
  assert.deepStrictEqual(positions[0], { x: 0, z: 1.8 });
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const distance = Math.hypot(positions[i].x - positions[j].x, positions[i].z - positions[j].z);
      assert.ok(distance >= CUP.topRadius * 2, `cups ${i} and ${j} overlap (${distance.toFixed(3)} m apart)`);
    }
  }
});
