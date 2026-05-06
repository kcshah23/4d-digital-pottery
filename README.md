# 4D Digital Pottery

A hand-tracked, immersive pottery sculpting experience.
Sculpt a 50,000-particle pot in mid-air with a Leap Motion controller, then save your finished pot to a persistent web gallery.

Built with **Three.js**, **Ultraleap Leap Motion**, **Web Audio**, and **Supabase**.

---

## Hardware Required

- **Ultraleap Leap Motion Controller** (Gemini V5+ supported)
- A laptop / desktop with a modern browser (Chrome / Firefox / Safari)
- Speakers or headphones (for audio feedback)

---

## Software Prerequisites

- **Node.js** 18+ and **npm**
- **Ultraleap Tracking Software** installed (the Control Panel app)
- For the Leap WebSocket bridge: **git**, **cmake**, **libwebsockets**
  - macOS: `brew install cmake libwebsockets`
- A **Supabase** project (free tier is fine) with:
  - A public storage bucket called `postcard-images`
  - A table called `user_postcard_gallery` (image URL + particle positions JSONB)
  - See `CLAUDE.md` for the schema details

---

## Setup

```bash
# 1. Install npm dependencies
npm install

# 2. One-time: build the Ultraleap WebSocket bridge
#    (Gemini V5+ removed the built-in WebSocket, so we run our own)
npm run setup-leap-bridge

# 3. Add your audio file
#    Place a squish.mp3 file inside the public/ folder

# 4. Configure Supabase
#    Open src/supabase/supabaseClient.js and set your Supabase URL + anon key
```

---

## Run

```bash
npm run dev
```

This starts:
- The **Leap WebSocket bridge** on `ws://127.0.0.1:6437`
- The **Vite dev server** on http://localhost:5173

Then open **http://localhost:5173** in your browser.

> Want to run only the visuals (no Leap hardware needed)? Use `npm run dev:vite`.

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
   - **Two open palms**: stretch / squeeze the pot's width
   - **Flat palm**: smooth the surface
4. When you're happy, **make a fist and hold for ~1 second** (or press **F**) to start the 3-2-1 countdown and save your pot.
5. Type your name → **Save to Gallery** → you'll be redirected to the gallery view.
6. Visit the gallery any time at **http://localhost:5173/gallery.html**.

---

## System Architecture

```
[Ultraleap Leap Motion] --USB--> [leap-bridge (C WebSocket server)] --ws://6437--> [Browser]
                                                                                        |
                                                                                        v
                                                                  [main.js: gestures, animation]
                                                                                        |
                              ----------------------------------------------------------+
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

A higher-resolution diagram is included as `assets/system-diagram-bw.png`.

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
│   ├── main.js                       # Entry point: Three.js scene, Leap, gestures, save flow
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
│   │   └── audioManager.js           # Web Audio: swoosh + squish
│   │
│   ├── postcard/
│   │   └── postcardManager.js        # Canvas capture (html2canvas)
│   │
│   ├── supabase/
│   │   ├── supabaseClient.js         # Supabase config (URL + anon key)
│   │   └── galleryService.js         # Upload + CRUD for saved pots
│   │
│   └── utils/
│       ├── leapCoordinates.js        # Leap mm → Three.js world space
│       └── deformation.js            # Legacy mesh deformer (unused)
│
├── public/
│   ├── leap.min.js                   # LeapJS client library
│   └── squish.mp3                    # Audio (add this yourself)
│
├── scripts/
│   ├── setup-leap-bridge.js          # Builds the Ultraleap WebSocket bridge
│   └── run-leap-bridge.js            # Runs the bridge alongside Vite
│
├── leap-bridge/                      # Ultraleap WebSocket source (after setup)
└── mcp-leap/                         # Optional MCP server exposing Leap data
```

---

## Tech Stack

| Layer        | Tech                                                 |
|--------------|------------------------------------------------------|
| Hardware     | Ultraleap Leap Motion Controller (Gemini V5+)        |
| Bridge       | UltraleapTrackingWebSocket (C, libwebsockets)        |
| Rendering    | Three.js + EffectComposer (UnrealBloomPass)          |
| Physics      | Custom spring-mass simulation on `Float32Array`      |
| Hand input   | LeapJS (loaded via `<script>` tag)                   |
| Audio        | Web Audio API (no library)                           |
| Capture      | html2canvas + `preserveDrawingBuffer`                |
| Backend      | Supabase (Postgres + Storage)                        |
| Build / dev  | Vite + concurrently                                  |

---

## Troubleshooting

- **"Waiting for connection…"** — the Leap WebSocket bridge isn't running. Run `npm run setup-leap-bridge` once, then `npm run dev`.
- **Hands not detected** — check that the Ultraleap Control Panel sees your hands; the room may be too dark or too sun-lit.
- **Save button doesn't work** — confirm your Supabase URL/anon key in `src/supabase/supabaseClient.js`, and that the storage bucket and table exist.
- **No audio** — make sure `public/squish.mp3` exists, and click anywhere on the page once (browsers block audio until user interaction).

---

## Author

**Kamya Shah** — UDIST-3120 Computational & Studio Practice, California College of the Arts, Spring 2026.
