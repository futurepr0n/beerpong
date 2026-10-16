// Hollow, tapered cup physics shared by the browser game and the Node tests
(function (root) {
  const CUP_WALL_SEGMENTS = 32;
  const CUP_WALL_THICKNESS = 0.02;
  const SETTLED_HEIGHT_TOLERANCE = 0.02;

  // Ring of tilted wall boxes, wider at the top; the table acts as the cup floor
  function createCupBody(CANNON, cup, x, z, material) {
    const body = new CANNON.Body({ mass: 0, material });
    const flare = cup.topRadius - cup.bottomRadius;
    const tilt = Math.atan2(flare, cup.height);
    const slantHeight = Math.sqrt(cup.height * cup.height + flare * flare);
    const segmentWidth = 2 * cup.topRadius * Math.tan(Math.PI / CUP_WALL_SEGMENTS) + CUP_WALL_THICKNESS;
    const midRadius = (cup.topRadius + cup.bottomRadius) / 2 + CUP_WALL_THICKNESS / 2;
    const wallShape = new CANNON.Box(new CANNON.Vec3(segmentWidth / 2, slantHeight / 2, CUP_WALL_THICKNESS / 2));
    const lean = new CANNON.Quaternion();
    lean.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), tilt);

    for (let i = 0; i < CUP_WALL_SEGMENTS; i++) {
      const angle = (i / CUP_WALL_SEGMENTS) * Math.PI * 2;
      const offset = new CANNON.Vec3(midRadius * Math.cos(angle), 0, midRadius * Math.sin(angle));
      const facing = new CANNON.Quaternion();
      facing.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), Math.PI / 2 - angle);
      body.addShape(wallShape, offset, facing.mult(lean));
    }

    body.position.set(x, cup.height / 2, z);
    return body;
  }

  // Inner wall radius at a height measured from the cup's base
  function innerRadiusAt(cup, heightAboveBase) {
    const t = Math.min(Math.max(heightAboveBase / cup.height, 0), 1);
    return cup.bottomRadius + (cup.topRadius - cup.bottomRadius) * t;
  }

  // Ball counts as sunk once it has dropped inside the cup all the way to the bottom
  function isBallInCup(ballPosition, ballRadius, cupPosition, cup) {
    const base = cupPosition.y - cup.height / 2;
    const heightAboveBase = ballPosition.y - base;
    const dx = ballPosition.x - cupPosition.x;
    const dz = ballPosition.z - cupPosition.z;
    return heightAboveBase < ballRadius + SETTLED_HEIGHT_TOLERANCE &&
      Math.sqrt(dx * dx + dz * dz) < innerRadiusAt(cup, heightAboveBase);
  }

  // Triangle rack with its point toward the thrower: 1 cup in front, then 2, 3, ...
  function rackPositions(rowCount, apexZ, spacing) {
    const positions = [];
    for (let row = 0; row < rowCount; row++) {
      const z = apexZ + row * spacing * Math.sqrt(3) / 2;
      for (let i = 0; i <= row; i++) {
        positions.push({ x: (i - row / 2) * spacing, z });
      }
    }
    return positions;
  }

  const api = { createCupBody, innerRadiusAt, isBallInCup, rackPositions };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.CupPhysics = api;
  }
})(this);
