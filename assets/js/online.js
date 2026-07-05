(function ($, App) {
    // --- Session (PeerJS) ---

    var sessionPeer = null;
    var sessionConnections = [];
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
    var debateRoster = [];        // [{peerId, name, zone, index, signal, speaking}]
    var debatePendingJoin = null; // participant: {name} queued until masterConn opens
    var debateIframe = null;      // the live VDO.Ninja <iframe> element (for postMessage)
    var previewIframe = null;     // the join-screen preview <iframe> (separate instance, own postMessage channel)
    var joinCamDeviceIndex = null, joinMicDeviceIndex = null; // device picked on the join screen, carried into the live room
    var myPeerId = null;          // this browser's id in the roster ('__master__' for host)
    var myPushId = null;          // this browser's stable VDO push id — never renamed on promotion,
                                   // unlike myPeerId (see "Comaster failover" below)
    var myDebateName = '';        // this browser's own display name
    var myEmbedMode = null;       // 'publish' | 'view' — current VDO iframe mode
    var mySignal = null;          // 'hand' | 'advocem' | null (this browser's raised signal)
    var debateAllowControls = false; // master let positioned participants run the clock
    var debateEditMode = false;   // master: drag & drop seat re-assignment
    var micOn = true, camOn = true;  // this browser's local media state (VDO gives no readback)
    var streamNames = {};         // master: VDO streamID -> label, for the speaking indicator
    var MASTER_ID = '__master__';
    var ZONE_SLOTS = { proposition: 4, opposition: 4, judges: 3 };

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

    // A stable per-browser id, independent of the ephemeral PeerJS peerId (which is
    // random on every page load) and of the display name (which the user can change on
    // rejoin). Lets the master recognise "this is the same browser reconnecting" and
    // drop its old roster entry immediately — instead of waiting for PeerJS to notice
    // the old connection actually died, which after an abrupt reload/refresh can lag
    // well behind the new connection being established, leaving a stale duplicate.
    var CLIENT_ID_KEY = 'licznik:client-id';
    function getClientId() {
        try {
            var id = localStorage.getItem(CLIENT_ID_KEY);
            if (!id) {
                id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2);
                localStorage.setItem(CLIENT_ID_KEY, id);
            }
            return id;
        } catch (e) {
            return null;
        }
    }

    App.onStateChange = function(delta) {
        if (App.state.applyingState) return;
        if (App.state.isSlaveSession) {
            if (masterConn) {
                try { masterConn.send({type: 'settings', state: delta}); } catch(e) {}
            }
        } else if (sessionPeer && sessionConnections.length > 0) {
            sessionConnections.forEach(function(c) {
                try { c.conn.send({type: 'state', state: delta}); } catch(e) {}
            });
        }
    };

    $('.session-name-input').on('input', function() {
        $(this).val($(this).val().toLowerCase());
        var val = $(this).val();
        var wasInvalid = $(this).hasClass('is-invalid');
        var invalid = val.length > 0 && !/^[a-zA-Z0-9]+$/.test(val);
        $(this).toggleClass('is-invalid', invalid);
        if (invalid && !wasInvalid) App.core.showWarn('Dozwolone tylko litery a–z, A–Z i cyfry');
        $('.session-create-btn').prop('disabled', !(val.length > 0 && !invalid));
    });

    $('.session-random-btn').click(function() {
        var name = SESSION_WORDS[Math.floor(Math.random() * SESSION_WORDS.length)];
        $('.session-name-input').val(name).trigger('input');
    });

    $('.session-create-btn').click(function() {
        var name = $('.session-name-input').val().trim().toLowerCase();
        if (!/^[a-zA-Z0-9]+$/.test(name)) return;
        if (sessionPeer) { sessionPeer.destroy(); sessionPeer = null; }

        var $btn = $(this);
        $btn.text('Łączenie…').prop('disabled', true);

        sessionPeer = new Peer(name);
        sessionPeer.on('open', function(id) {
            var link = window.location.origin + window.location.pathname + '?s=' + id;
            $('.session-link-val').val(link);
            $('.session-links').show();
            $('#session-qr').empty();
            new QRCode(document.getElementById('session-qr'), {text: link, width: 128, height: 128});
            $btn.text('Sesja aktywna');
        });
        sessionPeer.on('error', function(err) {
            console.error('[Session] Master error:', err.type);
            var msg = err.type === 'unavailable-id' ? 'Nazwa zajęta — wybierz inną' : 'Błąd: ' + err.type;
            $btn.text(msg).prop('disabled', false);
            sessionPeer = null;
        });
        sessionPeer.on('connection', handleMasterConnection);
    });

    // Shared master-side connection handling (plain sharing + online debate)
    function handleMasterConnection(conn) {
        conn.on('open', function() {
            sessionConnections.push({conn: conn});
            conn.send({type: 'init', state: App.core.getFullState()});
            // A reconnecting participant (post-failover) never re-sends {type:'join'},
            // so this is the only place it gets a fresh roster — a brand-new joiner
            // gets a second, complete one moments later once addRosterEntry runs.
            if (debateRoster.length) conn.send({ type: 'roster', roster: slimRoster() });
            App.core.showAlert('Podłączono sesję');
        });
        conn.on('data', function(data) {
            if (data.type === 'settings') {
                App.core.applyState(data.state);
                sessionConnections.forEach(function(c) {
                    if (c.conn !== conn) {
                        try { c.conn.send({type: 'state', state: data.state}); } catch(e) {}
                    }
                });
            } else if (data.type === 'join') {
                addRosterEntry(conn.peer, data.name, data.wasMaster, data.clientId);
            } else if (data.type === 'takeSlot') {
                assignSlot(conn.peer, data.zone, data.index);
            } else if (data.type === 'leaveSlot') {
                vacateSlot(conn.peer);
            } else if (data.type === 'chat') {
                var ce = findEntry(conn.peer);
                var chatChannel = (data.channel === 'general') ? 'general' : (ce ? ce.zone : 'audience');
                broadcastChat(ce ? ce.name : 'Uczestnik', data.msg, chatChannel);
            } else if (data.type === 'signal') {
                setSignal(conn.peer, data.kind);
            } else if (data.type === 'breakout') {
                setBreakout(conn.peer, data.on);
            }
        });
        conn.on('close', function() {
            sessionConnections = sessionConnections.filter(function(c) { return c.conn !== conn; });
            removeRosterEntry(conn.peer);
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

    $('.session-join-input').on('input', function() {
        $(this).val($(this).val().toLowerCase());
        var val = $(this).val();
        var wasInvalid = $(this).hasClass('is-invalid');
        var invalid = val.length > 0 && !/^[a-zA-Z0-9]+$/.test(val);
        $(this).toggleClass('is-invalid', invalid);
        if (invalid && !wasInvalid) App.core.showWarn('Dozwolone tylko litery a–z, A–Z i cyfry');
        $('.session-join-btn').prop('disabled', !(val.length > 0 && !invalid));
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
    var VDO_CLEAN = '&cleanoutput&hidemenu&transparent';
    // Show only whoever is actually talking, hiding silent-but-published guests.
    var VDO_SPEAKER = '&activespeaker&activespeakerdelay=1500';

    // A stable, predictable VDO.Ninja stream id per participant (instead of a random one)
    // so the director can target a specific person with &push/&forward regardless of when
    // they joined.
    function pushIdFor(peerId) { return String(peerId).replace(/[^a-zA-Z0-9]/g, '_').slice(0, 64); }

    function breakoutRoomId(zone) {
        var suffix = zone === 'proposition' ? 'proposition' : zone === 'opposition' ? 'opposition' : 'judges';
        return vdoRoom() + '-bo-' + suffix;
    }

    function buildVdoUrl(mode, name, pushId) {
        var room = encodeURIComponent(vdoRoom());
        // Publishers (people who took a debater/judge slot) send camera + mic.
        // &webcam picks "Join Room with Camera" and &autostart skips the entry screen
        // (without them, cleanoutput hides the menu and getUserMedia never fires).
        if (mode === 'publish') {
            return VDO_BASE + '?room=' + room + '&label=' + encodeURIComponent(name || '') +
                '&push=' + encodeURIComponent(pushIdFor(pushId)) +
                '&webcam&autostart' + VDO_SPEAKER + VDO_CLEAN;
        }
        // Everyone else (audience / unassigned / master watching) just views the scene.
        return VDO_BASE + '?room=' + room + '&scene' + VDO_SPEAKER + VDO_CLEAN;
    }

    // A second, invisible iframe that holds director permissions purely so we can send
    // &forward commands for breakout rooms — kept off-screen so its own control panel
    // (record/mute/scene buttons) never leaks into our UI. The master's visible iframe
    // above stays a plain scene viewer / publisher, unchanged.
    var directorIframe = null;
    function embedDirector() {
        if (directorIframe) return;
        var room = encodeURIComponent(vdoRoom());
        var $f = $('<iframe class="vdo-director-iframe" allow="autoplay" src="' +
            VDO_BASE + '?director=' + room + '&cleanoutput&hidemenu"></iframe>');
        $('body').append($f);
        directorIframe = $f.get(0);
    }
    function removeDirector() {
        if (directorIframe) { $(directorIframe).remove(); directorIframe = null; }
    }

    // Local self-view for the join screen — lets the user test camera/mic before joining.
    function embedPreview() {
        var allow = 'camera *; microphone *; autoplay; fullscreen; picture-in-picture';
        $('.debate-join-preview').html(
            '<iframe class="vdo-iframe" allow="' + allow + '" src="' +
            VDO_BASE + '?webcam&autostart&cleanoutput&transparent"></iframe>'
        );
        previewIframe = $('.debate-join-preview iframe').get(0);
        if (previewIframe) {
            previewIframe.onload = function() {
                postToFrame(previewIframe, { getDeviceList: true });
                setTimeout(function() { postToFrame(previewIframe, { getDeviceList: true }); }, 3000);
            };
        }
        startMicMeter();
    }
    function clearPreview() {
        $('.debate-join-preview').empty();
        previewIframe = null;
        $('.debate-join-cam-select').hide().empty();
        $('.debate-join-mic-select').hide().empty();
        stopMicMeter();
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

    function embedVdo(url) {
        // Camera/microphone must be delegated to the cross-origin vdo.ninja iframe with
        // "*" (bare "camera" means 'self' only, which silently blocks getUserMedia there).
        var allow = 'camera *; microphone *; display-capture *; autoplay; fullscreen; picture-in-picture';
        $('.debate-video').html(
            '<iframe class="vdo-iframe" allow="' + allow + '" src="' + url + '"></iframe>'
        );
        debateIframe = $('.debate-video iframe').get(0);
        if (debateIframe) {
            debateIframe.onload = function() {
                // Publishers: populate our camera/mic pickers from VDO's device list
                if (myEmbedMode === 'publish') {
                    postToVdo({ getDeviceList: true });
                    setTimeout(function() { postToVdo({ getDeviceList: true }); }, 3000);
                }
                // Master's iframe hears everyone → loudness tells us who is talking
                if (isDebateMaster) {
                    postToVdo({ getLoudness: true });
                    setTimeout(function() { postToVdo({ getLoudness: true }); }, 3000);
                }
            };
        }
    }

    function postToFrame(iframe, obj) {
        if (iframe && iframe.contentWindow) {
            try { iframe.contentWindow.postMessage(obj, '*'); } catch (e) {}
        }
    }
    function postToVdo(obj) { postToFrame(debateIframe, obj); }

    function setMicBtn(on) {
        micOn = on;
        $('.debate-mic-btn').text(on ? 'Wycisz mikrofon' : 'Włącz mikrofon');
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
        fillDeviceSelect($('.debate-cam-select'), split.cams, 'Kamera');
        fillDeviceSelect($('.debate-mic-select'), split.mics, 'Mikrofon');
        applyPreferredDevices();
    }

    // Carry the device chosen on the join screen over into the live room the first
    // time its device list arrives.
    function applyPreferredDevices() {
        if (joinCamDeviceIndex != null) {
            $('.debate-cam-select').val(joinCamDeviceIndex);
            postToVdo({ changeVideoDevice: joinCamDeviceIndex });
        }
        if (joinMicDeviceIndex != null) {
            $('.debate-mic-select').val(joinMicDeviceIndex);
            postToVdo({ changeAudioDevice: joinMicDeviceIndex });
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

    // Chat: a general channel everyone shares, plus one channel per debate zone that only
    // its current occupants (and the master, while seated there) can see.
    var chatLogs = {};            // channel -> [{name, msg}]
    var activeChatIsTeam = false; // false = "Ogólny" tab, true = "Zespół" tab

    function myChatZone() {
        var e = findEntry(myPeerId);
        return (e && e.zone) || 'audience';
    }
    function currentChatChannel() { return activeChatIsTeam ? myChatZone() : 'general'; }

    function zoneChatLabel(zone) {
        return zone === 'proposition' ? 'Propozycja' : zone === 'opposition' ? 'Opozycja' :
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
            .removeClass('debate-chat--general debate-chat--proposition debate-chat--opposition debate-chat--judges debate-chat--audience')
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

    // Master-side send: 'general' goes to everyone, a team channel only to whoever is
    // *currently* seated in that zone (checked live, not trusted from the sender).
    function broadcastChat(name, msg, channel) {
        channel = channel || 'general';
        appendChat(name, msg, channel);
        sessionConnections.forEach(function (c) {
            if (channel === 'general') {
                try { c.conn.send({ type: 'chat', channel: 'general', name: name, msg: msg }); } catch (e) {}
                return;
            }
            var entry = findEntry(c.conn.peer);
            if (entry && entry.zone === channel) {
                try { c.conn.send({ type: 'chat', channel: channel, name: name, msg: msg }); } catch (err) {}
            }
        });
    }

    function sendToPeer(peerId, obj) {
        sessionConnections.forEach(function (c) {
            if (c.conn.peer === peerId) { try { c.conn.send(obj); } catch (e) {} }
        });
    }

    // Participant: apply a command relayed from the master
    function handleDebateCmd(data) {
        if (data.action === 'mute') {
            postToVdo({ mic: false });
            setMicBtn(false);
            App.core.showWarn('Prowadzący wyciszył Twój mikrofon');
        } else if (data.action === 'close') {
            window.alert('Prowadzący zamknął pokój debaty');
            window.location.replace(window.location.origin + window.location.pathname);
        } else if (data.action === 'allowControls') {
            debateAllowControls = !!data.on;
            updateControlsVisibility();
        }
    }

    function findEntry(peerId) {
        return debateRoster.filter(function(e) { return e.peerId === peerId; })[0];
    }

    function addRosterEntry(peerId, name, wasMaster, clientId) {
        // A rejoin after a page refresh gets a brand-new PeerJS peerId, but the same
        // persistent clientId — drop any old entry (and its now-stale connection, which
        // PeerJS may not notice is actually dead for a while yet) for the same browser
        // right away, instead of leaving a duplicate on the list until WebRTC's own
        // disconnect detection eventually catches up.
        var stale = clientId ? debateRoster.filter(function(e) { return e.clientId === clientId && e.peerId !== peerId; }) : [];
        debateRoster = debateRoster.filter(function(e) { return e.peerId !== peerId && (!clientId || e.clientId !== clientId); });
        stale.forEach(function(e) {
            var staleConn = sessionConnections.filter(function(c) { return c.conn.peer === e.peerId; })[0];
            if (staleConn) {
                sessionConnections = sessionConnections.filter(function(c) { return c !== staleConn; });
                try { staleConn.conn.close(); } catch (err) {}
            }
        });
        debateRoster.push({
            // pushId is fixed at the peerId this participant joined with, and — unlike
            // peerId — is never renamed on promotion, so their existing VDO stream (and
            // any &forward targeting it) keeps working with no re-embed. See TODO.md.
            peerId: peerId, pushId: peerId, clientId: clientId || null, name: name, zone: 'audience', index: -1,
            signal: null, speaking: false, breakout: false,
            joinSeq: nextJoinSeq++, comaster: null, honorary: !!wasMaster
        });
        syncPrimaryComaster();
        renderDebate();
    }

    function removeRosterEntry(peerId) {
        debateRoster = debateRoster.filter(function(e) { return e.peerId !== peerId; });
        syncPrimaryComaster();
        renderDebate();
    }

    // Succession queue for who becomes master next: pure function over the already-
    // replicated roster, ordered by join order, excluding the master itself and
    // anyone honorary (a former/outgoing master — never re-enters the queue).
    function computeQueue() {
        return debateRoster
            .filter(function(e) { return e.peerId !== MASTER_ID && !e.honorary; })
            .sort(function(a, b) { return a.joinSeq - b.joinSeq; });
    }

    // Same, but also considers honorary entries — used only as a fallback when the
    // room would otherwise be left with zero failover capacity (e.g. only 2 real
    // participants, and the other one is a returning/handed-off ex-master). Better an
    // honorary comaster than none: it's a rare edge case, not the default path.
    function computeFallbackQueue() {
        return debateRoster
            .filter(function(e) { return e.peerId !== MASTER_ID; })
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
    function designateComaster(peerId) {
        var target = findEntry(peerId);
        if (!target || target.honorary || target.peerId === MASTER_ID) return;
        var current = debateRoster.filter(function(e) { return e.comaster === 'primary'; })[0];
        if (current && current.peerId !== peerId) current.comaster = null;
        target.comaster = 'primary';
        renderDebate();
    }

    // Authoritative (master-side) slot assignment — moves a person, vacating their old slot
    function assignSlot(peerId, zone, index) {
        if (!ZONE_SLOTS[zone] || index < 0 || index >= ZONE_SLOTS[zone]) return;
        var taken = debateRoster.some(function(e) {
            return e.zone === zone && e.index === index && e.peerId !== peerId;
        });
        if (taken) return;
        var e = findEntry(peerId);
        if (!e) return;
        if (e.zone !== zone) resetBreakout(e);
        e.zone = zone; e.index = index;
        renderDebate();
    }

    function vacateSlot(peerId) {
        var e = findEntry(peerId);
        if (e) { resetBreakout(e); e.zone = 'audience'; e.index = -1; renderDebate(); }
    }

    // Breakout rooms: only debaters/judges (never audience) may use them, and only for
    // whichever zone they're currently seated in. Leaving the seat (or being moved to a
    // different one) always pulls them back to the main room first.
    function doForward(entry) {
        if (!entry) return;
        var dest = entry.breakout ? breakoutRoomId(entry.zone) : vdoRoom();
        postToFrame(directorIframe, { action: 'forward', target: pushIdFor(entry.pushId), value: dest });
    }
    function resetBreakout(entry) {
        if (entry && entry.breakout) { entry.breakout = false; doForward(entry); }
    }
    function setBreakout(peerId, on) {
        var e = findEntry(peerId);
        if (!e || e.zone === 'audience') return;
        e.breakout = !!on;
        doForward(e);
        renderDebate();
    }
    function requestBreakout(on) {
        if (isDebateMaster) setBreakout(MASTER_ID, on);
        else if (masterConn && masterConn.open) { try { masterConn.send({ type: 'breakout', on: on }); } catch (e) {} }
    }

    function setSignal(peerId, kind) {
        var e = findEntry(peerId);
        if (!e) return;
        e.signal = kind || null;
        renderDebate();
        if (kind) App.core.showAlert((e.name || 'Uczestnik') + (kind === 'advocem' ? ': ad vocem' : ': podnosi rękę'));
    }

    // Called locally (master) or relayed to master (participant)
    function requestSlot(zone, index) {
        if (isDebateMaster) assignSlot(MASTER_ID, zone, index);
        else if (masterConn && masterConn.open) { try { masterConn.send({ type: 'takeSlot', zone: zone, index: index }); } catch (e) {} }
    }
    function requestLeave() {
        if (isDebateMaster) vacateSlot(MASTER_ID);
        else if (masterConn && masterConn.open) { try { masterConn.send({ type: 'leaveSlot' }); } catch (e) {} }
    }

    // renderDebate = the visual zones (everyone) + the master management list (master only)
    function renderDebate() {
        renderZones();
        if (isDebateMaster) { renderMasterRoster(); broadcastRoster(); }
        updateMyEmbed();
    }

    // Slim roster shape sent over the wire (everyone renders the same zones from this)
    function slimRoster() {
        return debateRoster.map(function(e) {
            return {
                peerId: e.peerId, pushId: e.pushId, name: e.name, zone: e.zone, index: e.index, signal: e.signal,
                speaking: e.speaking, breakout: !!e.breakout,
                joinSeq: e.joinSeq, comaster: e.comaster || null, honorary: !!e.honorary
            };
        });
    }

    // Master broadcasts a slim roster so every participant renders the same zones
    function broadcastRoster() {
        var slim = slimRoster();
        sessionConnections.forEach(function(c) {
            try { c.conn.send({ type: 'roster', roster: slim }); } catch (e) {}
        });
    }

    function occupant(zone, index) {
        return debateRoster.filter(function(e) { return e.zone === zone && e.index === index; })[0];
    }

    // While I'm in a breakout room, everyone who isn't in that same room with me is someone
    // I can no longer see/hear over VDO — dim them so the UI doesn't lie about who's "here".
    function isDimmedForMe(entry) {
        var me = findEntry(myPeerId);
        if (!me || !me.breakout || !entry) return false;
        return !(entry.zone === me.zone && entry.breakout);
    }

    function slotEl(entry, zone, index) {
        var mine = entry && entry.peerId === myPeerId;
        var draggable = isDebateMaster && debateEditMode && !!entry;
        var cls = 'slot' + (entry ? '' : ' slot--empty') + (mine ? ' slot--me' : '') +
            (entry && entry.signal ? ' slot--signal' : '') + (draggable ? ' slot--draggable' : '') +
            (isDimmedForMe(entry) ? ' slot--dimmed' : '');
        var $s = $('<div class="' + cls + '"></div>').attr('data-zone', zone).attr('data-index', index);
        if (draggable) $s.attr('draggable', 'true').attr('data-peer', entry.peerId);
        if (!entry) {
            var $plus = $('<button type="button" class="slot-avatar slot-plus">+</button>')
                .attr('data-zone', zone).attr('data-index', index);
            $s.append($plus);
            $s.append($('<div class="slot-name"></div>').text('—'));
            return $s;
        }
        var badge = entry.signal ? (entry.signal === 'advocem' ? 'AV' : '✋') :
            (entry.name ? entry.name.trim().charAt(0).toUpperCase() : '');
        var $av = $('<div class="slot-avatar"></div>').text(badge);
        if (mine) { $av.addClass('slot-avatar--me').attr('title', 'Kliknij, aby wrócić do widzów'); }
        $s.append($av);
        var $n = $('<div class="slot-name"></div>').text(entry.name);
        if (entry.speaking) $n.append(' ').append($('<span class="slot-mic" title="Mówi">🎤</span>'));
        if (entry.breakout) $n.append(' ').append($('<span class="badge badge-secondary roster-breakout-badge"></span>').text('Narada'));
        if (entry.comaster === 'primary') $n.append(' ').append($('<span class="badge badge-info comaster-badge" title="Wyznaczony następca mastera"></span>').text('Co-master'));
        $s.append($n);
        return $s;
    }

    function fillZone(zone) {
        var $list = $('.slot-list[data-zone="' + zone + '"]');
        $list.empty();
        for (var i = 0; i < ZONE_SLOTS[zone]; i++) $list.append(slotEl(occupant(zone, i) || null, zone, i));
    }

    function renderZones() {
        fillZone('proposition');
        fillZone('opposition');
        fillZone('judges');

        var $aud = $('.slot-list[data-zone="audience"]');
        $aud.empty();
        var aud = debateRoster.filter(function(e) { return e.zone === 'audience'; });
        if (!aud.length) { $aud.append('<span class="aud-empty text-muted">—</span>'); }
        aud.forEach(function(e) {
            var $d = $('<div class="aud-dot"></div>').attr('title', e.name)
                .text(e.name ? e.name.trim().charAt(0).toUpperCase() : '');
            if (e.peerId === myPeerId) $d.addClass('aud-dot--me');
            if (e.speaking) $d.addClass('aud-dot--speaking');
            if (e.comaster === 'primary') $d.addClass('aud-dot--comaster');
            if (isDimmedForMe(e)) $d.addClass('aud-dot--dimmed');
            if (isDebateMaster && debateEditMode) {
                $d.addClass('aud-dot--draggable').attr('draggable', 'true').attr('data-peer', e.peerId);
            }
            $aud.append($d);
        });

        updateChatTabs();
        updateBreakoutButton();
    }

    // Master edit mode: drag a seated slot (or an audience dot) onto another slot to move/swap,
    // or onto the audience list to send someone back to the audience.
    function moveToSlot(peerId, zone, index) {
        var mover = findEntry(peerId);
        if (!mover) return;
        var occ = occupant(zone, index);
        if (occ && occ.peerId !== peerId) {
            resetBreakout(occ);
            occ.zone = mover.zone; occ.index = mover.index;
        }
        if (mover.zone !== zone) resetBreakout(mover);
        mover.zone = zone; mover.index = index;
        renderDebate();
    }

    $(document).on('dragstart', '.slot--draggable, .aud-dot--draggable', function(e) {
        if (!isDebateMaster || !debateEditMode) { e.preventDefault(); return; }
        e.originalEvent.dataTransfer.setData('text/plain', $(this).data('peer'));
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
        var peerId = e.originalEvent.dataTransfer.getData('text/plain');
        moveToSlot(peerId, $(this).data('zone'), parseInt($(this).data('index'), 10));
    });
    $(document).on('drop', '.slot-list[data-zone="audience"]', function(e) {
        if (!isDebateMaster || !debateEditMode) return;
        e.preventDefault();
        $(this).removeClass('slot--dragover');
        var peerId = e.originalEvent.dataTransfer.getData('text/plain');
        vacateSlot(peerId);
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
            $row.append($('<span class="roster-name"></span>').text(e.name + (e.peerId === MASTER_ID ? ' (Ty)' : '')));
            $row.append($('<span class="roster-role"></span>').text(zoneLabel(e.zone)));
            if (e.comaster === 'primary') {
                $('<span class="badge badge-info comaster-badge" title="Wyznaczony następca mastera"></span>').text('Co-master').appendTo($row);
            }
            if (e.honorary) {
                $('<span class="badge badge-secondary comaster-badge comaster-badge--honorary" title="Był(a) prowadzącym"></span>').text('Co-master (h.)').appendTo($row);
            }
            if (e.signal) {
                $('<button type="button" class="btn btn-sm roster-signal"></button>')
                    .attr('data-peer', e.peerId)
                    .text(e.signal === 'advocem' ? 'AD VOCEM' : '✋ ręka')
                    .appendTo($row);
            }
            if (e.breakout) {
                $('<span class="badge badge-secondary roster-breakout-badge"></span>').text('Narada').appendTo($row);
                $('<button type="button" class="btn btn-outline-secondary btn-sm roster-recall">Wróć</button>')
                    .attr('data-peer', e.peerId).appendTo($row);
            }
            if (e.peerId !== MASTER_ID) {
                $('<button type="button" class="btn btn-outline-secondary btn-sm roster-mute">Wycisz</button>')
                    .attr('data-peer', e.peerId).appendTo($row);
                if (e.comaster === 'primary') {
                    $('<button type="button" class="btn btn-outline-primary btn-sm roster-promote">Uczyń masterem</button>')
                        .attr('data-peer', e.peerId).appendTo($row);
                } else if (!e.honorary) {
                    $('<button type="button" class="btn btn-outline-secondary btn-sm roster-designate-comaster">Ustaw jako co-master</button>')
                        .attr('data-peer', e.peerId).appendTo($row);
                }
            }
            $r.append($row);
        });
    }

    $(document).on('click', '.roster-recall', function() {
        setBreakout(String($(this).data('peer')), false);
    });

    function zoneLabel(zone) {
        return zone === 'proposition' ? 'Propozycja' : zone === 'opposition' ? 'Opozycja' :
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
        sendToPeer(String($(this).data('peer')), { type: 'cmd', action: 'mute' });
        App.core.showAlert('Wyciszono uczestnika');
    });

    $(document).on('click', '.roster-signal', function() {
        setSignal(String($(this).data('peer')), null);
    });

    // Switch our own VDO iframe between publishing (took a slot) and viewing the scene
    function updateMyEmbed() {
        var me = findEntry(myPeerId);
        var mode = (me && me.zone && me.zone !== 'audience') ? 'publish' : 'view';
        if (mode !== myEmbedMode) {
            myEmbedMode = mode;
            embedVdo(buildVdoUrl(mode, myDebateName, myPushId));
            $('body').toggleClass('is-publishing', mode === 'publish');
            if (mode === 'publish') { setMicBtn(true); camOn = true; $('.debate-cam-btn').text('Wyłącz kamerę'); }
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
        $('.debate-hand-btn').toggleClass('active', mySignal === 'hand');
        $('.debate-advocem-btn').toggleClass('active', mySignal === 'advocem');
    }

    // Master: create a debate room
    $('.debate-name-input').on('input', function() {
        $(this).val($(this).val().toLowerCase());
        var val = $(this).val();
        var wasInvalid = $(this).hasClass('is-invalid');
        var invalid = val.length > 0 && !/^[a-zA-Z0-9]+$/.test(val);
        $(this).toggleClass('is-invalid', invalid);
        if (invalid && !wasInvalid) App.core.showWarn('Dozwolone tylko litery a–z, A–Z i cyfry');
        $('.debate-create-btn').prop('disabled', !(val.length > 0 && !invalid));
    });

    $('.debate-random-btn').click(function() {
        var name = SESSION_WORDS[Math.floor(Math.random() * SESSION_WORDS.length)];
        $('.debate-name-input').val(name).trigger('input');
    });

    $('.debate-create-btn').click(function() {
        var name = $('.debate-name-input').val().trim().toLowerCase();
        if (!/^[a-zA-Z0-9]+$/.test(name)) return;
        if (sessionPeer) { sessionPeer.destroy(); sessionPeer = null; }

        var $btn = $(this);
        $btn.text('Łączenie…').prop('disabled', true);

        sessionPeer = new Peer(name);
        sessionPeer.on('open', function(id) {
            debateSessionId = id;
            isDebateMaster = true;
            myPeerId = MASTER_ID;
            myPushId = MASTER_ID;
            myGeneration = 0;
            myDebateName = $('.debate-master-name-input').val().trim() || 'Prowadzący';
            markWasMaster(id);
            debateRoster = [{
                peerId: MASTER_ID, pushId: MASTER_ID, name: myDebateName, zone: 'audience', index: -1,
                signal: null, speaking: false, breakout: false,
                joinSeq: 0, comaster: null, honorary: false
            }];
            embedDirector();
            $('body').addClass('is-debate-master');
            $('.debate-empty').hide();
            $('.debate-stage').show();
            $('.debate-roster-wrap').show();
            updateShareLinks();
            myEmbedMode = null;
            renderDebate(); // seeds the scene iframe via updateMyEmbed
            $btn.text('Debata aktywna');
        });
        sessionPeer.on('error', function(err) {
            console.error('[Debata] Master error:', err.type);
            var msg = err.type === 'unavailable-id' ? 'Nazwa zajęta — wybierz inną' : 'Błąd: ' + err.type;
            $btn.text(msg).prop('disabled', false);
            sessionPeer = null;
        });
        sessionPeer.on('connection', handleMasterConnection);
    });

    $('.debate-copy-btn').click(function() {
        navigator.clipboard.writeText($('.debate-link-val').val());
    });

    // Join screen: preview camera/mic before entering
    $('.debate-preview-btn').click(function() {
        embedPreview();
        $(this).text('Podgląd włączony');
    });

    // Join screen: pick a device — switches the live preview and carries over into the room
    $('.debate-join-cam-select').change(function() {
        joinCamDeviceIndex = parseInt($(this).val(), 10);
        postToFrame(previewIframe, { changeVideoDevice: joinCamDeviceIndex });
    });
    $('.debate-join-mic-select').change(function() {
        joinMicDeviceIndex = parseInt($(this).val(), 10);
        postToFrame(previewIframe, { changeAudioDevice: joinMicDeviceIndex });
    });

    // Participant: submit name, join as audience, announce to master
    $('.debate-join-btn').click(function() {
        var name = $('.debate-join-name').val().trim();
        if (!name) { $('.debate-join-error').text('Podaj imię').show(); return; }
        $('.debate-join-error').hide();

        myDebateName = name;
        clearPreview();
        $('.debate-join').hide();
        $('.debate-stage').show();
        myEmbedMode = null;
        updateMyEmbed(); // audience → scene viewer

        sendJoinMessage(name);
    });

    // Participant self-media controls (drive our own iframe via postMessage)
    $('.debate-mic-btn').click(function() {
        setMicBtn(!micOn);
        postToVdo({ mic: micOn });
    });

    $('.debate-cam-btn').click(function() {
        camOn = !camOn;
        postToVdo({ camera: camOn });
        $(this).text(camOn ? 'Wyłącz kamerę' : 'Włącz kamerę');
    });

    $('.debate-cam-select').change(function() {
        postToVdo({ changeVideoDevice: parseInt($(this).val(), 10) });
    });

    $('.debate-mic-select').change(function() {
        postToVdo({ changeAudioDevice: parseInt($(this).val(), 10) });
    });

    // Debater signals — click again to cancel (toggle)
    function toggleSignal(kind) {
        mySignal = (mySignal === kind) ? null : kind;
        if (isDebateMaster) setSignal(MASTER_ID, mySignal);
        else if (masterConn && masterConn.open) { try { masterConn.send({ type: 'signal', kind: mySignal }); } catch (e) {} }
        updateSignalButtons();
    }
    $('.debate-hand-btn').click(function() { toggleSignal('hand'); });
    $('.debate-advocem-btn').click(function() { toggleSignal('advocem'); });

    // Debater/judge: step into (or back out of) their team's breakout room
    function updateBreakoutButton() {
        var me = findEntry(myPeerId);
        var inBreakout = !!(me && me.breakout);
        $('.debate-breakout-btn').toggleClass('active', inBreakout)
            .text(inBreakout ? 'Wróć do pokoju głównego' : 'Pokój narad');
    }
    $('.debate-breakout-btn').click(function() {
        var me = findEntry(myPeerId);
        requestBreakout(!(me && me.breakout));
    });

    // Master: let positioned participants control the clock
    $('.debate-allow-controls-btn').click(function() {
        debateAllowControls = !debateAllowControls;
        $(this).toggleClass('active', debateAllowControls)
            .text(debateAllowControls ? 'Zablokuj sterowanie zegarem' : 'Pozwól sterować zegarem');
        sessionConnections.forEach(function(c) {
            try { c.conn.send({ type: 'cmd', action: 'allowControls', on: debateAllowControls }); } catch (e) {}
        });
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

    // Master room controls
    $('.debate-muteall-btn').click(function() {
        sessionConnections.forEach(function(c) {
            try { c.conn.send({ type: 'cmd', action: 'mute' }); } catch (e) {}
        });
        App.core.showAlert('Wyciszono wszystkich');
    });

    $('.debate-close-btn').click(function() {
        if (!window.confirm('Zamknąć pokój debaty? Wszyscy uczestnicy zostaną rozłączeni.')) return;
        sessionConnections.forEach(function(c) {
            try { c.conn.send({ type: 'cmd', action: 'close' }); } catch (e) {}
        });
        if (sessionPeer) { sessionPeer.destroy(); sessionPeer = null; }
        if (backupPeer) { backupPeer.destroy(); backupPeer = null; }
        sessionConnections = [];
        debateRoster = [];
        isDebateMaster = false;
        isPrimaryComaster = false;
        myPeerId = null;
        myPushId = null;
        myGeneration = 0;
        myEmbedMode = null;
        streamNames = {};
        $('body').removeClass('is-debate-master is-publishing is-comaster-primary');
        $('.debate-video').empty();
        debateIframe = null;
        removeDirector();
        $('.debate-stage').hide();
        $('.debate-roster-wrap').hide();
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
            try { masterConn.send({ type: 'chat', channel: channel, msg: msg }); } catch (e) {}
        }
    }
    $('.debate-chat-send').click(sendChatMessage);
    $('.debate-chat-input').keydown(function(e) {
        if (e.key === 'Enter') { e.preventDefault(); sendChatMessage(); }
    });

    // Receive data back from our own VDO iframe(s) — the live room iframe and, on the
    // join screen, the separate preview iframe (each is its own postMessage channel).
    window.addEventListener('message', function(e) {
        var d = e.data;
        if (!d) return;
        if (debateIframe && e.source === debateIframe.contentWindow) {
            if (d.deviceList) populateDevices(d.deviceList);
            // Speaking indicator (master only): map loud streams to names
            if (d.action === 'guest-connected' && d.streamID) streamNames[d.streamID] = (d.value && d.value.label) || '';
            if (d.action === 'guest-disconnected' && d.streamID) delete streamNames[d.streamID];
            if (d.loudness !== undefined) handleLoudness(d.loudness);
        } else if (previewIframe && e.source === previewIframe.contentWindow) {
            if (d.deviceList) populateJoinDevices(d.deviceList);
        }
    });

    // Best-effort talk detection from VDO loudness — thresholds/shape need live tuning
    function handleLoudness(loud) {
        if (!isDebateMaster) return;
        var THRESH = 5;
        var speaking = {};
        var consider = function(streamID, level) {
            if (level != null && level > THRESH && streamNames[streamID]) speaking[streamNames[streamID]] = true;
        };
        if (Array.isArray(loud)) {
            loud.forEach(function(x) { consider(x.streamID || x.id, x.loudness != null ? x.loudness : x.level); });
        } else if (loud && typeof loud === 'object') {
            Object.keys(loud).forEach(function(k) { consider(k, loud[k]); });
        }
        var changed = false;
        debateRoster.forEach(function(e) {
            var sp = !!speaking[e.name];
            if (sp !== !!e.speaking) { e.speaking = sp; changed = true; }
        });
        if (changed) { renderZones(); broadcastSpeaking(); }
    }
    function broadcastSpeaking() {
        var names = debateRoster.filter(function(e) { return e.speaking; }).map(function(e) { return e.name; });
        sessionConnections.forEach(function(c) {
            try { c.conn.send({ type: 'speaking', names: names }); } catch (e) {}
        });
    }

    // --- Comaster failover: promotion, backup hub, reconnect cascade ---

    // Send our own join message (or queue it until masterConn opens), tagging whether
    // this browser was ever master of this room so it can be granted honorary comaster
    // status instead of re-entering the succession queue.
    function sendJoinMessage(name) {
        var payload = { type: 'join', name: name, wasMaster: checkWasMaster(debateSessionId), clientId: getClientId() };
        if (masterConn && masterConn.open) {
            try { masterConn.send(payload); } catch (e) {}
        } else {
            debatePendingJoin = { name: name };
        }
    }

    // Create/destroy the standby PeerJS hub at genName(myGeneration + 1). Called from
    // handleSlaveData whenever a roster broadcast shows my own entry's comaster status
    // has changed. Connections landing on it are handled exactly like connections
    // landing on the primary sessionPeer.
    function setComasterHosting(on) {
        isPrimaryComaster = on;
        $('body').toggleClass('is-comaster-primary', on);
        if (on && !backupPeer) {
            backupPeer = new Peer(genName(myGeneration + 1));
            backupPeer.on('connection', handleMasterConnection);
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

        // Drop the old master's own entry — on a crash it was never removed (nobody's
        // 'close' handler ever fires for the master's own roster slot, only for
        // incoming participant connections), so without this it would linger as a
        // stale, unremovable duplicate MASTER_ID entry once I rename myself to it below.
        debateRoster = debateRoster.filter(function(e) { return e.peerId !== MASTER_ID; });

        var me = findEntry(myPeerId);
        if (me) { me.peerId = MASTER_ID; me.comaster = null; me.honorary = false; }
        myPeerId = MASTER_ID;
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
        $('.debate-roster-wrap').show();
        App.core.showAlert('Zostałeś nowym prowadzącym debaty');
        renderDebate();
    }

    // Master: hand off the role to a specific comaster without leaving the room —
    // a deliberate, controlled version of the same event a crash triggers (destroying
    // our own room id closes everyone's connection to it, so they all discover the new
    // generation via the normal reconnect cascade below). The outgoing master drops its
    // own seat and rejoins fresh afterward — exactly like a returning-after-crash master
    // — so it's granted honorary comaster status by the same wasMaster mechanism instead
    // of a special-cased transplant.
    function handoffMasterTo(peerId) {
        if (!window.confirm('Przekazać rolę mastera temu uczestnikowi?')) return;
        var target = findEntry(peerId);
        if (!target) return;

        var rosterForHandoff = debateRoster.filter(function(e) { return e.peerId !== MASTER_ID; });
        sendToPeer(peerId, { type: 'promoteToMaster', state: App.core.getFullState(), roster: rosterForHandoff });
        markWasMaster(debateSessionId);

        if (sessionPeer) { sessionPeer.destroy(); sessionPeer = null; }
        sessionConnections = [];
        isDebateMaster = false;
        App.state.isSlaveSession = true;
        removeDirector();
        $('body').removeClass('is-debate-master');
        $('.debate-roster-wrap').hide();
        App.core.showAlert('Przekazano rolę prowadzącego');

        var name = myDebateName;
        var fromGen = myGeneration;
        myPeer = new Peer();
        myPeer.on('open', function(id) {
            myPeerId = id;
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
            if (err.type === 'peer-unavailable') finish(false);
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
    function attachMasterConn(conn, gen, toast) {
        myGeneration = gen;
        masterConn = conn;
        masterConn.on('data', handleSlaveData);
        masterConn.on('close', handleMasterConnLost);
        if (toast) App.core.showAlert(toast);
    }

    // The debate-mode masterConn.on('close') handler. Always tries the room we were
    // just on again first (5s) — a dropped WebRTC data channel doesn't necessarily mean
    // the host is actually gone — before treating it as a real failover. Only then does
    // the primary comaster promote itself (it already hosts the next generation as a
    // standby); everyone else instead searches forward for wherever the room now lives.
    function handleMasterConnLost() {
        // Already master via another path (e.g. this is our own pre-promotion
        // masterConn closing as a side effect of a manual handoff) — irrelevant now.
        if (isDebateMaster) return;
        App.core.showWarn('Utracono połączenie z prowadzącym — próba przełączenia…');
        var fromGen = myGeneration;
        tryConnect(genName(fromGen), 5000, function(ok, conn) {
            if (ok) { attachMasterConn(conn, fromGen, 'Połączono ponownie z prowadzącym'); return; }
            if (isPrimaryComaster) { promoteSelfToMaster(null); return; }
            probeForward(fromGen + 1, fromGen + 10, function(gen, conn2) {
                attachMasterConn(conn2, gen, 'Połączono ponownie z prowadzącym');
            }, function() {
                $('.session-lost-alert').fadeIn(50);
            });
        });
    }

    $(document).on('click', '.roster-promote', function() {
        handoffMasterTo(String($(this).data('peer')));
    });
    $(document).on('click', '.roster-designate-comaster', function() {
        designateComaster(String($(this).data('peer')));
    });

    // Slave-side dispatch of data arriving over masterConn — factored out so it can
    // be re-attached to a fresh connection after a failover reconnect.
    function handleSlaveData(data) {
        if (data.type === 'init' || data.type === 'state') App.core.applyState(data.state);
        else if (data.type === 'chat') appendChat(data.name, data.msg, data.channel);
        else if (data.type === 'cmd') handleDebateCmd(data);
        else if (data.type === 'promoteToMaster') { promoteSelfToMaster({ state: data.state, roster: data.roster }); }
        else if (data.type === 'roster') {
            debateRoster = data.roster || [];
            renderZones();
            updateMyEmbed();
            // Whether I should be hosting the standby hub is derived from my own entry
            // in every roster broadcast, not a separate point-to-point message — right
            // after a promotion the designated comaster usually isn't even connected
            // yet, so a one-shot message sent at that instant could silently miss them.
            var me = findEntry(myPeerId);
            var shouldHost = !!(me && me.comaster === 'primary');
            if (shouldHost !== isPrimaryComaster) setComasterHosting(shouldHost);
        }
        else if (data.type === 'speaking') {
            debateRoster.forEach(function(e) { e.speaking = data.names.indexOf(e.name) !== -1; });
            renderZones();
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
        } else {
            var slaveUrl = window.location.href;
            $('.slave-session-link-val').val(slaveUrl);
            new QRCode(document.getElementById('slave-qr'), {text: slaveUrl, width: 256, height: 256});
        }

        console.log('[Session] Joining session:', s, isDebate ? '(debata)' : '');
        $('.session-status').text('Łączenie z sesją…').show();

        myPeer = new Peer();
        myPeer.on('open', function(myId) {
            console.log('[Session] Slave peer opened:', myId);
            myPeerId = myId;
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
                });
            } else {
                masterConn = myPeer.connect(s, {serialization: 'json'});
                masterConn.on('open', function() {
                    console.log('[Session] Connected to master!');
                    $('.session-status').hide();
                    App.core.showAlert('Połączono z sesją');
                });
                masterConn.on('data', handleSlaveData);
                masterConn.on('close', function() {
                    $('.session-lost-alert').fadeIn(50);
                });
                masterConn.on('error', function(err) {
                    console.error('[Session] Conn error:', err);
                    $('.session-status').text('Błąd połączenia: ' + err.type).show();
                });
            }
        });
        myPeer.on('error', function(err) {
            console.error('[Session] Peer error:', err.type);
            $('.session-status').text('Błąd: ' + err.type).show();
        });
    })();

})(jQuery, window.App);
