// Scene setup
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 2.8, -4.2);
camera.lookAt(0, 0, 1);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xffffff, 0x334433, 0.6));
const sunLight = new THREE.DirectionalLight(0xffffff, 0.9);
sunLight.position.set(2, 6, -3);
sunLight.target.position.set(0, 0, 1.5);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
Object.assign(sunLight.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3 });
scene.add(sunLight, sunLight.target);

// Physics setup
const world = new CANNON.World();
world.gravity.set(0, -9.82, 0);

// Table
const tableGeometry = new THREE.PlaneGeometry(4, 8);
const tableMaterial = new THREE.MeshStandardMaterial({ color: 0x228B22, roughness: 0.8 });
const tableMesh = new THREE.Mesh(tableGeometry, tableMaterial);
tableMesh.rotation.x = -Math.PI / 2;
tableMesh.receiveShadow = true;
scene.add(tableMesh);

const ballPhysicsMaterial = new CANNON.Material('ball');
const tablePhysicsMaterial = new CANNON.Material('table');
const cupPhysicsMaterial = new CANNON.Material('cup');
world.addContactMaterial(new CANNON.ContactMaterial(ballPhysicsMaterial, tablePhysicsMaterial, { restitution: 0.6, friction: 0.3 }));
world.addContactMaterial(new CANNON.ContactMaterial(ballPhysicsMaterial, cupPhysicsMaterial, { restitution: 0.4, friction: 0.3 }));

const tableBody = new CANNON.Body({ mass: 0, material: tablePhysicsMaterial });
tableBody.addShape(new CANNON.Plane());
tableBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
world.addBody(tableBody);

// Cups: tapered and open-topped, red outside, white inside, with liquid at the bottom
const cupShape = { topRadius: 0.2, bottomRadius: 0.14, height: 0.5 };
const cups = [];
const cupSpacing = cupShape.topRadius * 2 + 0.02;
const cupPositions = [
  [0, 0, 1.8],
  [cupSpacing / 2, 0, 1.8 + cupSpacing * Math.sqrt(3) / 2],
  [-cupSpacing / 2, 0, 1.8 + cupSpacing * Math.sqrt(3) / 2]
];
const cupWallGeometry = new THREE.CylinderGeometry(cupShape.topRadius, cupShape.bottomRadius, cupShape.height, 48, 1, true);
const cupRimGeometry = new THREE.TorusGeometry(cupShape.topRadius, 0.012, 8, 48);
const cupLiquidGeometry = new THREE.CircleGeometry(cupShape.bottomRadius, 32);
const cupOutsideMaterial = new THREE.MeshStandardMaterial({ color: 0xd01818, roughness: 0.4, side: THREE.FrontSide });
const cupInsideMaterial = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6, side: THREE.BackSide });
const cupLiquidMaterial = new THREE.MeshStandardMaterial({ color: 0xc8901a, roughness: 0.2 });

function createCupMesh(x, z) {
  const group = new THREE.Group();
  const outside = new THREE.Mesh(cupWallGeometry, cupOutsideMaterial);
  const inside = new THREE.Mesh(cupWallGeometry, cupInsideMaterial);
  outside.castShadow = true;
  inside.receiveShadow = true;
  [outside, inside].forEach(mesh => mesh.position.y = cupShape.height / 2);

  const rim = new THREE.Mesh(cupRimGeometry, cupInsideMaterial.clone());
  rim.material.side = THREE.FrontSide;
  rim.rotation.x = Math.PI / 2;
  rim.position.y = cupShape.height;

  const liquid = new THREE.Mesh(cupLiquidGeometry, cupLiquidMaterial);
  liquid.rotation.x = -Math.PI / 2;
  liquid.position.y = 0.003;
  liquid.receiveShadow = true;

  group.add(outside, inside, rim, liquid);
  group.position.set(x, 0, z);
  return group;
}

cupPositions.forEach(([x, , z]) => {
  const mesh = createCupMesh(x, z);
  scene.add(mesh);
  const body = CupPhysics.createCupBody(CANNON, cupShape, x, z, cupPhysicsMaterial);
  world.addBody(body);
  cups.push({ mesh, body });
});

// Ball (regulation ping pong ball to cup proportions)
const ballRadius = 0.08;
const ballGeometry = new THREE.SphereGeometry(ballRadius, 32, 32);
const ballMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
const ballMesh = new THREE.Mesh(ballGeometry, ballMaterial);
ballMesh.castShadow = true;
scene.add(ballMesh);

const ballStartPosition = new CANNON.Vec3(0, 1, -2.6);
const maxBallSpeed = 20;
const ballBody = new CANNON.Body({ mass: 0.054, material: ballPhysicsMaterial });
ballBody.addShape(new CANNON.Sphere(ballRadius));
world.addBody(ballBody);

// Hold the ball still at the throw spot until the next throw releases it
function holdBall() {
  ballBody.type = CANNON.Body.KINEMATIC;
  ballBody.position.copy(ballStartPosition);
  ballBody.velocity.set(0, 0, 0);
  ballBody.angularVelocity.set(0, 0, 0);
}
holdBall();

// Socket.io connection
const socket = io();

// Visual feedback elements
const throwFeedback = document.createElement('div');
throwFeedback.style.position = 'absolute';
throwFeedback.style.top = '10px';
throwFeedback.style.left = '10px';
throwFeedback.style.color = 'white';
throwFeedback.style.fontSize = '16px';
throwFeedback.style.fontFamily = 'Arial, sans-serif';
document.body.appendChild(throwFeedback);

const roomDisplay = document.createElement('div');
roomDisplay.style.position = 'absolute';
roomDisplay.style.top = '10px';
roomDisplay.style.right = '10px';
roomDisplay.style.color = 'white';
roomDisplay.style.fontSize = '20px';
roomDisplay.style.fontFamily = 'Arial, sans-serif';
roomDisplay.style.textAlign = 'right';
document.body.appendChild(roomDisplay);

// Ask the server for a room code; a reconnect gets a fresh one
socket.on('connect', () => {
  socket.emit('create-room', ({ code }) => {
    const controllerUrl = `${location.origin}/controller.html?room=${code}`;
    roomDisplay.innerHTML = '';
    const codeLine = document.createElement('div');
    codeLine.style.fontSize = '36px';
    codeLine.textContent = `Room: ${code}`;
    const urlLine = document.createElement('div');
    urlLine.textContent = controllerUrl;
    roomDisplay.append(codeLine, urlLine);
  });
});

socket.on('disconnect', () => {
  roomDisplay.textContent = 'Disconnected. Reconnecting...';
});

// Ball state tracker
let ballInFlight = false;
let lastThrowTime = 0;
let pendingResetTimer = null;
const resetDelay = 5000; // 5 seconds

// Reset ball if it goes out of bounds or stops moving
function checkBallReset() {
  const pos = ballBody.position;
  const vel = ballBody.velocity;
  const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
  
  // Reset if out of bounds or if it's been moving too long
  if (pos.y < -5 || pos.x < -10 || pos.x > 10 || pos.z < -10 || pos.z > 10 || 
      (Date.now() - lastThrowTime > resetDelay && speed < 0.5 && ballInFlight)) {
    ballInFlight = false;
    holdBall();
    throwFeedback.textContent = '';  // Clear feedback
  }
}

// Sink detection runs after the physics step so bodies are never removed mid-step.
// The ball stays visibly in the cup for a moment before the cup is cleared.
const sinkDisplayDelay = 1500;
let sinkingCup = null;

function checkCupSink() {
  if (!ballInFlight) return;
  const sunkCup = cups.find(cup =>
    CupPhysics.isBallInCup(ballBody.position, ballRadius, cup.body.position, cupShape));
  if (!sunkCup) return;

  ballInFlight = false;
  sinkingCup = sunkCup;
  throwFeedback.textContent = 'Cup sunk! 🎉';
  clearTimeout(pendingResetTimer);
  pendingResetTimer = setTimeout(finishSink, sinkDisplayDelay);
}

function finishSink() {
  if (sinkingCup) {
    scene.remove(sinkingCup.mesh);
    world.removeBody(sinkingCup.body);
    cups.splice(cups.indexOf(sinkingCup), 1);
    sinkingCup = null;
  }
  holdBall();
  throwFeedback.textContent = '';
}

// Handle throw event
socket.on('throw', (velocityDevice) => {
  // Use a dynamic scale factor based on the velocity magnitude
  const velocityMagnitude = Math.sqrt(
    velocityDevice.x * velocityDevice.x + 
    velocityDevice.y * velocityDevice.y + 
    velocityDevice.z * velocityDevice.z
  );
  
  // Adjust scale factor based on magnitude - lower for strong throws
  let scaleFactor = 1.5;
  if (velocityMagnitude > 20) {
    scaleFactor = 1.2; // Less amplification for stronger throws
  } else if (velocityMagnitude < 10) {
    scaleFactor = 1.8; // More amplification for weaker throws
  }
  
  // Apply the velocity with the dynamic scale factor
  const vGame = new CANNON.Vec3(
    velocityDevice.x * scaleFactor,
    velocityDevice.y * scaleFactor,
    velocityDevice.z * scaleFactor
  );

  // Cap speed so the ball cannot tunnel through cups between physics steps
  const gameSpeed = vGame.length();
  if (gameSpeed > maxBallSpeed) vGame.scale(maxBallSpeed / gameSpeed, vGame);

  clearTimeout(pendingResetTimer);
  if (sinkingCup) finishSink();
  
  // Set ball position and apply velocity
  holdBall();
  ballBody.type = CANNON.Body.DYNAMIC;
  ballBody.velocity.set(vGame.x, vGame.y, vGame.z);
  
  // Visual feedback
  throwFeedback.textContent = `Throw power: ${Math.round(velocityMagnitude)}`;
  
  // Update ball state
  ballInFlight = true;
  lastThrowTime = Date.now();
  
  console.log('Applied velocity:', vGame);
});

// Animation loop: fixed physics step independent of display refresh rate
const physicsTimeStep = 1 / 480;
const maxSubSteps = 50;
let lastFrameTime = performance.now();

function animate(now = performance.now()) {
  requestAnimationFrame(animate);
  const frameDelta = Math.min((now - lastFrameTime) / 1000, 0.1);
  lastFrameTime = now;
  world.step(physicsTimeStep, frameDelta, maxSubSteps);

  // Sync ball mesh with physics body
  ballMesh.position.copy(ballBody.position);
  ballMesh.quaternion.copy(ballBody.quaternion);
  
  // Check if ball needs reset
  checkCupSink();
  checkBallReset();

  renderer.render(scene, camera);
}

animate();

// Handle window resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});