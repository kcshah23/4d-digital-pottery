# 4D Digital Pottery

A hand-tracked, immersive pottery sculpting experience using Three.js, Leap Motion (LeapJS), Web Audio, Supabase (gallery + storage), and bloom post-processing.

## Prerequisites

- **Leap Motion / Ultraleap** controller
- **WebSocket on port 6437** (see below)
- A `squish.mp3` audio file (place in `/public/`)
- **Supabase** project with `user_postcard_gallery` table and public `postcard-images` storage bucket (see `CLAUDE.md`)

### WebSocket for Ultraleap (Required if you see "Waiting for connection")

With **Ultraleap Gemini V5+** (Ultraleap Control Panel), the built-in WebSocket was removed. Run the bridge included in this repo:

```bash
npm run setup-leap-bridge   # one-time
npm run dev                 # starts bridge + Vite
```

Or see `CLAUDE.md` for details. With the bridge running, the app connects on `ws://127.0.0.1:6437`.

## Setup

```bash
npm install
```

Add your `squish.mp3` to the `public/` folder. Configure Supabase URL and anon key in `src/supabase/supabaseClient.js`.

**One-time: build the Leap WebSocket bridge** (required for Ultraleap hand tracking):

```bash
npm run setup-leap-bridge
```

You need: `git`, `cmake`, and `libwebsockets` (on macOS: `brew install cmake libwebsockets`).

## Run

```bash
npm run dev
```

This starts both the Leap WebSocket bridge (if built) and the app. Use `npm run dev:vite` to run only Vite (no Leap).

## Features

- 50,000-particle point cloud with spring-mass physics and surface-of-revolution pot shape
- Leap hand gestures: sculpt, smooth, width/height, reset, finish (fist hold or **F**)
- Full-screen hand skeleton overlay aligned with the 3D scene (camera projection)
- Neon color palette (25 hues) that cycles each new pot session
- Save flow: countdown → clay snapshot → name → upload to Supabase Storage + row in `user_postcard_gallery`
- Standalone gallery at **`/gallery.html`** (all saved pots)

## Controls

- Move hands over the clay to sculpt
- **Fist hold ~1s** or **press F** to finish (countdown → save)
- Enter your name and **Save to Gallery**; you are redirected to the gallery when done
- **Gallery** link (bottom-right) or visit `/gallery.html` anytime

## Project Structure

```
├── index.html
├── gallery.html
├── package.json
├── vite.config.js
├── CLAUDE.md              # Detailed architecture for contributors / AI tools
├── src/
│   ├── main.js            # Entry, Three.js, Leap, gestures, save flow
│   ├── gallery.js         # Gallery page: fetch & grid
│   ├── gallery.css
│   ├── styles.css
│   ├── particles/
│   │   └── particleSystem.js
│   ├── postcard/
│   │   └── postcardManager.js   # Canvas capture, html2canvas helpers
│   ├── supabase/
│   │   ├── supabaseClient.js
│   │   └── galleryService.js    # Storage upload + table CRUD
│   ├── tracking/
│   │   └── handVisualizer.js      # Full-screen hand overlay
│   ├── audio/
│   │   └── audioManager.js
│   └── utils/
│       ├── leapCoordinates.js
│       └── deformation.js         # Legacy mesh deformation (unused)
├── public/
│   └── squish.mp3
└── leap-bridge/           # Ultraleap WebSocket (after setup-leap-bridge)
```
