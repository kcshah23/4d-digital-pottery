# 4D Digital Pottery

A hand-tracked, immersive pottery sculpting experience.
Sculpt a 50,000-particle pot in mid-air with an Ultraleap Leap Motion controller, then save your finished pot to a persistent web gallery.

Built with **Three.js**, **Ultraleap Leap Motion**, **Web Audio**, and **Supabase**.

---

## Table of Contents

1. [Hardware Required](#hardware-required)
2. [Software Prerequisites](#software-prerequisites)
3. [Quick Start](#quick-start)
4. [Installing the Ultraleap Stack (in depth)](#installing-the-ultraleap-stack-in-depth)
5. [The Leap WebSocket Bridge — why we built it, how it works](#the-leap-websocket-bridge--why-we-built-it-how-it-works)
6. [How Leap data flows through the app](#how-leap-data-flows-through-the-app)
7. [Gesture vocabulary (what your hands actually do)](#gesture-vocabulary-what-your-hands-actually-do)
8. [Running the app](#running-the-app)
9. [How to Use](#how-to-use)
10. [System Architecture](#system-architecture)
11. [Project Structure](#project-structure)
12. [Optional: the MCP server for live Leap introspection in Cursor](#optional-the-mcp-server-for-live-leap-introspection-in-cursor)
13. [Tech Stack](#tech-stack)
14. [Troubleshooting](#troubleshooting)
15. [Author](#author)

---

## Hardware Required

- **Ultraleap Leap Motion Controller** — original Leap Motion Controller or Leap Motion Controller 2. Gemini V5+ tracking is supported.
- A laptop / desktop with a modern browser (Chrome / Firefox / Safari).
- Speakers or headphones (for audio feedback).

> The Leap sensor should sit on the desk in front of the monitor, **facing up**, with your hands hovering above it. The app assumes the standard desktop orientation (X right, Y up, Z toward the user).

---

## Software Prerequisites

- **Node.js 18+** and **npm**
- **Ultraleap Hand Tracking Software** (Gemini V5 or above) — provides the system-level service the bridge talks to via LeapC.
- **For building the WebSocket bridge from source:**
  - `git`
  - `cmake` (3.16+)
  - `libwebsockets`
  - On macOS: `brew install cmake libwebsockets`
  - On Ubuntu/Debian: `sudo apt install cmake libwebsockets-dev`
  - On Windows: install via `vcpkg` (see below)
- A **Supabase** project (free tier is fine) with:
  - A public storage bucket called `postcard-images`
  - A table called `user_postcard_gallery` (image URL + particle positions JSONB)
  - See `CLAUDE.md` for schema details

---

## Quick Start

```bash
# 1. Install npm dependencies
npm install

# 2. One-time: build the Ultraleap WebSocket bridge
npm run setup-leap-bridge

# 3. Drop in your audio asset
#    Place a squish.mp3 file inside the public/ folder

# 4. Configure Supabase
#    Open src/supabase/supabaseClient.js and set your Supabase URL + anon key

# 5. Run everything
npm run dev
```

Then open **http://localhost:5173** in your browser.

---

## Installing the Ultraleap Stack (in depth)

The browser can't talk to a USB device directly — it only speaks WebSockets. Getting a Leap Motion controller to feed live hand data into a web app requires **three** independent layers, each of which must be working before the next one matters:

```
┌──────────────────────────┐
│ 1. Ultraleap Hand        │   System service + LeapC SDK
│    Tracking Software     │   (system-level driver, runs as a daemon)
└────────────┬─────────────┘
             │ shared memory / IPC
             ▼
┌──────────────────────────┐
│ 2. leap-bridge           │   Native C executable we build from source
│    (UltraleapTracking-   │   Talks LeapC inbound, WebSocket outbound
│     WebSocket)           │
└────────────┬─────────────┘
             │ ws://127.0.0.1:6437/v6.json
             ▼
┌──────────────────────────┐
│ 3. LeapJS in the browser │   public/leap.min.js + window.Leap.loop()
│    (src/main.js)         │
└──────────────────────────┘
```

### Step 1 — Install the Ultraleap Hand Tracking Software

Download and install the **Ultraleap Gemini V5+** package for your OS from <https://leap2.ultraleap.com/downloads>.

After install:

- **macOS:** the **Ultraleap Control Panel** app appears in `/Applications`. The tracking service runs as a launch daemon automatically. The `LeapSDK` is installed under `/Library/Application Support/Ultraleap/LeapSDK/`. The bridge's CMake file finds the SDK at that path automatically.
- **Windows:** the SDK is installed under `C:\Program Files\Ultraleap\`. The Control Panel runs from the system tray.
- **Linux (Ubuntu/Debian):** add Ultraleap's apt repository per their [Linux docs](https://docs.ultraleap.com/linux/), then `sudo apt install ultraleap-hand-tracking-service`. The SDK ends up at `/usr/share/doc/ultraleap-hand-tracking-service/lib/cmake/LeapSDK`.

**Sanity check:** open the **Ultraleap Control Panel**, plug in the Leap, hover your hands over it. You should see a 3D skeleton tracked in real time. If this doesn't work, nothing else will — fix this first.

### Step 2 — Build the WebSocket bridge

This is the part that didn't exist for free. See [the next section](#the-leap-websocket-bridge--why-we-built-it-how-it-works) for the full story and a manual build walkthrough.

The short version is one command:

```bash
npm run setup-leap-bridge
```

### Step 3 — Verify with `npm run dev`

If both layers below the browser are working, `npm run dev` will print:

```
[leap-bridge] Starting: …/leap-bridge/build/Ultraleap-Tracking-WS
…
LeapJS connected.
```

…and the HUD in the browser will switch from **"Leap Motion: Connecting…"** to **"Leap Motion: Connected — move your hands"** to **"Leap Motion: Tracking"** the moment a hand enters the field of view.

---

## The Leap WebSocket Bridge — why we built it, how it works

### Why this exists at all

Older Leap Motion software (the **Orion V4** era) shipped with a built-in WebSocket server. LeapJS could connect to `ws://127.0.0.1:6437` straight out of the box, and any web page could read hand data with zero extra setup.

When Ultraleap released **Gemini V5**, they **removed the WebSocket feature entirely**. The new SDK only exposes `LeapC`, a native C API — great for Unity / native apps, useless for a browser. Every LeapJS-based experience on the open web broke overnight.

Ultraleap acknowledged this and published a small reference project — [`UltraleapTrackingWebSocket`](https://github.com/ultraleap/UltraleapTrackingWebSocket) — that bridges the gap: a tiny C executable that subscribes to LeapC tracking frames, serializes them into the legacy `v6.json` LeapJS protocol, and broadcasts them over `libwebsockets` on the original port `6437`.

This project clones that reference, builds it locally, and runs it alongside Vite during development. We did **not** vendor a pre-built binary because:

- Binaries are platform-specific (separate macOS / Windows / Linux builds).
- The bridge dynamically links `libLeapC` from the installed SDK path, which differs per machine.
- It's tiny — the source clone + build takes under a minute.

The repo at `leap-bridge/` is therefore *expected to be empty until you run setup*. It is `.gitignore`d so you never commit machine-specific build artifacts.

### What `npm run setup-leap-bridge` actually does

See `scripts/setup-leap-bridge.js`. Concretely:

1. Checks for `leap-bridge/CMakeLists.txt`. If missing, removes any stray `leap-bridge/` directory and `git clone --depth 1 https://github.com/ultraleap/UltraleapTrackingWebSocket.git` into it.
2. Creates `leap-bridge/build/`.
3. Runs `cmake ..` inside the build folder. CMake locates:
   - `libwebsockets` (via `find_package(libwebsockets CONFIG REQUIRED)`)
   - `LeapSDK` (via `find_package(LeapSDK REQUIRED PATHS …)` — see `leap-bridge/CMakeLists.txt:42-53` for OS-specific paths)
   - The system threads library
4. Runs `cmake --build .` to compile.
5. Leaves the executable as `leap-bridge/build/Ultraleap-Tracking-WS` (macOS / Linux) or `…/Ultraleap-Tracking-WS.exe` (Windows).

If you'd rather build it by hand (e.g. to debug a CMake failure):

```bash
cd leap-bridge
mkdir -p build && cd build
cmake ..
cmake --build .
```

Common pitfalls:

| Error | Fix |
|-------|-----|
| `Could not find a package configuration file for "libwebsockets"` | Install it. macOS: `brew install libwebsockets`. Debian/Ubuntu: `sudo apt install libwebsockets-dev`. Windows: `vcpkg install libwebsockets --triplet x64-windows` and pass `-DCMAKE_TOOLCHAIN_FILE=…/vcpkg.cmake` to `cmake`. |
| `Could not find a package configuration file for "LeapSDK"` | The Ultraleap Hand Tracking Software isn't installed, or the SDK path differs from the one hard-coded in `leap-bridge/CMakeLists.txt`. Verify the path exists. On macOS this is `/Library/Application Support/Ultraleap/LeapSDK/lib/cmake/LeapSDK`. |
| `dyld: Library not loaded: @rpath/libLeapC.5.dylib` at runtime | The bridge can't find LeapC at runtime. `scripts/run-leap-bridge.js` sets `DYLD_LIBRARY_PATH` to the build dir to handle this; if it still fails, copy `libLeapC.*` into `leap-bridge/build/`. |

### What `npm run leap-bridge` does

See `scripts/run-leap-bridge.js`. It:

1. Searches `leap-bridge/build/` for an executable (tries common Ultraleap names first, then falls back to scanning for any executable file).
2. If found, spawns it with `stdio: 'inherit'` so its logs appear in the same terminal.
3. Prepends the build dir to `DYLD_LIBRARY_PATH` (macOS) so the dynamic loader can resolve `libLeapC.5.dylib` even when run from outside Xcode.
4. If no binary exists, prints a giant banner pointing the user at `npm run setup-leap-bridge`.

The top-level `npm run dev` command uses `concurrently` to launch the bridge **and** Vite together:

```jsonc
"dev": "concurrently -n leap,vite -c blue,green \"npm run leap-bridge\" \"vite\""
```

This means a single terminal shows interleaved logs from both processes. If you only want the visuals (e.g. you're working on UI and don't want to plug in the sensor), use `npm run dev:vite` to skip the bridge entirely.

### The wire protocol

The bridge speaks the legacy LeapJS `v6.json` protocol on `ws://127.0.0.1:6437`. Each message is a JSON-encoded frame containing:

- `id` — monotonically-increasing frame id
- `timestamp` — microseconds since epoch
- `hands[]` — for each visible hand:
  - `id`, `type` (`"left"` | `"right"`)
  - `palmPosition` (mm, `[x, y, z]`)
  - `palmVelocity` (mm/s, `[x, y, z]`)
  - `pinchStrength`, `grabStrength` (0–1)
- `pointables[]` — fingertip data
- `interactionBox` — Leap's normalized interaction volume

LeapJS in the browser (loaded via `<script src="/leap.min.js">` in `index.html`) handles parsing this stream and exposes it through `Leap.loop(opts, callback)`. We never write WebSocket code ourselves — LeapJS hides the protocol.

---

## How Leap data flows through the app

```
                                                    ┌── particleSystem.update()  (sculpting)
window.Leap.loop({                                  │
  host: '127.0.0.1',                                ├── handVisualizer            (skeleton overlay)
  port: 6437,                                       │
  enableGestures: false,                            ├── audioManager              (squish, swoosh, hum)
}, frame => {                                       │
  for (hand of frame.hands) {                       ├── session timer             (30s auto-capture)
    hands.push(getHandData(hand, LEAP_CONFIG))      │
    tips.push(...getHandPositions(hand, LEAP_CONFIG)) ── leapCoordinates.js (mm → Three.js space)
  }                                                 │
  rawFrameHands = frame.hands                       └── all consumed inside animate() each frame
})
```

### 1. Coordinate conversion — `src/utils/leapCoordinates.js`

Leap reports positions in **millimetres** with the sensor at the origin (X right, Y up, Z toward the user). Three.js scene units are meters and we want the clay centered at the world origin. The conversion is:

```js
{
  x:   leap.x * 0.002,
  y:   leap.y * 0.002 + (-0.15),
  z: -(leap.z * 0.002) + 0,
}
```

- `0.002` → millimetres-to-meters with an additional ×2 zoom so hands feel close to the camera.
- `offsetY = -0.15` → drops the resting-palm height (~200mm above the sensor) down so it lines up with the clay rim.
- Z is **negated** because Leap's +Z points *toward* the user, whereas Three.js's +Z points *out of the screen* toward the user as well — but our camera is at `(0, 0.05, 1.0)` *looking back at the origin*, so we mirror it.

`getHandData(hand, config)` extracts only the fields the gesture engine cares about: `palm`, `indexTip`, `thumbTip`, `pinchStrength`, `grabStrength`, `palmVelocity`, `palmVelocityY`, and all five fingertips.

`getHandPositions(hand, config)` returns palm + every fingertip as a flat array, used by the tracking overlay.

### 2. Gesture classification — `src/main.js → processGestures()`

Once per animation frame, the gesture engine:

1. Pulls the latest `lastHandData` cached by the LeapJS callback.
2. Re-projects each hand position from world space into the rotating *clay-local* space (`pts.worldToLocal(v)`), because the pottery wheel is constantly spinning on Y and we want a pinch at `x=0.1` to mean "the right wall right now," not "the right side of the world."
3. Classifies each visible hand into exactly one mode based on `pinchStrength` and `grabStrength`. See [Gesture vocabulary](#gesture-vocabulary-what-your-hands-actually-do).
4. If both hands are visible, also computes:
   - **Width** scale from horizontal palm distance (`Math.abs(left.x - right.x) / BASELINE_PALM_DIST`, clamped to `[0.35, 2.2]`).
   - **Height** delta from average vertical palm velocity (only kicks in above 50 mm/s to avoid drift).

The classification output is then passed into `particleSys.update(gesture, dt)` which actually moves the clay.

### 3. Skeleton overlay — `src/tracking/handVisualizer.js`

A full-screen transparent canvas (`#tracking-canvas`) sits on top of the Three.js canvas. Every frame, we take the **raw** LeapJS hand objects (`rawFrameHands`) and:

1. Run each joint through the same Leap→world conversion as the gesture engine.
2. `Vector3.project(camera)` to drop it into normalized device coordinates.
3. Map NDC to pixel space and draw lines/dots in glowing neon ink (color matches the current particle palette).

This is what makes your hands appear to *physically reach into* the particle cloud — the skeleton tracks the same camera projection as the clay.

### 4. Audio reactivity — `src/audio/audioManager.js`

Hand data also drives sound. From `main.js → animate()`:

- `updateContactBuzz(hasHands, palmDistFromCenter)` — triangle oscillator that wakes up when hands enter the field, modulated by distance from the wheel center.
- `updateRotationHum(wheelSpeed)` — low sine drone that scales with the wheel's current angular velocity.
- `playWaterSquish()` — fires once when `pinchStrength` crosses 0.9 (a fresh hard pinch).
- `playSquish(mag)` — triggered when the particle displacement spikes by ≥15% frame-to-frame (smoothing/morphing makes audible squelches).
- `updateSwoosh(palmVelocityMag)` — filtered white noise whose lowpass cutoff scales with how fast your palms are moving.

### 5. The 30-second auto-capture loop

The "kiosk" timer in `src/main.js → tickSessionTimer()` decrements only **while hands are visible** and the user hasn't triggered finish. At zero, if the clay has actually been sculpted past a tiny `SESSION_MIN_DISPLACEMENT` threshold, it auto-triggers `triggerFinish()` → 3-2-1 countdown → photo flash → Supabase upload. If you never touched the clay, it just holds at `0:00` until you do.

### 6. Reconnection logic

WebSockets are flaky. `initLeap()` and friends in `main.js` implement:

- **Startup watchdog:** if the socket hasn't opened in 6 seconds, the status bar morphs into a "Retry" link with diagnostic instructions.
- **Exponential reconnect:** if the socket drops, `scheduleNextLeapReconnect()` backs off `450ms → 1000ms → 1550ms …` capped at 15 s.
- **`online` event listener:** when the OS reports network is back, we immediately pulse a reconnect.

This is critical when you stop/restart the bridge during development — the browser will recover without a page reload.

---

## Gesture vocabulary (what your hands actually do)

| Gesture | Detection (in `processGestures`) | Effect on clay |
|---|---|---|
| **Pinch** (sculpt) | One hand, `pinchStrength > 0.36`, index tip present | Treats finger Z-depth as a height along the pot (`mapHandDepthToClayColumn`), then carves the ring at that height toward the index tip. Pinch strength scales carve rate. |
| **Flat palm** (smooth) | `grabStrength < 0.2` *and* `pinchStrength < 0.3` | Applies Laplacian smoothing on the ring nearest the palm's depth-mapped height. |
| **Two palms — width** | Both `left.palm` + `right.palm` present | `radiusScale = clamp(|left.x − right.x| / 0.28, 0.35, 2.2)`. Width is "remembered" for 2 s after one hand leaves, then fades back to 1.0 over another second. |
| **Two palms — height** | Two hands, `palmVelocityY` averaged | Only above 50 mm/s. Integrates upward / downward palm motion into `heightTarget`, clamped `[0.4, 2.5]`. |
| **Fist** (finish) | `grabStrength > 0.8` held for ~1 s, *or* press **F** | Freezes the clay, starts a 3-2-1 countdown, flashes the screen, captures the canvas, uploads to Supabase, and morphs back to a cylinder over 4 s. |
| **No hands** | `frame.hands.length === 0` | Pottery wheel keeps spinning, but the sculpt timer pauses and the clay rests in its current pose. |

Keyboard shortcuts:

- **F** — manual finish (same flow as fist).
- **R** — instant reset to the default cylinder.

---

## Running the app

```bash
npm run dev
```

This starts:

- The **Leap WebSocket bridge** on `ws://127.0.0.1:6437`
- The **Vite dev server** on `http://localhost:5173`

Open **http://localhost:5173** in your browser.

> Want to run only the visuals (no Leap hardware needed)? Use `npm run dev:vite`. The HUD will sit at "Leap: No connection on 127.0.0.1:6437" but the wheel will still spin and you can press **F** to test the save flow.

To build for production:

```bash
npm run build      # outputs to dist/
npm run preview    # serves the production build
```

---

## How to Use

1. Hold both hands over the Leap Motion sensor.
2. The grid of particles transitions into a glowing pot shape.
3. **Sculpt** with your fingers:
   - **Pinch** (thumb + index): pull the wall outward at that height
   - **Two open palms**: stretch / squeeze the pot's width and height
   - **Flat palm**: smooth the surface
4. When you're happy, **make a fist and hold for ~1 second** (or press **F**) to start the 3-2-1 countdown and save your pot.
5. The pot is captured, uploaded in the background, and the clay morphs back to a fresh cylinder so the next person can sculpt.
6. Visit the gallery at **http://localhost:5173/gallery.html**.

---

## System Architecture

```
[Ultraleap Hand Tracking Service] --LeapC--> [leap-bridge (C WebSocket server)] --ws://6437--> [Browser / LeapJS]
                                                                                                       |
                                                                                                       v
                                                                                       [main.js: gestures, animation]
                                                                                                       |
                              -------------------------------------------------------------------------+
                              |              |              |               |           |
                              v              v              v               v           v
                    [particleSystem]  [leapCoordinates]  [handVisualizer] [audioManager] [postcardManager]
                                                                                                |
                                                                                                v
                                                                                  [galleryService] --> [Supabase Storage + Postgres]
                                                                                                                          |
                                                                                                                          v
                                                                                                            [gallery.html / gallery.js]
```

---

## Project Structure

```
.
├── index.html                        # Main sculpting app
├── gallery.html                      # Saved-pots gallery page
├── package.json
├── vite.config.js
├── CLAUDE.md                         # Detailed architecture notes
├── README.md
│
├── src/
│   ├── main.js                       # Entry: Three.js scene, LeapJS loop, gestures, save flow
│   ├── gallery.js                    # Gallery page: fetch + grid layout
│   ├── gallery.css
│   ├── styles.css
│   │
│   ├── particles/
│   │   └── particleSystem.js         # 50,000 particles, spring-mass physics, ring topology
│   │
│   ├── tracking/
│   │   └── handVisualizer.js         # Full-screen hand skeleton overlay
│   │
│   ├── audio/
│   │   └── audioManager.js           # Web Audio: swoosh, squish, contact buzz, rotation hum
│   │
│   ├── postcard/
│   │   └── postcardManager.js        # Canvas capture (html2canvas)
│   │
│   ├── supabase/
│   │   ├── supabaseClient.js         # Supabase config (URL + anon key)
│   │   └── galleryService.js         # Upload + CRUD for saved pots
│   │
│   ├── gallery/                      # Curatorial facts, pot quotes, shape inference
│   │
│   └── utils/
│       ├── leapCoordinates.js        # Leap mm → Three.js world space + getHandData()
│       └── deformation.js            # Legacy mesh deformer (unused; kept for reference)
│
├── public/
│   ├── leap.min.js                   # Pre-built LeapJS browser bundle (loaded via <script>)
│   └── squish.mp3                    # Audio (add this yourself)
│
├── scripts/
│   ├── setup-leap-bridge.js          # Clones + builds UltraleapTrackingWebSocket
│   └── run-leap-bridge.js            # Runs the bridge alongside Vite
│
├── leap-bridge/                      # Cloned Ultraleap WebSocket source (gitignored)
│   ├── CMakeLists.txt                # Finds libwebsockets + LeapSDK, builds executable
│   ├── main.c                        # The bridge itself
│   ├── utils.c / utils.h
│   └── build/                        # CMake output (Ultraleap-Tracking-WS binary)
│
└── mcp-leap/                         # Optional MCP server exposing Leap data to Cursor
    ├── index.js                      # WebSocket client + MCP tools
    └── package.json
```

---

## Optional: the MCP server for live Leap introspection in Cursor

`mcp-leap/` ships a small **Model Context Protocol** server that lets Cursor's AI directly read live hand-tracking frames from the same `ws://127.0.0.1:6437` bridge. It's not needed to run the app — it's a development convenience.

Two tools are exposed:

- `get_leap_hands` — returns a summarized JSON object: hand count, palm positions, palm velocities, pinch / grab strength per hand, and pointables.
- `get_leap_frame_raw` — returns the entire latest frame JSON (firehose).

It's wired up in `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "leap-motion": {
      "command": "node",
      "args": ["mcp-leap/index.js"],
      "cwd": "${workspaceFolder}"
    }
  }
}
```

Install and use:

```bash
cd mcp-leap && npm install   # one-time
# Restart Cursor to pick up the MCP config.
```

Then in Cursor chat you can ask things like *"What are my hands doing according to Leap right now?"* and the agent will call `get_leap_hands`. Useful when prototyping new gestures.

---

## Tech Stack

| Layer        | Tech                                                 |
|--------------|------------------------------------------------------|
| Hardware     | Ultraleap Leap Motion Controller (Gemini V5+)        |
| System SDK   | Ultraleap Hand Tracking Service + LeapC              |
| Bridge       | UltraleapTrackingWebSocket (C, libwebsockets)        |
| Browser hand input | LeapJS 0.6.4 (loaded via `<script>` tag)       |
| Rendering    | Three.js + EffectComposer (UnrealBloomPass)          |
| Physics      | Custom spring-mass simulation on `Float32Array`      |
| Audio        | Web Audio API (no library)                           |
| Capture      | html2canvas + `preserveDrawingBuffer`                |
| Backend      | Supabase (Postgres + Storage)                        |
| Build / dev  | Vite + concurrently                                  |
| Dev MCP      | `@modelcontextprotocol/sdk` + `ws`                   |

---

## Troubleshooting

| Symptom | What to check |
|---|---|
| **HUD stuck on "Connecting to Leap Motion…"** | The bridge isn't running. Confirm the `[leap-bridge] Starting:` line in your terminal. Build it with `npm run setup-leap-bridge`, then `npm run dev`. |
| **"Leap: No connection on 127.0.0.1:6437"** with Retry link | Same as above — the WebSocket server didn't start. Most often: the bridge binary doesn't exist (run setup), or port 6437 is held by something else. |
| **Bridge starts but immediately exits** | `libLeapC` can't be loaded. Verify the Ultraleap Hand Tracking Service is installed and running. On macOS, open the Ultraleap Control Panel app once to confirm. |
| **HUD says "Connected" but never "Tracking"** | The bridge is alive but the sensor sees nothing. Check the Ultraleap Control Panel — is the device detected? Is the room too dark or too sun-lit? Is the sensor facing up? |
| **`npm run setup-leap-bridge` fails at `cmake ..`** | Read the error. Almost always one of: `libwebsockets` not installed, `LeapSDK` not installed at the OS-specific path, or `cmake` itself missing. Re-run the manual install lines for your OS in [Step 1](#step-1--install-the-ultraleap-hand-tracking-software). |
| **`dyld: Library not loaded` when bridge runs** | `libLeapC.5.dylib` isn't on the loader path. The wrapper script sets `DYLD_LIBRARY_PATH` but in stubborn cases you may need to copy `libLeapC.*` from the Ultraleap SDK folder into `leap-bridge/build/`. |
| **Save button doesn't work** | Confirm your Supabase URL + anon key in `src/supabase/supabaseClient.js`, and that the `postcard-images` bucket and `user_postcard_gallery` table exist. |
| **No audio** | Make sure `public/squish.mp3` exists. Browsers block audio until the page receives a user gesture — click anywhere once. |
| **Hands "drift" when not moving** | Two-hand height control intentionally ignores movement below 50 mm/s. If pinch sculpting drifts, your `pinchStrength` is hovering near `0.36` — clench harder or let go fully. |

---

## Author

**Kamya Shah** — UDIST-3120 Computational & Studio Practice, California College of the Arts, Spring 2026.
