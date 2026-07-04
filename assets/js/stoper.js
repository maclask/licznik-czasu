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
    var isAdVocem = false;
    var bpOvertimeRunning = false;
    var bpOvertimeSecs = 15;  // remaining overtime seconds (updated on pause)
    var bpOvertimeStartedAt;

    // Session sync
    var onStateChange = function(delta) {};  // no-op until session active
    var applyingState = false;              // prevents echo-loop in applyState
    var logoSrcs = [null, null];            // tracks active logo srcs independently of DOM visibility
    var MAX_LOGOS = 6;

    // --- Init ---

    $('[data-toggle="tooltip"]').tooltip({ trigger: 'hover' });
    $('.alert').hide();
    $('.joker-timer').hide();
    $('.joker-controls').hide();
    $('.oxford-joker').hide();
    $('#settings').hide();
    $('#help').hide();
    $('#sharing').hide();
    $('#debata').hide();
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
        // Both #timer and the debate stage share the same clock classes
        $('.timer-minutes').text(minutes);
        $('.timer-seconds').text(seconds < 10 ? '0' + seconds : seconds);
    }

    function renderJoker() {
        var m = Math.floor(jokerSeconds / 60);
        var s = jokerSeconds % 60;
        $('.joker-minutes').text(m);
        $('.joker-seconds').text(s < 10 ? '0' + s : s);
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
                if (!isAdVocem && remaining === 30) playDingSound();
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
        isAdVocem = false;
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
        isAdVocem = true;
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
        if (effectiveShowControls()) $('.joker-controls').show();
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

    function effectiveShowControls() {
        return isSlaveSession ? slaveShowControls : showControls;
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
        logoSrcs[no - 1] = src || null;
        if (!src) {
            $('.img' + no).parent().css('display', 'none');
        } else {
            $('.img' + no).attr('src', src).parent().css('display', 'flex');
        }
        var $slot = $('#logo-slots .logo-slot[data-logo-no="' + no + '"]');
        if (src) {
            $slot.find('.logo-slot-preview').attr('src', src);
            $slot.addClass('logo-slot--active');
        } else {
            $slot.removeClass('logo-slot--active');
            $slot.find('.logo-slot-preview').attr('src', '');
        }
        var activeCount = logoSrcs.filter(function (s) { return s !== null; }).length;
        $('.img-grid').attr('data-count', activeCount);
        if (!applyingState) onStateChange({ logos: logoSrcs.slice() });
    }

    var DROPDOWN_ITEMS_HTML =
        '<a class="dropdown-item" data="ergo.png" href="#">Ergo</a>' +
        '<a class="dropdown-item" data="tld.png" href="#">TLD</a>' +
        '<a class="dropdown-item" data="idp.png" href="#">IDP</a>' +
        '<a class="dropdown-item" data="g5.jpg" href="#">G5</a>' +
        '<a class="dropdown-item" data="WTDO.png" href="#">WTDO</a>' +
        '<a class="dropdown-item" data="mpdo.png" href="#">MPDO</a>' +
        '<a class="dropdown-item" data="PPDO.png" href="#">PPDO</a>' +
        '<a class="dropdown-item" data="ksm.png" href="#">KSM</a>' +
        '<a class="dropdown-item" data="ng.png" href="#">Nowy Głos</a>' +
        '<a class="dropdown-item" data="#" href="#">brak obrazu</a>';

    function createSlotHtml(no) {
        return '<div class="logo-drop-zone logo-slot" data-logo-no="' + no + '">' +
            '<div class="logo-slot-controls">' +
              '<div class="dropdown dropdown' + no + '">' +
                '<button type="button" class="btn btn-secondary btn-sm dropdown-toggle" ' +
                        'id="dropdownMenuButton' + no + '" data-toggle="dropdown" ' +
                        'aria-haspopup="true" aria-expanded="false">Wybierz z listy</button>' +
                '<div class="dropdown-menu" aria-labelledby="dropdownMenuButton' + no + '">' +
                  DROPDOWN_ITEMS_HTML +
                '</div>' +
              '</div>' +
              '<button type="button" class="btn btn-outline-secondary btn-sm logo-file-btn">Wybierz z dysku</button>' +
              '<input type="file" accept="image/*" class="logo-file-input d-none">' +
            '</div>' +
            '<img class="logo-slot-preview" src="" alt="">' +
            '<div class="logo-change-overlay">kliknij by zmienić obraz</div>' +
            '<p class="logo-drop-hint">lub przeciągnij / wklej (Ctrl+V)</p>' +
            '<button type="button" class="logo-remove-btn" title="Usuń logo">&times;</button>' +
          '</div>';
    }

    // --- Navigation ---

    function navigate(section) {
        $('#timer, #settings, #help, #sharing, #debata').hide();
        $('#' + section).show();
        var titles = { settings: 'Ustawienia', help: 'Pomoc', timer: '', sharing: 'Udostępnianie', debata: 'Debata online' };
        $('#section-title').text(titles[section] || '');
    }

    // --- Alert ---

    function showAlert(msg) {
        if (msg) $('.alert-success strong').text(msg);
        else $('.alert-success strong').text('Zrobiono!');
        $('.alert-success').fadeIn(50);
        setTimeout(function () { $('.alert-success').fadeOut(); }, 5000);
    }

    function showWarn(msg) {
        $('.toast-warn').text(msg).fadeIn(50);
        setTimeout(function() { $('.toast-warn').fadeOut(); }, 3000);
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

    // --- Time input mask (MM:SS) ---

    function applyTimeMask(input) {
        $(input).on('input', function() {
            var raw = $(this).val().replace(/\D/g, '').slice(0, 4);
            if (raw.length >= 3) {
                $(this).val(raw.slice(0, 2) + ':' + raw.slice(2));
            } else {
                $(this).val(raw);
            }
        });
        $(input).on('blur', function() {
            var parts = $(this).val().split(':');
            var mm = Math.min(parseInt(parts[0], 10) || 0, 99);
            var ss = Math.min(parseInt(parts[1], 10) || 0, 59);
            $(this).val((mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss);
            $(this).trigger('change');
        });
        $(input).on('keydown', function(e) {
            if (e.key === 'Enter') $(this).blur();
        });
    }

    applyTimeMask('.input-minuty');
    applyTimeMask('.input-minuty-advocem');

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
        $('.teza-text').text($(this).val());
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

    $(document).on('click', '.dropdown-item', function () {
        var no = parseInt($(this).closest('.logo-drop-zone').data('logo-no'));
        var imgName = $(this).attr('data');
        setImage(imgName === '#' ? null : 'img/' + imgName, no);
    });

    $(document).on('click', '.logo-file-btn', function () {
        $(this).next('.logo-file-input').trigger('click');
    });

    $(document).on('change', '.logo-file-input', function () {
        var no = parseInt($(this).closest('.logo-drop-zone').data('logo-no'));
        var file = this.files[0];
        if (file && file.type.startsWith('image/')) {
            var reader = new FileReader();
            reader.onload = function (evt) { setImage(evt.target.result, no); };
            reader.readAsDataURL(file);
            this.value = '';
        }
    });

    $('#logo-add-card').click(function () {
        var nextNo = logoSrcs.length + 1;
        if (nextNo > MAX_LOGOS) return;
        logoSrcs.push(null);
        $(createSlotHtml(nextNo)).insertBefore(this);
        if (logoSrcs.length >= MAX_LOGOS) $(this).hide();
    });

    $(document).on('click', '.logo-change-overlay', function () {
        var no = parseInt($(this).closest('.logo-drop-zone').data('logo-no'));
        setImage(null, no);
    });

    $(document).on('click', '.logo-remove-btn', function () {
        var $slot = $(this).closest('.logo-drop-zone');
        var no = parseInt($slot.data('logo-no'));
        $slot.remove();
        logoSrcs.splice(no - 1, 1);
        // Re-index remaining slots in settings
        $('#logo-slots .logo-slot').each(function (i) {
            var newNo = i + 1;
            $(this).attr('data-logo-no', newNo).data('logo-no', newNo);
            $(this).find('.dropdown').removeClass(function (idx, cls) {
                return (cls.match(/\bdropdown\d+\b/) || []).join(' ');
            }).addClass('dropdown' + newNo);
            $(this).find('[id^="dropdownMenuButton"]').attr('id', 'dropdownMenuButton' + newNo);
            $(this).find('[aria-labelledby^="dropdownMenuButton"]').attr('aria-labelledby', 'dropdownMenuButton' + newNo);
        });
        // Refresh all timer images to match shifted array
        for (var i = 1; i <= MAX_LOGOS; i++) {
            var src = logoSrcs[i - 1] || null;
            if (!src) {
                $('.img' + i).parent().css('display', 'none');
            } else {
                $('.img' + i).attr('src', src).parent().css('display', 'flex');
            }
        }
        $('#logo-add-card').show();
        if (!applyingState) onStateChange({ logos: logoSrcs.slice() });
    });

    var pasteTargetNo = 1;
    $(document).on('mouseenter', '.logo-drop-zone', function () {
        pasteTargetNo = parseInt($(this).data('logo-no'));
    });

    $(document).on('paste', function (e) {
        if (!$('#settings').is(':visible')) return;
        var items = (e.originalEvent.clipboardData || window.clipboardData || {}).items;
        if (!items) return;
        for (var i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                var file = items[i].getAsFile();
                if (!file) continue;
                var reader = new FileReader();
                (function (no) {
                    reader.onload = function (evt) { setImage(evt.target.result, no); };
                })(pasteTargetNo);
                reader.readAsDataURL(file);
                break;
            }
        }
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
    $('#sharing-link').click(function () { navigate('sharing'); });
    $('#debata-link').click(function () { navigate('debata'); });

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
    var sessionConnections = [];
    var masterConn = null;
    var isSlaveSession = false;
    var slaveShowControls = false;
    var SESSION_WORDS = [
        'lew','lis','kot','pies','mysz','kura','owca','koza','krowa','wilk',
        'dzik','bocian','wrona','sowa','kret','borsuk','byk','mors','kogut',
        'karp','sum','delfin','pingwin','tygrys','lama','panda','lemur',
        'gepard','pelikan','sroka'
    ];

    // Debate (online) state — media via VDO.Ninja, app state via the PeerJS layer above
    var VDO_BASE = 'https://vdo.ninja/';
    var debateSessionId = null;   // == PeerJS session id; VDO room is 'licznik' + this
    var isDebateMaster = false;
    var debateRoster = [];        // master-side: [{peerId, name, role, side, signal, audioAllowed}]
    var debatePendingJoin = null; // participant: {name, role} queued until masterConn opens
    var debateIframe = null;      // the live VDO.Ninja <iframe> element (for postMessage)
    var myDebateRole = null;      // participant's own role: sedzia|debatant|publika|master
    var myDebateName = '';        // participant's own display name
    var micOn = true, camOn = true; // participant's own local media state (VDO gives no readback)

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
            slaveShowControls: slaveShowControls,
            soundEnabled: soundEnabled,
            jokerEnabled: jokerEnabled,
            timerValue: $('.input-minuty').val(),
            adVocemValue: $('.input-minuty-advocem').val(),
            teza: $('.input-teza').val(),
            logos: logoSrcs.slice()
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
        if (state.teza !== undefined) { $('.input-teza').val(state.teza); $('.teza-text').text(state.teza); }

        // Checkboxes
        if (state.showControls !== undefined) {
            showControls = state.showControls;
            if (!isSlaveSession) {
                $('#customCheck1').prop('checked', showControls);
                $('.timer-controls:not(.joker-controls)').toggle(showControls);
            }
        }
        if (state.slaveShowControls !== undefined) {
            slaveShowControls = state.slaveShowControls;
            if (isSlaveSession) {
                $('.timer-controls:not(.joker-controls)').toggle(slaveShowControls);
                if (jokerRunning) $('.joker-controls').toggle(slaveShowControls);
            }
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
        if (state.logos !== undefined) {
            while (logoSrcs.length < state.logos.length && logoSrcs.length < MAX_LOGOS) {
                logoSrcs.push(null);
                $('#logo-add-card').before(createSlotHtml(logoSrcs.length));
            }
            if (logoSrcs.length >= MAX_LOGOS) $('#logo-add-card').hide();
            state.logos.forEach(function (src, i) { setImage(src, i + 1); });
        }
        // Backward compat for old session peers
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
                if (effectiveShowControls()) $('.joker-controls').show();
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

    onStateChange = function(delta) {
        if (applyingState) return;
        if (isSlaveSession) {
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
        if (invalid && !wasInvalid) showWarn('Dozwolone tylko litery a–z, A–Z i cyfry');
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
            conn.send({type: 'init', state: getFullState()});
            showAlert('Podłączono sesję');
        });
        conn.on('data', function(data) {
            if (data.type === 'settings') {
                applyState(data.state);
                sessionConnections.forEach(function(c) {
                    if (c.conn !== conn) {
                        try { c.conn.send({type: 'state', state: data.state}); } catch(e) {}
                    }
                });
            } else if (data.type === 'join') {
                addRosterEntry(conn.peer, data.name, data.role);
            } else if (data.type === 'chat') {
                var ce = debateRoster.filter(function(e) { return e.peerId === conn.peer; })[0];
                broadcastChat(ce ? ce.name : 'Uczestnik', data.msg);
            } else if (data.type === 'signal') {
                var se = debateRoster.filter(function(e) { return e.peerId === conn.peer; })[0];
                if (se) {
                    se.signal = data.kind;
                    renderRoster();
                    showAlert((se.name || 'Uczestnik') + (data.kind === 'advocem' ? ': ad vocem' : ': podnosi rękę'));
                }
            }
        });
        conn.on('close', function() {
            sessionConnections = sessionConnections.filter(function(c) { return c.conn !== conn; });
            removeRosterEntry(conn.peer);
            showAlert('Odłączono sesję');
        });
    }

    $('.session-copy-btn').click(function() {
        navigator.clipboard.writeText($('.session-link-val').val());
    });

    $('.slave-controls-checkbox').change(function() {
        slaveShowControls = this.checked;
        onStateChange({slaveShowControls: slaveShowControls});
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
        if (invalid && !wasInvalid) showWarn('Dozwolone tylko litery a–z, A–Z i cyfry');
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

    function vdoRoom() { return 'licznik' + debateSessionId; }

    // Strip VDO.Ninja's own UI so the iframe is a bare video tile — all controls
    // (camera/mic pick, mute, chat) move to the licznik UI in Faza 2 via postMessage.
    var VDO_CLEAN = '&cleanoutput&hidemenu&nocursor';

    function buildVdoUrl(role, name) {
        var room = encodeURIComponent(vdoRoom());
        // Master + publika only watch the mixed scene (no camera/mic prompt, auto-scales
        // with the number of active publishers). Publika audio-on-request comes in Faza 2.
        if (role === 'master' || role === 'publika') return VDO_BASE + '?room=' + room + '&scene' + VDO_CLEAN;
        // Debatant + sędzia publish camera + microphone as room members
        return VDO_BASE + '?room=' + room + '&label=' + encodeURIComponent(name) + VDO_CLEAN + '&autostart';
    }

    function isPublisherRole(role) { return role === 'debatant' || role === 'sedzia'; }

    function embedVdo(url) {
        var allow = 'camera; microphone; autoplay; fullscreen; display-capture; picture-in-picture';
        $('.debata-video').html(
            '<iframe class="vdo-iframe" allow="' + allow + '" src="' + url + '"></iframe>'
        );
        debateIframe = $('.debata-video iframe').get(0);
        if (debateIframe) {
            debateIframe.onload = function() {
                // Ask VDO for the device list so we can drive camera/mic pickers from our UI
                if (isPublisherRole(myDebateRole)) {
                    postToVdo({ getDeviceList: true });
                    setTimeout(function() { postToVdo({ getDeviceList: true }); }, 3000);
                }
            };
        }
    }

    function postToVdo(obj) {
        if (debateIframe && debateIframe.contentWindow) {
            try { debateIframe.contentWindow.postMessage(obj, '*'); } catch (e) {}
        }
    }

    function setMicBtn(on) {
        micOn = on;
        $('.debate-mic-btn').text(on ? 'Wycisz mikrofon' : 'Włącz mikrofon');
    }

    function populateDevices(list) {
        // VDO.Ninja's deviceList shape varies; accept a flat array or a grouped object
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
        fillDeviceSelect($('.debate-cam-select'), cams, 'Kamera');
        fillDeviceSelect($('.debate-mic-select'), mics, 'Mikrofon');
    }

    function fillDeviceSelect($sel, devices, fallback) {
        if (!devices || devices.length < 2) { $sel.hide(); return; }
        $sel.empty();
        devices.forEach(function (d, i) {
            $('<option></option>').val(i + 1).text(d.label || (fallback + ' ' + (i + 1))).appendTo($sel);
        });
        $sel.show();
    }

    function appendChat(name, msg) {
        var $log = $('.debate-chat-log');
        if (!$log.length) return;
        var $m = $('<div class="chat-msg"></div>');
        $m.append($('<b></b>').text(name + ': '));
        $m.append(document.createTextNode(msg));
        $log.append($m);
        $log.scrollTop($log.prop('scrollHeight'));
    }

    function broadcastChat(name, msg) {
        appendChat(name, msg);
        sessionConnections.forEach(function (c) {
            try { c.conn.send({ type: 'chat', name: name, msg: msg }); } catch (e) {}
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
            showWarn('Prowadzący wyciszył Twój mikrofon');
        } else if (data.action === 'close') {
            window.alert('Prowadzący zamknął pokój debaty');
            window.location.replace(window.location.origin + window.location.pathname);
        } else if (data.action === 'allowAudio') {
            embedVdo(VDO_BASE + '?room=' + encodeURIComponent(vdoRoom()) +
                '&label=' + encodeURIComponent(myDebateName) + '&novideo' + VDO_CLEAN + '&autostart');
            $('body').addClass('publika-audio');
            setMicBtn(true);
            showAlert('Prowadzący pozwolił Ci mówić');
        } else if (data.action === 'revokeAudio') {
            embedVdo(buildVdoUrl('publika', myDebateName));
            $('body').removeClass('publika-audio');
            showWarn('Prowadzący odebrał Ci głos');
        }
    }

    function roleLabel(role) {
        return role === 'sedzia' ? 'Sędzia' : role === 'publika' ? 'Publika' : 'Debatant';
    }

    function addRosterEntry(peerId, name, role) {
        debateRoster = debateRoster.filter(function(e) { return e.peerId !== peerId; });
        debateRoster.push({ peerId: peerId, name: name, role: role, side: null });
        renderRoster();
    }

    function removeRosterEntry(peerId) {
        debateRoster = debateRoster.filter(function(e) { return e.peerId !== peerId; });
        renderRoster();
    }

    function renderRoster() {
        var $r = $('.debate-roster');
        if (!$r.length) return;
        $r.empty();
        if (!debateRoster.length) {
            $r.append('<p class="text-muted mb-0">Brak uczestników</p>');
            return;
        }
        debateRoster.forEach(function(e) {
            var $row = $('<div class="roster-row"></div>');
            $row.append($('<span class="roster-name"></span>').text(e.name));
            $row.append($('<span class="roster-role"></span>').text(roleLabel(e.role)));
            if (e.signal) {
                $('<button type="button" class="btn btn-sm roster-signal"></button>')
                    .attr('data-peer', e.peerId)
                    .text(e.signal === 'advocem' ? 'AD VOCEM' : '✋ ręka')
                    .appendTo($row);
            }
            if (e.role === 'debatant') {
                var $sel = $(
                    '<select class="form-control form-control-sm roster-side">' +
                        '<option value="">— strona —</option>' +
                        '<option value="proposition">Propozycja</option>' +
                        '<option value="opposition">Opozycja</option>' +
                    '</select>'
                );
                $sel.attr('data-peer', e.peerId).val(e.side || '');
                $row.append($sel);
            }
            if (isDebateMaster) {
                $('<button type="button" class="btn btn-outline-secondary btn-sm roster-mute">Wycisz</button>')
                    .attr('data-peer', e.peerId).appendTo($row);
                if (e.role === 'publika') {
                    $('<button type="button" class="btn btn-outline-secondary btn-sm roster-allow"></button>')
                        .attr('data-peer', e.peerId)
                        .text(e.audioAllowed ? 'Odbierz głos' : 'Pozwól mówić')
                        .appendTo($row);
                }
            }
            $r.append($row);
        });
    }

    $(document).on('change', '.roster-side', function() {
        var peerId = String($(this).data('peer'));
        var val = $(this).val() || null;
        debateRoster.forEach(function(e) { if (e.peerId === peerId) e.side = val; });
    });

    $(document).on('click', '.roster-mute', function() {
        sendToPeer(String($(this).data('peer')), { type: 'cmd', action: 'mute' });
        showAlert('Wyciszono uczestnika');
    });

    $(document).on('click', '.roster-allow', function() {
        var peerId = String($(this).data('peer'));
        var e = debateRoster.filter(function(x) { return x.peerId === peerId; })[0];
        if (!e) return;
        e.audioAllowed = !e.audioAllowed;
        sendToPeer(peerId, { type: 'cmd', action: e.audioAllowed ? 'allowAudio' : 'revokeAudio' });
        renderRoster();
    });

    $(document).on('click', '.roster-signal', function() {
        var peerId = String($(this).data('peer'));
        debateRoster.forEach(function(e) { if (e.peerId === peerId) e.signal = null; });
        renderRoster();
    });

    // Master: create a debate room
    $('.debate-name-input').on('input', function() {
        $(this).val($(this).val().toLowerCase());
        var val = $(this).val();
        var wasInvalid = $(this).hasClass('is-invalid');
        var invalid = val.length > 0 && !/^[a-zA-Z0-9]+$/.test(val);
        $(this).toggleClass('is-invalid', invalid);
        if (invalid && !wasInvalid) showWarn('Dozwolone tylko litery a–z, A–Z i cyfry');
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
            myDebateRole = 'master';
            myDebateName = 'Prowadzący';
            $('body').addClass('is-debate-master');
            var link = window.location.origin + window.location.pathname + '?s=' + id + '&d=1';
            $('.debate-link-val').val(link);
            $('.debate-links').show();
            $('#debate-qr').empty();
            new QRCode(document.getElementById('debate-qr'), {text: link, width: 128, height: 128});
            embedVdo(buildVdoUrl('master'));
            $('.debate-stage').show();
            $('.debate-roster-wrap').show();
            renderRoster();
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

    // Participant: submit name + role, then join VDO room and announce to master
    $('.debate-join-btn').click(function() {
        var name = $('.debate-join-name').val().trim();
        var role = $('.debate-join-role').val();
        if (!name) { $('.debate-join-error').text('Podaj imię').show(); return; }
        $('.debate-join-error').hide();

        myDebateRole = role;
        myDebateName = name;
        $('body').addClass('role-' + role);
        setMicBtn(true);
        embedVdo(buildVdoUrl(role, name));
        $('.debate-join').hide();
        $('.debate-stage').show();

        if (masterConn && masterConn.open) {
            try { masterConn.send({type: 'join', name: name, role: role}); } catch(e) {}
        } else {
            debatePendingJoin = {name: name, role: role};
        }
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

    // Debater signals to the master
    function sendSignal(kind) {
        if (masterConn && masterConn.open) {
            try { masterConn.send({ type: 'signal', kind: kind }); } catch (e) {}
            showAlert(kind === 'advocem' ? 'Zgłoszono ad vocem' : 'Podniesiono rękę');
        }
    }
    $('.debate-hand-btn').click(function() { sendSignal('hand'); });
    $('.debate-advocem-btn').click(function() { sendSignal('advocem'); });

    // Master room controls
    $('.debate-muteall-btn').click(function() {
        sessionConnections.forEach(function(c) {
            try { c.conn.send({ type: 'cmd', action: 'mute' }); } catch (e) {}
        });
        showAlert('Wyciszono wszystkich');
    });

    $('.debate-close-btn').click(function() {
        if (!window.confirm('Zamknąć pokój debaty? Wszyscy uczestnicy zostaną rozłączeni.')) return;
        sessionConnections.forEach(function(c) {
            try { c.conn.send({ type: 'cmd', action: 'close' }); } catch (e) {}
        });
        if (sessionPeer) { sessionPeer.destroy(); sessionPeer = null; }
        sessionConnections = [];
        debateRoster = [];
        isDebateMaster = false;
        $('body').removeClass('is-debate-master');
        $('.debata-video').empty();
        debateIframe = null;
        $('.debate-stage').hide();
        $('.debate-roster-wrap').hide();
        $('.debate-links').hide();
        $('.debate-create-btn').text('Utwórz debatę').prop('disabled', false);
        showAlert('Pokój zamknięty');
    });

    // Chat (relayed over the PeerJS mesh so it also reaches scene-only audience)
    function sendChatMessage() {
        var msg = $('.debate-chat-input').val().trim();
        if (!msg) return;
        $('.debate-chat-input').val('');
        if (isDebateMaster) {
            broadcastChat(myDebateName, msg);
        } else if (masterConn && masterConn.open) {
            try { masterConn.send({ type: 'chat', msg: msg }); } catch (e) {}
        }
    }
    $('.debate-chat-send').click(sendChatMessage);
    $('.debate-chat-input').keydown(function(e) {
        if (e.key === 'Enter') { e.preventDefault(); sendChatMessage(); }
    });

    // Receive device list back from our own VDO iframe
    window.addEventListener('message', function(e) {
        if (!debateIframe || e.source !== debateIframe.contentWindow) return;
        var d = e.data;
        if (d && d.deviceList) populateDevices(d.deviceList);
    });

    // Auto-join if URL contains ?s=sessionName (plain viewer or debate participant)
    (function() {
        var params = new URLSearchParams(window.location.search);
        var s = (params.get('s') || '').toLowerCase();
        if (!s || !/^[a-z0-9]+$/.test(s)) return;
        var isDebate = params.get('d') === '1';

        isSlaveSession = true;
        $('body').addClass('is-slave');
        $('.timer-controls').hide();

        if (isDebate) {
            debateSessionId = s;
            $('body').addClass('is-debate');
            navigate('debata');
            $('.debate-setup').hide();
            $('.debate-join').show();
        } else {
            var slaveUrl = window.location.href;
            $('.slave-session-link-val').val(slaveUrl);
            new QRCode(document.getElementById('slave-qr'), {text: slaveUrl, width: 256, height: 256});
        }

        console.log('[Session] Joining session:', s, isDebate ? '(debata)' : '');
        $('.session-status').text('Łączenie z sesją…').show();

        var peer = new Peer();
        peer.on('open', function(myId) {
            console.log('[Session] Slave peer opened:', myId);
            masterConn = peer.connect(s, {serialization: 'json'});
            masterConn.on('open', function() {
                console.log('[Session] Connected to master!');
                $('.session-status').hide();
                if (!isDebate) showAlert('Połączono z sesją');
                if (debatePendingJoin) {
                    try { masterConn.send({type: 'join', name: debatePendingJoin.name, role: debatePendingJoin.role}); } catch(e) {}
                    debatePendingJoin = null;
                }
            });
            masterConn.on('data', function(data) {
                if (data.type === 'init' || data.type === 'state') applyState(data.state);
                else if (data.type === 'chat') appendChat(data.name, data.msg);
                else if (data.type === 'cmd') handleDebateCmd(data);
            });
            masterConn.on('close', function() {
                $('.session-lost-alert').fadeIn(50);
            });
            masterConn.on('error', function(err) {
                console.error('[Session] Conn error:', err);
                $('.session-status').text('Błąd połączenia: ' + err.type).show();
            });
        });
        peer.on('error', function(err) {
            console.error('[Session] Peer error:', err.type);
            $('.session-status').text('Błąd: ' + err.type).show();
        });
    })();

})(jQuery);
