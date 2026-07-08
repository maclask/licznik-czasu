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

    // Populated by stopwatch.js at the end of its IIFE.
    App.core = {};
})();
