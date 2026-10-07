// Shared namespace for the licznik-czasu scripts.
//
// The app is split into two plain-script layers that load in order:
//   stopwatch.js  — the offline stopwatch (timer, joker, BP format, sound, logos, UI)
//   online.js  — the collaboration layer (PeerJS session sync + VDO.Ninja debate)
//
// They cannot share a closure, so the small, deliberate contract between them
// lives here on `App`:
//   App.state          — the few state fields both layers read/write
//   App.onStateChange   — hook the core calls after every mutation; online.js
//                         overrides it to broadcast the delta to peers
//   App.onConfetti      — hook the core calls on a local confetti burst; online.js
//                         overrides it to relay the burst to peers
//   App.core            — core functions online.js needs (filled in by stopwatch.js)
(function () {
    window.App = window.App || {};

    // Feature switches — flip to true to bring a feature back into the UI. Both are
    // fully implemented (online.js / debate.css) but hidden on master for now; the
    // code stays in place so re-enabling is just flipping the flag, no merge surgery.
    App.features = {
        onlineDebate: false,   // "Debata online" nav tab (VDO.Ninja video debate)
        styleSwitcher: false   // "Styl" dropdown in Settings (glassmorphic theme)
    };
    if (document.body) {
        // Runs at the bottom of <body>, so the DOM is already there.
        if (!App.features.onlineDebate) $('#debate-link-item').hide();
        if (!App.features.styleSwitcher) $('#style-select-row').hide();
    }

    App.state = {
        isSlaveSession: false,     // this browser joined someone else's session
        slaveShowControls: false,  // master lets slaves run the clock
        applyingState: false       // guards against echo-loops while applying a remote state
    };

    // No-op until the online layer is loaded and connects.
    App.onStateChange = function (delta) {};

    // Fired when this browser triggers the confetti burst locally (e.g. via its own
    // keyboard shortcut) — a transient one-off event, not part of getFullState/applyState,
    // so a late-joining peer never replays it. No-op until online.js overrides it to
    // relay the burst to peers.
    App.onConfetti = function () {};

    // Populated by stopwatch.js at the end of its IIFE.
    App.core = {};

    // Verbose debug logging — off by default, on every environment. Enable from the
    // browser console with `App.verbose = true` to log every PeerJS message sent/received
    // and every VDO.Ninja postMessage action invoked (see online.js) to the console;
    // filter by text in DevTools.
    //
    // An accessor rather than a plain field: flipping it from the console must take
    // effect immediately in the UI too — body.is-verbose reveals debug-only affordances
    // in CSS.
    var verbose = false;
    Object.defineProperty(App, 'verbose', {
        get: function () { return verbose; },
        set: function (on) {
            verbose = !!on;
            if (document.body) document.body.classList.toggle('is-verbose', verbose);
        }
    });

    // Dev/local vs. production — recognised by hostname or a '/dev' path segment. Unlike
    // `verbose` this defaults true on dev/local and false elsewhere, but is the same kind
    // of live-toggleable accessor: `App.debug = true/false` from the console works
    // identically on every environment (see online.js's onDebugChange), only the starting
    // value differs by environment.
    var debug = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ||
        location.pathname.indexOf('/dev') !== -1;
    Object.defineProperty(App, 'debug', {
        get: function () { return debug; },
        set: function (on) {
            debug = !!on;
            if (document.body) document.body.classList.toggle('is-debug', debug);
            App.onDebugChange(debug);
        }
    });
    App.onDebugChange = function (on) {};  // no-op until online.js overrides it

    App.vlog = function () {
        if (!verbose) return;
        console.log.apply(console, arguments);
    };
})();
