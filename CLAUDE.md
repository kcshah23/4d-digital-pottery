# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

4D Digital Pottery — a hand-tracked immersive pottery sculpting experience. Users sculpt a 50,000-particle point cloud pot using Leap Motion hand gestures, with spring-mass physics, bloom post-processing, and Web Audio feedback. A postcard feature captures webcam + clay snapshots and emails them via EmailJS.

## Commands

- `npm install` — install dependencies
- `npm run dev` — starts both Leap WebSocket bridge and Vite dev server (port 5173)
- `npm run dev:vite` — Vite only (no Leap bridge, useful when working on UI/visuals)
- `npm run build` — production build via Vite (output in `dist/`)
- `npm run setup-leap-bridge` — one-time: clones and builds UltraleapTrackingWebSocket into `leap-bridge/` (requires git, cmake, libwebsockets)

There are no tests or linting configured.

## Architecture

### Rendering Pipeline
`src/main.js` is the entry point. It sets up Three.js with `EffectComposer` (UnrealBloom post-processing), creates the particle system, connects Leap Motion via LeapJS (WebSocket on port 6437), and runs the animation loop. The renderer uses `preserveDrawingBuffer: true` for canvas capture.

### Particle System (`src/particles/particleSystem.js`)
The core simulation. 50,000 particles exist as flat `Float32Array` buffers (no per-particle objects). Two attractor states:
- **Grid**: 3D rectangular lattice (shown when no hands detected)
- **Pot**: surface-of-revolution defined by `PROFILE` array (shown when hands present)

Particles blend between states via spring-mass physics (semi-implicit Euler, K=120, D=11). Sculpting writes to `sculptOff` (sculpt offset) array which modifies pot target positions. Ring topology (100 rings, ~500 particles/ring) enables Laplacian smoothing with 4-connected neighbors.

### Gesture Processing (in `src/main.js:processGestures`)
Transforms Leap hand data to particle-system local space, classifies gestures:
- **Pinch** (pinchStrength > 0.8): wall pull — moves particles at Y-band toward index tip
- **Two palms**: dynamic width — palm distance scales pot radius
- **Flat palm** (grab < 0.2, pinch < 0.3): Laplacian smoothing
- **Fist** (grabStrength > 0.8): reset sculpt offsets
- **Two-hand pinch**: triggers postcard/finish flow

### Leap Motion Integration
- `src/utils/leapCoordinates.js` — converts Leap mm coordinates to Three.js world space (scale 0.002, Y offset -0.15, Z negated)
- LeapJS connects via WebSocket at `ws://127.0.0.1:6437`
- Ultraleap Gemini V5+ removed built-in WebSocket; the `leap-bridge/` directory contains a clone of UltraleapTrackingWebSocket (C project) that provides it

### MCP Server (`mcp-leap/`)
A standalone MCP server (using `@modelcontextprotocol/sdk`) that connects to the Leap WebSocket and exposes `get_leap_hands` and `get_leap_frame_raw` tools. Configured in `.cursor/mcp.json`. Has its own `node_modules/`.

### Audio (`src/audio/audioManager.js`)
Raw Web Audio API — no library. Swoosh is generated white noise through a low-pass filter modulated by palm velocity. Squish plays `/squish.mp3` triggered by displacement magnitude changes.

### Postcard (`src/postcard/postcardManager.js`)
Captures webcam via `getUserMedia`, captures Three.js canvas, composites via `html2canvas`, sends via EmailJS. Config (`EMAILJS_CONFIG`) is at the top of `src/main.js`.

## Key Conventions

- ES modules throughout (`"type": "module"` in package.json)
- No framework — vanilla JS with Three.js
- Hot path (particle update) uses typed arrays and avoids allocations; do not introduce per-frame object creation in `particleSystem.js`
- LeapJS is loaded via `<script>` tag in `index.html` (not an npm import) — accessed as `window.Leap`
- `src/utils/deformation.js` contains a mesh-based deformation engine that is currently unused (the particle system replaced it) but kept for reference
