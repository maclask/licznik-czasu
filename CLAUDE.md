# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Dev server

Serve the project with Python (available as Python 2.7):

```bash
cd licznik-czasu
python -m SimpleHTTPServer 3000
```

Then open `http://localhost:3000/`. There is no build step, transpiler, or bundler — edits to source files are live on reload.

The preview config lives in `../.claude/launch.json` (one level up, in the `repos/` root) because that is Claude Code's working directory for this session.

## Architecture

### One file per layer

| File | Role |
|---|---|
| `index.html` | Single page — all five views (`#timer`, `#settings`, `#help`, `#sharing`, `#debata`) rendered together, shown/hidden by JS |
| `assets/js/app.js` | Shared `App` namespace: cross-file state, the `onStateChange` hook, and the `App.core` export bag |
| `assets/js/stopwatch.js` | Core offline stopwatch — timer, joker, BP format, sound, logos, navigation, UI event listeners |
| `assets/js/online.js` | Collaboration layer — PeerJS session sync + VDO.Ninja online debate |
| `assets/css/style.css` | Core styles — container, timer, settings/help, logos; defines the `:root` custom properties and `@import`s the Google Fonts |
| `assets/css/debate.css` | Collaboration-layer styles — session, debate stage, chat, breakout, prep-time, theme switcher; loaded **after** style.css so it inherits `:root` + fonts |

No build artifacts, no `package.json`, no transpilation.

### JS layers and the `App` contract

Three plain `<script>`s load in order (`app.js` → `stopwatch.js` → `online.js`). There is no bundler, so instead of one closure they share a small, deliberate contract through a global `App`. Each file is its own `(function ($, App) { … })(jQuery, window.App)` IIFE.

- **`app.js`** defines the contract: `App.state` (the only fields both layers touch — `isSlaveSession`, `slaveShowControls`, `applyingState`), a no-op `App.onStateChange`, and an empty `App.core`.
- **`stopwatch.js`** (core) fills `App.core` at the end of its IIFE with the functions `online.js` needs: `getFullState`, `applyState`, `navigate`, `showAlert`, `showWarn`, `reset`, `startPrepTime`, `isPrepActive`, `getCurrentFormat`. Everything else stays local to its closure.
- **`online.js`** overrides `App.onStateChange` to broadcast state deltas to peers, and reaches into core only via `App.core.*` / `App.state.*`.

Dependency direction is one-way: the core knows nothing about sessions or debate — its single seam to the online layer is `App.onStateChange`, which it calls after every state mutation. Keep it that way: any new cross-file need goes through `App`, and the `<script>` order in `index.html` **is** the dependency contract.

### stopwatch.js (core) structure

Key variable groups at the top of the IIFE:

- **Timer state**: `timerRunning`, `minutes`, `seconds`, `timerStartedAt`, `timerStartSeconds`, `lastTimerSecond`
- **Joker state**: `jokerRunning`, `jokerSeconds`, `jokerStartedAt`, `jokerStartSeconds`, `lastJokerSecond`, `jokerEnabled`
- **BP state**: `bpBell1Rung`, `bpBell2Rung`, `bpOvertimeRunning`, `bpOvertimeSecs`, `bpOvertimeStartedAt`
- **Config**: `currentFormat` (`'oxford'` | `'bp'`), `showControls`, `soundEnabled`
- **Prep time**: `isPrepTime` — master-set countdown with no format bells / no BP overtime; core-local, exposed to online via `App.core.isPrepActive()`

**Timer accuracy**: countdown uses `Date.now()` anchors — `timerStartedAt` is set on each start/resume and `timerStartSeconds` holds the remaining seconds at that point. A `setInterval` at 250 ms polls elapsed time; `lastTimerSecond` guards against re-rendering the same second twice.

**Pause/resume**: `stopTimer()` computes remaining seconds from elapsed wall time and saves them into `minutes`/`seconds`. The next `startTimer()` reads those values to create a fresh anchor.

**Navigation**: `navigate(section)` hides all five panels and shows the requested one.

**State sync**: `getFullState()` / `applyState(state)` serialize and re-apply the whole core state; the online layer calls them (via `App.core`) to push/receive a peer's state. Every core mutation also calls `App.onStateChange(delta)` so a live session can broadcast just the change.

### online.js structure

One IIFE with two concerns that are intentionally kept together (they share `sessionConnections` / `masterConn` / `sessionPeer` heavily):

- **Session (PeerJS)**: master creates a named peer; slaves connect via `?s=<name>`. `handleMasterConnection` routes incoming messages; `getFullState`/`applyState` sync clock state.
- **Debate (VDO.Ninja)**: position-based roster (`proposition`/`opposition`/`judges`), per-team chat, breakout rooms, raise-hand/ad-vocem signals, and active-speaker video, all layered on the session transport. A trailing IIFE auto-joins when the URL carries `?s=` (and `?d=1` for debate).

### Debate formats

**Oxford** (default, 5 min):
- 30-second bell at remaining = 30 s
- Ad vocem button loads a shorter countdown (default 30 s)
- Optional Joker: independent 30 s countdown with its own controls
- `.oxford-only`, `.oxford-joker`, `.oxford-setting` elements are shown/hidden by `applyFormat()`

**BP** (7 min):
- Bell 1: 60 s after speech starts
- Bell 2: 60 s before speech ends
- After the main countdown hits 0: 15-second overtime starts automatically, timer gets class `bp-overtime`
- Ad vocem and Joker are hidden in BP mode

### CSS conventions

- `--timer-size: clamp(60px, 17vmin, 280px)` — responsive timer font size, overridden via media query on mobile
- Settings panel uses `settings-panel-grid` (3-column CSS Grid: label | value | value)
- Oxford-only settings use `.oxford-setting` + `.settings-hidden` (visibility/opacity toggle, not display, to keep grid layout stable)
- `#timer .timer` keeps `scale: 100%` as the baseline for jQuery's `popTime()` animation

### Dependencies

Local (vendored under `assets/`):

- Bootstrap 4 (`bootstrap.min.css`, `bootstrap.bundle.min.js`, `popper.min.js`)
- jQuery 3.3.1

From a CDN (the online layer needs these; a plain timer works offline without them):

- PeerJS 1.5.4 (`unpkg.com`) — session sync transport
- qrcodejs 1.0.0 (`jsdelivr`) — session/join QR codes

External:

- Google Fonts — Chivo Mono, Epilogue, Montserrat (loaded via `@import` in style.css)

### Logos

Logos in `img/` are selected in Settings and displayed in `#timer .img-container`. `.img-container` is `display: none` by default; JS switches it to `display: flex` when a logo is set. `setImage(null, no)` hides it again.
