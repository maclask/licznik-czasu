(function ($, App) {
    var showControls = true;
    var soundEnabled = true;
    var currentFormat = 'oxford'; // 'oxford' | 'bp'
    var jokerEnabled = false;

    var JOKER_SECONDS = 30;
    var OVERTIME_SECONDS = 15;   // BP: automatic overtime after the speech ends

    // Whole clock state is a single "seconds remaining" value; MM:SS is derived only
    // at render/sync boundaries (see renderTimer / curMin / curSec).
    var displaySeconds = 0;      // what the main timer currently shows
    var adVocemTotal = 0;        // seconds loaded from the ad-vocem input

    // Format/mode flags
    var bpBell1Rung = false;     // BP bell 1: 1 min after start
    var bpBell2Rung = false;     // BP bell 2: 1 min before end
    var isAdVocem = false;
    var isPrepTime = false;      // master-set prep countdown — no format bells, no BP overtime
    var inOvertime = false;      // BP overtime phase active (running or paused)

    // Session sync — the hook and the echo-guard flag live on App (see app.js),
    // so the online layer (online.js) can share them across the file boundary.
    var logoSrcs = [null, null]; // tracks active logo srcs independently of DOM visibility
    var MAX_LOGOS = 6;

    // --- Countdown engine (one machine, three instances: timer, overtime, joker) ---

    // A drift-free countdown anchored to Date.now(): the remaining time is always
    // derived from wall-clock elapsed since the last (re)start, never from a tick
    // count, so it survives a throttled/slept tab. callbacks.onSecond(remaining) fires
    // at most once per whole second; callbacks.onEnd() fires when it reaches zero.
    function makeCountdown(callbacks) {
        var startedAt = 0, startSeconds = 0, lastSecond = -1, frozen = 0;
        var running = false, interval = null;

        function tick() {
            var rem = startSeconds - Math.floor((Date.now() - startedAt) / 1000);
            if (rem <= 0) {
                frozen = 0;
                clearInterval(interval);
                running = false;
                callbacks.onEnd();
                return;
            }
            if (rem === lastSecond) return;   // same whole second — nothing to redraw
            lastSecond = rem;
            frozen = rem;
            callbacks.onSecond(rem);
        }

        var api = {
            // Start fresh from `seconds`, anchored at now.
            start: function (seconds) {
                startedAt = Date.now();
                startSeconds = seconds;
                frozen = seconds;
                lastSecond = seconds;
                clearInterval(interval);
                interval = setInterval(tick, 250);
                running = true;
            },
            // Resume a paused countdown from its frozen remaining.
            resume: function () { api.start(frozen); },
            // Freeze the current remaining and stop ticking.
            pause: function () {
                if (!running) return;
                clearInterval(interval);
                running = false;
                frozen = Math.max(0, startSeconds - Math.floor((Date.now() - startedAt) / 1000));
            },
            // Hard stop, keeping the frozen value as-is.
            stop: function () { clearInterval(interval); running = false; },
            // Adopt a peer's anchors (sync): pick up a running countdown mid-flight.
            adopt: function (startedAtVal, startSecondsVal) {
                startedAt = startedAtVal;
                startSeconds = startSecondsVal;
                lastSecond = -1;
                frozen = Math.max(0, startSeconds - Math.floor((Date.now() - startedAt) / 1000));
                clearInterval(interval);
                interval = setInterval(tick, 250);
                running = true;
            },
            setFrozen: function (v) { frozen = v; },
            remaining: function () { return frozen; },
            startedAt: function () { return startedAt; },
            startSeconds: function () { return startSeconds; },
            isRunning: function () { return running; }
        };
        return api;
    }

    var mainTimer = makeCountdown({ onSecond: onMainSecond, onEnd: onMainEnd });
    var overtime = makeCountdown({ onSecond: onOvertimeSecond, onEnd: onOvertimeEnd });
    var joker = makeCountdown({ onSecond: onJokerSecond, onEnd: onJokerEnd });

    function running() { return mainTimer.isRunning() || overtime.isRunning(); }

    // --- Helpers ---

    function pad2(n) { return n < 10 ? '0' + n : '' + n; }

    // Parse an MM:SS input into total seconds, clamping to a sane 99:59.
    function parseTimeInput(selector) {
        var parts = ($(selector).val() || '').split(':');
        var m = Math.min(parseInt(parts[0], 10) || 0, 99);
        var s = Math.min(parseInt(parts[1], 10) || 0, 59);
        return m * 60 + s;
    }

    function curMin() { return Math.floor(displaySeconds / 60); }
    function curSec() { return displaySeconds % 60; }

    function loadTimeFromInput() {
        displaySeconds = parseTimeInput('.input-minutes');
        renderTimer(displaySeconds);
    }

    function loadAdVocemFromInput() {
        adVocemTotal = parseTimeInput('.input-minutes-advocem');
    }

    function renderTimer(total) {
        displaySeconds = total;
        // Both #timer and the debate stage share the same clock classes
        $('.timer-minutes').text(Math.floor(total / 60));
        $('.timer-seconds').text(pad2(total % 60));
    }

    function renderJoker(total) {
        $('.joker-minutes').text(Math.floor(total / 60));
        $('.joker-seconds').text(pad2(total % 60));
    }

    function popTime() {
        $('.timer').animate({ scale: '93%' }, 'fast');
        $('.timer').animate({ scale: '100%' }, 'fast');
    }

    // Full timer state on the wire — a superset of every field the online layer reads,
    // built in one place so start/stop/sync never disagree about the shape.
    function timerWire() {
        return {
            timerRunning: running(),
            timerStartedAt: mainTimer.startedAt(),
            timerStartSeconds: mainTimer.startSeconds(),
            bpOvertimeRunning: inOvertime,
            bpOvertimeStartedAt: overtime.startedAt(),
            bpOvertimeSecs: overtime.isRunning() ? overtime.startSeconds() : overtime.remaining(),
            minutes: curMin(),
            seconds: curSec()
        };
    }

    // --- Main timer callbacks ---

    function onMainSecond(rem) {
        // Format-specific bells — skipped during prep time (it isn't a protected speech)
        if (soundEnabled && !isPrepTime) {
            if (currentFormat === 'oxford') {
                if (!isAdVocem && rem === 30) playSound('#30stoend');
            } else {
                var startSecs = mainTimer.startSeconds();
                var elapsedSecs = startSecs - rem;
                if (!bpBell1Rung && elapsedSecs >= 60 && startSecs > 60) {
                    bpBell1Rung = true;
                    playSound('#30stoend');
                }
                if (!bpBell2Rung && rem <= 60 && startSecs > 120) {
                    bpBell2Rung = true;
                    playSound('#30stoend');
                }
            }
        }
        renderTimer(rem);
    }

    function onMainEnd() {
        renderTimer(0);
        if (soundEnabled) playSound('#endoftime');
        if (currentFormat === 'bp' && !isPrepTime) {
            // Slide straight into a 15 s overtime. Each client crosses this boundary on
            // its own clock, so no broadcast is needed — a peer's own main timer reaches
            // zero and enters overtime independently.
            inOvertime = true;
            $('.timer').addClass('bp-overtime');
            overtime.start(OVERTIME_SECONDS);
            renderTimer(OVERTIME_SECONDS);
        } else {
            $('.start-stop').text('Start');
        }
    }

    function onOvertimeSecond(rem) { renderTimer(rem); }

    function onOvertimeEnd() {
        renderTimer(0);
        inOvertime = false;
        $('.timer').removeClass('bp-overtime');
        $('.start-stop').text('Start');
    }

    // --- Main timer controls ---

    function startTimer() {
        if (running()) return;
        if (inOvertime) {
            overtime.resume();
        } else {
            bpBell1Rung = false;
            bpBell2Rung = false;
            mainTimer.start(displaySeconds);
        }
        $('.start-stop').text('Stop');
        App.onStateChange(timerWire());
    }

    function stopTimer() {
        if (!running()) return;
        if (inOvertime) { overtime.pause(); renderTimer(overtime.remaining()); }
        else { mainTimer.pause(); renderTimer(mainTimer.remaining()); }
        $('.start-stop').text('Start');
        App.onStateChange(timerWire());
    }

    function toggleTimer() {
        if (running()) stopTimer(); else startTimer();
        popTime();
    }

    // Stop every clock and clear BP overtime — the shared "back to a clean stop" block.
    function hardStop() {
        mainTimer.stop();
        overtime.stop();
        inOvertime = false;
        bpBell1Rung = false;
        bpBell2Rung = false;
        $('.timer').removeClass('bp-overtime');
        $('.start-stop').text('Start');
    }

    function reset() {
        hardStop();
        isAdVocem = false;
        isPrepTime = false;
        $('body').removeClass('is-prep-time');
        $('.debate-prep-btn').removeClass('active').text('Czas przygotowania');
        loadTimeFromInput();
        App.onStateChange({
            timerRunning: false, bpOvertimeRunning: false, bpOvertimeSecs: OVERTIME_SECONDS,
            isPrepTime: false, minutes: curMin(), seconds: curSec(), timerValue: $('.input-minutes').val()
        });
    }

    // Master: switch the shared clock to a plain prep-time countdown (default 15:00) —
    // no protected-time bells, no BP overtime. Resetting (or picking a format) returns
    // to the normal, configured speech time.
    function startPrepTime() {
        hardStop();
        isAdVocem = false;
        isPrepTime = true;
        $('body').addClass('is-prep-time');
        renderTimer(parseTimeInput('.input-prep-time'));
        App.onStateChange({
            timerRunning: false, bpOvertimeRunning: false, bpOvertimeSecs: OVERTIME_SECONDS,
            isPrepTime: true, minutes: curMin(), seconds: curSec()
        });
    }

    function setAdVocem() {
        if (currentFormat !== 'oxford') return;
        hardStop();
        isAdVocem = true;
        renderTimer(adVocemTotal);
        App.onStateChange({ timerRunning: false, minutes: curMin(), seconds: curSec() });
    }

    // --- Format ---

    function applyFormat() {
        if (currentFormat === 'bp') {
            $('.oxford-only').hide();
            $('.oxford-joker').hide();
            $('.oxford-setting').addClass('settings-hidden');
            $('.bp-only').show();
            if ($('.input-minutes').val() === '05:00') $('.input-minutes').val('07:00');
        } else {
            $('.oxford-only').show();
            $('.oxford-joker').toggle(jokerEnabled);
            $('.oxford-setting').removeClass('settings-hidden');
            $('.bp-only').hide();
            if ($('.input-minutes').val() === '07:00') $('.input-minutes').val('05:00');
        }
        reset();
        App.onStateChange({
            currentFormat: currentFormat, timerRunning: false,
            minutes: curMin(), seconds: curSec(), timerValue: $('.input-minutes').val()
        });
    }

    // --- Joker timer callbacks + controls ---

    function onJokerSecond(rem) { renderJoker(rem); }

    function onJokerEnd() {
        renderJoker(0);
        jokerOff();
        if (soundEnabled) playSound('#30stoend');
    }

    function jokerStart() {
        joker.start(JOKER_SECONDS);
        renderJoker(JOKER_SECONDS);
        $('.joker-timer').show();
        if (effectiveShowControls()) $('.joker-controls').show();
        App.onStateChange({
            jokerRunning: true, jokerStartedAt: joker.startedAt(),
            jokerStartSeconds: JOKER_SECONDS, jokerSeconds: JOKER_SECONDS
        });
    }

    function jokerToggle() {
        if (joker.isRunning()) joker.pause(); else joker.resume();
        renderJoker(joker.remaining());
        App.onStateChange({
            jokerRunning: joker.isRunning(), jokerStartedAt: joker.startedAt(),
            jokerStartSeconds: joker.startSeconds(), jokerSeconds: joker.remaining()
        });
    }

    function jokerOff() {
        joker.stop();
        $('.joker-timer').hide();
        $('.joker-controls').hide();
        App.onStateChange({ jokerRunning: false });
    }

    function effectiveShowControls() {
        return App.state.isSlaveSession ? App.state.slaveShowControls : showControls;
    }

    // --- Sound ---

    function playSound(selector) {
        var s = $(selector).get(0);
        if (!s) return;
        s.currentTime = 0;
        s.play();
    }

    function toggleSound() {
        soundEnabled = !soundEnabled;
    }

    // --- Images ---

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
              '<div class="dropdown">' +
                '<button type="button" class="btn btn-secondary btn-sm dropdown-toggle" ' +
                        'data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">Wybierz z listy</button>' +
                '<div class="dropdown-menu">' + DROPDOWN_ITEMS_HTML + '</div>' +
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

    // Rebuild every settings slot from logoSrcs (render-from-state) — add/remove is just
    // a splice + this call, so there is no DOM renumbering to keep in sync.
    function renderLogoSlots() {
        $('#logo-slots .logo-slot').remove();
        logoSrcs.forEach(function (src, i) {
            var $slot = $(createSlotHtml(i + 1));
            if (src) { $slot.addClass('logo-slot--active').find('.logo-slot-preview').attr('src', src); }
            $slot.insertBefore('#logo-add-card');
        });
        $('#logo-add-card').toggle(logoSrcs.length < MAX_LOGOS);
    }

    // Push logoSrcs onto the timer's own image grid.
    function renderTimerLogos() {
        for (var i = 1; i <= MAX_LOGOS; i++) {
            var src = logoSrcs[i - 1] || null;
            var $container = $('.img' + i).parent();
            if (!src) { $container.css('display', 'none'); }
            else { $('.img' + i).attr('src', src); $container.css('display', 'flex'); }
        }
        var activeCount = logoSrcs.filter(function (s) { return s !== null; }).length;
        $('.img-grid').attr('data-count', activeCount);
    }

    function setImage(src, no) {
        logoSrcs[no - 1] = src || null;
        renderTimerLogos();
        var $slot = $('#logo-slots .logo-slot[data-logo-no="' + no + '"]');
        if (src) { $slot.addClass('logo-slot--active').find('.logo-slot-preview').attr('src', src); }
        else { $slot.removeClass('logo-slot--active').find('.logo-slot-preview').attr('src', ''); }
        if (!App.state.applyingState) App.onStateChange({ logos: logoSrcs.slice() });
    }

    // --- Navigation ---

    function navigate(section) {
        $('#timer, #settings, #help, #sharing, #debate').hide();
        $('#' + section).show();
        var titles = { settings: 'Ustawienia', help: 'Pomoc', timer: '', sharing: 'Udostępnianie', debate: 'Debata online' };
        $('#section-title').text(titles[section] || '');
    }

    // --- Alerts ---

    var alertTimeout = null, warnTimeout = null;

    function showAlert(msg) {
        $('.alert-success strong').text(msg || 'Zrobiono!');
        $('.alert-success').fadeIn(50);
        clearTimeout(alertTimeout);
        alertTimeout = setTimeout(function () { $('.alert-success').fadeOut(); }, 5000);
    }

    function showWarn(msg) {
        $('.toast-warn').text(msg).fadeIn(50);
        clearTimeout(warnTimeout);
        warnTimeout = setTimeout(function () { $('.toast-warn').fadeOut(); }, 3000);
    }

    // --- Fullscreen ---

    function toggleFullscreen() {
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            document.documentElement.requestFullscreen();
        }
    }

    // --- Time input mask (MM:SS) ---

    function applyTimeMask(input) {
        $(input).on('input', function () {
            var raw = $(this).val().replace(/\D/g, '').slice(0, 4);
            if (raw.length >= 3) {
                $(this).val(raw.slice(0, 2) + ':' + raw.slice(2));
            } else {
                $(this).val(raw);
            }
        });
        $(input).on('blur', function () {
            var parts = $(this).val().split(':');
            var mm = Math.min(parseInt(parts[0], 10) || 0, 99);
            var ss = Math.min(parseInt(parts[1], 10) || 0, 59);
            $(this).val(pad2(mm) + ':' + pad2(ss));
            $(this).trigger('change');
        });
        $(input).on('keydown', function (e) {
            if (e.key === 'Enter') $(this).blur();
        });
    }

    // --- Init ---

    $('[data-toggle="tooltip"]').tooltip({ trigger: 'hover' });
    $('.alert').hide();
    $('.joker-timer').hide();
    $('.joker-controls').hide();
    $('.oxford-joker').hide();
    $('.bp-only').hide();
    $('#settings').hide();
    $('#help').hide();
    $('#sharing').hide();
    $('#debate').hide();
    // Drop focus from a just-clicked button so Space toggles the timer, not the button —
    // but only on mouse click, so keyboard Tab navigation still works.
    $(document).on('mousedown', 'button', function (e) { e.preventDefault(); });

    renderLogoSlots();
    loadTimeFromInput();
    loadAdVocemFromInput();

    applyTimeMask('.input-minutes');
    applyTimeMask('.input-minutes-advocem');
    applyTimeMask('.input-prep-time');

    // --- Event listeners ---

    $('.start-stop').click(toggleTimer);
    $('.reset').click(reset);
    $('.input-minutes').change(reset);
    $('.ad-vocem').click(setAdVocem);
    $('.input-minutes-advocem').change(function () {
        loadAdVocemFromInput();
        App.onStateChange({ adVocemValue: $(this).val() });
    });

    $('.joker').click(jokerStart);
    $('.joker-start-stop').click(jokerToggle);
    $('.joker-reset').click(jokerStart);
    $('.joker-off').click(jokerOff);

    $('.sound-switch').click(function () {
        toggleSound();
        App.onStateChange({ soundEnabled: soundEnabled });
    });
    $('.sound-test1').click(function () { playSound('#30stoend'); });
    $('.sound-test2').click(function () { playSound('#endoftime'); });

    $('.input-motion').on('input', function () {
        $('.motion-text').text($(this).val());
        App.onStateChange({ motion: $(this).val() });
    });

    $('.controls-checkbox').click(function () {
        showControls = this.checked;
        $('.timer-controls:not(.joker-controls)').toggle(showControls);
        App.onStateChange({ showControls: showControls });
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
        App.onStateChange({ jokerEnabled: jokerEnabled });
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
        if (logoSrcs.length >= MAX_LOGOS) return;
        logoSrcs.push(null);
        renderLogoSlots();
    });

    $(document).on('click', '.logo-change-overlay', function () {
        var no = parseInt($(this).closest('.logo-drop-zone').data('logo-no'));
        setImage(null, no);
    });

    $(document).on('click', '.logo-remove-btn', function () {
        var no = parseInt($(this).closest('.logo-drop-zone').data('logo-no'));
        logoSrcs.splice(no - 1, 1);
        renderLogoSlots();
        renderTimerLogos();
        if (!App.state.applyingState) App.onStateChange({ logos: logoSrcs.slice() });
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
        $('body').toggleClass('glassmorphic', $(this).val() === 'glassmorphic');
    });

    $('.full-screen-btn').click(toggleFullscreen);

    $('#timer-link').click(function () { navigate('timer'); });
    $('#settings-link').click(function () { navigate('settings'); });
    $('#help-link').click(function () { navigate('help'); });
    $('#sharing-link').click(function () { navigate('sharing'); });
    $('#debate-link').click(function () { navigate('debate'); });

    $(window).keyup(function (e) {
        if ($(e.target).is(':input')) return;
        switch (e.key) {
            case ' ': case 'Spacebar': e.preventDefault(); toggleTimer(); break;
            case '1': reset(); break;
            case '2': if (currentFormat === 'oxford') setAdVocem(); break;
            case 'j': case 'J': if (currentFormat === 'oxford' && jokerEnabled) jokerStart(); break;
            case 'h': case 'H': if (currentFormat === 'oxford' && jokerEnabled) jokerToggle(); break;
            case 'k': case 'K': if (currentFormat === 'oxford' && jokerEnabled) jokerOff(); break;
        }
    });

    // --- State sync (seam for online.js) ---

    function getFullState() {
        var wire = timerWire();
        wire.jokerRunning = joker.isRunning();
        wire.jokerStartedAt = joker.startedAt();
        wire.jokerStartSeconds = joker.startSeconds();
        wire.jokerSeconds = joker.remaining();
        wire.currentFormat = currentFormat;
        wire.isPrepTime = isPrepTime;
        wire.showControls = showControls;
        wire.slaveShowControls = App.state.slaveShowControls;
        wire.soundEnabled = soundEnabled;
        wire.jokerEnabled = jokerEnabled;
        wire.timerValue = $('.input-minutes').val();
        wire.adVocemValue = $('.input-minutes-advocem').val();
        wire.motion = $('.input-motion').val();
        wire.logos = logoSrcs.slice();
        return wire;
    }

    // applyState is an ordered list of per-concern appliers. Order matters: format runs
    // first because applyFormat() internally calls reset(), which would otherwise wipe a
    // freshly applied time; the timer applier runs after the input values it may read.
    function applyFormatField(state) {
        if (state.currentFormat !== undefined && state.currentFormat !== currentFormat) {
            currentFormat = state.currentFormat;
            $('[name="debateFormat"][value="' + currentFormat + '"]').prop('checked', true);
            applyFormat();
        }
    }

    function applyPrepField(state) {
        if (state.isPrepTime !== undefined) {
            isPrepTime = state.isPrepTime;
            $('body').toggleClass('is-prep-time', isPrepTime);
            $('.debate-prep-btn').toggleClass('active', isPrepTime)
                .text(isPrepTime ? 'Zakończ czas przygotowania' : 'Czas przygotowania');
        }
    }

    function applyInputsField(state) {
        if (state.timerValue) $('.input-minutes').val(state.timerValue);
        if (state.adVocemValue) { $('.input-minutes-advocem').val(state.adVocemValue); loadAdVocemFromInput(); }
        if (state.motion !== undefined) { $('.input-motion').val(state.motion); $('.motion-text').text(state.motion); }
    }

    function applyCheckboxesField(state) {
        if (state.showControls !== undefined) {
            showControls = state.showControls;
            if (!App.state.isSlaveSession) {
                $('#customCheck1').prop('checked', showControls);
                $('.timer-controls:not(.joker-controls)').toggle(showControls);
            }
        }
        if (state.slaveShowControls !== undefined) {
            App.state.slaveShowControls = state.slaveShowControls;
            if (App.state.isSlaveSession) {
                $('.timer-controls:not(.joker-controls)').toggle(App.state.slaveShowControls);
                if (joker.isRunning()) $('.joker-controls').toggle(App.state.slaveShowControls);
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
    }

    function applyLogosField(state) {
        if (state.logos !== undefined) {
            logoSrcs = state.logos.slice(0, MAX_LOGOS);
            renderLogoSlots();
            renderTimerLogos();
        }
        // Backward compat for old session peers that sent individual logo fields
        if (state.logo1 !== undefined) setImage(state.logo1, 1);
        if (state.logo2 !== undefined) setImage(state.logo2, 2);
    }

    function applyTimerField(state) {
        if (state.timerRunning === undefined && state.minutes === undefined) return;
        mainTimer.stop();
        overtime.stop();
        inOvertime = state.bpOvertimeRunning || false;
        $('.timer').toggleClass('bp-overtime', inOvertime);
        if (state.minutes !== undefined) {
            renderTimer(state.minutes * 60 + (state.seconds || 0));
        }
        if (state.timerRunning) {
            if (inOvertime) {
                overtime.adopt(state.bpOvertimeStartedAt, state.bpOvertimeSecs);
            } else {
                mainTimer.adopt(state.timerStartedAt, state.timerStartSeconds);
            }
            $('.start-stop').text('Stop');
        } else {
            // Paused: remember the overtime remaining so a later resume is correct.
            if (inOvertime && state.bpOvertimeSecs !== undefined) overtime.setFrozen(state.bpOvertimeSecs);
            $('.start-stop').text('Start');
        }
    }

    function applyJokerField(state) {
        if (state.jokerRunning === undefined) return;
        joker.stop();
        if (state.jokerRunning) {
            joker.adopt(state.jokerStartedAt, state.jokerStartSeconds);
            renderJoker(joker.remaining());
            $('.joker-timer').show();
            if (effectiveShowControls()) $('.joker-controls').show();
        } else {
            if (state.jokerSeconds !== undefined) joker.setFrozen(state.jokerSeconds);
            $('.joker-timer').hide();
            $('.joker-controls').hide();
        }
    }

    var STATE_APPLIERS = [
        applyFormatField,     // first — applyFormat() calls reset()
        applyPrepField,
        applyInputsField,     // before the timer applier, which may read the input values
        applyCheckboxesField,
        applyLogosField,
        applyTimerField,
        applyJokerField
    ];

    function applyState(state) {
        App.state.applyingState = true;
        STATE_APPLIERS.forEach(function (fn) { fn(state); });
        App.state.applyingState = false;
    }

    // --- Exports for the online layer (online.js) ---
    App.core = {
        getFullState: getFullState,
        applyState: applyState,
        navigate: navigate,
        showAlert: showAlert,
        showWarn: showWarn,
        reset: reset,
        startPrepTime: startPrepTime,
        isPrepActive: function () { return isPrepTime; }
    };
})(jQuery, window.App);
