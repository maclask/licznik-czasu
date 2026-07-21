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
    // and every VDO.Ninja postMessage action invoked (see online.js), and to reveal the
    // on-page log/room-info panels online.js builds.
    //
    // An accessor rather than a plain field: flipping it from the console must take
    // effect immediately in the UI too. It carries the debug-only affordances —
    // body.is-verbose reveals them in CSS, and onVerboseChange lets the online layer
    // build/tear down its debug panels when the flag changes.
    var verbose = false;
    Object.defineProperty(App, 'verbose', {
        get: function () { return verbose; },
        set: function (on) {
            verbose = !!on;
            if (document.body) document.body.classList.toggle('is-verbose', verbose);
            App.onVerboseChange(verbose);
        }
    });
    App.onVerboseChange = function (on) {};  // no-op until online.js overrides it

    // Fired for every App.vlog(...) call while verbose is on — online.js overrides this
    // to feed the on-page log panel, so filtering/scrollback doesn't depend on the
    // browser console. entry.tag is vlog's first argument (e.g. '[PeerJS→]', '[VDO← publish]');
    // entry.args are the rest, exactly as passed to console.log.
    App.onVlog = function (entry) {};  // no-op until online.js overrides it

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
        App.onVlog({ ts: Date.now(), tag: arguments[0], args: Array.prototype.slice.call(arguments, 1) });
    };
})();
