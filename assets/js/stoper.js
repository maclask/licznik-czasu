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
        $('#timer, #settings, #help, #sharing').hide();
        $('#' + section).show();
        var titles = { settings: 'Ustawienia', help: 'Pomoc', timer: '', sharing: 'Udostępnianie' };
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
        if (state.teza !== undefined) { $('.input-teza').val(state.teza); $('#teza').text(state.teza); }

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
        sessionPeer.on('connection', function(conn) {
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
                }
            });
            conn.on('close', function() {
                sessionConnections = sessionConnections.filter(function(c) { return c.conn !== conn; });
                showAlert('Odłączono sesję');
            });
        });
    });

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

    // Auto-join if URL contains ?s=sessionName
    (function() {
        var params = new URLSearchParams(window.location.search);
        var s = (params.get('s') || '').toLowerCase();
        if (!s || !/^[a-z0-9]+$/.test(s)) return;

        isSlaveSession = true;
        $('body').addClass('is-slave');
        $('.timer-controls').hide();

        var slaveUrl = window.location.href;
        $('.slave-session-link-val').val(slaveUrl);
        new QRCode(document.getElementById('slave-qr'), {text: slaveUrl, width: 256, height: 256});

        console.log('[Session] Joining session:', s);
        $('.session-status').text('Łączenie z sesją…').show();

        var peer = new Peer();
        peer.on('open', function(myId) {
            console.log('[Session] Slave peer opened:', myId);
            masterConn = peer.connect(s, {serialization: 'json'});
            masterConn.on('open', function() {
                console.log('[Session] Connected to master!');
                $('.session-status').hide();
                showAlert('Połączono z sesją');
            });
            masterConn.on('data', function(data) {
                if (data.type === 'init' || data.type === 'state') applyState(data.state);
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
