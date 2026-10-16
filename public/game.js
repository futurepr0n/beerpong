// Scene setup
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 5, -5);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Physics setup
const world = new CANNON.World();
world.gravity.set(0, -9.82, 0);

// Table
const tableGeometry = new THREE.PlaneGeometry(4, 8);
const tableMaterial = new THREE.MeshBasicMaterial({ color: 0x228B22 });
const tableMesh = new THREE.Mesh(tableGeometry, tableMaterial);
tableMesh.rotation.x = -Math.PI / 2;
scene.add(tableMesh);

const tableBody = new CANNON.Body({ mass: 0 });
tableBody.addShape(new CANNON.Plane());
tableBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
world.addBody(tableBody);
tableBody.material = new CANNON.Material();
tableBody.material.restitution = 0.5;

// Cups
const cupRadius = 0.2;
const cupHeight = 0.5;
const cups = [];
const cupPositions = [
  [0, 0, 2], [0.3, 0, 1.8], [-0.3, 0, 1.8] // Simplified triangle formation
];

cupPositions.forEach((pos) => {
  const cupGeometry = new THREE.CylinderGeometry(cupRadius, cupRadius, cupHeight, 32);
  const cupMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
  const cupMesh = new THREE.Mesh(cupGeometry, cupMaterial);
  cupMesh.position.set(pos[0], cupHeight / 2, pos[2]);
  scene.add(cupMesh);

  const cupBody = new CANNON.Body({ mass: 0 });
  cupBody.addShape(new CANNON.Cylinder(cupRadius, cupRadius, cupHeight, 16));
  cupBody.position.set(pos[0], cupHeight / 2, pos[2]);
  // CANNON.Cylinder is built along Z; rotate it upright to match the Three.js cylinder (Y axis)
  cupBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
  world.addBody(cupBody);

  cups.push({ mesh: cupMesh, body: cupBody, position: pos });
});

// Ball
const ballRadius = 0.05;
const ballGeometry = new THREE.SphereGeometry(ballRadius, 32, 32);
const ballMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
const ballMesh = new THREE.Mesh(ballGeometry, ballMaterial);
scene.add(ballMesh);

const ballStartPosition = new CANNON.Vec3(0, 1, -3);
const maxBallSpeed = 20;
const ballBody = new CANNON.Body({ mass: 1 });
ballBody.addShape(new CANNON.Sphere(ballRadius));
ballBody.position.copy(ballStartPosition);
world.addBody(ballBody);
ballBody.material = new CANNON.Material();
ballBody.material.restitution = 0.8;

// Contact material for realistic bouncing
const contactMaterial = new CANNON.ContactMaterial(ballBody.material, tableBody.material, { restitution: 0.7 });
world.addContactMaterial(contactMaterial);

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
    ballBody.position.copy(ballStartPosition); // Reset position
    ballBody.velocity.set(0, 0, 0);  // Stop movement
    throwFeedback.textContent = '';  // Clear feedback
  }
}

// Collision detection
ballBody.addEventListener('collide', (event) => {
  const otherBody = event.body;
  const hitCup = cups.find(cup => cup.body === otherBody);
  if (hitCup) {
    scene.remove(hitCup.mesh);
    world.removeBody(hitCup.body);
    cups.splice(cups.indexOf(hitCup), 1);
    throwFeedback.textContent = 'Cup hit! 🎉';
    console.log('Cup hit!');
    
    // Reset the ball after a cup hit
    clearTimeout(pendingResetTimer);
    pendingResetTimer = setTimeout(() => {
      ballInFlight = false;
      ballBody.position.copy(ballStartPosition);
      ballBody.velocity.set(0, 0, 0);
      throwFeedback.textContent = '';
    }, 2000);
  }
});

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
  
  // Set ball position and apply velocity
  ballBody.position.copy(ballStartPosition);
  ballBody.velocity.set(vGame.x, vGame.y, vGame.z);
  
  // Visual feedback
  throwFeedback.textContent = `Throw power: ${Math.round(velocityMagnitude)}`;
  
  // Update ball state
  ballInFlight = true;
  lastThrowTime = Date.now();
  
  console.log('Applied velocity:', vGame);
});

// Animation loop: fixed physics step independent of display refresh rate
const physicsTimeStep = 1 / 240;
const maxSubSteps = 20;
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