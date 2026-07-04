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
| `index.html` | Single page — all three views (`#timer`, `#settings`, `#help`) rendered together, shown/hidden by JS |
| `assets/js/stoper.js` | All logic — one jQuery IIFE, no modules |
| `assets/css/style.css` | All custom styles; Bootstrap and Font Awesome are kept separate |

No build artifacts, no `package.json`, no transpilation.

### stoper.js structure

The file is one `(function($){ … })(jQuery)` block. Key variable groups at the top:

- **Timer state**: `timerRunning`, `minutes`, `seconds`, `timerStartedAt`, `timerStartSeconds`, `lastTimerSecond`
- **Joker state**: `jokerRunning`, `jokerSeconds`, `jokerStartedAt`, `jokerStartSeconds`, `lastJokerSecond`, `jokerEnabled`
- **BP state**: `bpBell1Rung`, `bpBell2Rung`, `bpOvertimeRunning`, `bpOvertimeSecs`, `bpOvertimeStartedAt`
- **Config**: `currentFormat` (`'oxford'` | `'bp'`), `showControls`, `soundEnabled`

**Timer accuracy**: countdown uses `Date.now()` anchors — `timerStartedAt` is set on each start/resume and `timerStartSeconds` holds the remaining seconds at that point. A `setInterval` at 250 ms polls elapsed time; `lastTimerSecond` guards against re-rendering the same second twice.

**Pause/resume**: `stopTimer()` computes remaining seconds from elapsed wall time and saves them into `minutes`/`seconds`. The next `startTimer()` reads those values to create a fresh anchor.

**Navigation**: `navigate(section)` hides all three panels and shows the requested one.

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

### Dependencies (all local except Google Fonts)

- Bootstrap 4 (`bootstrap.min.css`, `bootstrap.bundle.min.js`, `popper.min.js`)
- jQuery 3.3.1
- Font Awesome (`all.css` + `assets/webfonts/`)
- Google Fonts — Chivo Mono, Epilogue, Montserrat (loaded via `@import` in style.css)
- `assets/js/easytimer.min.js` — present in repo but **not used** (was replaced by the `Date.now()` approach)

### Logos

Logos in `img/` are selected in Settings and displayed in `#timer .img-container`. `.img-container` is `display: none` by default; JS switches it to `display: flex` when a logo is set. `setImage(null, no)` hides it again.
