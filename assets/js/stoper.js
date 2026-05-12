(function ($) {
    var timerRunning = false;
    var jokerRunning = false;
    var showControls = true;
    var soundEnabled = true;

    // Current display values (updated on pause/stop so resume picks up correctly)
    var minutes, seconds;
    var adVocemMinutes, adVocemSeconds;
    var jokerSeconds;

    // System-time anchors for drift-free countdown
    var timerStartedAt, timerStartSeconds;
    var jokerStartedAt, jokerStartSeconds;

    var timerInterval, jokerInterval;
    var lastTimerSecond = -1;
    var lastJokerSecond = -1;

    // --- Init ---

    $('[data-toggle="tooltip"]').tooltip({ trigger: 'hover' });
    $('.alert').hide();
    $('.joker-timer').hide();
    $('.joker-controls').hide();
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
        var elapsed = Math.floor((Date.now() - timerStartedAt) / 1000);
        var remaining = timerStartSeconds - elapsed;

        if (remaining <= 0) {
            minutes = 0;
            seconds = 0;
            renderTimer();
            stopTimer();
            if (soundEnabled) playEndSound();
            return;
        }

        if (remaining === lastTimerSecond) return;
        lastTimerSecond = remaining;

        minutes = Math.floor(remaining / 60);
        seconds = remaining % 60;

        if (soundEnabled && minutes === 0 && seconds === 30) playDingSound();

        renderTimer();
    }

    function startTimer() {
        if (timerRunning) return;
        timerStartedAt = Date.now();
        timerStartSeconds = minutes * 60 + seconds;
        lastTimerSecond = timerStartSeconds;
        timerInterval = setInterval(timerTick, 250);
        timerRunning = true;
        $('.start-stop').text('Stop');
    }

    function stopTimer() {
        if (!timerRunning) return;
        clearInterval(timerInterval);
        timerRunning = false;
        var elapsed = Math.floor((Date.now() - timerStartedAt) / 1000);
        var remaining = Math.max(0, timerStartSeconds - elapsed);
        minutes = Math.floor(remaining / 60);
        seconds = remaining % 60;
        renderTimer();
        $('.start-stop').text('Start');
    }

    function toggleTimer() {
        if (timerRunning) stopTimer(); else startTimer();
        popTime();
    }

    function reset() {
        clearInterval(timerInterval);
        timerRunning = false;
        $('.start-stop').text('Start');
        loadTimeFromInput();
    }

    function setAdVocem() {
        clearInterval(timerInterval);
        timerRunning = false;
        $('.start-stop').text('Start');
        minutes = adVocemMinutes;
        seconds = adVocemSeconds;
        renderTimer();
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
    }

    function jokerOff() {
        clearInterval(jokerInterval);
        jokerRunning = false;
        $('.joker-timer').hide();
        $('.joker-controls').hide();
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
            $('.img' + no).attr('src', src).parent().css('display', 'grid');
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
    }

    // --- Alert ---

    function showAlert() {
        $('.alert').fadeIn(50);
        setTimeout(function () { $('.alert').fadeOut(); }, 1000);
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
    $('.zastosuj-minuty').click(reset);
    $('.ad-vocem').click(setAdVocem);
    $('.apply-advocem-time').click(loadAdVocemFromInput);

    $('.joker').click(jokerStart);
    $('.joker-start-stop').click(jokerToggle);
    $('.joker-reset').click(jokerStart);
    $('.joker-off').click(jokerOff);

    $('.sound-switch').click(toggleSound);
    $('.sound-test1').click(playDingSound);
    $('.sound-test2').click(playEndSound);

    $('#settings').find(':submit').click(showAlert);
    $('.zastosuj-teza').click(function () {
        $('#teza').text($('.input-teza').val());
    });

    $('.controls-checkbox').click(function () {
        showControls = this.checked;
        $('.timer-controls:not(.joker-controls)').toggle(showControls);
    });

    $('.imgInp').change(function () {
        var no = $(this).attr('id') === 'imgInp1' ? 1 : 2;
        readImageFile(this, no);
    });

    $('.dropdown-item').click(function () {
        var parentClass = $(this).parent().parent().attr('class');
        var no = parentClass.includes('dropdown1') ? 1 : 2;
        var imgName = $(this).attr('data');
        setImage(imgName === '#' ? null : 'img/' + imgName, no);
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
            case 50: setAdVocem(); break;
            case 74: jokerStart(); break;
            case 72: jokerToggle(); break;
            case 75: jokerOff(); break;
        }
    });

})(jQuery);
