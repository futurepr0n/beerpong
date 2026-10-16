const socket = io();
const throwButton = document.getElementById('throwButton');
const statusDisplay = document.getElementById('statusDisplay');
const joinForm = document.getElementById('joinForm');
const roomInput = document.getElementById('roomInput');

let roomCode = null;
let orientationReceived = false;

roomInput.value = new URLSearchParams(location.search).get('room') || '';

// iOS 13+ only delivers orientation events after permission is granted from a user gesture
async function requestOrientationPermission() {
  if (typeof DeviceOrientationEvent === 'undefined' ||
      typeof DeviceOrientationEvent.requestPermission !== 'function') {
    return true;
  }
  try {
    return (await DeviceOrientationEvent.requestPermission()) === 'granted';
  } catch (err) {
    console.error('Orientation permission request failed:', err);
    return false;
  }
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
    warning = 'Motion sensors need HTTPS; default throws only.';
  } else if (!(await requestOrientationPermission())) {
    warning = 'Motion access denied; default throws only.';
  }
  joinRoom(roomInput.value, warning);
});

let initialOrientation = { beta: 0, gamma: 0 };
let currentOrientation = { beta: 0, gamma: 0 };
let isThrowing = false;
let throwStartTime = 0;
let orientationHistory = [];
let lastOrientationTime = 0;

// Track phone orientation
window.addEventListener('deviceorientation', (event) => {
  if (event.beta === null || event.gamma === null) return;
  orientationReceived = true;
  const timestamp = Date.now();
  currentOrientation.beta = event.beta;   // Forward/back tilt (degrees)
  currentOrientation.gamma = event.gamma; // Left/right tilt (degrees)
  
  // If throwing, record orientation with timestamp for velocity calculation
  if (isThrowing) {
    // Only record points at a reasonable interval (every 50ms) to avoid overwhelming
    if (timestamp - lastOrientationTime > 50) {
      orientationHistory.push({
        beta: currentOrientation.beta,
        gamma: currentOrientation.gamma,
        timestamp: timestamp
      });
      lastOrientationTime = timestamp;
    }
  }
});

// Start throw
throwButton.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (!orientationReceived) {
    statusDisplay.textContent = 'No motion data from this device. Default throw will be used.';
  }
  isThrowing = true;
  throwStartTime = Date.now();
  initialOrientation.beta = currentOrientation.beta;
  initialOrientation.gamma = currentOrientation.gamma;
  
  // Reset history for this throw
  orientationHistory = [{
    beta: initialOrientation.beta,
    gamma: initialOrientation.gamma,
    timestamp: throwStartTime
  }];
  lastOrientationTime = throwStartTime;
  
  if (orientationReceived) statusDisplay.textContent = 'Hold and swing your phone to throw...';
});

// Abort the throw if the OS interrupts the touch
throwButton.addEventListener('pointercancel', () => {
  isThrowing = false;
  statusDisplay.textContent = 'Throw cancelled. Hold to throw.';
});

// End throw and calculate velocity
throwButton.addEventListener('pointerup', (e) => {
  e.preventDefault();
  if (isThrowing) {
    isThrowing = false;
    const throwEndTime = Date.now();
    const throwDuration = (throwEndTime - throwStartTime) / 1000; // in seconds
    
    // Add the final position to history
    orientationHistory.push({
      beta: currentOrientation.beta,
      gamma: currentOrientation.gamma,
      timestamp: throwEndTime
    });
    
    // Calculate motion speed based on orientation history
    let maxAngularSpeed = 0;
    
    if (orientationHistory.length > 1) {
      for (let i = 1; i < orientationHistory.length; i++) {
        const prev = orientationHistory[i-1];
        const curr = orientationHistory[i];
        const dt = (curr.timestamp - prev.timestamp) / 1000; // time diff in seconds
        
        if (dt > 0) {
          const betaChange = Math.abs(curr.beta - prev.beta);
          const gammaChange = Math.abs(curr.gamma - prev.gamma);
          // Angular speed in degrees per second
          const angularSpeed = Math.sqrt(betaChange*betaChange + gammaChange*gammaChange) / dt;
          maxAngularSpeed = Math.max(maxAngularSpeed, angularSpeed);
        }
      }
    }
    
    // Calculate orientation change in radians (first to last point)
    const deltaBeta = (currentOrientation.beta - initialOrientation.beta) * (Math.PI / 180);
    const deltaGamma = (currentOrientation.gamma - initialOrientation.gamma) * (Math.PI / 180);
    
    // Base throw power depends on both angular velocity and throw duration
    // Short, fast throws or longer, controlled throws can both be effective
    const speedFactor = Math.min(maxAngularSpeed / 100, 2); // Cap at 2x, normalize by 100deg/s
    const durationFactor = Math.min(throwDuration / 1.5, 1); // Duration factor maxes at 1.5 seconds
    
    // Combined power factor
    const powerFactor = 0.5 + (speedFactor * 0.8) + (durationFactor * 0.2);
    
    // Base speed with dynamic adjustment
    const baseSpeed = 15; 
    const speed = baseSpeed * powerFactor;
    
    // Direction calculation - unchanged
    const direction = {
      x: -Math.sin(deltaGamma),              // Left/right tilt affects x
      y: Math.sin(deltaBeta),                // Forward tilt affects y
      z: Math.cos(deltaGamma) * Math.cos(deltaBeta) // Forward motion
    };
    
    // Normalize direction vector to ensure consistent throwing power
    const dirMagnitude = Math.sqrt(
      direction.x * direction.x + 
      direction.y * direction.y + 
      direction.z * direction.z
    );
    
    if (dirMagnitude > 0) {
      direction.x /= dirMagnitude;
      direction.y /= dirMagnitude;
      direction.z /= dirMagnitude;
    }
    
    const velocity = {
      x: direction.x * speed,
      y: direction.y * speed,
      z: direction.z * speed
    };
    
    // Minimal motion detection - with better conditions
    const totalMotion = Math.abs(deltaBeta) + Math.abs(deltaGamma);
    const minimalMotionThreshold = 0.15; // Slightly increased threshold
    
    if (totalMotion < minimalMotionThreshold || maxAngularSpeed < 20) {
      // Default throw with slight random variation for natural feel
      velocity.x = 0 + (Math.random() * 2 - 1); // Small random x variation
      velocity.y = 4;  // Slightly lower than before
      velocity.z = 8;  // Slightly lower than before
      statusDisplay.textContent = 'Minimal motion detected. Using default throw.';
    } else {
      statusDisplay.textContent = `Throw power: ${Math.round(powerFactor * 100)}%. Speed: ${Math.round(speed)}`;
    }
    
    console.log('Motion stats:', {
      deltaAngles: { beta: deltaBeta, gamma: deltaGamma },
      maxAngularSpeed: maxAngularSpeed,
      throwDuration: throwDuration,
      powerFactor: powerFactor,
      speed: speed
    });
    
    console.log('Sent velocity:', velocity);
    socket.emit('throw', velocity);
  }
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