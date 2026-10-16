# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a beer pong game that uses real-time physics simulation with Three.js and cannon-es. The game consists of a Node.js/Express server with Socket.io for real-time communication and a browser-based game client with mobile controller support.

## Commands

- `npm start` - Start the server (port 9056; nginx proxy manager forwards pong.futurepr0n.com to it)
- `npm test` - Run all tests (Node's built-in test runner): cup physics, throw model, server sockets
- Production install: `npm ci --omit=dev`

## Architecture

### Backend (server.js)
- Express serves `public/`, plus `three` and `cannon-es` from `node_modules` at `/vendor/...`
- Rooms: each game screen gets a 4-character code; controllers join a room and only reach that game
- Validates and relays `throw` (velocity x/y/z, 500 ms cooldown) and `aim` (power 0-1, aim within +/-10 degrees, or null)
- Exports the HTTP server and only listens when run directly, so tests can start it on a random port

### Frontend Structure
- `public/index.html` - Landing page with navigation links
- `public/game.html` - Game view; loads `three` and `cannon-es` as ES modules via an import map
- `public/controller.html` - Mobile controller interface for throwing
- `public/game.js` - ES module: scene, lighting, physics, rack/score/win state, aim guide, Socket.io
- `public/cup-physics.js` - Tapered cup bodies, sink detection and rack layout (shared with `test/`)
- `public/throw-model.js` - Maps power/aim to launch velocity (shared by controller, game and `test/`)
- `public/controller.js` - Sensor permissions, flick/tilt or hold-to-charge/drag input, aim streaming

`cup-physics.js` and `throw-model.js` are classic scripts that set `window.CupPhysics` / `window.ThrowModel` in the browser and use `module.exports` in Node.

### Communication Flow
1. Controller joins a room by code (`?room=CODE` pre-fills it)
2. While the throw button is held, the controller streams `aim` so the game draws the predicted arc
3. On release, the controller converts power and aim to a launch velocity with `ThrowModel` and sends `throw`
4. Server validates and relays it to that room's game screen only
5. The game launches the ball with that velocity (capped at 20 m/s) and simulates it

### Throw Input
- With motion sensors (HTTPS + permission): power from peak forward wrist flick (`devicemotion` rotationRate.beta), aim from sideways tilt
- Without sensors: power charges up and back down while held (timing matters), aim by dragging left/right

### Physics System
- Fixed 1/480 s steps (sub-stepped per frame) so the ball cannot pass through cup walls
- Table is a solid box with edges; the ball can fall off and resets
- Cups are tapered rings of tilted wall boxes with the table as their floor; ball/cup bounce 0.4, friction 0.3, so balls can swirl, rattle or rim out
- A cup is sunk only when the ball reaches its bottom; the cup is cleared 1.5 s later
- Clearing all 6 cups shows a win banner and re-racks; `R` on the game screen re-racks any time
