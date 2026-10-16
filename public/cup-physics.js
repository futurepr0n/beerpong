// Hollow cup physics shared by the browser game and the Node tests
(function (root) {
  const CUP_WALL_SEGMENTS = 16;
  const CUP_WALL_THICKNESS = 0.03;

  // Ring of thin wall boxes with an open top; the table acts as the cup floor
  function createCupBody(CANNON, radius, height, x, z) {
    const body = new CANNON.Body({ mass: 0 });
    const segmentWidth = 2 * radius * Math.tan(Math.PI / CUP_WALL_SEGMENTS) + CUP_WALL_THICKNESS;
    const wallShape = new CANNON.Box(new CANNON.Vec3(segmentWidth / 2, height / 2, CUP_WALL_THICKNESS / 2));

    for (let i = 0; i < CUP_WALL_SEGMENTS; i++) {
      const angle = (i / CUP_WALL_SEGMENTS) * Math.PI * 2;
      const offset = new CANNON.Vec3(radius * Math.cos(angle), 0, radius * Math.sin(angle));
      const orientation = new CANNON.Quaternion();
      orientation.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), Math.PI / 2 - angle);
      body.addShape(wallShape, offset, orientation);
    }

    body.position.set(x, height / 2, z);
    return body;
  }

  // Ball counts as sunk once it is fully below the rim and inside the wall ring
  function isBallInCup(ballPosition, ballRadius, cupPosition, radius, height) {
    const dx = ballPosition.x - cupPosition.x;
    const dz = ballPosition.z - cupPosition.z;
    const innerRadius = radius - CUP_WALL_THICKNESS / 2;
    const rimY = cupPosition.y + height / 2;
    return Math.sqrt(dx * dx + dz * dz) < innerRadius && ballPosition.y < rimY - ballRadius;
  }

  const api = { createCupBody, isBallInCup };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.CupPhysics = api;
  }
})(this);
