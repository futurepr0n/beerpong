# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a beer pong game that uses real-time physics simulation with Three.js and Cannon.js. The game consists of a Node.js/Express server with Socket.io for real-time communication and a browser-based game client with mobile controller support.

## Commands

- `npm start` - Start the development server (runs on port 9056)
- `node server.js` - Alternative way to start the server

## Architecture

### Backend (server.js)
- Express server serving static files from the `public` directory
- Socket.io handles real-time communication between game clients and mobile controllers
- Validates and broadcasts throw data between connected clients

### Frontend Structure
- `public/index.html` - Main landing page with navigation links
- `public/game.html` - Game view with 3D beer pong table and physics
- `public/controller.html` - Mobile controller interface for throwing
- `public/game.js` - Three.js scene setup, physics simulation, and Socket.io integration
- `public/controller.js` - Mobile device orientation tracking and throw gesture detection

### Key Dependencies
- `express` - Web server framework
- `socket.io` - Real-time bidirectional communication
- `cannon` - Physics engine (loaded via CDN in browser)
- Three.js - 3D graphics (loaded via CDN in browser)

### Communication Flow
1. Mobile controller tracks device orientation during throw gestures
2. Controller calculates throw velocity based on orientation changes
3. Throw data is sent to server via Socket.io
4. Server validates and broadcasts throw data to all game clients
5. Game clients receive throw data and simulate ball physics

### Physics System
- Uses Cannon.js for realistic physics simulation
- Table is represented as a static plane body
- Cups are positioned in triangle formation with collision detection
- Ball physics include gravity, bounce, and collision responses

## File Structure
- `server.js` - Main server file
- `public/` - Static web assets
  - HTML files for different views (index, game, controller)
  - JavaScript files for client-side logic
- `package.json` - Node.js dependencies and scripts