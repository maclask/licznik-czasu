(function ($, App) {
    // --- Session (PeerJS) ---

    var sessionPeer = null;
    var sessionConnections = {};  // peerId -> DataConnection, one live conn per peer
    var masterConn = null;
    // isSlaveSession + slaveShowControls now live on App.state (see app.js)
    var SESSION_WORDS = [
        'lew','lis','kot','pies','mysz','kura','owca','koza','krowa','wilk',
        'dzik','bocian','wrona','sowa','kret','borsuk','byk','mors','kogut',
        'karp','sum','delfin','pingwin','tygrys','lama','panda','lemur',
        'gepard','pelikan','sroka'
    ];

    // Debate (online) state — media via VDO.Ninja, app state via the PeerJS layer above
    var VDO_BASE = 'https://vdo.ninja/';
    var debateSessionId = null;   // == PeerJS session id; VDO room is 'debate' + this
    var isDebateMaster = false;
    var debateRoster = [];        // [{clientId, peerId, pushId, name, role, zone, index, ...}] — identity = clientId
    var debatePendingJoin = null; // participant: {name} queued until masterConn opens
    var expelledClientIds = {};   // clientId -> 'kick' | 'rejected', refused re-admission until the room resets
    var debateIframe = null;      // the live VDO.Ninja <iframe> element (for postMessage)
    var previewIframe = null;     // the join-screen preview <iframe> (separate instance, own postMessage channel)
    var joinCamDeviceIndex = null, joinMicDeviceIndex = null; // device picked on the join screen, carried into the live room
    var myPushId = null;          // this browser's stable VDO push id — fixed for the whole debate
                                   // (participants: PeerJS id at join; master: clientId)
    var myDebateName = '';        // this browser's own display name
    var myEmbedMode = null;       // 'publish' | 'view' — current VDO iframe mode
    var mySignals = { hand: false, advocem: false }; // this browser's raised signals — independent, both can be up at once
    var debateAllowControls = false; // master let positioned participants run the clock
    var debateEditMode = false;   // master: drag & drop seat re-assignment
    var micOn = true, camOn = true;  // this browser's local media state (VDO gives no readback)
    var waitingRoomOn = false;    // master: new joiners wait for approval before seeing the room
    var ZONE_SLOTS = { proposition: 4, opposition: 4, og: 2, oo: 2, cg: 2, co: 2, judges: 3, marszalek: 1 };
    var DYNAMIC_ZONES = { judges: true }; // grows past its base slot count: always one spare empty slot beyond who's seated
    // Zones whose occupants may raise a question / ad vocem — the debating teams only,
    // never judges, the marshal or the audience.
    var DEBATER_ZONES = { proposition: true, opposition: true, og: true, oo: true, cg: true, co: true };
    function isDebaterZone(zone) { return !!DEBATER_ZONES[zone]; }
    // Zones with a breakout room ("Pokój narad") — team seats and the judges. The
    // marshal sits alone in their zone (nobody to confer with) and the audience
    // doesn't publish, so neither gets one.
    function zoneHasBreakout(zone) { return isDebaterZone(zone) || zone === 'judges'; }

    function zoneSlotCount(zone) {
        var base = ZONE_SLOTS[zone] || 0;
        if (!DYNAMIC_ZONES[zone]) return base;
        var occupied = debateRoster.filter(function(e) { return e.zone === zone; }).length;
        return Math.max(base, occupied + 1);
    }

    // --- Comaster failover ---
    // The "live" room moves through an ever-increasing sequence of PeerJS ids:
    // genName(0) == debateSessionId, genName(1) == debateSessionId + '-backup1', etc.
    // Whoever is the current "primary" comaster always hosts the NEXT generation as an
    // always-on standby (genName(myGeneration + 1)), so the moment the master's
    // connection drops, that generation is already live and ready to take over — no
    // name is ever fought over or torn down out from under someone still using it,
    // it just quietly becomes "the room" and the sequence moves forward. See TODO.md.
    var myPeer = null;                 // this browser's own outgoing Peer (slave/participant side)
    var backupPeer = null;             // non-null only while THIS client hosts the standby hub
    var myGeneration = 0;              // generation number of the room I'm currently connected to
    var nextJoinSeq = 1;               // master-only monotonic counter for join order
    var isPrimaryComaster = false;     // this client is the designated successor

    function genName(n) {
        return n === 0 ? debateSessionId : (debateSessionId + '-backup' + n);
    }

    // PeerJS drops its signaling-server socket (separate from any individual peer
    // connection) on ordinary network blips; left alone the Peer sits "disconnected"
    // forever and silently refuses both new outgoing connect() calls and incoming
    // ones — starving the entire failover cascade of the one thing it depends on.
    function keepSignalingAlive(peer) {
        peer.on('disconnected', function() {
            if (!peer.destroyed) peer.reconnect();
        });
    }

    var WAS_MASTER_KEY = 'licznik:was-master';
    // Persists across page reloads (unlike any in-memory flag) so a browser that
    // crashes/reloads after being master can be recognised as such on rejoin and
    // granted honorary comaster status, without ever reclaiming the master role.
    function markWasMaster(roomId) {
        try {
            var list = JSON.parse(localStorage.getItem(WAS_MASTER_KEY) || '[]');
            list = list.filter(function(id) { return id !== roomId; });
            list.push(roomId);
            if (list.length > 20) list = list.slice(list.length - 20);
            localStorage.setItem(WAS_MASTER_KEY, JSON.stringify(list));
        } catch (e) {}
    }
    function checkWasMaster(roomId) {
        try {
            var list = JSON.parse(localStorage.getItem(WAS_MASTER_KEY) || '[]');
            return list.indexOf(roomId) !== -1;
        } catch (e) { return false; }
    }

    // A stable per-tab id, independent of the ephemeral PeerJS peerId (which is random
    // on every page load) and of the display name (which the user can change on
    // rejoin). Lets the master recognise "this is the same tab reconnecting" and drop
    // its old roster entry immediately — instead of waiting for PeerJS to notice the
    // old connection actually died, which after an abrupt reload/refresh can lag well
    // behind the new connection being established, leaving a stale duplicate.
    // sessionStorage (not localStorage) is deliberate: it still survives a same-tab
    // reload, but two tabs opened independently (typing/pasting the join link twice)
    // get distinct ids instead of fighting the master over one roster entry.
    var CLIENT_ID_KEY = 'licznik:client-id';
    var volatileClientId = null;  // fallback when sessionStorage is unavailable — stable per page load
    function getClientId() {
        try {
            var id = sessionStorage.getItem(CLIENT_ID_KEY);
            if (!id) {
                id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2);
                sessionStorage.setItem(CLIENT_ID_KEY, id);
            }
            return id;
        } catch (e) {
            if (!volatileClientId) volatileClientId = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2);
            return volatileClientId;
        }
    }
    var myClientId = getClientId();   // this tab's roster identity (stable across reloads)

    function findEntry(clientId) {
        return debateRoster.filter(function(e) { return e.clientId === clientId; })[0];
    }
    function findEntryByPeer(peerId) {
        if (peerId == null) return undefined;
        return debateRoster.filter(function(e) { return e.peerId === peerId; })[0];
    }
    function myEntry() { return findEntry(myClientId); }

    function eachConn(fn) {
        Object.keys(sessionConnections).forEach(function(peerId) {
            fn(sessionConnections[peerId], peerId);
        });
    }
    function safeSend(conn, obj) {
        App.vlog('[PeerJS→]', conn && conn.peer, obj);
        try { conn.send(obj); } catch (e) {}
    }
    function sendToPeer(peerId, obj) {
        var conn = peerId != null ? sessionConnections[peerId] : null;
        if (conn) safeSend(conn, obj);
    }
    // May this connection see room broadcasts? Not while waiting for admission — and
    // an entry-less connection (connected, join not processed yet) only when the
    // waiting room is off.
    function connAdmitted(peerId) {
        var entry = findEntryByPeer(peerId);
        return entry ? !entry.pending : !waitingRoomOn;
    }

    App.onStateChange = function(delta) {
        if (App.state.applyingState) return;
        if (App.state.isSlaveSession) {
            if (masterConn) safeSend(masterConn, {type: 'settings', state: delta});
        } else if (sessionPeer) {
            eachConn(function(c, peerId) { if (connAdmitted(peerId)) safeSend(c, {type: 'state', state: delta}); });
        }
    };

    // One shared validator for every room-name input (create session / join / create debate)
    function bindRoomNameInput($input, $btn) {
        $input.on('input', function() {
            $(this).val($(this).val().toLowerCase());
            var val = $(this).val();
            var wasInvalid = $(this).hasClass('is-invalid');
            var invalid = val.length > 0 && !/^[a-zA-Z0-9]+$/.test(val);
            $(this).toggleClass('is-invalid', invalid);
            if (invalid && !wasInvalid) App.core.showWarn('Dozwolone tylko litery a–z, A–Z i cyfry');
            $btn.prop('disabled', !(val.length > 0 && !invalid));
        });
    }
    bindRoomNameInput($('.session-name-input'), $('.session-create-btn'));
    bindRoomNameInput($('.session-join-input'), $('.session-join-btn'));
    bindRoomNameInput($('.debate-name-input'), $('.debate-create-btn'));

    // Shared PeerJS hub creation (plain sharing + online debate): the connect cycle,
    // button feedback and error handling are identical — only the on-open setup differs.
    function createHub(name, $btn, onOpen) {
        if (sessionPeer) { sessionPeer.destroy(); sessionPeer = null; }
        $btn.text('Łączenie…').prop('disabled', true);
        sessionPeer = new Peer(name);
        keepSignalingAlive(sessionPeer);
        sessionPeer.on('open', onOpen);
        sessionPeer.on('error', function(err) {
            console.error('[Session] Master error:', err.type);
            var msg = err.type === 'unavailable-id' ? 'Nazwa zajęta — wybierz inną' : 'Błąd: ' + err.type;
            $btn.text(msg).prop('disabled', false);
            sessionPeer = null;
        });
        sessionPeer.on('connection', handleMasterConnection);
    }

    $('.session-random-btn').click(function() {
        var name = SESSION_WORDS[Math.floor(Math.random() * SESSION_WORDS.length)];
        $('.session-name-input').val(name).trigger('input');
    });

    $('.session-create-btn').click(function() {
        var name = $('.session-name-input').val().trim().toLowerCase();
        if (!/^[a-zA-Z0-9]+$/.test(name)) return;
        var $btn = $(this);
        createHub(name, $btn, function(id) {
            var link = window.location.origin + window.location.pathname + '?s=' + id;
            $('.session-link-val').val(link);
            $('.session-links').show();
            $('#session-qr').empty();
            new QRCode(document.getElementById('session-qr'), {text: link, width: 128, height: 128});
            $btn.text('Sesja aktywna');
        });
    });

    // Shared master-side connection handling (plain sharing + online debate)
    function handleMasterConnection(conn) {
        conn.on('open', function() {
            var old = sessionConnections[conn.peer];
            if (old && old !== conn) { try { old.close(); } catch (e) {} }
            sessionConnections[conn.peer] = conn;
            // A brand-new joiner with the waiting room on has no roster entry yet, so
            // connAdmitted() falls back to "admitted iff waiting room is off" — keep
            // the clock state out of their hands until they're actually let in.
            if (connAdmitted(conn.peer)) {
                safeSend(conn, {type: 'init', state: App.core.getFullState()});
            }
            // A reconnecting participant (post-failover) never re-sends {type:'join'},
            // so this is the only place it gets a fresh roster — a brand-new joiner
            // gets a second, complete one moments later once addRosterEntry runs.
            // With the waiting room on, an unknown peer gets nothing until admitted.
            if (debateRoster.length && connAdmitted(conn.peer)) {
                safeSend(conn, { type: 'roster', roster: slimRoster() });
            }
            App.core.showAlert('Podłączono sesję');
        });
        conn.on('data', function(data) {
            App.vlog('[PeerJS←]', conn.peer, data);
            var sender = findEntryByPeer(conn.peer);
            // Someone still in the waiting room can't touch the clock, seats or chat
            if (sender && sender.pending && data.type !== 'join') return;
            if (data.type === 'settings') {
                App.core.applyState(data.state);
                eachConn(function(c, peerId) {
                    if (c !== conn && connAdmitted(peerId)) safeSend(c, {type: 'state', state: data.state});
                });
            } else if (data.type === 'join') {
                // A kicked/rejected clientId gets the same refusal replayed instead of
                // being silently re-admitted — otherwise "Usuń" is enforced by nothing
                // but the removed client's own goodwill (it would just reconnect and
                // rejoin with the same clientId).
                if (expelledClientIds[data.clientId]) {
                    sendToPeer(conn.peer, { type: 'cmd', action: expelledClientIds[data.clientId] });
                    return;
                }
                addRosterEntry(conn.peer, data.name, data.wasMaster, data.clientId);
            } else if (data.type === 'takeSlot') {
                if (sender) assignSlot(sender.clientId, data.zone, data.index);
            } else if (data.type === 'leaveSlot') {
                if (sender) vacateSlot(sender.clientId);
            } else if (data.type === 'chat') {
                if (!sender) return; // no roster entry yet (or already removed) — nothing to attribute the message to
                var chatChannel = (data.channel === 'general') ? 'general' : sender.zone;
                broadcastChat(sender.name, data.msg, chatChannel);
            } else if (data.type === 'signal') {
                if (sender) setSignal(sender.clientId, data.kind, data.on);
            } else if (data.type === 'clearSignal') {
                // Only the raiser themselves or the marshal may take a signal down
                if (sender && (sender.marshal || sender.clientId === String(data.clientId))) {
                    setSignal(String(data.clientId), data.kind, false);
                }
            } else if (data.type === 'breakout') {
                if (sender) setBreakout(sender.clientId, data.on);
            }
        });
        conn.on('close', function() {
            // A superseded connection (same peer reconnected, or we closed it ourselves
            // while evicting a stale entry) is not ours to clean up.
            if (sessionConnections[conn.peer] !== conn) return;
            delete sessionConnections[conn.peer];
            var e = findEntryByPeer(conn.peer);
            if (e) removeRosterEntry(e.clientId);
            App.core.showAlert('Odłączono sesję');
        });
    }

    $('.session-copy-btn').click(function() {
        navigator.clipboard.writeText($('.session-link-val').val());
    });

    $('.slave-controls-checkbox').change(function() {
        App.state.slaveShowControls = this.checked;
        App.onStateChange({slaveShowControls: App.state.slaveShowControls});
    });

    $('.slave-copy-btn').click(function() {
        navigator.clipboard.writeText($('.slave-session-link-val').val());
    });

    $('.slave-disconnect-btn').click(function() {
        if (!window.confirm('Czy na pewno chcesz rozłączyć sesję?')) return;
        window.location.replace(window.location.origin + window.location.pathname);
    });

    $('.session-join-btn').click(function() {
        var name = $('.session-join-input').val().trim().toLowerCase();
        if (!/^[a-zA-Z0-9]+$/.test(name)) return;
        var $btn = $(this);
        $btn.text('Sprawdzanie…').prop('disabled', true);
        $('.session-join-error').hide();

        var done = false;
        var checkPeer = new Peer();

        checkPeer.on('open', function() {
            var conn = checkPeer.connect(name, {serialization: 'json'});
            var timeout = setTimeout(function() {
                if (done) return;
                done = true;
                checkPeer.destroy();
                $btn.text('Dołącz').prop('disabled', false);
                $('.session-join-error').text('Brak odpowiedzi — spróbuj ponownie').show();
            }, 5000);
            conn.on('open', function() {
                if (done) return;
                done = true;
                clearTimeout(timeout);
                checkPeer.destroy();
                window.location.replace(window.location.origin + window.location.pathname + '?s=' + name);
            });
        });

        checkPeer.on('error', function(err) {
            if (done) return;
            done = true;
            checkPeer.destroy();
            $btn.text('Dołącz').prop('disabled', false);
            var msg = err.type === 'peer-unavailable'
                ? 'Sesja "' + name + '" nie istnieje'
                : 'Błąd: ' + err.type;
            $('.session-join-error').text(msg).show();
        });
    });

    // --- Debata online (VDO.Ninja) ---

    function vdoRoom() { return 'debate' + debateSessionId; }

    // Strip VDO.Ninja's own UI so the iframe is a bare video tile — all controls
    // (camera/mic pick, mute, chat) live in the app's own UI via postMessage.
    // &transparent lets the .debate-video container control the background colour.
    // &cover crops the feed to fill the tile instead of letterboxing/pillarboxing it.
    var VDO_CLEAN = '&cleanoutput&hidemenu&transparent&cover';
    // Baza: nieaktywni publikujący na 0kbps do ręcznego dodania — patrz
    // docs.vdo.ninja/advanced-settings/mixer-scene-parameters/scene.md.
    // Kto konkretnie jest "ręcznie dodawany" na ciepło (żeby strona przeciwna
    // do mówiącej nie miała opóźnienia przy wtrąceniu) — patrz updatePrewarm().
    var VDO_SCENE = '&scene=2';
    // Sufit pobierania na gościa dla całego pokoju — ustawiany na linku reżysera,
    // patrz docs.vdo.ninja/advanced-settings/video-bitrate-parameters/roombitrate.md.
    // Wartość konserwatywna z myślą o słabszym łączu szkolnym; do doprecyzowania po teście.
    var VDO_DIRECTOR_BITRATE = '&totalroombitrate=4500';
    // Sufit tego, ile inni goście mogą pociągnąć z TEGO publikującego — niezależny
    // od sufitu całego pokoju, chroni przed jedną kamerą zjadającą cały budżet.
    var VDO_PUBLISH_BITRATE = '&roombitrate=2000';

    // A stable, predictable VDO.Ninja stream id per participant (instead of a random one)
    // so the director can target a specific person with &push/&forward regardless of when
    // they joined.
    function pushIdFor(peerId) { return String(peerId).replace(/[^a-zA-Z0-9]/g, '_').slice(0, 64); }

    // Every director command VDO.Ninja's own examples send includes a callback id
    // (cib) — we don't use the callback, but omitting it seems to route addScene
    // through a different, crashing internal code path (observed as an uncaught
    // "postMessage ... cannot be converted to a sequence" error inside VDO.Ninja's
    // own remoteInterfaceAPI). Just needs to be present and unique per call.
    var cibCounter = 0;
    function nextCib() { return 'c' + (++cibCounter) + '_' + Date.now(); }

    function breakoutRoomId(zone) {
        return vdoRoom() + '-bo-' + zone;
    }

    // &scene and &push are mutually exclusive on a single VDO.Ninja link — per
    // docs.vdo.ninja/advanced-settings/mixer-scene-parameters/scene.md and .../and-solo.md,
    // "&solo and &scene also tells the system not to be a publisher, but a viewer", i.e.
    // adding &scene to a &push link silently drops the &push and the guest never actually
    // publishes camera/mic at all. So publishing and scene-viewing need two SEPARATE
    // iframes: buildViewUrl() for the always-present visible stage (see embedVdo), and
    // buildPublishUrl() for a hidden send-only iframe (see embedPublish), same split as
    // the existing debateIframe / directorIframe pattern.

    // Everyone (audience / unassigned / master watching / seated publishers) sees the
    // scene through this link. &videodevice=0&audiodevice=0 stops VDO.Ninja from touching
    // local camera/mic on THIS iframe at all — that only ever happens on the publish
    // iframe below, so viewers on hardware without either can still join and watch.
    function buildViewUrl() {
        var room = encodeURIComponent(vdoRoom());
        // This viewer has no idea the publish iframe's stream is "us", so once we're
        // addScene'd it would play our own mic back with full WebRTC latency (delayed
        // self-echo). &excludeaudio drops just that stream's audio while keeping its
        // video on stage. (docs.vdo.ninja/advanced-settings/audio-parameters/noaudio.md
        // misspells it "exludeaudio" — the correct spelling is what works.)
        // Harmless for audience: the id simply never publishes.
        var selfMute = myPushId ? '&excludeaudio=' + encodeURIComponent(pushIdFor(myPushId)) : '';
        // Celowo BEZ &activespeaker: jego detekcja jest lokalna per viewer i oparta na
        // odbieranym audio, więc przez powyższy &excludeaudio mówca nigdy nie widział
        // własnego kafelka. Kto jest widoczny, narzuca aplikacja — patrz applySpeakerView().
        // &animated=0 gasi domyślną animację przesuwania kafelków przy przestawianiu
        // sceny — przy zmianie mówcy (replace) klatkowała zamiast płynnie przełączyć.
        return VDO_BASE + '?room=' + room + VDO_SCENE + VDO_CLEAN + '&animated=0' +
            '&videodevice=0&audiodevice=0' + selfMute;
    }
    // Publishers (people who took a debater/judge slot) send camera + mic through this
    // hidden iframe. &webcam picks "Join Room with Camera" and &autostart skips the entry
    // screen. What they see of the room — including their own video, once addScene'd —
    // comes back through the always-present buildViewUrl() iframe, same as everyone else.
    function buildPublishUrl(name, pushId) {
        var room = encodeURIComponent(vdoRoom());
        return VDO_BASE + '?room=' + room + '&label=' + encodeURIComponent(name || '') +
            '&push=' + encodeURIComponent(pushIdFor(pushId)) +
            '&webcam&autostart' + VDO_PUBLISH_BITRATE + '&cleanoutput&hidemenu';
    }

    // A second, invisible iframe that holds director permissions purely so we can send
    // &forward commands for breakout rooms — kept off-screen so its own control panel
    // (record/mute/scene buttons) never leaks into our UI. The master's visible iframe
    // above stays a plain scene viewer / publisher, unchanged.
    var directorIframe = null;
    // A director's &forward command only works on guests currently inside that director's
    // own room — VDO.Ninja hands "ownership" of a guest to whichever room it's forwarded
    // into. So pulling someone back out of a breakout room needs a director actually
    // sitting in that breakout room; the main room's director can no longer see them by
    // then. One extra invisible director iframe per zone covers that.
    var breakoutDirectorIframes = {};

    // Które strefy należą do którego formatu — Oxford: proposition/opposition,
    // BP: og/oo/cg/co; judges (i audience) dotyczą obu i nigdy nie są filtrowane.
    var ZONE_FORMAT = { proposition: 'oxford', opposition: 'oxford', og: 'bp', oo: 'bp', cg: 'bp', co: 'bp' };
    function relevantZones() {
        var fmt = App.core.getCurrentFormat();
        return Object.keys(ZONE_SLOTS).filter(function(zone) {
            return !ZONE_FORMAT[zone] || ZONE_FORMAT[zone] === fmt;
        });
    }

    // Kto realnie może wtrącić się, gdy mówi dana strefa. Sędziowie/widownia
    // celowo nie mają tu wpisu — brak wpisu = brak podgrzewania, zgodnie z
    // założeniem, że oni mogą znieść sekundowe opóźnienie.
    var INTERJECT_OPPONENTS = {
        proposition: ['opposition'], opposition: ['proposition'],
        og: ['oo', 'co'], cg: ['oo', 'co'],
        oo: ['og', 'cg'], co: ['og', 'cg']
    };
    function zonePushIds(zone) {
        return debateRoster.filter(function(e) { return e.zone === zone; }).map(function(e) { return e.pushId; });
    }

    function embedDirector() {
        if (directorIframe) return;
        var room = encodeURIComponent(vdoRoom());
        var $f = $('<iframe class="vdo-director-iframe" allow="autoplay" src="' +
            VDO_BASE + '?director=' + room + VDO_DIRECTOR_BITRATE + '&cleanoutput&hidemenu"></iframe>');
        $('body').append($f);
        directorIframe = $f.get(0);
        $.each(relevantZones().filter(zoneHasBreakout), function(i, zone) {
            var broom = encodeURIComponent(breakoutRoomId(zone));
            var $bf = $('<iframe class="vdo-director-iframe" allow="autoplay" src="' +
                VDO_BASE + '?director=' + broom + VDO_DIRECTOR_BITRATE + '&cleanoutput&hidemenu"></iframe>');
            $('body').append($bf);
            breakoutDirectorIframes[zone] = $bf.get(0);
        });
        updateSelfSpeechDetection();
    }
    function removeDirector() {
        if (directorIframe) { $(directorIframe).remove(); directorIframe = null; }
        $.each(breakoutDirectorIframes, function(zone, iframe) { $(iframe).remove(); });
        breakoutDirectorIframes = {};
        resetPrewarmState();
        updateSelfSpeechDetection();
    }

    // Local self-view for the join screen — lets the user test camera/mic before
    // joining. Auto-embedded together with the join screen: this iframe is what asks
    // for camera+mic permission, in one combined prompt (a grant is per device TYPE,
    // so it covers every camera and every mic). Don't pre-ask via a top-level
    // getUserMedia instead — a top-level grant doesn't reliably transfer to the
    // cross-origin vdo.ninja iframes (Safari scopes grants to the requesting frame's
    // origin; Chrome's "Allow this time" isn't delegated), which used to cause a
    // second prompt at seat-taking. Grants DO carry between successive vdo.ninja
    // iframes on the same page, so the later publish iframe starts silently.
    function embedPreview() {
        var allow = 'camera *; microphone *; autoplay; fullscreen; picture-in-picture';
        $('.debate-join-preview').html(
            '<iframe class="vdo-iframe" allow="' + allow + '" src="' +
            VDO_BASE + '?webcam&autostart&cleanoutput&transparent&cover"></iframe>'
        );
        previewIframe = $('.debate-join-preview iframe').get(0);
        if (previewIframe) {
            previewIframe.onload = function() {
                pollDeviceList('preview', function() { return previewIframe; });
            };
        }
        startMicMeter();
    }
    function clearPreview() {
        stopDeviceListPoll('preview');
        $('.debate-join-preview').empty();
        previewIframe = null;
        $('.debate-join-cam-select').hide().empty();
        $('.debate-join-mic-select').hide().empty();
        stopMicMeter();
    }

    // A getDeviceList answered before the user clicks "Allow" returns placeholder
    // entries (one per kind, empty labels) — enumerateDevices() only yields the real
    // list once the iframe's own getUserMedia has been granted. The permission prompt
    // easily outlives a one-shot request, so poll until a labelled list arrives (the
    // message handler stops the poll when it sees one).
    var deviceListPolls = {};   // frame label -> interval id
    function pollDeviceList(label, getFrame) {
        stopDeviceListPoll(label);
        var attempts = 0;
        function ask() {
            var f = getFrame();
            if (!f || ++attempts > 20) { stopDeviceListPoll(label); return; }
            postToFrame(f, { getDeviceList: true });
        }
        deviceListPolls[label] = setInterval(ask, 2000);
        ask();
    }
    function stopDeviceListPoll(label) {
        if (deviceListPolls[label]) { clearInterval(deviceListPolls[label]); delete deviceListPolls[label]; }
    }
    function deviceListHasLabels(list) {
        var split = splitDeviceList(list);
        return split.cams.concat(split.mics).some(function(d) { return !!d.label; });
    }

    // Mic level meter — grabbed independently of the VDO iframe (which owns the camera
    // preview) since a cross-origin iframe won't hand us its audio stream to analyse.
    var micMeterStream = null, micMeterCtx = null, micMeterRaf = null, micMeterTimeoutId = null;
    function startMicMeter() {
        console.log('[Debata] startMicMeter() called');
        stopMicMeter();
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            console.log('[Debata] no navigator.mediaDevices.getUserMedia available');
            $('.debate-join-error').text('Mikrofon: przeglądarka nie udostępnia getUserMedia (kontekst niezabezpieczony?)').show();
            return;
        }
        console.log('[Debata] calling getUserMedia({audio:true})…');
        micMeterTimeoutId = setTimeout(function() {
            micMeterTimeoutId = null;
            console.warn('[Debata] getUserMedia(audio) did not respond within 6s');
            $('.debate-join-error').text('Mikrofon: przeglądarka nie odpowiada na prośbę o dostęp (sprawdź rozszerzenia blokujące lub ustawienia prywatności systemu)').show();
        }, 6000);
        navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream) {
            if (micMeterTimeoutId) { clearTimeout(micMeterTimeoutId); micMeterTimeoutId = null; }
            console.log('[Debata] mic stream granted', stream);
            micMeterStream = stream;
            micMeterCtx = new (window.AudioContext || window.webkitAudioContext)();
            var source = micMeterCtx.createMediaStreamSource(stream);
            var analyser = micMeterCtx.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);
            var data = new Uint8Array(analyser.frequencyBinCount);
            $('.mic-level-meter').show();
            (function tick() {
                analyser.getByteTimeDomainData(data);
                var sum = 0;
                for (var i = 0; i < data.length; i++) {
                    var v = (data[i] - 128) / 128;
                    sum += v * v;
                }
                var rms = Math.sqrt(sum / data.length);
                $('.mic-level-fill').css('width', Math.min(100, Math.round(rms * 250)) + '%');
                micMeterRaf = requestAnimationFrame(tick);
            })();
        }).catch(function(err) {
            if (micMeterTimeoutId) { clearTimeout(micMeterTimeoutId); micMeterTimeoutId = null; }
            console.error('[Debata] Mic meter error:', err);
            $('.debate-join-error').text('Mikrofon: ' + err.name + (err.message ? ' — ' + err.message : '')).show();
        });
    }
    function stopMicMeter() {
        if (micMeterTimeoutId) { clearTimeout(micMeterTimeoutId); micMeterTimeoutId = null; }
        if (micMeterRaf) { cancelAnimationFrame(micMeterRaf); micMeterRaf = null; }
        if (micMeterCtx) { try { micMeterCtx.close(); } catch (e) {} micMeterCtx = null; }
        if (micMeterStream) { micMeterStream.getTracks().forEach(function(t) { t.stop(); }); micMeterStream = null; }
        $('.mic-level-meter').hide();
        $('.mic-level-fill').css('width', '0%');
    }

    // Self-speech detection for the master's own voice. handleLoudness() only sees
    // audio VDO.Ninja actually RECEIVES on our iframe — and WebRTC never loops our own
    // outgoing mic back to us as a received track, so the master can never detect
    // themselves speaking that way (relevant whenever the master also takes a seat).
    // This measures the local mic directly instead, same technique as startMicMeter().
    var SELF_SPEECH_THRESH = 0.03;
    var SELF_SPEECH_HANGOVER_MS = 1000; // avoid flicker during natural pauses in speech
    var selfSpeechStream = null, selfSpeechCtx = null, selfSpeechRaf = null, selfSpeechHangoverTimer = null;
    var amSelfSpeaking = false;
    function startSelfSpeechDetection() {
        if (selfSpeechStream || selfSpeechCtx) return; // already running
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
        navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream) {
            selfSpeechStream = stream;
            selfSpeechCtx = new (window.AudioContext || window.webkitAudioContext)();
            var source = selfSpeechCtx.createMediaStreamSource(stream);
            var analyser = selfSpeechCtx.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);
            var data = new Uint8Array(analyser.frequencyBinCount);
            (function tick() {
                if (!selfSpeechCtx) return; // stopped mid-flight
                analyser.getByteTimeDomainData(data);
                var sum = 0;
                for (var i = 0; i < data.length; i++) {
                    var v = (data[i] - 128) / 128;
                    sum += v * v;
                }
                var rms = Math.sqrt(sum / data.length);
                if (rms > SELF_SPEECH_THRESH) {
                    if (selfSpeechHangoverTimer) { clearTimeout(selfSpeechHangoverTimer); selfSpeechHangoverTimer = null; }
                    if (!amSelfSpeaking) { amSelfSpeaking = true; reportSelfSpeaking(true); }
                } else if (amSelfSpeaking && !selfSpeechHangoverTimer) {
                    selfSpeechHangoverTimer = setTimeout(function() {
                        selfSpeechHangoverTimer = null;
                        amSelfSpeaking = false;
                        reportSelfSpeaking(false);
                    }, SELF_SPEECH_HANGOVER_MS);
                }
                selfSpeechRaf = requestAnimationFrame(tick);
            })();
        }).catch(function(err) {
            console.error('[Debata] Self-speech meter error:', err);
        });
    }
    function stopSelfSpeechDetection() {
        if (selfSpeechHangoverTimer) { clearTimeout(selfSpeechHangoverTimer); selfSpeechHangoverTimer = null; }
        if (selfSpeechRaf) { cancelAnimationFrame(selfSpeechRaf); selfSpeechRaf = null; }
        if (selfSpeechCtx) { try { selfSpeechCtx.close(); } catch (e) {} selfSpeechCtx = null; }
        if (selfSpeechStream) { selfSpeechStream.getTracks().forEach(function(t) { t.stop(); }); selfSpeechStream = null; }
        if (amSelfSpeaking) { amSelfSpeaking = false; reportSelfSpeaking(false); }
    }
    // Only relevant while we're both master (own the directorIframe needed for addScene)
    // and seated/publishing (there's an own voice to detect in the first place).
    function updateSelfSpeechDetection() {
        if (isDebateMaster && myEmbedMode === 'publish') startSelfSpeechDetection();
        else stopSelfSpeechDetection();
    }
    function reportSelfSpeaking(speaking) {
        var me = myEntry();
        if (!me || !!me.speaking === speaking) return;
        me.speaking = speaking;
        renderZones();
        broadcastSpeaking();
        updatePrewarm();
        applySpeakerView();
    }

    // The visible stage — a plain scene viewer, never swapped on publish/view role
    // changes (see buildViewUrl for why it can't also publish). Rebuilt only when
    // myPushId changes: a master handoff mints a new peer id, and the &exludeaudio
    // baked into the old URL would keep pointing at the previous stream, bringing
    // the self-echo back for the ex-master once they take a seat again.
    var viewUrlPushId = null;  // myPushId baked into the current iframe's URL
    function embedVdo() {
        if (debateIframe && viewUrlPushId !== myPushId) {
            $('.debate-video-frame').empty();
            debateIframe = null;
        }
        if (debateIframe) return;
        viewUrlPushId = myPushId;
        speakerViewSids = null; // świeży iframe = czysty grid, filtr narzucimy od zera
        var allow = 'autoplay; fullscreen; picture-in-picture';
        $('.debate-video-frame').html(
            '<iframe class="vdo-iframe" allow="' + allow + '" src="' + buildViewUrl() + '"></iframe>'
        );
        $('.debate-video').addClass('debate-video--has-frame');
        debateIframe = $('.debate-video-frame iframe').get(0);
        if (debateIframe) {
            debateIframe.onload = function() {
                // Master's iframe hears everyone → loudness tells us who is talking
                if (isDebateMaster) {
                    postToVdo({ getLoudness: true });
                    setTimeout(function() { postToVdo({ getLoudness: true }); }, 3000);
                }
                // Dołączenie w trakcie: ktoś może już mówić, zanim dotrą zdarzenia sceny
                applySpeakerView(true);
            };
        }
    }

    // Hidden send-only iframe for when we've taken a debater/judge slot — see
    // buildPublishUrl for why this has to be separate from the visible viewer iframe.
    var publishIframe = null;
    function embedPublish(name, pushId) {
        if (publishIframe) return;
        // Camera/microphone must be delegated to the cross-origin vdo.ninja iframe with
        // "*" (bare "camera" means 'self' only, which silently blocks getUserMedia there).
        var allow = 'camera *; microphone *; display-capture *; autoplay; fullscreen; picture-in-picture';
        var $f = $('<iframe class="vdo-publish-iframe" allow="' + allow + '" src="' +
            buildPublishUrl(name, pushId) + '"></iframe>');
        $('body').append($f);
        publishIframe = $f.get(0);
        publishIframe.onload = function() {
            pollDeviceList('publish', function() { return publishIframe; });
        };
    }
    function removePublish() {
        stopDeviceListPoll('publish');
        if (publishIframe) { $(publishIframe).remove(); publishIframe = null; }
    }

    function vdoFrameLabel(iframe) {
        if (iframe === debateIframe) return 'debate';
        if (iframe === publishIframe) return 'publish';
        if (iframe === directorIframe) return 'director';
        if (iframe === previewIframe) return 'preview';
        var breakoutZone = null;
        $.each(breakoutDirectorIframes, function(zone, f) { if (f === iframe) breakoutZone = zone; });
        if (breakoutZone) return 'director-breakout-' + breakoutZone;
        return 'iframe';
    }
    function postToFrame(iframe, obj) {
        if (iframe && iframe.contentWindow) {
            App.vlog('[VDO→ ' + vdoFrameLabel(iframe) + ']', obj);
            try { iframe.contentWindow.postMessage(obj, '*'); } catch (e) {}
        }
    }
    function postToVdo(obj) { postToFrame(debateIframe, obj); }
    function postToPublish(obj) { postToFrame(publishIframe, obj); }

    function setMicBtn(on) {
        micOn = on;
        $('.debate-mic-btn').toggleClass('is-off', !on).attr('title', on ? 'Wycisz mikrofon' : 'Włącz mikrofon');
    }

    // VDO.Ninja's deviceList shape varies; accept a flat array or a grouped object
    function splitDeviceList(list) {
        var cams = [], mics = [];
        if (Array.isArray(list)) {
            list.forEach(function (d) {
                if (d.kind === 'videoinput') cams.push(d);
                else if (d.kind === 'audioinput') mics.push(d);
            });
        } else if (list && typeof list === 'object') {
            cams = list.videoinput || list.video || [];
            mics = list.audioinput || list.audio || [];
        }
        return { cams: cams, mics: mics };
    }

    function populateDevices(list) {
        var split = splitDeviceList(list);
        fillDeviceMenu($('.debate-cam-menu'), split.cams, 'Kamera');
        fillDeviceMenu($('.debate-mic-menu'), split.mics, 'Mikrofon');
        // Join-screen indexes refer to the REAL device list — applying them against a
        // pre-permission placeholder list would switch to the wrong device.
        if (deviceListHasLabels(list)) applyPreferredDevices();
    }

    // Carry the device chosen on the join screen over into the live room the first
    // time its device list arrives.
    function applyPreferredDevices() {
        if (joinCamDeviceIndex != null) {
            markActiveDevice($('.debate-cam-menu'), joinCamDeviceIndex);
            // VDO.Ninja's changeVideoDevice is 0-based while our UI index is 1-based (see changeAudioDevice below).
            postToPublish({ changeVideoDevice: joinCamDeviceIndex - 1 });
        }
        if (joinMicDeviceIndex != null) {
            markActiveDevice($('.debate-mic-menu'), joinMicDeviceIndex);
            postToPublish({ changeAudioDevice: joinMicDeviceIndex });
        }
    }

    function populateJoinDevices(list) {
        var split = splitDeviceList(list);
        fillDeviceSelect($('.debate-join-cam-select'), split.cams, 'Kamera');
        fillDeviceSelect($('.debate-join-mic-select'), split.mics, 'Mikrofon');
    }

    function fillDeviceSelect($sel, devices, fallback) {
        if (!devices || devices.length < 2) { $sel.hide(); return; }
        $sel.empty();
        devices.forEach(function (d, i) {
            $('<option></option>').val(i + 1).text(d.label || (fallback + ' ' + (i + 1))).appendTo($sel);
        });
        $sel.show();
    }

    // In-room mic/cam pickers: a dropdown-menu on the split button's caret instead of
    // a <select>. The caret itself always stays visible for a consistent layout —
    // when there's nothing to pick from, it's just disabled (greyed out, inert)
    // instead of disappearing.
    function fillDeviceMenu($menu, devices, fallback) {
        var $caret = $menu.siblings('.dv-caret');
        $menu.empty();
        if (!devices || devices.length < 2) { $caret.prop('disabled', true); return; }
        devices.forEach(function (d, i) {
            $('<button type="button" class="dropdown-item"></button>')
                .attr('data-index', i + 1).text(d.label || (fallback + ' ' + (i + 1))).appendTo($menu);
        });
        $caret.prop('disabled', false);
    }

    function markActiveDevice($menu, index) {
        $menu.find('.dropdown-item').removeClass('active').filter('[data-index="' + index + '"]').addClass('active');
    }

    // Chat: a general channel everyone shares, plus one channel per debate zone that only
    // its current occupants (and the master, while seated there) can see.
    var chatLogs = {};            // channel -> [{name, msg}]
    var activeChatIsTeam = false; // false = "Ogólny" tab, true = "Zespół" tab

    function myChatZone() {
        var e = myEntry();
        return (e && e.zone) || 'audience';
    }
    function currentChatChannel() { return activeChatIsTeam ? myChatZone() : 'general'; }

    function zoneChatLabel(zone) {
        return zone === 'proposition' ? 'Propozycja' : zone === 'opposition' ? 'Opozycja' :
            zone === 'og' ? 'Otwierający rząd' : zone === 'oo' ? 'Otwierająca opozycja' :
            zone === 'cg' ? 'Zamykający rząd' : zone === 'co' ? 'Zamykająca opozycja' :
            zone === 'judges' ? 'Sędziowie' : 'Widzowie';
    }

    function renderChatLog() {
        var $log = $('.debate-chat-log');
        if (!$log.length) return;
        $log.empty();
        (chatLogs[currentChatChannel()] || []).forEach(function(m) {
            var $m = $('<div class="chat-msg"></div>');
            $m.append($('<b></b>').text(m.name + ': '));
            $m.append(document.createTextNode(m.msg));
            $log.append($m);
        });
        $log.scrollTop($log.prop('scrollHeight'));
    }

    // Keep the "Zespół" tab in sync with whatever zone I'm currently seated in.
    function updateChatTabs() {
        var zone = myChatZone();
        $('.debate-chat-tab-team').text(zoneChatLabel(zone)).data('zone', zone);
        $('.debate-chat-tab-general').toggleClass('active', !activeChatIsTeam);
        $('.debate-chat-tab-team').toggleClass('active', activeChatIsTeam);
        $('.debate-chat')
            .removeClass('debate-chat--general debate-chat--proposition debate-chat--opposition debate-chat--og debate-chat--oo debate-chat--cg debate-chat--co debate-chat--judges debate-chat--audience')
            .addClass('debate-chat--' + currentChatChannel());
        renderChatLog();
        (activeChatIsTeam ? $('.debate-chat-tab-team') : $('.debate-chat-tab-general')).removeClass('has-unread');
    }

    $(document).on('click', '.debate-chat-tab-general', function() { activeChatIsTeam = false; updateChatTabs(); });
    $(document).on('click', '.debate-chat-tab-team', function() { activeChatIsTeam = true; updateChatTabs(); });

    function appendChat(name, msg, channel) {
        channel = channel || 'general';
        if (!chatLogs[channel]) chatLogs[channel] = [];
        chatLogs[channel].push({ name: name, msg: msg });
        if (channel === currentChatChannel()) {
            renderChatLog();
        } else if (channel === 'general' || channel === myChatZone()) {
            (channel === 'general' ? $('.debate-chat-tab-general') : $('.debate-chat-tab-team')).addClass('has-unread');
        }
    }

    // Master-side send: 'general' goes to everyone admitted, a team channel only to
    // whoever is *currently* seated in that zone (checked live, not trusted from the sender).
    function broadcastChat(name, msg, channel) {
        channel = channel || 'general';
        appendChat(name, msg, channel);
        eachConn(function (conn, peerId) {
            if (!connAdmitted(peerId)) return;
            var entry = findEntryByPeer(peerId);
            if (channel === 'general' || (entry && entry.zone === channel)) {
                safeSend(conn, { type: 'chat', channel: channel, name: name, msg: msg });
            }
        });
    }

    // Participant: apply a command relayed from the master
    function handleDebateCmd(data) {
        if (data.action === 'mute') {
            postToPublish({ mic: false });
            setMicBtn(false);
            App.core.showWarn('Prowadzący wyciszył Twój mikrofon');
        } else if (data.action === 'close') {
            App.core.showWarn('Prowadzący zamknął pokój debaty');
            setTimeout(function() {
                window.location.replace(window.location.origin + window.location.pathname);
            }, 5000);
        } else if (data.action === 'allowControls') {
            debateAllowControls = !!data.on;
            updateControlsVisibility();
        } else if (data.action === 'waiting') {
            // Waiting room: pull back anything already revealed and park on the hold screen
            $('.debate-stage').hide();
            $('.debate-video-frame').empty();
            $('.debate-video').removeClass('debate-video--has-frame');
            debateIframe = null;
            removePublish();
            myEmbedMode = null;
            $('.debate-waiting-hint').text('Prowadzący włączył poczekalnię — czekasz na wpuszczenie…');
            $('.debate-waiting').show();
        } else if (data.action === 'rejected') {
            window.alert('Prowadzący nie wpuścił Cię do pokoju debaty');
            window.location.replace(window.location.origin + window.location.pathname);
        } else if (data.action === 'kick') {
            window.alert('Prowadzący usunął Cię z pokoju debaty');
            window.location.replace(window.location.origin + window.location.pathname);
        }
    }

    function addRosterEntry(peerId, name, wasMaster, clientId) {
        clientId = clientId || peerId;  // client couldn't mint an id — peerId is the best we have
        // A rejoin after a page refresh gets a brand-new PeerJS peerId, but the same
        // persistent clientId — drop any old entry (and its now-stale connection, which
        // PeerJS may not notice is actually dead for a while yet) for the same browser
        // right away, instead of leaving a duplicate on the list until WebRTC's own
        // disconnect detection eventually catches up. The master's own entry is never
        // evicted, even by a join from the same browser (a second tab).
        var stale = debateRoster.filter(function(e) {
            return e.role !== 'master' && e.clientId === clientId && e.peerId !== peerId;
        });
        debateRoster = debateRoster.filter(function(e) {
            return e.role === 'master' || (e.clientId !== clientId && e.peerId !== peerId);
        });
        stale.forEach(function(e) {
            var staleConn = sessionConnections[e.peerId];
            if (staleConn) {
                delete sessionConnections[e.peerId];
                try { staleConn.close(); } catch (err) {}
            }
        });
        var entry = {
            // pushId is fixed at the peerId this participant joined with and never changes
            // afterwards (not even on promotion to master), so their VDO stream (and any
            // &forward targeting it) keeps working with no re-embed. See TODO.md.
            clientId: clientId, peerId: peerId, pushId: peerId, name: name, role: null,
            zone: 'audience', index: -1, signals: {}, speaking: false, breakout: false,
            joinSeq: nextJoinSeq++, comaster: null, honorary: !!wasMaster,
            pending: waitingRoomOn
        };
        // Same browser rejoining (e.g. after an accidental F5): give back their seat,
        // raised signal, queue seniority — and their admission, so they skip the
        // waiting room they already passed through.
        var prev = stale[0];
        if (prev) {
            entry.joinSeq = prev.joinSeq;
            entry.signals = prev.signals || {};
            entry.pending = prev.pending && waitingRoomOn;
            if (prev.zone !== 'audience' && !occupant(prev.zone, prev.index)) {
                entry.zone = prev.zone;
                entry.index = prev.index;
            }
        }
        debateRoster.push(entry);
        syncPrimaryComaster();
        renderDebate();
        if (entry.pending) sendToPeer(peerId, { type: 'cmd', action: 'waiting' });
    }

    function removeRosterEntry(clientId) {
        debateRoster = debateRoster.filter(function(e) { return e.clientId !== clientId; });
        syncPrimaryComaster();
        renderDebate();
    }

    // Succession queue for who becomes master next: pure function over the already-
    // replicated roster, ordered by join order, excluding the master itself, anyone
    // honorary (a former/outgoing master — never re-enters the queue) and anyone
    // still stuck in the waiting room.
    function computeQueue() {
        return debateRoster
            .filter(function(e) { return e.role !== 'master' && !e.honorary && !e.pending; })
            .sort(function(a, b) { return a.joinSeq - b.joinSeq; });
    }

    // Same, but also considers honorary entries — used only as a fallback when the
    // room would otherwise be left with zero failover capacity (e.g. only 2 real
    // participants, and the other one is a returning/handed-off ex-master). Better an
    // honorary comaster than none: it's a rare edge case, not the default path.
    function computeFallbackQueue() {
        return debateRoster
            .filter(function(e) { return e.role !== 'master' && !e.pending; })
            .sort(function(a, b) { return a.joinSeq - b.joinSeq; });
    }

    // Fill a vacant "primary comaster" slot from the queue head — but never contest
    // an existing, still-eligible holder (keeps a manual designateComaster() override
    // sticky across unrelated roster churn). Only mutates the roster field here — the
    // designated comaster picks this up from the roster broadcast itself (see
    // handleSlaveData's 'roster' branch), not from a separate point-to-point message:
    // right after a promotion, the new comaster-to-be usually isn't even connected yet
    // (their own reconnect cascade takes several seconds), so a one-shot message sent
    // this instant would silently miss them.
    function syncPrimaryComaster() {
        var q = computeQueue();
        if (!q.length) q = computeFallbackQueue();
        var current = debateRoster.filter(function(e) { return e.comaster === 'primary'; })[0];
        if (current && q.indexOf(current) !== -1) return;
        if (current) current.comaster = null;
        if (q.length) q[0].comaster = 'primary';
    }

    // Master: manually override who the primary comaster is, ahead of the default
    // join-order assignment. Same as above — the roster broadcast that renderDebate()
    // triggers is what actually informs both the old and new comaster.
    function designateComaster(clientId) {
        var target = findEntry(clientId);
        if (!target || target.honorary || target.pending || target.role === 'master') return;
        var current = debateRoster.filter(function(e) { return e.comaster === 'primary'; })[0];
        if (current && current.clientId !== clientId) current.comaster = null;
        target.comaster = 'primary';
        renderDebate();
    }

    // Authoritative (master-side) slot assignment — moves a person, vacating their old slot
    function assignSlot(clientId, zone, index) {
        if (!ZONE_SLOTS[zone] || index < 0 || index >= zoneSlotCount(zone)) return;
        var taken = debateRoster.some(function(e) {
            return e.zone === zone && e.index === index && e.clientId !== clientId;
        });
        if (taken) return;
        var e = findEntry(clientId);
        if (!e) return;
        if (e.zone !== zone) resetBreakout(e);
        e.zone = zone; e.index = index;
        if (!isDebaterZone(zone)) dropSignalWithSeat(e);
        renderDebate();
    }

    // The marshal role always keeps a seat — leaving one (clicking your own avatar,
    // dragging onto the audience list in edit mode, …) never drops them into the
    // audience; it sends them back to the dedicated Marszałek zone instead, which
    // reappears for exactly this reason. Anyone else vacates to the audience as usual.
    function vacateSlot(clientId) {
        var e = findEntry(clientId);
        if (!e) return;
        resetBreakout(e);
        dropSignalWithSeat(e);
        if (e.marshal) { e.zone = 'marszalek'; e.index = 0; }
        else { e.zone = 'audience'; e.index = -1; }
        renderDebate();
    }

    // Master: assign (or, clicked again, unassign) the single "Marszałek" — if they're
    // currently a judge they just get the badge in place; anyone else is seated into the
    // dedicated Marszałek zone, which only exists while occupied (see renderZones()).
    function setMarshal(clientId) {
        var entry = findEntry(clientId);
        if (!entry || entry.pending) return;
        var wasMarshal = !!entry.marshal;
        var prev = debateRoster.filter(function(e) { return e.marshal; })[0];
        if (prev) {
            prev.marshal = false;
            if (prev.zone === 'marszalek') vacateSlot(prev.clientId);
        }
        if (wasMarshal) { renderDebate(); return; }
        entry.marshal = true;
        if (entry.zone === 'judges') renderDebate();
        else assignSlot(clientId, 'marszalek', 0);
    }

    // Breakout rooms: only debaters/judges (never the audience or the marshal's own
    // zone) may use them, and only for whichever zone they're currently seated in.
    // Leaving the seat (or being moved to a different one) always pulls them back to
    // the main room first.
    function doForward(entry) {
        if (!entry) return;
        // entry.breakout already reflects the *new* state, so it also tells us which
        // room the guest is coming from: the main room when entering, that zone's
        // breakout room when leaving — see the directorIframe comment above.
        var dest = entry.breakout ? breakoutRoomId(entry.zone) : vdoRoom();
        var source = entry.breakout ? directorIframe : breakoutDirectorIframes[entry.zone];
        postToFrame(source, { action: 'forward', target: pushIdFor(entry.pushId), value: dest });
    }
    function resetBreakout(entry) {
        if (entry && entry.breakout) { entry.breakout = false; doForward(entry); }
    }
    function setBreakout(clientId, on) {
        var e = findEntry(clientId);
        if (!e || !zoneHasBreakout(e.zone)) return;
        e.breakout = !!on;
        doForward(e);
        renderDebate();
    }
    function requestBreakout(on) {
        if (isDebateMaster) setBreakout(myClientId, on);
        else if (masterConn && masterConn.open) safeSend(masterConn, { type: 'breakout', on: on });
    }

    // The master can be seated too — keep its own toggle buttons in sync no matter
    // which path (button, badge click, marshal request) changed a signal.
    function syncMySignals(e) {
        mySignals.hand = !!(e && e.signals && e.signals.hand);
        mySignals.advocem = !!(e && e.signals && e.signals.advocem);
        updateSignalButtons();
    }

    // Question and ad vocem are independent — raising one never lowers the other
    function setSignal(clientId, kind, on) {
        if (kind !== 'hand' && kind !== 'advocem') return;
        var e = findEntry(clientId);
        if (!e) return;
        if (on && !isDebaterZone(e.zone)) return; // only team seats may raise; clearing is always allowed
        if (!e.signals) e.signals = {};
        e.signals[kind] = !!on;
        if (e.clientId === myClientId) syncMySignals(e);
        renderDebate();
        if (on) App.core.showAlert((e.name || 'Uczestnik') + (kind === 'advocem' ? ': ad vocem' : ': zgłasza pytanie'));
    }

    // Raised signals belong to a team seat — being reseated outside the team zones
    // (judge, marshal, audience) takes them down with the seat.
    function dropSignalWithSeat(e) {
        if (!e || !e.signals || (!e.signals.hand && !e.signals.advocem)) return;
        e.signals = {};
        if (e.clientId === myClientId) syncMySignals(e);
    }

    // Called locally (master) or relayed to master (participant)
    function requestSlot(zone, index) {
        if (isDebateMaster) assignSlot(myClientId, zone, index);
        else if (masterConn && masterConn.open) safeSend(masterConn, { type: 'takeSlot', zone: zone, index: index });
    }
    function requestLeave() {
        if (isDebateMaster) vacateSlot(myClientId);
        else if (masterConn && masterConn.open) safeSend(masterConn, { type: 'leaveSlot' });
    }

    // renderDebate = the visual zones (everyone) + the master management list (master only)
    function renderDebate() {
        renderZones();
        if (isDebateMaster) { renderMasterRoster(); broadcastRoster(); }
        updateMyEmbed();
    }

    // Slim roster shape sent over the wire (everyone renders the same zones from this).
    // Waiting-room entries stay master-local until admitted.
    function slimRoster() {
        return debateRoster.filter(function(e) { return !e.pending; }).map(function(e) {
            return {
                clientId: e.clientId, peerId: e.peerId, pushId: e.pushId, name: e.name,
                role: e.role || null, zone: e.zone, index: e.index, signals: e.signals || {},
                speaking: e.speaking, breakout: !!e.breakout,
                joinSeq: e.joinSeq, comaster: e.comaster || null, honorary: !!e.honorary,
                marshal: !!e.marshal
            };
        });
    }

    // Master broadcasts a slim roster so every admitted participant renders the same zones
    function broadcastRoster() {
        var slim = slimRoster();
        eachConn(function(conn, peerId) {
            if (!connAdmitted(peerId)) return;
            safeSend(conn, { type: 'roster', roster: slim });
        });
    }

    function occupant(zone, index) {
        return debateRoster.filter(function(e) { return e.zone === zone && e.index === index; })[0];
    }

    // While I'm in a breakout room, everyone who isn't in that same room with me is someone
    // I can no longer see/hear over VDO — dim them so the UI doesn't lie about who's "here".
    function isDimmedForMe(entry) {
        var me = myEntry();
        if (!me || !me.breakout || !entry) return false;
        return !(entry.zone === me.zone && entry.breakout);
    }

    // Same raised-hand drawing as on the .debate-hand-btn button, sized for a badge
    var HAND_BADGE_SVG =
        '<svg class="signal-badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M8 12.5V6a1.5 1.5 0 0 1 3 0v5.5"/>' +
        '<path d="M11 11.5V4.5a1.5 1.5 0 0 1 3 0v7"/>' +
        '<path d="M14 11.8V6a1.5 1.5 0 0 1 3 0v6.5"/>' +
        '<path d="M17 13V9a1.5 1.5 0 0 1 3 0v6c0 3.5-2 6.5-6 6.5h-1.5c-2 0-3-.5-4.3-2.2L5 15.8c-.6-.8-.5-1.7.3-2.3.8-.6 1.8-.4 2.4.3L9 15.5"/>' +
        '</svg>';

    // Raised-signal badge beside the name, one per raised kind (both can be up at
    // once). Clickable (to take that signal down) for the raiser themselves, the
    // marshal and the master; static for everyone else.
    function signalBadgeEl(entry, kind) {
        var isAdvocem = kind === 'advocem';
        var me = myEntry();
        var canClear = entry.clientId === myClientId || isDebateMaster || !!(me && me.marshal);
        var $b = $('<span class="badge signal-badge"></span>')
            .addClass(isAdvocem ? 'signal-badge--advocem' : 'signal-badge--hand')
            .attr('data-client', entry.clientId).attr('data-kind', kind)
            .attr('title', (isAdvocem ? 'Ad vocem' : 'Pytanie') + (canClear ? ' — kliknij, aby usunąć' : ''));
        if (isAdvocem) $b.text('AV'); else $b.html(HAND_BADGE_SVG);
        if (canClear) $b.addClass('signal-badge--clickable');
        return $b;
    }

    $(document).on('click', '.signal-badge--clickable', function(ev) {
        ev.stopPropagation();
        var clientId = String($(this).attr('data-client'));
        var kind = String($(this).attr('data-kind'));
        if (isDebateMaster) setSignal(clientId, kind, false);
        else if (masterConn && masterConn.open) safeSend(masterConn, { type: 'clearSignal', clientId: clientId, kind: kind });
    });

    function slotEl(entry, zone, index) {
        var mine = entry && entry.clientId === myClientId;
        var draggable = isDebateMaster && debateEditMode && !!entry;
        var cls = 'slot' + (entry ? '' : ' slot--empty') + (mine ? ' slot--me' : '') +
            (draggable ? ' slot--draggable' : '') +
            (isDimmedForMe(entry) ? ' slot--dimmed' : '');
        var $s = $('<div class="' + cls + '"></div>').attr('data-zone', zone).attr('data-index', index);
        if (draggable) $s.attr('draggable', 'true').attr('data-client', entry.clientId);
        var isChiefJudge = zone === 'judges' && index === 0;
        if (!entry) {
            var $plus = $('<button type="button" class="slot-avatar slot-plus">+</button>')
                .attr('data-zone', zone).attr('data-index', index);
            $s.append($plus);
            $s.append($('<div class="slot-name"></div>').text(isChiefJudge ? 'Sędzia główny' : '—'));
            return $s;
        }
        var $av = $('<div class="slot-avatar"></div>')
            .text(entry.name ? entry.name.trim().charAt(0).toUpperCase() : '');
        if (mine) { $av.addClass('slot-avatar--me').attr('title', 'Kliknij, aby wrócić do widzów'); }
        $s.append($av);
        var $n = $('<div class="slot-name"></div>').text(entry.name);
        if (entry.signals && entry.signals.hand) $n.append(' ').append(signalBadgeEl(entry, 'hand'));
        if (entry.signals && entry.signals.advocem) $n.append(' ').append(signalBadgeEl(entry, 'advocem'));
        if (isChiefJudge) $n.append(' ').append($('<span class="badge badge-dark chief-judge-badge" title="Sędzia główny"></span>').text('SG'));
        if (zone === 'judges' && entry.marshal) $n.append(' ').append($('<span class="badge marshal-badge" title="Marszałek"></span>').text('M'));
        if (entry.speaking) $n.append(' ').append($('<span class="slot-mic" title="Mówi">🎤</span>'));
        if (entry.breakout) $n.append(' ').append($('<span class="badge badge-secondary roster-breakout-badge"></span>').text('Narada'));
        if (entry.comaster === 'primary') $n.append(' ').append($('<span class="badge badge-info comaster-badge" title="Wyznaczony następca mastera"></span>').text('Co-master'));
        $s.append($n);
        return $s;
    }

    function fillZone(zone) {
        var $list = $('.slot-list[data-zone="' + zone + '"]');
        $list.empty();
        for (var i = 0; i < zoneSlotCount(zone); i++) $list.append(slotEl(occupant(zone, i) || null, zone, i));
    }

    // Long motions get the logos beside the clock to save vertical space; a short or
    // empty motion keeps them below it (bigger, simpler). "Long" = wraps past one line,
    // detected by comparing the rendered element's height to its own line-height —
    // recomputed on every zone render (covers state sync + the stage becoming visible)
    // and on resize (wrapping depends on the column's width too).
    function updateMotionLayout() {
        var $m = $('.debate-motion');
        if (!$m.length || !$m.is(':visible')) return;
        var lineHeight = parseFloat($m.css('line-height'));
        // A one- or two-line motion is normal and stays readable above the clock;
        // only 3+ lines is cramped enough to earn the compact side-by-side layout.
        var isLong = lineHeight > 0 && $m[0].scrollHeight > lineHeight * 2.5;
        $('.debate-center').toggleClass('debate-center--long-motion', isLong);
    }
    $(window).on('resize', updateMotionLayout);
    // The core (stopwatch.js) writes the motion text straight into the DOM — both on
    // every keystroke locally and via applyState() for synced peers — with no hook back
    // into this file, so watch the node itself rather than threading a call through core.
    if (document.querySelector('.debate-motion')) {
        new MutationObserver(updateMotionLayout)
            .observe(document.querySelector('.debate-motion'), { childList: true, characterData: true, subtree: true });
    }

    function renderZones() {
        fillZone('proposition');
        fillZone('opposition');
        fillZone('og');
        fillZone('oo');
        fillZone('cg');
        fillZone('co');
        fillZone('judges');
        fillZone('marszalek');
        $('.debate-zone--marshal').toggle(!!occupant('marszalek', 0));
        updateMotionLayout();

        var $aud = $('.slot-list[data-zone="audience"]');
        $aud.empty();
        var aud = debateRoster.filter(function(e) { return e.zone === 'audience' && !e.pending; });
        if (!aud.length) { $aud.append('<span class="aud-empty text-muted">—</span>'); }
        aud.forEach(function(e) {
            var $d = $('<div class="aud-dot"></div>').attr('title', e.name)
                .text(e.name ? e.name.trim().charAt(0).toUpperCase() : '');
            if (e.clientId === myClientId) $d.addClass('aud-dot--me');
            if (e.speaking) $d.addClass('aud-dot--speaking');
            if (e.comaster === 'primary') $d.addClass('aud-dot--comaster');
            if (isDimmedForMe(e)) $d.addClass('aud-dot--dimmed');
            if (isDebateMaster && debateEditMode) {
                $d.addClass('aud-dot--draggable').attr('draggable', 'true').attr('data-client', e.clientId);
            }
            $aud.append($d);
        });

        updateChatTabs();
        updateBreakoutButton();
    }

    // Master edit mode: drag a seated slot (or an audience dot) onto another slot to move/swap,
    // or onto the audience list to send someone back to the audience.
    function moveToSlot(clientId, zone, index) {
        var mover = findEntry(clientId);
        if (!mover) return;
        var occ = occupant(zone, index);
        if (occ && occ.clientId !== clientId) {
            resetBreakout(occ);
            occ.zone = mover.zone; occ.index = mover.index;
        }
        if (mover.zone !== zone) resetBreakout(mover);
        mover.zone = zone; mover.index = index;
        renderDebate();
    }

    $(document).on('dragstart', '.slot--draggable, .aud-dot--draggable', function(e) {
        if (!isDebateMaster || !debateEditMode) { e.preventDefault(); return; }
        e.originalEvent.dataTransfer.setData('text/plain', $(this).data('client'));
        e.originalEvent.dataTransfer.effectAllowed = 'move';
    });
    $(document).on('dragover', '.slot[data-zone], .slot-list[data-zone="audience"]', function(e) {
        if (!isDebateMaster || !debateEditMode) return;
        e.preventDefault();
        e.originalEvent.dataTransfer.dropEffect = 'move';
    });
    $(document).on('dragenter', '.slot[data-zone], .slot-list[data-zone="audience"]', function() {
        if (isDebateMaster && debateEditMode) $(this).addClass('slot--dragover');
    });
    $(document).on('dragleave', '.slot[data-zone], .slot-list[data-zone="audience"]', function() {
        $(this).removeClass('slot--dragover');
    });
    $(document).on('drop', '.slot[data-zone]', function(e) {
        if (!isDebateMaster || !debateEditMode) return;
        e.preventDefault();
        $(this).removeClass('slot--dragover');
        var clientId = e.originalEvent.dataTransfer.getData('text/plain');
        moveToSlot(clientId, $(this).data('zone'), parseInt($(this).data('index'), 10));
    });
    $(document).on('drop', '.slot-list[data-zone="audience"]', function(e) {
        if (!isDebateMaster || !debateEditMode) return;
        e.preventDefault();
        $(this).removeClass('slot--dragover');
        var clientId = e.originalEvent.dataTransfer.getData('text/plain');
        vacateSlot(clientId);
    });

    $('.debate-editmode-btn').click(function() {
        debateEditMode = !debateEditMode;
        $(this).toggleClass('active', debateEditMode)
            .text(debateEditMode ? 'Zakończ edycję miejsc' : 'Edytuj przypisanie miejsc');
        $('body').toggleClass('is-debate-edit', debateEditMode);
        renderDebate();
    });

    // Master-only management list: per-person mute
    function renderMasterRoster() {
        var $r = $('.debate-roster');
        if (!$r.length) return;
        $r.empty();
        if (!debateRoster.length) {
            $r.append('<p class="text-muted mb-0">Brak uczestników</p>');
            return;
        }
        debateRoster.forEach(function(e) {
            var $row = $('<div class="roster-row"></div>');
            $row.append($('<span class="roster-name"></span>').text(e.name + (e.role === 'master' ? ' (Ty)' : '')));
            $row.append($('<span class="roster-role"></span>').text(zoneLabel(e.zone)));
            if (e.pending) {
                $('<span class="badge badge-warning roster-pending-badge" title="Czeka na wpuszczenie"></span>').text('Poczekalnia').appendTo($row);
                $('<button type="button" class="btn btn-outline-primary btn-sm roster-admit">Wpuść</button>')
                    .attr('data-client', e.clientId).appendTo($row);
                $('<button type="button" class="btn btn-outline-danger btn-sm roster-reject">Odrzuć</button>')
                    .attr('data-client', e.clientId).appendTo($row);
                $r.append($row);
                return;
            }
            if (e.comaster === 'primary') {
                $('<span class="badge badge-info comaster-badge" title="Wyznaczony następca mastera"></span>').text('Co-master').appendTo($row);
            }
            if (e.honorary) {
                $('<span class="badge badge-secondary comaster-badge comaster-badge--honorary" title="Był(a) prowadzącym"></span>').text('Co-master (h.)').appendTo($row);
            }
            ['hand', 'advocem'].forEach(function(kind) {
                if (!e.signals || !e.signals[kind]) return;
                $('<button type="button" class="btn btn-sm roster-signal"></button>')
                    .attr('data-client', e.clientId).attr('data-kind', kind)
                    .text(kind === 'advocem' ? 'AD VOCEM' : '✋ pytanie')
                    .appendTo($row);
            });
            if (e.breakout) {
                $('<span class="badge badge-secondary roster-breakout-badge"></span>').text('Narada').appendTo($row);
                $('<button type="button" class="btn btn-outline-secondary btn-sm roster-recall">Wróć</button>')
                    .attr('data-client', e.clientId).appendTo($row);
            }
            $('<button type="button" class="btn btn-sm roster-marshal"></button>')
                .toggleClass('btn-secondary', !!e.marshal).toggleClass('btn-outline-secondary', !e.marshal)
                .text(e.marshal ? 'Zdejmij marszałka' : 'Ustaw jako marszałka')
                .attr('data-client', e.clientId).appendTo($row);
            if (e.role !== 'master') {
                $('<button type="button" class="btn btn-outline-secondary btn-sm roster-mute">Wycisz</button>')
                    .attr('data-client', e.clientId).appendTo($row);
                if (e.comaster === 'primary') {
                    $('<button type="button" class="btn btn-outline-primary btn-sm roster-promote">Uczyń masterem</button>')
                        .attr('data-client', e.clientId).appendTo($row);
                } else if (!e.honorary) {
                    $('<button type="button" class="btn btn-outline-secondary btn-sm roster-designate-comaster">Ustaw jako co-master</button>')
                        .attr('data-client', e.clientId).appendTo($row);
                }
                $('<button type="button" class="btn btn-outline-danger btn-sm roster-kick">Usuń</button>')
                    .attr('data-client', e.clientId).appendTo($row);
            }
            $r.append($row);
        });
    }

    // Master: push a participant out of the room (reject = still in the waiting room,
    // kick = already admitted). The cmd is sent first; the conn is closed a moment
    // later so the message has time to flush before the channel goes down.
    function expelParticipant(clientId, action) {
        var e = findEntry(clientId);
        if (!e || e.role === 'master') return;
        expelledClientIds[clientId] = action;
        sendToPeer(e.peerId, { type: 'cmd', action: action });
        var peerId = e.peerId;
        setTimeout(function() {
            var conn = sessionConnections[peerId];
            if (conn) {
                delete sessionConnections[peerId];
                try { conn.close(); } catch (err) {}
            }
        }, 1000);
        removeRosterEntry(clientId);
    }

    $(document).on('click', '.roster-admit', function() {
        var e = findEntry(String($(this).data('client')));
        if (!e || !e.pending) return;
        e.pending = false;
        syncPrimaryComaster();
        renderDebate();
        sendToPeer(e.peerId, { type: 'init', state: App.core.getFullState() });
        App.core.showAlert('Wpuszczono: ' + e.name);
    });
    $(document).on('click', '.roster-reject', function() {
        expelParticipant(String($(this).data('client')), 'rejected');
    });
    $(document).on('click', '.roster-kick', function() {
        if (!window.confirm('Usunąć uczestnika z pokoju?')) return;
        expelParticipant(String($(this).data('client')), 'kick');
    });

    $(document).on('click', '.roster-recall', function() {
        setBreakout(String($(this).data('client')), false);
    });

    $(document).on('click', '.roster-marshal', function() {
        setMarshal(String($(this).data('client')));
    });

    function zoneLabel(zone) {
        return zone === 'proposition' ? 'Propozycja' : zone === 'opposition' ? 'Opozycja' :
            zone === 'og' ? 'OG' : zone === 'oo' ? 'OO' :
            zone === 'cg' ? 'CG' : zone === 'co' ? 'CO' :
            zone === 'marszalek' ? 'Marszałek' :
            zone === 'judges' ? 'Sędzia' : 'Widz';
    }

    // Take / leave a slot by clicking the + or your own avatar
    $(document).on('click', '.slot-plus', function() {
        requestSlot($(this).data('zone'), parseInt($(this).data('index'), 10));
    });
    $(document).on('click', '.slot--me .slot-avatar--me, .aud-dot--me', function() {
        if ($(this).hasClass('aud-dot--me')) return; // already audience
        requestLeave();
    });

    $(document).on('click', '.roster-mute', function() {
        var e = findEntry(String($(this).data('client')));
        if (!e) return;
        sendToPeer(e.peerId, { type: 'cmd', action: 'mute' });
        App.core.showAlert('Wyciszono uczestnika');
    });

    $(document).on('click', '.roster-signal', function() {
        setSignal(String($(this).data('client')), String($(this).data('kind')), false);
    });

    // The visible stage is always on (a no-op after the first call); on top of that,
    // switch our hidden send iframe in/out depending on whether we hold a seat.
    function updateMyEmbed() {
        embedVdo();
        var me = myEntry();
        // Signal buttons (question / ad vocem) are for team seats only; the breakout
        // button additionally covers judges — see debate.css
        $('body').toggleClass('is-debater', !!(me && isDebaterZone(me.zone)))
            .toggleClass('has-breakout', !!(me && zoneHasBreakout(me.zone)));
        var mode = (me && me.zone && me.zone !== 'audience') ? 'publish' : 'view';
        if (mode !== myEmbedMode) {
            myEmbedMode = mode;
            if (mode === 'publish') embedPublish(myDebateName, myPushId); else removePublish();
            $('body').toggleClass('is-publishing', mode === 'publish');
            if (mode === 'publish') { setMicBtn(true); camOn = true; $('.debate-cam-btn').removeClass('is-off').attr('title', 'Wyłącz kamerę'); }
            updateSelfSpeechDetection();
        }
        updateControlsVisibility();
    }

    // Positioned debaters/judges see clock controls only when the master allows it.
    // Set display explicitly: the auto-join hid .timer-controls inline, and CSS can't
    // override an inline style, so re-assert flex/none directly here.
    function updateControlsVisibility() {
        var show = isDebateMaster || (myEmbedMode === 'publish' && debateAllowControls);
        $('.debate-timer-controls:not(.joker-controls)').css('display', show ? 'flex' : 'none');
    }

    function updateSignalButtons() {
        $('.debate-hand-btn').toggleClass('active', !!mySignals.hand);
        $('.debate-advocem-btn').toggleClass('active', !!mySignals.advocem);
    }

    // Master: create a debate room
    $('.debate-random-btn').click(function() {
        var name = SESSION_WORDS[Math.floor(Math.random() * SESSION_WORDS.length)];
        $('.debate-name-input').val(name).trigger('input');
    });

    $('.debate-create-btn').click(function() {
        var name = $('.debate-name-input').val().trim().toLowerCase();
        if (!/^[a-zA-Z0-9]+$/.test(name)) return;
        var $btn = $(this);
        createHub(name, $btn, function(id) {
            debateSessionId = id;
            isDebateMaster = true;
            myPushId = myClientId;   // the master publishes under its stable clientId
            myGeneration = 0;
            nextJoinSeq = 1;
            expelledClientIds = {};
            myDebateName = $('.debate-master-name-input').val().trim() || 'Prowadzący';
            markWasMaster(id);
            debateRoster = [{
                clientId: myClientId, peerId: null, pushId: myClientId, name: myDebateName,
                role: 'master', zone: 'audience', index: -1,
                signals: {}, speaking: false, breakout: false,
                joinSeq: 0, comaster: null, honorary: false, pending: false
            }];
            embedDirector();
            $('body').addClass('is-debate-master');
            $('.debate-empty').hide();
            $('.debate-stage').show();
            updateShareLinks();
            myEmbedMode = null;
            renderDebate(); // seeds the scene iframe via updateMyEmbed
            $btn.text('Debata aktywna');
        });
    });

    $('.debate-copy-btn').click(function() {
        navigator.clipboard.writeText($('.debate-link-val').val());
    });

    // Join screen: preview camera/mic before entering (fallback — the preview now
    // auto-starts with the join screen and this button is hidden then)
    $('.debate-preview-btn').click(function() {
        if (!previewIframe) embedPreview();
        $(this).text('Podgląd włączony');
    });

    // Join screen: pick a device — switches the live preview and carries over into the room
    $('.debate-join-cam-select').change(function() {
        joinCamDeviceIndex = parseInt($(this).val(), 10);
        // VDO.Ninja's changeVideoDevice is 0-based while our UI index is 1-based (see changeAudioDevice below).
        postToFrame(previewIframe, { changeVideoDevice: joinCamDeviceIndex - 1 });
    });
    $('.debate-join-mic-select').change(function() {
        joinMicDeviceIndex = parseInt($(this).val(), 10);
        postToFrame(previewIframe, { changeAudioDevice: joinMicDeviceIndex });
    });

    // Participant: submit name, announce to master. The stage is revealed by the first
    // roster broadcast — which the master only sends once we're in (immediately, unless
    // the waiting room is on, in which case a {cmd:'waiting'} arrives instead).
    $('.debate-join-btn').click(function() {
        var name = $('.debate-join-name').val().trim();
        if (!name) { $('.debate-join-error').text('Podaj imię').show(); return; }
        $('.debate-join-error').hide();

        myDebateName = name;
        clearPreview();
        $('.debate-join').hide();
        $('.debate-waiting-hint').text('Dołączanie…');
        $('.debate-waiting').show();
        myEmbedMode = null;

        sendJoinMessage(name);
    });

    // Participant self-media controls (drive our own publish iframe via postMessage)
    $('.debate-mic-btn').click(function() {
        setMicBtn(!micOn);
        postToPublish({ mic: micOn });
    });

    $('.debate-cam-btn').click(function() {
        camOn = !camOn;
        postToPublish({ camera: camOn });
        $(this).toggleClass('is-off', !camOn).attr('title', camOn ? 'Wyłącz kamerę' : 'Włącz kamerę');
    });

    // In-room device pickers are the dropdown menus attached to the mic/cam split
    // buttons (see fillDeviceMenu); the join-screen preview keeps its own <select>s.
    $(document).on('click', '.debate-cam-menu .dropdown-item', function() {
        var idx = parseInt($(this).attr('data-index'), 10);
        markActiveDevice($('.debate-cam-menu'), idx);
        // VDO.Ninja's changeVideoDevice is 0-based while our UI index is 1-based (see changeAudioDevice below).
        postToPublish({ changeVideoDevice: idx - 1 });
    });
    $(document).on('click', '.debate-mic-menu .dropdown-item', function() {
        var idx = parseInt($(this).attr('data-index'), 10);
        markActiveDevice($('.debate-mic-menu'), idx);
        postToPublish({ changeAudioDevice: idx });
    });

    // Debater signals — click again to cancel (toggle); hand and ad vocem are
    // independent, so raising one never lowers the other. Team seats only: the
    // buttons are hidden for everyone else (body.is-debater), this guards the code path too.
    function toggleSignal(kind) {
        var me = myEntry();
        if (!me || !isDebaterZone(me.zone)) return;
        var on = !mySignals[kind];
        mySignals[kind] = on;
        if (isDebateMaster) setSignal(myClientId, kind, on);
        else if (masterConn && masterConn.open) safeSend(masterConn, { type: 'signal', kind: kind, on: on });
        updateSignalButtons();
    }
    $('.debate-hand-btn').click(function() { toggleSignal('hand'); });
    $('.debate-advocem-btn').click(function() { toggleSignal('advocem'); });

    // Debater/judge: step into (or back out of) their team's breakout room
    function updateBreakoutButton() {
        var me = myEntry();
        var inBreakout = !!(me && me.breakout);
        $('.debate-breakout-btn').toggleClass('active', inBreakout)
            .attr('title', inBreakout ? 'Wróć do pokoju głównego' : 'Pokój narad');
    }
    $('.debate-breakout-btn').click(function() {
        var me = myEntry();
        requestBreakout(!(me && me.breakout));
    });

    // Master: let positioned participants control the clock
    $('.debate-allow-controls-checkbox').change(function() {
        debateAllowControls = this.checked;
        eachConn(function(c) {
            safeSend(c, { type: 'cmd', action: 'allowControls', on: debateAllowControls });
        });
    });

    // Participant: leave the debate room entirely (the master uses "Zamknij pokój" instead)
    $('.debate-leave-btn').click(function() {
        if (!window.confirm('Czy na pewno chcesz opuścić pokój debaty?')) return;
        window.location.replace(window.location.origin + window.location.pathname);
    });

    // Master: waiting room — new joiners need explicit approval. Turning it off
    // admits everyone still waiting.
    $('.debate-waitroom-btn').click(function() {
        waitingRoomOn = !waitingRoomOn;
        $(this).toggleClass('active', waitingRoomOn)
            .text(waitingRoomOn ? 'Wyłącz poczekalnię' : 'Włącz poczekalnię');
        if (!waitingRoomOn) {
            var admitted = [];
            debateRoster.forEach(function(e) {
                if (e.pending) { e.pending = false; admitted.push(e); }
            });
            if (admitted.length) {
                syncPrimaryComaster();
                renderDebate();
                admitted.forEach(function(e) { sendToPeer(e.peerId, { type: 'init', state: App.core.getFullState() }); });
            }
        }
        App.core.showAlert(waitingRoomOn ? 'Poczekalnia włączona' : 'Poczekalnia wyłączona');
    });

    // Master: toggle the shared clock between prep time and the normal, configured speech time
    $('.debate-prep-btn').click(function() {
        if (App.core.isPrepActive()) {
            App.core.reset();
        } else {
            App.core.startPrepTime();
            $(this).addClass('active').text('Zakończ czas przygotowania');
        }
    });

    // The roster button lives inside the settings modal — swap to the roster modal
    // instead of stacking it on top (Bootstrap 4 modals aren't designed to nest).
    $('.debate-roster-btn').click(function() {
        $('#debate-settings-modal').one('hidden.bs.modal', function() {
            $('#debate-roster-modal').modal('show');
        });
        $('#debate-settings-modal').modal('hide');
    });

    // Master room controls
    $('.debate-muteall-btn').click(function() {
        eachConn(function(c) { safeSend(c, { type: 'cmd', action: 'mute' }); });
        App.core.showAlert('Wyciszono wszystkich');
    });

    $('.debate-close-btn').click(function() {
        if (!window.confirm('Zamknąć pokój debaty? Wszyscy uczestnicy zostaną rozłączeni.')) return;
        eachConn(function(c) { safeSend(c, { type: 'cmd', action: 'close' }); });
        // Give the 'close' command a moment to actually flush over the data channel
        // before tearing down the hub — destroying it immediately can sever the
        // channel before the message arrives, and a comaster who never saw it treats
        // the drop as a crash and promotes itself, quietly resurrecting the room.
        var peerToDestroy = sessionPeer, backupToDestroy = backupPeer;
        sessionPeer = null;
        backupPeer = null;
        setTimeout(function() {
            if (peerToDestroy) peerToDestroy.destroy();
            if (backupToDestroy) backupToDestroy.destroy();
        }, 1000);
        sessionConnections = {};
        debateRoster = [];
        expelledClientIds = {};
        isDebateMaster = false;
        isPrimaryComaster = false;
        myPushId = null;
        myGeneration = 0;
        myEmbedMode = null;
        waitingRoomOn = false;
        $('.debate-waitroom-btn').removeClass('active').text('Włącz poczekalnię');
        $('body').removeClass('is-debate-master is-publishing is-comaster-primary');
        $('.debate-video-frame').empty();
        $('.debate-video').removeClass('debate-video--has-frame');
        debateIframe = null;
        removePublish();
        removeDirector();
        $('.debate-stage').hide();
        $('.debate-roster-modal').modal('hide');
        $('.debate-empty').show();
        $('.debate-links').hide();
        $('.debate-created-hint').hide();
        $('.debate-create-btn').text('Utwórz debatę').prop('disabled', false);
        App.core.showAlert('Pokój zamknięty');
    });

    // Chat (relayed over the PeerJS mesh so it also reaches scene-only audience)
    function sendChatMessage() {
        var msg = $('.debate-chat-input').val().trim();
        if (!msg) return;
        $('.debate-chat-input').val('');
        var channel = currentChatChannel();
        if (isDebateMaster) {
            broadcastChat(myDebateName, msg, channel);
        } else if (masterConn && masterConn.open) {
            safeSend(masterConn, { type: 'chat', channel: channel, msg: msg });
        }
    }
    $('.debate-chat-send').click(sendChatMessage);
    $('.debate-chat-input').keydown(function(e) {
        if (e.key === 'Enter') { e.preventDefault(); sendChatMessage(); }
    });

    // Receive data back from our own VDO iframe(s) — the visible viewer iframe, the
    // hidden publish iframe, and, on the join screen, the separate preview iframe (each
    // is its own postMessage channel).
    window.addEventListener('message', function(e) {
        var d = e.data;
        if (!d) return;
        if (debateIframe && e.source === debateIframe.contentWindow) {
            App.vlog('[VDO← debate]', d);
            if (d.loudness !== undefined) handleLoudness(d.loudness);
            // Zmiana topologii sceny (nowy strumień, zmiana slotów, wejście/wyjście ze
            // sceny) mogła dorenderować kafelki spoza naszego filtra — narzuć go na nowo.
            if (d.action === 'guest-connected' || d.action === 'view-connection' ||
                d.action === 'slot-updated' || d.action === 'scene-connected' ||
                d.action === 'push-connection' || d.action === 'add-to-scene' ||
                d.action === 'remove-from-scene') {
                applySpeakerView(true);
            }
        } else if (publishIframe && e.source === publishIframe.contentWindow) {
            App.vlog('[VDO← publish]', d);
            if (d.deviceList) {
                populateDevices(d.deviceList);
                if (deviceListHasLabels(d.deviceList)) stopDeviceListPoll('publish');
            }
        } else if (previewIframe && e.source === previewIframe.contentWindow) {
            App.vlog('[VDO← preview]', d);
            if (d.deviceList) {
                populateJoinDevices(d.deviceList);
                if (deviceListHasLabels(d.deviceList)) stopDeviceListPoll('preview');
            }
        } else if (directorIframe && e.source === directorIframe.contentWindow) {
            // The director iframe reports back its own actions — most importantly
            // {action:'add-to-scene'/'remove-from-scene'} after an addScene command
            // actually toggles a guest, and 'control-box' when a publisher lands
            // in the director's room. These drive the prewarm reconciliation.
            App.vlog('[VDO← director]', d);
            handleDirectorEvent(d);
        } else {
            $.each(breakoutDirectorIframes, function(zone, f) {
                if (f && e.source === f.contentWindow) App.vlog('[VDO← director-breakout-' + zone + ']', d);
            });
        }
    });

    // Best-effort talk detection from VDO loudness — thresholds/shape need live tuning.
    // Every publisher's VDO streamID is our own deterministic pushIdFor(pushId) (we
    // always set &push), so loud streams map straight onto roster entries — no name
    // matching, which used to conflate two participants sharing a display name.
    function handleLoudness(loud) {
        if (!isDebateMaster) return;
        var THRESH = 5;
        var loudIds = {};
        var consider = function(streamID, level) {
            if (streamID && level != null && level > THRESH) loudIds[streamID] = true;
        };
        if (Array.isArray(loud)) {
            loud.forEach(function(x) { consider(x.streamID || x.id, x.loudness != null ? x.loudness : x.level); });
        } else if (loud && typeof loud === 'object') {
            Object.keys(loud).forEach(function(k) { consider(k, loud[k]); });
        }
        var changed = false;
        debateRoster.forEach(function(e) {
            // Our own entry is driven by local self-speech detection (see
            // reportSelfSpeaking) — WebRTC never loops our own mic back to us as a
            // received stream, so loudIds can never legitimately contain our own pushId.
            if (e.clientId === myClientId) return;
            var sp = !!loudIds[pushIdFor(e.pushId)];
            if (sp !== !!e.speaking) { e.speaking = sp; changed = true; }
        });
        if (changed) { renderZones(); broadcastSpeaking(); updatePrewarm(); applySpeakerView(); }
    }
    function broadcastSpeaking() {
        var ids = debateRoster.filter(function(e) { return e.speaking; }).map(function(e) { return e.pushId; });
        eachConn(function(c, peerId) {
            if (!connAdmitted(peerId)) return;
            safeSend(c, { type: 'speaking', pushIds: ids });
        });
    }

    // Kto jest WIDOCZNY na scenie, narzuca aplikacja — nie &activespeaker VDO (patrz
    // buildViewUrl). Źródłem prawdy jest stan `speaking` rosteru (u mastera z detekcji
    // głośności, u pozostałych z broadcastu 'speaking'), nakładany lokalnie na własny
    // iframe sceny komendami DOM {target, replace/add}. To warstwa niezależna od
    // addScene/prewarm poniżej: skład sceny 2 decyduje, czyje media w ogóle płyną
    // (podgrzanie wideo + natychmiastowa słyszalność wtrąceń), a ten filtr — co widać.
    var speakerViewSids = null; // ostatnio narzucona lista widocznych sid (null = jeszcze nic)

    function applySpeakerView(reapply) {
        if (!debateIframe) return;
        var sids = [];
        debateRoster.forEach(function(e) {
            if (e.speaking && e.zone) sids.push(pushIdFor(e.pushId));
        });
        // Cisza nie czyści widoku — ostatni mówca zostaje na ekranie (spójnie z
        // updatePrewarm); przy re-aplikacji ponawiamy ostatni znany układ, bo scena
        // mogła właśnie dorenderować kafelki podgrzanych (a milczących) przeciwników.
        if (!sids.length) {
            if (!reapply || !speakerViewSids || !speakerViewSids.length) return;
            sids = speakerViewSids;
        }
        if (!reapply && speakerViewSids && sids.join(',') === speakerViewSids.join(',')) return;
        speakerViewSids = sids;
        // replace atomowo usuwa wszystkie pozostałe kafelki; ewentualni równocześni
        // mówcy (np. wtrącenie w trakcie) dochodzą add-em.
        postToVdo({ target: sids[0], replace: true });
        for (var i = 1; i < sids.length; i++) postToVdo({ target: sids[i], add: true });
    }

    // Selektywne "podgrzewanie" (addScene) strony przeciwnej do aktualnie mówiącej —
    // patrz VDO_SCENE. addScene jest komendą WYŁĄCZNIE dla reżysera (director) i zmienia
    // globalny, wspólny dla całego pokoju skład sceny — więc wysyła ją tylko master,
    // przez directorIframe. "value" to numer docelowej sceny (musi być zgodny z
    // VDO_SCENE, czyli 2) — to TOGGLE, nie flaga on/off.
    //
    // addScene działa przez programowe "kliknięcie" przycisku S2 danego gościa w DOM
    // panelu reżysera — a ten przycisk powstaje dopiero, gdy reżyser zobaczy publikującego
    // gościa. Komenda wysłana wcześniej po cichu nie robi NIC (świeżo posadzony mówca
    // regularnie przegrywał ten wyścig). Dlatego nie zakładamy, że wysłana komenda
    // zadziałała: stan sceny śledzimy po zdarzeniach zwrotnych add-to-scene /
    // remove-from-scene z iframe reżysera, a rozjazd chciane-vs-potwierdzone
    // uzgadnia syncPrewarm() — ponawiany też, gdy reżyser zgłosi nowego gościa.
    // Wszystkie trzy mapy są kluczowane sanitized streamID (pushIdFor), bo tak
    // identyfikuje gości sam VDO.
    var warmDesired = {};   // sid -> true: kogo chcemy mieć w scenie 2
    var warmConfirmed = {}; // sid -> true: kogo reżyser potwierdził jako dodanego
    var warmPending = {};   // sid -> timestamp ostatniego toggle (tłumi dublowanie w locie)

    function resetPrewarmState() { warmDesired = {}; warmConfirmed = {}; warmPending = {}; }

    function sendSceneToggle(sid) {
        var now = Date.now();
        if (warmPending[sid] && now - warmPending[sid] < 2000) return; // komenda w locie
        warmPending[sid] = now;
        postToFrame(directorIframe, { action: 'addScene', target: sid, value: 2, cib: nextCib() });
    }

    function syncPrewarm() {
        if (!directorIframe) return; // tylko master ma uprawnienia reżysera
        Object.keys(warmDesired).forEach(function(sid) {
            if (!warmConfirmed[sid]) sendSceneToggle(sid);
        });
        Object.keys(warmConfirmed).forEach(function(sid) {
            if (!warmDesired[sid]) sendSceneToggle(sid);
        });
    }

    // Zdarzenia zwrotne z iframe reżysera napędzające uzgadnianie stanu sceny.
    function handleDirectorEvent(d) {
        if (!d || !d.action) return;
        var sid = d.streamID;
        if (d.action === 'add-to-scene' && String(d.value) === '2' && sid) {
            warmConfirmed[sid] = true;
            delete warmPending[sid];
            syncPrewarm(); // jeśli w międzyczasie przestał być chciany — od razu zdejmij
        } else if (d.action === 'remove-from-scene' && String(d.value) === '2' && sid) {
            delete warmConfirmed[sid];
            delete warmPending[sid];
            syncPrewarm();
        } else if (d.action === 'control-box' || (d.action === 'push-connection' && d.value)) {
            // Nowy gość właśnie dostał panel u reżysera — dopiero teraz addScene może
            // zadziałać; ponów zaległe dodania.
            delete warmPending[d.streamID];
            syncPrewarm();
        } else if (d.action === 'push-connection' && !d.value && sid) {
            // Gość zniknął — jego stan sceny u reżysera wyparował razem z panelem.
            delete warmConfirmed[sid];
            delete warmPending[sid];
        }
    }

    function updatePrewarm() {
        if (!directorIframe) return;
        var speakingZones = {};
        debateRoster.forEach(function(e) { if (e.speaking && e.zone) speakingZones[e.zone] = true; });
        // Nikt teraz nie mówi — zostaw ostatnio pokazywaną osobę widoczną (nie czyść
        // sceny), zamiast gasić obraz na czas ciszy między mówcami. Skład sceny zmienia
        // się dopiero, gdy realnie zacznie mówić ktoś nowy.
        if (!Object.keys(speakingZones).length) return;
        var target = {};
        Object.keys(speakingZones).forEach(function(zone) {
            // Mówiąca strefa nigdy nie może wypaść z target — inaczej w momencie
            // przejścia "podgrzany przeciwnik" → "teraz mówi" dostałaby toggle
            // (czyli zostałaby wyrzucona ze sceny) w trakcie własnej wypowiedzi.
            zonePushIds(zone).forEach(function(pid) { target[pushIdFor(pid)] = true; });
            (INTERJECT_OPPONENTS[zone] || []).forEach(function(opp) {
                zonePushIds(opp).forEach(function(pid) { target[pushIdFor(pid)] = true; });
            });
        });
        warmDesired = target;
        syncPrewarm();
    }

    // --- Comaster failover: promotion, backup hub, reconnect cascade ---

    // Send our own join message (or queue it until masterConn opens), tagging whether
    // this browser was ever master of this room so it can be granted honorary comaster
    // status instead of re-entering the succession queue.
    function sendJoinMessage(name) {
        var payload = { type: 'join', name: name, wasMaster: checkWasMaster(debateSessionId), clientId: getClientId() };
        if (masterConn && masterConn.open) {
            safeSend(masterConn, payload);
        } else {
            debatePendingJoin = { name: name };
        }
    }

    // Create/destroy the standby PeerJS hub at genName(myGeneration + 1). Called from
    // handleSlaveData whenever a roster broadcast shows my own entry's comaster status
    // has changed. A connection landing on it is itself proof of failover (see below),
    // so it promotes us to master first and is then handled exactly like a connection
    // landing on the primary sessionPeer.
    function setComasterHosting(on) {
        isPrimaryComaster = on;
        $('body').toggleClass('is-comaster-primary', on);
        if (on && !backupPeer) {
            backupPeer = new Peer(genName(myGeneration + 1));
            keepSignalingAlive(backupPeer);
            backupPeer.on('connection', function(conn) {
                // Someone only reaches us here after their previous generation was
                // unreachable (peer-unavailable or a full timeout) — for them that IS
                // proof of failover, even if we haven't noticed our own masterConn drop
                // yet (our retry/promotion timer is a separate 5s clock). Promote before
                // servicing the connection so it's met by an actual master — otherwise
                // it gets adopted, added to our local roster, and then silently stranded
                // with no broadcastRoster (that only fires once isDebateMaster is true).
                if (!isDebateMaster) promoteSelfToMaster(null);
                handleMasterConnection(conn);
            });
            backupPeer.on('error', function(err) {
                console.error('[Comaster] backup hub error:', err.type);
            });
        } else if (!on && backupPeer) {
            backupPeer.destroy();
            backupPeer = null;
        }
    }

    // Re-show/refresh the debate join link + QR, and — important for the master's own
    // resilience — point this tab's own address bar at it too (no navigation, just
    // history.replaceState). The link always encodes only the original room name, never
    // a generation suffix: if this tab later reloads (crash or otherwise), the normal
    // auto-join flow kicks in and finds wherever the room currently lives via
    // connectToRoom's probing, the same way any participant's stale link would.
    function updateShareLinks() {
        var link = window.location.origin + window.location.pathname + '?s=' + debateSessionId + '&d=1';
        $('.debate-link-val').val(link);
        $('.debate-links').show();
        $('#debate-qr').empty();
        new QRCode(document.getElementById('debate-qr'), { text: link, width: 128, height: 128 });
        $('.debate-created-hint').show();
        try { window.history.replaceState(null, '', link); } catch (e) {}
    }

    // Shared promotion routine for both triggers: a crash (source=null, use the
    // already-mirrored roster/state every participant keeps) and a manual handoff
    // (source={state, roster}, a guaranteed-fresh snapshot from the outgoing master).
    // Only ever called on whoever is currently the primary comaster (see
    // handleMasterConnLost and the "Uczyń masterem" gating in renderMasterRoster), so
    // backupPeer is always already live at genName(myGeneration + 1) — promotion just
    // relabels it as the master hub, it is never destroyed/recreated, so nobody
    // connected to it is ever force-disconnected by this.
    function promoteSelfToMaster(source) {
        if (isDebateMaster) return; // already promoted — ignore a redundant trigger
        if (source && source.roster) debateRoster = source.roster;
        if (source && source.state) App.core.applyState(source.state);

        // Drop the dead ex-master's entry — on a crash it was never removed (nobody's
        // 'close' handler ever fires for the master's own roster slot, only for
        // incoming participant connections), so without this it would linger as a
        // stale, unremovable entry next to the newly-promoted one.
        debateRoster = debateRoster.filter(function(e) { return e.role !== 'master'; });

        // A non-master client never runs addRosterEntry, so nextJoinSeq is still stuck
        // at its initial 1 — without recomputing it from the inherited roster, the next
        // person to join here would look senior to everyone already seated.
        nextJoinSeq = debateRoster.reduce(function(max, e) { return Math.max(max, e.joinSeq + 1); }, 1);

        // Taking over is just flipping the role field on my own (clientId-keyed) entry —
        // peerId and pushId stay untouched, so my VDO stream and seat survive as-is.
        var me = myEntry();
        if (me) { me.role = 'master'; me.peerId = null; me.comaster = null; me.honorary = false; }
        myGeneration += 1;
        isDebateMaster = true;
        App.state.isSlaveSession = false;
        markWasMaster(debateSessionId);

        sessionPeer = backupPeer;   // my standby hub simply becomes the live master hub
        backupPeer = null;
        isPrimaryComaster = false;

        syncPrimaryComaster();      // designate the new primary comaster (next generation)

        embedDirector();
        updateShareLinks();
        $('body').addClass('is-debate-master').removeClass('is-comaster-primary');
        App.core.showAlert('Zostałeś nowym prowadzącym debaty');
        renderDebate();

        // getLoudness was only ever requested by the *previous* master's own iframe
        // (in embedVdo's onload); ours never asked, and updateMyEmbed() above only
        // re-embeds on a mode change — which usually doesn't happen here — so the
        // speaking indicator would otherwise go dark for the rest of the debate.
        if (debateIframe) {
            postToVdo({ getLoudness: true });
            setTimeout(function() { postToVdo({ getLoudness: true }); }, 3000);
        }
    }

    // Master: hand off the role to a specific comaster without leaving the room —
    // a deliberate, controlled version of the same event a crash triggers (destroying
    // our own room id closes everyone's connection to it, so they all discover the new
    // generation via the normal reconnect cascade below). The outgoing master drops its
    // own seat and rejoins fresh afterward — exactly like a returning-after-crash master
    // — so it's granted honorary comaster status by the same wasMaster mechanism instead
    // of a special-cased transplant.
    function handoffMasterTo(clientId) {
        if (!window.confirm('Przekazać rolę mastera temu uczestnikowi?')) return;
        var target = findEntry(clientId);
        if (!target) return;

        var rosterForHandoff = debateRoster.filter(function(e) { return e.role !== 'master'; });
        sendToPeer(target.peerId, { type: 'promoteToMaster', state: App.core.getFullState(), roster: rosterForHandoff });
        markWasMaster(debateSessionId);

        // Same flush concern as closing the room: destroying our hub the instant after
        // send() can sever the channel before 'promoteToMaster' actually reaches the
        // target, in which case they'd fall back to noticing the crash on their own —
        // give the message a moment to land first.
        var peerToDestroy = sessionPeer;
        sessionPeer = null;
        setTimeout(function() { if (peerToDestroy) peerToDestroy.destroy(); }, 1000);
        sessionConnections = {};
        isDebateMaster = false;
        App.state.isSlaveSession = true;
        removeDirector();
        $('body').removeClass('is-debate-master');
        $('.debate-roster-modal').modal('hide');
        App.core.showAlert('Przekazano rolę prowadzącego');

        var name = myDebateName;
        var fromGen = myGeneration;
        myPeer = new Peer();
        keepSignalingAlive(myPeer);
        myPeer.on('open', function(id) {
            myPushId = id;
            connectToRoom(fromGen, function(gen, conn) {
                attachMasterConn(conn, gen, 'Połączono ponownie z prowadzącym');
                sendJoinMessage(name);
            }, function() {
                App.core.showWarn('Nie udało się połączyć z nowym prowadzącym');
            });
        });
        myPeer.on('error', function(err) {
            console.error('[Comaster] handoff reconnect error:', err.type);
        });
    }

    // Dial a target peer id, resolving (true, conn) on open, or (false) as soon as
    // PeerJS tells us the id doesn't exist — instead of waiting out the full timeout,
    // which only exists as a fallback for a truly unresponsive/unreachable target.
    function tryConnect(targetId, timeoutMs, cb) {
        var done = false;
        function finish(ok, conn) {
            if (done) return;
            done = true;
            clearTimeout(timer);
            myPeer.off('error', onPeerError);
            cb(ok, conn);
        }
        function onPeerError(err) {
            // 'error' is emitted on the shared Peer, not per-connection, so a
            // still-in-flight error from an earlier, already-abandoned probe (its own
            // timeout can fire before the signaling server actually reports the id as
            // unavailable) can otherwise land here and fast-fail an unrelated, possibly
            // about-to-succeed attempt. PeerJS puts the id in the message text — that's
            // the only way to tell the two apart.
            if (err.type === 'peer-unavailable' && String(err.message || '').indexOf(targetId) !== -1) finish(false);
        }
        myPeer.on('error', onPeerError);
        var conn = myPeer.connect(targetId, { serialization: 'json' });
        var timer = setTimeout(function() {
            try { conn.close(); } catch (e) {}
            finish(false);
        }, timeoutMs);
        conn.on('open', function() { finish(true, conn); });
    }

    // Try generation `fromGeneration` first — covers a transient blip on an otherwise-
    // live room, or the "was I already master" retry — then probe forward through later
    // generations. This one function covers both a live reconnect (fromGeneration = the
    // last one we were actually on) and a cold join / stale link (fromGeneration = 0):
    // there is no separate "discovery" mechanism, just the same search starting further
    // back. Give up after 10 forward hops with no live room found.
    function connectToRoom(fromGeneration, onSuccess, onFailure) {
        tryConnect(genName(fromGeneration), 5000, function(ok, conn) {
            if (ok) { onSuccess(fromGeneration, conn); return; }
            probeForward(fromGeneration + 1, fromGeneration + 10, onSuccess, onFailure);
        });
    }
    function probeForward(gen, maxGen, onSuccess, onFailure) {
        if (gen > maxGen) { onFailure(); return; }
        tryConnect(genName(gen), 4000, function(ok, conn) {
            if (ok) { onSuccess(gen, conn); return; }
            probeForward(gen + 1, maxGen, onSuccess, onFailure);
        });
    }

    // Wire up a newly (re)established connection to the master/comaster hub.
    // `onLost` overrides the debate-mode reconnect cascade — the plain sharing
    // session passes its own simpler "session lost" handler here.
    function attachMasterConn(conn, gen, toast, onLost) {
        myGeneration = gen;
        masterConn = conn;
        masterConn.on('data', handleSlaveData);
        masterConn.on('close', onLost || handleMasterConnLost);
        if (toast) App.core.showAlert(toast);
    }

    // The debate-mode masterConn.on('close') handler. Always tries the room we were
    // just on again first (5s) — a dropped WebRTC data channel doesn't necessarily mean
    // the host is actually gone — before treating it as a real failover. Only then does
    // the primary comaster promote itself (it already hosts the next generation as a
    // standby); everyone else instead searches forward for wherever the room now lives.
    // After any reconnect, tell the (possibly new) master who we are. addRosterEntry
    // treats a same-clientId rejoin as "welcome back" (restores seat/seniority if still
    // free), so this is always safe — and it's the only way a freshly-promoted comaster,
    // whose mirrored roster never carried our entry while we were still in the waiting
    // room (slimRoster() deliberately omits pending entries), learns we exist at all.
    function resendJoinAfterReconnect() {
        if (!isDebateMaster && myDebateName) sendJoinMessage(myDebateName);
    }

    function handleMasterConnLost() {
        // Already master via another path (e.g. this is our own pre-promotion
        // masterConn closing as a side effect of a manual handoff) — irrelevant now.
        if (isDebateMaster) return;
        App.core.showWarn('Utracono połączenie z prowadzącym — próba przełączenia…');
        var fromGen = myGeneration;
        tryConnect(genName(fromGen), 5000, function(ok, conn) {
            if (ok) {
                attachMasterConn(conn, fromGen, 'Połączono ponownie z prowadzącym');
                resendJoinAfterReconnect();
                return;
            }
            if (isPrimaryComaster) { promoteSelfToMaster(null); return; }
            probeForward(fromGen + 1, fromGen + 10, function(gen, conn2) {
                attachMasterConn(conn2, gen, 'Połączono ponownie z prowadzącym');
                resendJoinAfterReconnect();
            }, function() {
                $('.session-lost-alert').fadeIn(50);
            });
        });
    }

    $(document).on('click', '.roster-promote', function() {
        handoffMasterTo(String($(this).data('client')));
    });
    $(document).on('click', '.roster-designate-comaster', function() {
        designateComaster(String($(this).data('client')));
    });

    // Slave-side dispatch of data arriving over masterConn — factored out so it can
    // be re-attached to a fresh connection after a failover reconnect.
    function handleSlaveData(data) {
        App.vlog('[PeerJS←]', masterConn && masterConn.peer, data);
        if (data.type === 'init' || data.type === 'state') App.core.applyState(data.state);
        else if (data.type === 'chat') appendChat(data.name, data.msg, data.channel);
        else if (data.type === 'cmd') handleDebateCmd(data);
        else if (data.type === 'promoteToMaster') { promoteSelfToMaster({ state: data.state, roster: data.roster }); }
        else if (data.type === 'roster') {
            debateRoster = data.roster || [];
            // The first roster that actually contains us doubles as the admission
            // signal: only then leave the hold screen for the stage (a roster without
            // our entry can arrive in between — e.g. broadcast for someone else's join
            // while ours is still in flight).
            if ($('.debate-waiting').is(':visible') && myEntry()) {
                $('.debate-waiting').hide();
                $('.debate-stage').show();
            }
            renderZones();
            updateMyEmbed();
            var me = myEntry();
            // The master (or marshal) can clear a raised hand/ad-vocem remotely —
            // without resyncing from our own roster entry, our toggle buttons would
            // stay lit and the next click would re-send the same (already-cleared) value.
            syncMySignals(me);
            // Whether I should be hosting the standby hub is derived from my own entry
            // in every roster broadcast, not a separate point-to-point message — right
            // after a promotion the designated comaster usually isn't even connected
            // yet, so a one-shot message sent at that instant could silently miss them.
            var shouldHost = !!(me && me.comaster === 'primary');
            if (shouldHost !== isPrimaryComaster) setComasterHosting(shouldHost);
        }
        else if (data.type === 'speaking') {
            debateRoster.forEach(function(e) { e.speaking = (data.pushIds || []).indexOf(e.pushId) !== -1; });
            renderZones();
            updatePrewarm();
            applySpeakerView();
        }
    }

    // Auto-join if URL contains ?s=sessionName (plain viewer or debate participant)
    (function() {
        var params = new URLSearchParams(window.location.search);
        var s = (params.get('s') || '').toLowerCase();
        if (!s || !/^[a-z0-9]+$/.test(s)) return;
        var isDebate = params.get('d') === '1';

        App.state.isSlaveSession = true;
        $('body').addClass('is-slave');
        $('.timer-controls').hide();

        if (isDebate) {
            debateSessionId = s;
            $('body').addClass('is-debate');
            App.core.navigate('debate');
            $('.debate-empty').hide();
            $('.debate-join').show();
            // The preview starts by itself, so the camera+mic prompt appears the
            // moment you land on the join screen — and coming from the vdo.ninja
            // iframe, its grant is the one the publish iframe reuses later.
            embedPreview();
            $('.debate-preview-btn').hide();
        } else {
            var slaveUrl = window.location.href;
            $('.slave-session-link-val').val(slaveUrl);
            new QRCode(document.getElementById('slave-qr'), {text: slaveUrl, width: 256, height: 256});
        }

        console.log('[Session] Joining session:', s, isDebate ? '(debata)' : '');
        $('.session-status').text('Łączenie z sesją…').show();

        myPeer = new Peer();
        keepSignalingAlive(myPeer);
        myPeer.on('open', function(myId) {
            console.log('[Session] Slave peer opened:', myId);
            myPushId = myId;

            if (isDebate) {
                // The room may have moved forward through several generations since
                // this link was first shared (or since our own last visit) — probe
                // forward from the original id until we find wherever it lives now.
                connectToRoom(0, function(gen, conn) {
                    attachMasterConn(conn, gen, null);
                    console.log('[Session] Connected to master! (generation', gen, ')');
                    $('.session-status').hide();
                    if (debatePendingJoin) {
                        sendJoinMessage(debatePendingJoin.name);
                        debatePendingJoin = null;
                    }
                }, function() {
                    $('.session-status').text('Nie udało się połączyć z pokojem debaty').show();
                    setTimeout(function() {
                        $('.session-status').text('Odświeżanie strony…');
                        setTimeout(function() {
                            window.location.replace(window.location.origin + window.location.pathname);
                        }, 3000);
                    }, 5000);
                });
            } else {
                var conn = myPeer.connect(s, {serialization: 'json'});
                conn.on('open', function() {
                    console.log('[Session] Connected to master!');
                    $('.session-status').hide();
                    App.core.showAlert('Połączono z sesją');
                });
                conn.on('error', function(err) {
                    console.error('[Session] Conn error:', err);
                    $('.session-status').text('Błąd połączenia: ' + err.type).show();
                });
                attachMasterConn(conn, 0, null, function() {
                    $('.session-lost-alert').fadeIn(50);
                });
            }
        });
        myPeer.on('error', function(err) {
            console.error('[Session] Peer error:', err.type);
            $('.session-status').text('Błąd: ' + err.type).show();
        });
    })();

})(jQuery, window.App);
