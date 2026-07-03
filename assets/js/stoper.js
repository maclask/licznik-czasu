(function ($) {
    var timerRunning = false;
    var jokerRunning = false;
    var showControls = true;
    var soundEnabled = true;
    var currentFormat = 'oxford'; // 'oxford' | 'bp'
    var jokerEnabled = false;

    // Current display values
    var minutes, seconds;
    var adVocemMinutes, adVocemSeconds;
    var jokerSeconds;

    // System-time anchors for drift-free countdown
    var timerStartedAt, timerStartSeconds;
    var jokerStartedAt, jokerStartSeconds;

    var timerInterval, jokerInterval;
    var lastTimerSecond = -1;
    var lastJokerSecond = -1;

    // BP-specific state
    var bpBell1Rung = false;  // 1 min after start
    var bpBell2Rung = false;  // 1 min before end
    var bpOvertimeRunning = false;
    var bpOvertimeSecs = 15;  // remaining overtime seconds (updated on pause)
    var bpOvertimeStartedAt;

    // Session sync
    var onStateChange = function(delta) {};  // no-op until session active
    var applyingState = false;              // prevents echo-loop in applyState

    // --- Init ---

    $('[data-toggle="tooltip"]').tooltip({ trigger: 'hover' });
    $('.alert').hide();
    $('.joker-timer').hide();
    $('.joker-controls').hide();
    $('.oxford-joker').hide();
    $('#settings').hide();
    $('#help').hide();
    $('button').focus(function () { this.blur(); });

    loadTimeFromInput();
    loadAdVocemFromInput();

    // --- Helpers ---

    function loadTimeFromInput() {
        var parts = $('.input-minuty').val().split(':');
        minutes = parseInt(parts[0], 10) || 0;
        seconds = parseInt(parts[1], 10) || 0;
        renderTimer();
    }

    function loadAdVocemFromInput() {
        var parts = $('.input-minuty-advocem').val().split(':');
        adVocemMinutes = parseInt(parts[0], 10) || 0;
        adVocemSeconds = parseInt(parts[1], 10) || 0;
    }

    function renderTimer() {
        $('#timer').find('.timer-minutes').text(minutes);
        $('#timer').find('.timer-seconds').text(seconds < 10 ? '0' + seconds : seconds);
    }

    function renderJoker() {
        var m = Math.floor(jokerSeconds / 60);
        var s = jokerSeconds % 60;
        $('#timer').find('.joker-minutes').text(m);
        $('#timer').find('.joker-seconds').text(s < 10 ? '0' + s : s);
    }

    function popTime() {
        $('.timer').animate({ scale: '93%' }, 'fast');
        $('.timer').animate({ scale: '100%' }, 'fast');
    }

    // --- Main timer ---

    function timerTick() {
        // BP overtime: counts down 15 s after speech ends
        if (bpOvertimeRunning) {
            var otElapsed = Math.floor((Date.now() - bpOvertimeStartedAt) / 1000);
            var otRemaining = bpOvertimeSecs - otElapsed;
            if (otRemaining <= 0) {
                minutes = 0;
                seconds = 0;
                renderTimer();
                clearInterval(timerInterval);
                timerRunning = false;
                bpOvertimeRunning = false;
                bpOvertimeSecs = 15;
                $('.start-stop').text('Start');
                $('.timer').removeClass('bp-overtime');
                return;
            }
            if (otRemaining === lastTimerSecond) return;
            lastTimerSecond = otRemaining;
            minutes = 0;
            seconds = otRemaining;
            renderTimer();
            return;
        }

        // Normal countdown
        var elapsed = Math.floor((Date.now() - timerStartedAt) / 1000);
        var remaining = timerStartSeconds - elapsed;

        if (remaining <= 0) {
            minutes = 0;
            seconds = 0;
            renderTimer();
            if (soundEnabled) playEndSound();

            if (currentFormat === 'bp') {
                bpOvertimeRunning = true;
                bpOvertimeSecs = 15;
                bpOvertimeStartedAt = Date.now();
                lastTimerSecond = 15;
                minutes = 0;
                seconds = 15;
                renderTimer();
                $('.timer').addClass('bp-overtime');
            } else {
                stopTimer();
            }
            return;
        }

        if (remaining === lastTimerSecond) return;
        lastTimerSecond = remaining;

        minutes = Math.floor(remaining / 60);
        seconds = remaining % 60;

        // Format-specific bells
        if (soundEnabled) {
            if (currentFormat === 'oxford') {
                if (remaining === 30) playDingSound();
            } else {
                // BP: 1 min after start, 1 min before end
                var elapsedSecs = timerStartSeconds - remaining;
                if (!bpBell1Rung && elapsedSecs >= 60 && timerStartSeconds > 60) {
                    bpBell1Rung = true;
                    playDingSound();
                }
                if (!bpBell2Rung && remaining <= 60 && timerStartSeconds > 120) {
                    bpBell2Rung = true;
                    playDingSound();
                }
            }
        }

        renderTimer();
    }

    function startTimer() {
        if (timerRunning) return;

        if (bpOvertimeRunning) {
            // Resume paused overtime
            bpOvertimeStartedAt = Date.now();
        } else {
            timerStartedAt = Date.now();
            timerStartSeconds = minutes * 60 + seconds;
            lastTimerSecond = timerStartSeconds;
            bpBell1Rung = false;
            bpBell2Rung = false;
        }

        timerInterval = setInterval(timerTick, 250);
        timerRunning = true;
        $('.start-stop').text('Stop');
        onStateChange({timerRunning: true, timerStartedAt: timerStartedAt, timerStartSeconds: timerStartSeconds});
    }

    function stopTimer() {
        if (!timerRunning) return;
        clearInterval(timerInterval);
        timerRunning = false;

        if (bpOvertimeRunning) {
            var ot = Math.floor((Date.now() - bpOvertimeStartedAt) / 1000);
            bpOvertimeSecs = Math.max(0, bpOvertimeSecs - ot);
            minutes = 0;
            seconds = bpOvertimeSecs;
        } else {
            var el = Math.floor((Date.now() - timerStartedAt) / 1000);
            var rem = Math.max(0, timerStartSeconds - el);
            minutes = Math.floor(rem / 60);
            seconds = rem % 60;
        }
        renderTimer();
        $('.start-stop').text('Start');
        onStateChange({timerRunning: false, minutes: minutes, seconds: seconds, bpOvertimeRunning: bpOvertimeRunning, bpOvertimeSecs: bpOvertimeSecs});
    }

    function toggleTimer() {
        if (timerRunning) stopTimer(); else startTimer();
        popTime();
    }

    function reset() {
        clearInterval(timerInterval);
        timerRunning = false;
        bpOvertimeRunning = false;
        bpOvertimeSecs = 15;
        bpBell1Rung = false;
        bpBell2Rung = false;
        $('.timer').removeClass('bp-overtime');
        $('.start-stop').text('Start');
        loadTimeFromInput();
        onStateChange({timerRunning: false, bpOvertimeRunning: false, bpOvertimeSecs: 15, minutes: minutes, seconds: seconds, timerValue: $('.input-minuty').val()});
    }

    function setAdVocem() {
        if (currentFormat !== 'oxford') return;
        clearInterval(timerInterval);
        timerRunning = false;
        bpOvertimeRunning = false;
        $('.timer').removeClass('bp-overtime');
        $('.start-stop').text('Start');
        minutes = adVocemMinutes;
        seconds = adVocemSeconds;
        renderTimer();
        onStateChange({timerRunning: false, minutes: minutes, seconds: seconds});
    }

    // --- Format ---

    function applyFormat() {
        if (currentFormat === 'bp') {
            $('.oxford-only').hide();
            $('.oxford-joker').hide();
            $('.oxford-setting').addClass('settings-hidden');
            if ($('.input-minuty').val() === '05:00') $('.input-minuty').val('07:00');
        } else {
            $('.oxford-only').show();
            $('.oxford-joker').toggle(jokerEnabled);
            $('.oxford-setting').removeClass('settings-hidden');
            if ($('.input-minuty').val() === '07:00') $('.input-minuty').val('05:00');
        }
        reset();
        onStateChange({currentFormat: currentFormat, timerRunning: false, minutes: minutes, seconds: seconds, timerValue: $('.input-minuty').val()});
    }

    // --- Joker timer ---

    function jokerTick() {
        var elapsed = Math.floor((Date.now() - jokerStartedAt) / 1000);
        var remaining = jokerStartSeconds - elapsed;

        if (remaining <= 0) {
            jokerSeconds = 0;
            renderJoker();
            jokerOff();
            if (soundEnabled) playDingSound();
            return;
        }

        if (remaining === lastJokerSecond) return;
        lastJokerSecond = remaining;
        jokerSeconds = remaining;
        renderJoker();
    }

    function jokerStart() {
        clearInterval(jokerInterval);
        jokerSeconds = 30;
        jokerStartedAt = Date.now();
        jokerStartSeconds = 30;
        lastJokerSecond = 30;
        renderJoker();
        $('.joker-timer').show();
        if (showControls) $('.joker-controls').show();
        jokerInterval = setInterval(jokerTick, 250);
        jokerRunning = true;
        onStateChange({jokerRunning: true, jokerStartedAt: jokerStartedAt, jokerStartSeconds: 30, jokerSeconds: 30});
    }

    function jokerToggle() {
        if (jokerRunning) {
            clearInterval(jokerInterval);
            jokerRunning = false;
            var elapsed = Math.floor((Date.now() - jokerStartedAt) / 1000);
            jokerSeconds = Math.max(0, jokerStartSeconds - elapsed);
        } else {
            jokerStartedAt = Date.now();
            jokerStartSeconds = jokerSeconds;
            lastJokerSecond = jokerSeconds;
            jokerInterval = setInterval(jokerTick, 250);
            jokerRunning = true;
        }
        onStateChange({jokerRunning: jokerRunning, jokerStartedAt: jokerStartedAt, jokerStartSeconds: jokerStartSeconds, jokerSeconds: jokerSeconds});
    }

    function jokerOff() {
        clearInterval(jokerInterval);
        jokerRunning = false;
        $('.joker-timer').hide();
        $('.joker-controls').hide();
        onStateChange({jokerRunning: false});
    }

    // --- Sound ---

    function playDingSound() {
        var s = $('#30stoend').get(0);
        s.currentTime = 0;
        s.play();
    }

    function playEndSound() {
        var s = $('#endoftime').get(0);
        s.currentTime = 0;
        s.play();
    }

    function toggleSound() {
        soundEnabled = !soundEnabled;
    }

    // --- Images ---

    function setImage(src, no) {
        if (!src) {
            $('.img' + no).parent().css('display', 'none');
        } else {
            $('.img' + no).attr('src', src).parent().css('display', 'flex');
        }
        if (!applyingState) {
            var d = {};
            d['logo' + no] = src || null;
            onStateChange(d);
        }
    }

    function readImageFile(input, no) {
        if (input.files && input.files[0]) {
            var reader = new FileReader();
            reader.onload = function (e) { setImage(e.target.result, no); };
            reader.readAsDataURL(input.files[0]);
        }
    }

    // --- Navigation ---

    function navigate(section) {
        $('#timer, #settings, #help').hide();
        $('#' + section).show();
        var titles = { settings: 'Ustawienia', help: 'Pomoc', timer: '' };
        $('#section-title').text(titles[section] || '');
    }

    // --- Alert ---

    function showAlert(msg) {
        if (msg) $('.alert-success strong').text(msg);
        else $('.alert-success strong').text('Zrobiono!');
        $('.alert-success').fadeIn(50);
        setTimeout(function () { $('.alert-success').fadeOut(); }, 1000);
    }

    // --- Fullscreen ---

    function toggleFullscreen() {
        if (document.fullscreenElement) {
            (document.exitFullscreen || document.mozCancelFullScreen ||
             document.webkitExitFullscreen || document.msExitFullscreen).call(document);
        } else {
            var el = document.documentElement;
            (el.requestFullscreen || el.mozRequestFullScreen ||
             el.webkitRequestFullscreen || el.msRequestFullscreen).call(el);
        }
    }

    // --- Event listeners ---

    $('.start-stop').click(toggleTimer);
    $('.reset').click(reset);
    $('.input-minuty').change(reset);
    $('.ad-vocem').click(setAdVocem);
    $('.input-minuty-advocem').change(function() {
        loadAdVocemFromInput();
        onStateChange({adVocemValue: $(this).val()});
    });

    $('.joker').click(jokerStart);
    $('.joker-start-stop').click(jokerToggle);
    $('.joker-reset').click(jokerStart);
    $('.joker-off').click(jokerOff);

    $('.sound-switch').click(function() {
        toggleSound();
        onStateChange({soundEnabled: soundEnabled});
    });
    $('.sound-test1').click(playDingSound);
    $('.sound-test2').click(playEndSound);

    $('#settings').find(':submit').click(showAlert);
    $('.input-teza').on('input', function () {
        $('#teza').text($(this).val());
        onStateChange({teza: $(this).val()});
    });

    $('.controls-checkbox').click(function () {
        showControls = this.checked;
        $('.timer-controls:not(.joker-controls)').toggle(showControls);
        onStateChange({showControls: showControls});
    });

    $('.debate-format').change(function () {
        currentFormat = $(this).val();
        applyFormat();
    });

    $('.joker-checkbox').change(function () {
        jokerEnabled = this.checked;
        if (currentFormat === 'oxford') {
            $('.oxford-joker').toggle(jokerEnabled);
        }
        onStateChange({jokerEnabled: jokerEnabled});
    });

    $('.dropdown-item').click(function () {
        var parentClass = $(this).parent().parent().attr('class');
        var no = parentClass.includes('dropdown1') ? 1 : 2;
        var imgName = $(this).attr('data');
        setImage(imgName === '#' ? null : 'img/' + imgName, no);
    });

    $(document).on('dragover', '.logo-drop-zone', function (e) {
        e.preventDefault();
        $(this).addClass('drag-over');
    });

    $(document).on('dragleave', '.logo-drop-zone', function (e) {
        if (!$(this).is($(e.relatedTarget).closest('.logo-drop-zone'))) {
            $(this).removeClass('drag-over');
        }
    });

    $(document).on('drop', '.logo-drop-zone', function (e) {
        e.preventDefault();
        $(this).removeClass('drag-over');
        var no = parseInt($(this).data('logo-no'));
        var dt = e.originalEvent.dataTransfer;

        // Lokalny plik
        var file = dt.files[0];
        if (file && file.type.startsWith('image/')) {
            var reader = new FileReader();
            reader.onload = function (evt) { setImage(evt.target.result, no); };
            reader.readAsDataURL(file);
            return;
        }

        // Obrazek ze strony — URI list
        var uriList = dt.getData('text/uri-list');
        if (uriList) {
            var url = uriList.split('\n')
                .map(function (s) { return s.trim(); })
                .filter(function (s) { return s && s[0] !== '#'; })[0];
            if (url) { setImage(url, no); return; }
        }

        // Fallback — src z HTML
        var html = dt.getData('text/html');
        if (html) {
            var match = html.match(/src="([^"]+)"/i) || html.match(/src='([^']+)'/i);
            if (match) { setImage(match[1], no); }
        }
    });

    $('.full-screen-btn').click(toggleFullscreen);

    $('#timer-link').click(function () { navigate('timer'); });
    $('#settings-link').click(function () { navigate('settings'); });
    $('#help-link').click(function () { navigate('help'); });

    $(window).keyup(function (e) {
        if ($(e.target).is(':input')) return;
        switch (e.keyCode) {
            case 32: e.preventDefault(); toggleTimer(); break;
            case 49: reset(); break;
            case 50: if (currentFormat === 'oxford') setAdVocem(); break;
            case 74: if (currentFormat === 'oxford' && jokerEnabled) jokerStart(); break;
            case 72: if (currentFormat === 'oxford' && jokerEnabled) jokerToggle(); break;
            case 75: if (currentFormat === 'oxford' && jokerEnabled) jokerOff(); break;
        }
    });

    // --- Session (PeerJS) ---

    var sessionPeer = null;
    var sessionConnections = [];  // master: [{conn, mode}, ...]
    var masterConn = null;        // slave: DataConnection to master
    var isSlaveSession = false;
    var slaveModeReadonly = false;

    function getFullState() {
        return {
            timerRunning: timerRunning,
            timerStartedAt: timerStartedAt,
            timerStartSeconds: timerStartSeconds,
            bpOvertimeRunning: bpOvertimeRunning,
            bpOvertimeSecs: bpOvertimeSecs,
            bpOvertimeStartedAt: bpOvertimeStartedAt,
            minutes: minutes,
            seconds: seconds,
            jokerRunning: jokerRunning,
            jokerStartedAt: jokerStartedAt,
            jokerStartSeconds: jokerStartSeconds,
            jokerSeconds: jokerSeconds,
            currentFormat: currentFormat,
            showControls: showControls,
            soundEnabled: soundEnabled,
            jokerEnabled: jokerEnabled,
            timerValue: $('.input-minuty').val(),
            adVocemValue: $('.input-minuty-advocem').val(),
            teza: $('.input-teza').val(),
            logo1: $('.img-grid .img1').attr('src') || null,
            logo2: $('.img-grid .img2').attr('src') || null
        };
    }

    function applyState(state) {
        applyingState = true;

        // Format first — applyFormat internally calls reset
        if (state.currentFormat !== undefined && state.currentFormat !== currentFormat) {
            currentFormat = state.currentFormat;
            $('[name="debateFormat"][value="' + currentFormat + '"]').prop('checked', true);
            applyFormat();
        }

        // Input values
        if (state.timerValue) $('.input-minuty').val(state.timerValue);
        if (state.adVocemValue) { $('.input-minuty-advocem').val(state.adVocemValue); loadAdVocemFromInput(); }
        if (state.teza !== undefined) { $('.input-teza').val(state.teza); $('#teza').text(state.teza); }

        // Checkboxes
        if (state.showControls !== undefined) {
            showControls = state.showControls;
            $('#customCheck1').prop('checked', showControls);
            $('.timer-controls:not(.joker-controls)').toggle(showControls);
        }
        if (state.soundEnabled !== undefined) {
            soundEnabled = state.soundEnabled;
            $('#customCheck2').prop('checked', soundEnabled);
        }
        if (state.jokerEnabled !== undefined) {
            jokerEnabled = state.jokerEnabled;
            $('#jokerCheck').prop('checked', jokerEnabled);
            if (currentFormat === 'oxford') $('.oxford-joker').toggle(jokerEnabled);
        }

        // Logos
        if (state.logo1 !== undefined) setImage(state.logo1, 1);
        if (state.logo2 !== undefined) setImage(state.logo2, 2);

        // Timer
        if (state.timerRunning !== undefined || state.minutes !== undefined) {
            clearInterval(timerInterval);
            timerRunning = false;
            bpOvertimeRunning = state.bpOvertimeRunning || false;
            bpOvertimeSecs = state.bpOvertimeSecs !== undefined ? state.bpOvertimeSecs : bpOvertimeSecs;
            bpOvertimeStartedAt = state.bpOvertimeStartedAt;
            $('.timer').removeClass('bp-overtime');
            if (bpOvertimeRunning) $('.timer').addClass('bp-overtime');
            if (state.minutes !== undefined) { minutes = state.minutes; seconds = state.seconds || 0; renderTimer(); }
            if (state.timerRunning) {
                timerStartedAt = state.timerStartedAt;
                timerStartSeconds = state.timerStartSeconds;
                lastTimerSecond = -1;
                timerInterval = setInterval(timerTick, 250);
                timerRunning = true;
                $('.start-stop').text('Stop');
            } else {
                $('.start-stop').text('Start');
            }
        }

        // Joker
        if (state.jokerRunning !== undefined) {
            clearInterval(jokerInterval);
            jokerRunning = false;
            if (state.jokerRunning) {
                jokerStartedAt = state.jokerStartedAt;
                jokerStartSeconds = state.jokerStartSeconds;
                jokerSeconds = state.jokerSeconds;
                lastJokerSecond = -1;
                renderJoker();
                $('.joker-timer').show();
                if (showControls) $('.joker-controls').show();
                jokerInterval = setInterval(jokerTick, 250);
                jokerRunning = true;
            } else {
                jokerSeconds = state.jokerSeconds !== undefined ? state.jokerSeconds : jokerSeconds;
                $('.joker-timer').hide();
                $('.joker-controls').hide();
            }
        }

        applyingState = false;
    }

    // Overwrite placeholder — session sync is now active
    onStateChange = function(delta) {
        if (applyingState) return;
        if (isSlaveSession) {
            if (!slaveModeReadonly && masterConn) {
                try { masterConn.send({type: 'settings', state: delta}); } catch(e) {}
            }
        } else if (sessionPeer && sessionConnections.length > 0) {
            sessionConnections.forEach(function(c) {
                try { c.conn.send({type: 'state', state: delta}); } catch(e) {}
            });
        }
    };

    $('.session-create-btn').click(function() {
        if (sessionPeer) return;
        var $btn = $(this);
        $btn.text('Łączenie…').prop('disabled', true);
        sessionPeer = new Peer();
        sessionPeer.on('open', function(id) {
            var base = window.location.href.split('?')[0];
            $('.session-link-full').val(base + '?s=' + btoa(id + ':full'));
            $('.session-link-readonly').val(base + '?s=' + btoa(id + ':readonly'));
            $('.session-links').show();
            $btn.text('Sesja aktywna');
        });
        sessionPeer.on('connection', function(conn) {
            conn.on('open', function() {
                sessionConnections.push({conn: conn, mode: (conn.metadata && conn.metadata.mode) || 'readonly'});
                conn.send({type: 'init', state: getFullState()});
                showAlert('Podłączono sesję (' + sessionConnections.length + ' podłączonych)');
            });
            conn.on('data', function(data) {
                if (data.type === 'settings' && conn.metadata && conn.metadata.mode === 'full') {
                    applyState(data.state);
                    // relay the same delta to other connections
                    sessionConnections.forEach(function(c) {
                        if (c.conn !== conn) {
                            try { c.conn.send({type: 'state', state: data.state}); } catch(e) {}
                        }
                    });
                }
            });
            conn.on('close', function() {
                sessionConnections = sessionConnections.filter(function(c) { return c.conn !== conn; });
                showAlert('Odłączono sesję (' + sessionConnections.length + ' podłączonych)');
            });
        });
    });

    $('.session-copy-btn').click(function() {
        var val = $(this).data('target') === 'full'
            ? $('.session-link-full').val()
            : $('.session-link-readonly').val();
        navigator.clipboard.writeText(val);
    });

    // Auto-join if URL contains ?s=BASE64
    (function() {
        var params = new URLSearchParams(window.location.search);
        var s = params.get('s');
        if (!s) return;
        var sid, mode;
        try {
            var decoded = atob(s);
            var idx = decoded.lastIndexOf(':');
            sid = decoded.substring(0, idx);
            mode = decoded.substring(idx + 1);
            if (!sid || (mode !== 'full' && mode !== 'readonly')) return;
        } catch(e) { return; }

        isSlaveSession = true;
        slaveModeReadonly = (mode === 'readonly');
        $('body').addClass('is-slave');
        if (slaveModeReadonly) $('body').addClass('slave-readonly');

        var peer = new Peer();
        peer.on('open', function() {
            masterConn = peer.connect(sid, {metadata: {mode: mode}, reliable: true});
            masterConn.on('data', function(data) {
                if (data.type === 'init' || data.type === 'state') applyState(data.state);
            });
            masterConn.on('close', function() {
                $('.session-lost-alert').fadeIn(50);
            });
        });
        peer.on('disconnected', function() {
            $('.session-lost-alert').fadeIn(50);
        });
    })();

})(jQuery);
