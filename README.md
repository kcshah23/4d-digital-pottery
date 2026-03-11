# 4D Digital Pottery

A hand-tracked, immersive pottery sculpting experience using Three.js, Leap Motion (LeapJS), Web Audio, and EmailJS.

## Prerequisites

- **Leap Motion / Ultraleap** controller
- **WebSocket on port 6437** (see below)
- A `squish.mp3` audio file (place in `/public/`)

### WebSocket for Ultraleap (Required if you see "Waiting for connection")

With **Ultraleap Gemini V5+** (Ultraleap Control Panel), the built-in WebSocket was removed. You need to run **[UltraleapTrackingWebSocket](https://github.com/ultraleap/UltraleapTrackingWebSocket)** alongside the Control Panel:

1. Clone and build:
   ```bash
   git clone https://github.com/ultraleap/UltraleapTrackingWebSocket.git
   cd UltraleapTrackingWebSocket
   mkdir build && cd build
   cmake .. && cmake --build .
   ```
2. **macOS:** Install libwebsockets: `brew install libwebsockets`
3. Run the built executable (it listens on `ws://127.0.0.1:6437/v6.json`)

With this running, the app will connect and the clay will respond to your hands.

## Setup

```bash
npm install
```

Add your `squish.mp3` to the `public/` folder.

**One-time: build the Leap WebSocket bridge** (required for Ultraleap hand tracking):

```bash
npm run setup-leap-bridge
```

This clones and builds UltraleapTrackingWebSocket. You need: `git`, `cmake`, and `libwebsockets` (on macOS: `brew install cmake libwebsockets`).

## Run

```bash
npm run dev
```

This starts both the Leap WebSocket bridge (if built) and the app. If you haven’t run `setup-leap-bridge`, the app will still start but won’t connect to Leap. Use `npm run dev:vite` to run only the app.

## Features

- **Phase 1:** Full-screen canvas, LeapJS integration, coordinate mapping
- **Phase 2:** Clay geometry (subdivided cylinder), PBR material, realistic lighting
- **Phase 3:** Hand molding – inside push (bulge), outside push (indent), smooth deformation
- **Phase 4:** Swoosh audio (velocity), squish audio (deformation)
- **Phase 5:** Postcard overlay with webcam + clay snapshot, EmailJS send

## Controls

- Move hands over the clay to sculpt
- **Two-hand pinch** or **press F** to finish and open the postcard
- Fill the form and send via EmailJS (see `EMAILJS_SETUP.md`)

## Texture Placeholders

For more realistic clay, add normal and roughness maps. In `src/main.js`, uncomment and configure:

```js
const textureLoader = new THREE.TextureLoader();
const clayMaterial = new THREE.MeshStandardMaterial({
  // ...existing props...
  normalMap: textureLoader.load('/textures/clay_normal.jpg'),
  roughnessMap: textureLoader.load('/textures/clay_roughness.jpg'),
});
```

Place textures in `public/textures/`.

## Project Structure

```
├── index.html
├── package.json
├── vite.config.js
├── src/
│   ├── main.js           # Entry, Three.js, Leap, animation
│   ├── styles.css
│   ├── utils/
│   │   ├── leapCoordinates.js  # Leap → Three.js conversion
│   │   └── deformation.js      # Vertex deformation logic
│   ├── audio/
│   │   └── audioManager.js     # Swoosh & squish
│   └── postcard/
│       └── postcardManager.js  # Webcam, canvas, html2canvas, EmailJS
├── public/
│   └── squish.mp3         # Add your squish sound here
└── EMAILJS_SETUP.md
```
