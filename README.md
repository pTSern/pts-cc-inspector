# pts-cc-inspector

Lightweight, local, advertising-free Cocos Creator 2.x & 3.x runtime inspector extension for Chromium browsers (Chrome, Edge, Brave, etc.) built with strict TypeScript and Manifest V3.

## Features

- **Engine Support:** Automatically inspects Cocos Creator 2.x (tested on 2.4.5) and 3.x (tested on 3.8.8) runtime games.
- **Scene Hierarchy:** Searchable, virtualized node tree capable of rendering thousands of nodes smoothly without lag or memory blowup.
- **Typed Property Inspector:** Inspect and live-edit numbers, strings, booleans, enums, colors, Vec2/Vec3/Vec4, and Size properties.
- **Live Component & Node Actions:** Toggle active states, live destroy nodes (with confirmation dialog), log real node/component objects to DevTools console (`temp0`, `temp1`, etc.), copy node name or hierarchy paths.
- **Draw Call Diagnostics:** Opt-in per-node draw call attribution hooks into the Cocos renderer; filter nodes by specific draw call buckets.
- **Media & Animation Controls:** Play and stop animation clips directly from the inspector panel; preview textures, sprites, and atlas regions.
- **Local Asset Image Replacement:** Live-replace sprite/texture regions using local PNG, JPEG, or WebP files without any external network server.
- **Engine Overlays & Atlas Debug:** Toggle the Cocos engine's built-in FPS/stats overlay, inspect dynamic atlas parameters, and view debug dynamic atlas pages.
- **Event Breakpoints & Code Navigation:** Attach `debugger;` hooks to specific node touch or mouse events; inspect scripts and button handlers in DevTools.
- **Asset Tree & Bundle Browser:** Two-tab hierarchy navigation (`Scene Tree` & `Assets Tree`). Accesses bundles directly from `cc.assetManager.bundles`, lists indexed assets by bundle, displays live image/texture previews, metadata, and quick copy/open actions.
- **Project Build Exporter:** One-click `Export build` button that traverses all runtime assets, scripts, bundle configurations, pack files, settings, and stylesheets directly from the running game, compresses them into a standard PKZIP archive matching the Cocos Creator build folder structure, and triggers a browser download.
- **Dual Display Modes:**
  - Standard **DevTools Panel**: appears as the `pts-cc-inspector` tab in browser developer tools.
  - In-Page **Floating Inspector**: activate directly from the extension popup onto any live game tab without opening DevTools.
- **Multilingual Support:** Clean internationalization architecture. Ships with English (default) and Vietnamese (`Tiếng Việt`), with instant language switching in Settings.
- **Zero Bloat & Maximum Privacy:**
  - No Google Analytics, telemetry, or tracking.
  - No ads, QR codes, donation popups, or external promotional tool lists.
  - No runtime external network requests (completely offline).
  - Minimal memory footprint: zero heavy web frameworks; authored in vanilla DOM TypeScript.

## Project Structure

```text
pts-cc-inspector/
├── manifest.json              # Clean MV3 manifest (version 1.0.0, version_name 1.0.0-beta)
├── package.json               # Development scripts (build, test, typecheck)
├── tsconfig.json              # Strict TypeScript configuration
├── scripts/
│   └── build.ts               # Local esbuild compilation pipeline
├── src/
│   ├── shared/
│   │   └── protocol.ts        # Typed IPC contracts, commands, and settings schema
│   ├── background.ts          # MV3 service worker routing tabs and isolated frames
│   ├── browser/
│   │   └── client.ts          # High-level typed client communicating with background worker
│   ├── content/
│   │   └── bridge.ts          # Isolated world content script and floating UI iframe host
│   ├── runtime/               # Injected page-world game runtime inspector
│   │   ├── contracts.ts       # Structural typing for Cocos Creator 2.x and 3.x engine APIs
│   │   ├── engine.ts          # Scene traversal, property reading/writing, actions & diagnostics
│   │   ├── properties.ts      # Typed property reflection, path safety, and validation
│   │   ├── overlay.ts         # Highlighting and interactive canvas node picking
│   │   ├── images.ts          # Local image preview generation and atlas-preserving texture update
│   │   ├── draw-calls.ts      # Reversible draw call attribution hooks
│   │   └── index.ts           # Page runtime communication listener & lifecycle manager
│   ├── locales/
│   │   └── index.ts           # Dictionaries for English (en) and Vietnamese (vi)
│   ├── ui/                    # Lightweight virtualized UI
│   │   ├── index.ts           # Main inspector shell, toolbar, frame selection & dialogs
│   │   ├── tree.ts            # Viewport-bounded virtualized hierarchy list
│   │   ├── properties.ts      # Grouped typed property editors
│   │   └── inspector.css      # Dark theme inspector styles
│   └── entries/               # Extension entry points
│       ├── devtools.ts        # Registers panel in Chrome/Edge DevTools
│       ├── panel.ts           # DevTools panel page
│       ├── floating.ts        # Floating in-page inspector
│       ├── popup.ts           # Extension toolbar action popup
│       ├── options.ts         # Preferences & language settings
│       └── controls.css       # Popup & options page styles
└── tests/
    └── protocol.test.ts       # Protocol and security boundary unit tests
```

## How to Build

From this directory (`E:/__pTSern/.tools/cc-inspector/pts-cc-inspector`):

```bash
# Install local build tools (esbuild, tsx, typescript, prettier)
npm install

# Run TypeScript type check
npx tsc --noEmit

# Run unit tests
npx tsx --test tests/protocol.test.ts

# Build bundled extension to dist/
npx tsx scripts/build.ts
```

The compiled, ready-to-load extension will be in the `dist/` directory.

## How to Load in Chrome / Edge

1. Open your browser and navigate to the Extensions page:
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`
2. Enable **Developer mode** (toggle in top right on Chrome, or left sidebar on Edge).
3. Click **Load unpacked** (or **Load unpacked extension**).
4. Select the `dist/` folder inside `pts-cc-inspector` (`E:\__pTSern\.tools\cc-inspector\pts-cc-inspector\dist`).
5. Open any web page hosting a Cocos Creator game.
6. Either:
   - Open browser **DevTools** (`F12`), find the **pts-cc-inspector** tab, OR
   - Click the extension icon in the browser toolbar and click **Open floating inspector**.

## Verified Compatibility

Verified on Chromium (Edge 156 / Windows 10 x64):

- **Cocos Creator 2.4.5** (tested with custom procedural scene fixture):
  - Full tree discovery, node hierarchy inspection
  - Live property reads and writes (numbers, strings, booleans, enums, colors, Vec3, contentSize)
  - Animation clip playback and stopping
  - Engine FPS stats toggle
  - In-memory node image preview and local image replacement
  - Security boundaries: `__proto__` and constructor prototype pollution strictly blocked with `INVALID_PATH`
  - Scene generation mismatch protection (`STALE_GENERATION`)
- **Cocos Creator 3.8.8** (tested with prebuilt real game `PLACore/build/WonderMatch_RF_RoyaleEscape_HWTheme_2_2_2`):
  - 1,124 live nodes inspected smoothly with full hierarchy traversal
  - UITransform and 2D batcher camera projection verified
  - Draw call counters (19 draw calls) verified
  - Node renaming and property mutation readback verified
- **Multi-Frame Isolation:**
  - Correctly enumerates frames in multi-iframe documents and switches inspection target frame seamlessly.
