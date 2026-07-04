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
    var isPrepTime = false;  // master-set prep countdown — no format bells, no BP overtime
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

            if (currentFormat === 'bp' && !isPrepTime) {
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

        // Format-specific bells — skipped during prep time (it isn't a protected speech)
        if (soundEnabled && !isPrepTime) {
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
        isPrepTime = false;
        $('.timer').removeClass('bp-overtime');
        $('body').removeClass('is-prep-time');
        $('.debate-prep-btn').removeClass('active').text('Czas przygotowania');
        $('.start-stop').text('Start');
        loadTimeFromInput();
        onStateChange({timerRunning: false, bpOvertimeRunning: false, bpOvertimeSecs: 15, isPrepTime: false, minutes: minutes, seconds: seconds, timerValue: $('.input-minuty').val()});
    }

    // Master: switch the shared clock to a plain prep-time countdown (default 15:00) —
    // no protected-time bells, no BP overtime. Resetting (or picking a format) returns
    // to the normal, configured speech time.
    function startPrepTime() {
        var parts = $('.input-prep-time').val().split(':');
        var m = Math.min(parseInt(parts[0], 10) || 0, 99);
        var s = Math.min(parseInt(parts[1], 10) || 0, 59);
        clearInterval(timerInterval);
        timerRunning = false;
        bpOvertimeRunning = false;
        bpOvertimeSecs = 15;
        bpBell1Rung = false;
        bpBell2Rung = false;
        isAdVocem = false;
        isPrepTime = true;
        minutes = m; seconds = s;
        $('.timer').removeClass('bp-overtime');
        $('body').addClass('is-prep-time');
        $('.start-stop').text('Start');
        renderTimer();
        onStateChange({ timerRunning: false, bpOvertimeRunning: false, bpOvertimeSecs: 15, isPrepTime: true, minutes: minutes, seconds: seconds });
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
    applyTimeMask('.input-prep-time');

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

    // Style theme switcher
    $('#style-select').change(function () {
        var theme = $(this).val();
        if (theme === 'glassmorphic') {
            $('body').addClass('glassmorphic');
        } else {
            $('body').removeClass('glassmorphic');
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
    var debateRoster = [];        // [{peerId, name, zone, index, signal, speaking}]
    var debatePendingJoin = null; // participant: {name} queued until masterConn opens
    var debateIframe = null;      // the live VDO.Ninja <iframe> element (for postMessage)
    var previewIframe = null;     // the join-screen preview <iframe> (separate instance, own postMessage channel)
    var joinCamDeviceIndex = null, joinMicDeviceIndex = null; // device picked on the join screen, carried into the live room
    var myPeerId = null;          // this browser's id in the roster ('__master__' for host)
    var myDebateName = '';        // this browser's own display name
    var myEmbedMode = null;       // 'publish' | 'view' — current VDO iframe mode
    var mySignal = null;          // 'hand' | 'advocem' | null (this browser's raised signal)
    var debateAllowControls = false; // master let positioned participants run the clock
    var debateEditMode = false;   // master: drag & drop seat re-assignment
    var micOn = true, camOn = true;  // this browser's local media state (VDO gives no readback)
    var streamNames = {};         // master: VDO streamID -> label, for the speaking indicator
    var MASTER_ID = '__master__';
    var ZONE_SLOTS = { proposition: 4, opposition: 4, judges: 3 };

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
            isPrepTime: isPrepTime,
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

        if (state.isPrepTime !== undefined) {
            isPrepTime = state.isPrepTime;
            $('body').toggleClass('is-prep-time', isPrepTime);
            $('.debate-prep-btn').toggleClass('active', isPrepTime)
                .text(isPrepTime ? 'Zakończ czas przygotowania' : 'Czas przygotowania');
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
                addRosterEntry(conn.peer, data.name);
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
    // (camera/mic pick, mute, chat) live in the licznik UI via postMessage.
    // &transparent lets the .debata-video container control the background colour.
    var VDO_CLEAN = '&cleanoutput&hidemenu&transparent';
    // Show only whoever is actually talking, hiding silent-but-published guests.
    var VDO_SPEAKER = '&activespeaker&activespeakerdelay=1500';

    // A stable, predictable VDO.Ninja stream id per participant (instead of a random one)
    // so the director can target a specific person with &push/&forward regardless of when
    // they joined.
    function pushIdFor(peerId) { return String(peerId).replace(/[^a-zA-Z0-9]/g, '_').slice(0, 64); }

    function breakoutRoomId(zone) {
        var suffix = zone === 'proposition' ? 'propozycja' : zone === 'opposition' ? 'opozycja' : 'sedziowie';
        return vdoRoom() + '-bo-' + suffix;
    }

    function buildVdoUrl(mode, name, peerId) {
        var room = encodeURIComponent(vdoRoom());
        // Publishers (people who took a debater/judge slot) send camera + mic.
        // &webcam picks "Join Room with Camera" and &autostart skips the entry screen
        // (without them, cleanoutput hides the menu and getUserMedia never fires).
        if (mode === 'publish') {
            return VDO_BASE + '?room=' + room + '&label=' + encodeURIComponent(name || '') +
                '&push=' + encodeURIComponent(pushIdFor(peerId)) +
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
        $('.debata-video').html(
            '<iframe class="vdo-iframe" allow="' + allow + '" src="' + url + '"></iframe>'
        );
        debateIframe = $('.debata-video iframe').get(0);
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
            showWarn('Prowadzący wyciszył Twój mikrofon');
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

    function addRosterEntry(peerId, name) {
        debateRoster = debateRoster.filter(function(e) { return e.peerId !== peerId; });
        debateRoster.push({ peerId: peerId, name: name, zone: 'audience', index: -1, signal: null, speaking: false, breakout: false });
        renderDebate();
    }

    function removeRosterEntry(peerId) {
        debateRoster = debateRoster.filter(function(e) { return e.peerId !== peerId; });
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
        postToFrame(directorIframe, { action: 'forward', target: pushIdFor(entry.peerId), value: dest });
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
        if (kind) showAlert((e.name || 'Uczestnik') + (kind === 'advocem' ? ': ad vocem' : ': podnosi rękę'));
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

    // Master broadcasts a slim roster so every participant renders the same zones
    function broadcastRoster() {
        var slim = debateRoster.map(function(e) {
            return { peerId: e.peerId, name: e.name, zone: e.zone, index: e.index, signal: e.signal, speaking: e.speaking, breakout: !!e.breakout };
        });
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
        showAlert('Wyciszono uczestnika');
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
            embedVdo(buildVdoUrl(mode, myDebateName, myPeerId));
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
            myPeerId = MASTER_ID;
            myDebateName = $('.debate-master-name-input').val().trim() || 'Prowadzący';
            debateRoster = [{ peerId: MASTER_ID, name: myDebateName, zone: 'audience', index: -1, signal: null, speaking: false, breakout: false }];
            embedDirector();
            $('body').addClass('is-debate-master');
            var link = window.location.origin + window.location.pathname + '?s=' + id + '&d=1';
            $('.debate-link-val').val(link);
            $('.debate-links').show();
            $('#debate-qr').empty();
            new QRCode(document.getElementById('debate-qr'), {text: link, width: 128, height: 128});
            $('.debate-empty').hide();
            $('.debate-stage').show();
            $('.debate-roster-wrap').show();
            $('.debate-created-hint').show();
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

        if (masterConn && masterConn.open) {
            try { masterConn.send({type: 'join', name: name}); } catch(e) {}
        } else {
            debatePendingJoin = {name: name};
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
        if (isPrepTime) {
            reset();
        } else {
            startPrepTime();
            $(this).addClass('active').text('Zakończ czas przygotowania');
        }
    });

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
        myPeerId = null;
        myEmbedMode = null;
        streamNames = {};
        $('body').removeClass('is-debate-master is-publishing');
        $('.debata-video').empty();
        debateIframe = null;
        removeDirector();
        $('.debate-stage').hide();
        $('.debate-roster-wrap').hide();
        $('.debate-empty').show();
        $('.debate-links').hide();
        $('.debate-created-hint').hide();
        $('.debate-create-btn').text('Utwórz debatę').prop('disabled', false);
        showAlert('Pokój zamknięty');
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
            $('.debate-empty').hide();
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
            myPeerId = myId;
            masterConn = peer.connect(s, {serialization: 'json'});
            masterConn.on('open', function() {
                console.log('[Session] Connected to master!');
                $('.session-status').hide();
                if (!isDebate) showAlert('Połączono z sesją');
                if (debatePendingJoin) {
                    try { masterConn.send({type: 'join', name: debatePendingJoin.name}); } catch(e) {}
                    debatePendingJoin = null;
                }
            });
            masterConn.on('data', function(data) {
                if (data.type === 'init' || data.type === 'state') applyState(data.state);
                else if (data.type === 'chat') appendChat(data.name, data.msg, data.channel);
                else if (data.type === 'cmd') handleDebateCmd(data);
                else if (data.type === 'roster') { debateRoster = data.roster || []; renderZones(); updateMyEmbed(); }
                else if (data.type === 'speaking') {
                    debateRoster.forEach(function(e) { e.speaking = data.names.indexOf(e.name) !== -1; });
                    renderZones();
                }
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
