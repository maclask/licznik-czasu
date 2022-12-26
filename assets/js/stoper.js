var config = ["5:00", "0:30", "", true, false, "", "", false, "5:00", false, "0:30"];
(function($) {

var sekundy;
var started = false;
var joker_started = false;
var showControls = true;
var interval;
var intervalJoker;
var minuty;
var imgNumber;
var end_minutes = 0;
var end_seconds = 0;
var ding_minute = 0;
var ding_second = 30;
var ding_minute2 = -1;
var ding_second2 = -1;
var ding_minute3 = -1;
var ding_second3 = -1;
var soundEnabled=true;
		var minutyJoker;
		var sekundyJoker;
$('[data-toggle="tooltip"]').tooltip({ trigger: "hover" });
$('.oxford-debate').addClass("active");
$('.alert').hide();
$('.joker-timer').hide();
$('.joker-controls').hide();
	$( "#settings" ).hide();
	$( "#help" ).hide();	
	$( "#coin-flip" ).hide();
	$( "#jitsi" ).hide();
		$( ".debate-participants" ).hide();
	$( ".debate-chat" ).hide();
	minuty = $('.input-minuty').val().split(":")[0];
	if(minuty != 0){
		minuty = minuty.replace(/^0+/, '');
	}
	else{
		minuty = 0;
	}
    sekundy = $('.input-minuty').val().split(":")[1];
	$('#timer').find('.timer-minutes').text(minuty);
	$('#timer').find('.timer-seconds').text(sekundy);
	minutyAdvocem = $('.input-minuty-advocem').val().split(":")[0];
	sekundyAdvocem = $('.input-minuty-advocem').val().split(":")[1];
	$(function () {
  $('[data-toggle="tooltip"]').tooltip()
})
	//$(".timer-controls").toggle();
$('button').focus(function() {
        this.blur();
    });
    
	$('.start-stop').click(function(){
		if(started){
			clearInterval(interval);
			started=false;
		}
		else{
			interval = setInterval(updateDisplay, 1000);
			started=true;
		}
	});
	
	$('.zastosuj-minuty').click(reset);
	$('.reset').click(reset);
	$('.ad-vocem').click(adVocem);
    $('.apply-advocem-time').click(change_advocem);
	$('.joker').click(joker);
	$('.oxford-debate').click(oxford_debate);
	$('.bp-debate').click(bp_debate);
    
	$('.joker-start-stop').click(joker_start_stop);
	$('.joker-reset').click(joker);
	$('.joker-off').click(joker_off);
    
		$('.sound-test1').click(playsound1);
		$('.sound-test2').click(playsound2);
		
		$('.sound-switch').click(soundSwitch);
	
	$('#settings').find(':submit').click(done);
	
		$('.zastosuj-teza').click(function(){
		var teza = $('.input-teza').val();
		$('#teza').text(teza);
		setUrlParameter("teza", teza);
	});
	
	function oxford_debate(){
		$('.ad-vocem').show();
		$('.joker').show();	
		$('.ad-vocem-settings').show();	
		$('.input-minuty').val("05:00");
		$('.oxford-debate').addClass("active");
		$('.bp-debate').removeClass("active");
		end_seconds = 0;
		ding_minute = 0;
		ding_second = 30;
		ding_minute2 = -1;
		ding_second2 = -1;
		ding_minute3 = -1;
		ding_second3 = -1;
		reset();
		done();			
	}
	function bp_debate(){
		$('.ad-vocem').hide();
		$('.joker').hide();
		$('.ad-vocem-settings').hide();
		$('.input-minuty').val("07:00");
		$('.oxford-debate').removeClass("active");
		$('.bp-debate').addClass("active");
		end_seconds = -15;
		ding_minute = 6;
		ding_second = 0;
		ding_minute2 = 1;
		ding_second2 = 0;
		ding_minute3 = 0;
		ding_second3 = 0;
		reset();
		done();
	}
	
	
	$(window).keyup(function(e){
	// sprawdza czy wcisnieto spacje
        if(!$(e.target).is(':input')){
            switch(e.keyCode){
                case 32:
                    e.preventDefault();
                    if(started){
                        clearInterval(interval);
                        started=false;
                    }
                    else{
                        interval = setInterval(updateDisplay, 1000);
                        started=true;
                    }
                    break;
                case 49:
                    reset();
                    break;
                case 50:
                    adVocem();
                    break;
                case 74:
                    joker();
                    break;
                case 72:
                    joker_start_stop();
                    break;
                case 75:
                    joker_off();
                    break;
            }
        }
});
 $(".imgInp").change(function(){
		imgNumber = $(this).attr('id');
       readURL(this, imgNumber);
 });
	$('.controls-checkbox').click(function() {
    $(".timer-controls:not(.joker-controls)").toggle(this.checked);
    if(showControls)
        showControls = false;
    else
        showControls = true;
});

function readURL(input, imgNumber) {
        if (input.files && input.files[0]) {
            var reader = new FileReader();
            
            reader.onload = function (e) {
				if(imgNumber == 'imgInp1'){
                set_image(e.target.result, 1);

				}
				else{
					set_image(e.target.result, 2);

				}
            };
            
            reader.readAsDataURL(input.files[0]);
        }
    }
	
function insert_img(name, imgNumber){
	
    if(imgNumber == 'dropdown1 show'){
		set_image('img/'+name, 1);
	}
	else{
		set_image('img/'+name, 2);	
	}
}
function set_image(src, no){
		if(src == "img/#"){
			$('.img'+no).parent().css('display', 'none');
		}else{
			$('.img'+no).attr('src', src);
			$('.img'+no).parent().css('display', 'grid');
		}
		

}
$('.dropdown-item').click(function(){
    console.log($(this).parent().parent().attr('class'));
    insert_img($(this).attr('data'), $(this).parent().parent().attr('class'));

})
function updateDisplay(){
	if(minuty==end_minutes & sekundy==end_seconds){
			clearInterval(interval);
			if(soundEnabled)
			playsound2();
	}
	else
	sekundy--;

if(soundEnabled && minuty==ding_minute && sekundy==ding_second) playsound1();
if(soundEnabled && minuty==ding_minute2 && sekundy==ding_second2) playsound1();
if(soundEnabled && minuty==ding_minute3 && sekundy==ding_second3) playsound1();
if(sekundy<0 && minuty>0){
		sekundy=59;
		updateDisplay2();
	}
if(sekundy<0 & minuty<=0){
		$('#timer').find('.timer-minutes').text("-0");
}
	if(sekundy<10 & sekundy>=0)
	$('#timer').find('.timer-seconds').text("0"+sekundy);
	else if(sekundy<0 & sekundy>-10)
	$('#timer').find('.timer-seconds').text("0"+sekundy*(-1));
	else if(sekundy<=-10)
	$('#timer').find('.timer-seconds').text(sekundy*(-1));
	else
	$('#timer').find('.timer-seconds').text(sekundy);
}

function updateDisplay2(){    
	minuty--;
	$('#timer').find('.timer-minutes').text(minuty);
}

function reset(){
		clearInterval(interval);
		started=false;
		minuty = $('.input-minuty').val().split(":")[0];
		sekundy = $('.input-minuty').val().split(":")[1];
        if(minuty != 0){
			minuty = minuty.replace(/^0+/, '');
		}
		else{
			minuty = 0;
		}
		$('#timer').find('.timer-minutes').text(minuty);
		$('#timer').find('.timer-seconds').text(sekundy);
		setUrlParameter("tm", minuty);
		setUrlParameter("ts", sekundy);
	}
	
	function adVocem(){
		clearInterval(interval);
		started=false;
		$('.start-stop').text(function(index, text){
				return text.replace("Stop", "Start");  
			});
		minuty = minutyAdvocem;
		sekundy = sekundyAdvocem;
        if(minuty!= 0){
			minuty = minuty.replace(/^0+/, '');
		}
		else{
			minuty = 0;
		}
		$('#timer').find('.timer-minutes').text(minuty);
		$('#timer').find('.timer-seconds').text(sekundy);
	}
	function change_advocem(){
			minutyAdvocem = $('.input-minuty-advocem').val().split(":")[0];
			sekundyAdvocem = $('.input-minuty-advocem').val().split(":")[1];
			setUrlParameter("tavm", minutyAdvocem);
			setUrlParameter("tavs", sekundyAdvocem);
	}
	
function joker_start_stop(){
    if(joker_started){
			clearInterval(intervalJoker);
			joker_started=false;
		}
		else{
			intervalJoker = setInterval(jokerUpdate, 1000);
			joker_started=true;
		}
}
function joker_off(){
    clearInterval(intervalJoker);
    $('.joker-timer').hide();
    $('.joker-controls').hide();
    joker_started = false; 
}
    
		function joker(){
        if(showControls) 
            $('.joker-controls').show();
		clearInterval(intervalJoker);
		$('.joker-timer').show();
	 minutyJoker = 0;
	 sekundyJoker = 30;
		$('#timer').find('.joker-minutes').text(minutyJoker);
		$('#timer').find('.joker-seconds').text(sekundyJoker);
			intervalJoker = setInterval(jokerUpdate, 1000);
            joker_started = true;
	}
	
	function jokerUpdate(){
		//sekundyJoker = $('#timer').find('.joker-seconds');
		if(sekundyJoker==0 & minutyJoker==0){
		clearInterval(intervalJoker);
		if(soundEnabled)
		playsound1();
		$('.joker-timer').hide();
        $('.joker-controls').hide();
        joker_started = false;
	}
	else{
		sekundyJoker--;
			if(sekundyJoker<10)
	$('#timer').find('.joker-seconds').text("0"+sekundyJoker);
	else
	$('#timer').find('.joker-seconds').text(sekundyJoker);
	}}
	
	function playsound1(){
		if(soundEnabled){
				$('#30stoend').get(0).load();
				$('#30stoend').get(0).play();
		}
	}
		function playsound2(){
			if(soundEnabled){
				$('#endoftime').get(0).load();
				$('#endoftime').get(0).play();
			}
	}
	
	function done(){
$('.alert').fadeIn(50);
setTimeout(
  function() 
  {
   $('.alert').fadeOut();
  }, 1000);
	}
	
	function soundSwitch(){
		if(soundEnabled)
		soundEnabled=false;
		else
		soundEnabled=true;
	}


	var elem = document.documentElement;

	/* View in fullscreen */
	function toggleFullscreen() {
	if(document.fullscreenElement){
		if (document.exitFullscreen) {
			document.exitFullscreen();
		  } else if (document.mozCancelFullScreen) { /* Firefox */
			document.mozCancelFullScreen();
		  } else if (document.webkitExitFullscreen) { /* Chrome, Safari and Opera */
			document.webkitExitFullscreen();
		  } else if (document.msExitFullscreen) { /* IE/Edge */
			document.msExitFullscreen();
		  }
	}
	else{
		if (elem.requestFullscreen) {
			elem.requestFullscreen();
		  } else if (elem.mozRequestFullScreen) { /* Firefox */
			elem.mozRequestFullScreen();
		  } else if (elem.webkitRequestFullscreen) { /* Chrome, Safari and Opera */
			elem.webkitRequestFullscreen();
		  } else if (elem.msRequestFullscreen) { /* IE/Edge */
			elem.msRequestFullscreen();
		  }
	}
	  
	}




	$('.full-screen-btn').click(toggleFullscreen);

$('#settings-link').click(function() {
	//site = "settings";
	$('#timer').hide();
	$('#settings').show();
	$('#help').hide();
	$( "#coin-flip" ).hide();
	$( "#jitsi" ).hide();	
	$( ".debate-participants" ).hide();
	$( ".debate-chat" ).hide();
});

$( "#timer-link" ).click(function() {
	//site = "settings";
	$( "#timer" ).show();
	$( "#settings" ).hide();
	$( "#help" ).hide();
	$( "#coin-flip" ).hide();
	$( "#jitsi" ).hide();	
	$( ".debate-participants" ).hide();
	$( ".debate-chat" ).hide();
});

$( "#help-link" ).click(function() {
	//site = "settings";
	$( "#help" ).show();
	$( "#settings" ).hide();
	$( "#timer" ).hide();	
	$( "#coin-flip" ).hide();
	$( "#jitsi" ).hide();	
	$( ".debate-participants" ).hide();
	$( ".debate-chat" ).hide();
});
$( "#coin-link" ).click(function() {
	$( "#coin-flip" ).show();
	$( "#help" ).hide();
	$( "#settings" ).hide();
	$( "#timer" ).hide();	
	$( "#jitsi" ).hide();	
	$( ".debate-participants" ).hide();
	$( ".debate-chat" ).hide();

});
$( "#jitsi-link" ).click(function() {
	$( "#jitsi" ).show();
	$( "#coin-flip" ).hide();
	$( "#help" ).hide();
	$( "#settings" ).hide();
	$( "#timer" ).hide();	
	$( ".debate-participants" ).show();
	$( ".debate-chat" ).show();
	createDebate();
});



	})(jQuery);
		// Coin Flip Simulation

var coinFlipButton = document.getElementById('coinFlipButton');
var outcome = document.querySelector('.outcome');

function getRandomNumber() {
  return Math.floor(Math.random() * (2 - 1 + 1)) + 1
}

coinFlipButton.addEventListener('click', function() {
  var randomNumber = getRandomNumber();
  outcome.textContent = '';
  outcome.classList.toggle('flip');
  outcome.classList.add('toss');
  
  // Waits 3sec to display flip result
  setTimeout(function() {
    if (randomNumber == 1) {
      outcome.textContent = 'orzeł';
    } else if (randomNumber == 2) {
      outcome.textContent = 'reszka';
    }
    outcome.classList.remove('toss');
  }, 800);
    
});
//url query
const queryString = window.location.search;
const urlParams = new URLSearchParams(queryString);
function setUrlParameter(urlKey, urlValue)
{
	if ('URLSearchParams' in window) {
		var searchParams = new URLSearchParams(window.location.search)
		searchParams.set(urlKey, urlValue);
		var newRelativePathQuery = window.location.pathname + '?' + searchParams.toString();
		history.replaceState({}, '', newRelativePathQuery);
	}
}
function deleteUrlParameter(urlKey)
{
	if ('URLSearchParams' in window) {
		var searchParams = new URLSearchParams(window.location.search)
		searchParams.delete(urlKey);
		var newRelativePathQuery = window.location.pathname + '?' + searchParams.toString();
		history.replaceState({} , '', newRelativePathQuery);
	}
}
//jitsi
var debate_id;
if(urlParams.get('d') === null){
	debate_id = uuidv4();
	document.cookie = "debateMod=true";
}
else{
	var debate_id = urlParams.get('d') ;
}

setUrlParameter('d', debate_id)
const domain = 'meet.jit.si';
const options = {
    roomName: debate_id,
    width: 400,
    height: 300,
    parentNode: document.querySelector('#debate'),
    lang: 'pl',
	userInfo: {
        displayName: 'Maciek Laskowski'
    }
};
var api = null;
function createDebate(){
	if(api === null){
		
		api = new JitsiMeetExternalAPI(domain, options);
		api.addListener('participantJoined', addParticipantVisual);
		api.addListener('participantLeft', removeParticipantVisual);
		api.addListener('displayNameChange', editParticipantVisual);
		api.addListener('dominantSpeakerChanged', dominantSpeakerChanged);
		api.addListener('incomingMessage', incomingMessage);
		api.addListener('outgoingMessage', incomingMessage);
		api.addEventListener('participantRoleChanged', function (event) {
    if(event.role === 'moderator') {
        api.executeCommand('toggleLobby', true);
    }
});

		 adjustDebateConfig();
		 setDebateMotion();
	}
}

function adjustDebateConfig() {

	api.executeCommand('overwriteConfig',
    {
		toolbarButtons: ['camera', 'microphone'],
		toolbarConfig: {alwaysVisible: true},
		toolbarConfig: {disableStageFilmstrip: true},
		disabledNotifications: [
			'notify.chatMessages', // shown when receiving chat messages while the chat window is closed
			'notify.grantedTo', // shown when moderator rights were granted to a participant
		],
		filmstrip: {
			disableResizable: true,
			disableStageFilmstrip: true
		},
		disabledSounds: [
			 'ASKED_TO_UNMUTE_SOUND',
			 'E2EE_OFF_SOUND',
			 'E2EE_ON_SOUND',
			 'INCOMING_MSG_SOUND',
			 'KNOCKING_PARTICIPANT_SOUND',
			 'LIVE_STREAMING_OFF_SOUND',
			 'LIVE_STREAMING_ON_SOUND',
			 'NO_AUDIO_SIGNAL_SOUND',
			 'NOISY_AUDIO_INPUT_SOUND',
			 'OUTGOING_CALL_EXPIRED_SOUND',
			 'OUTGOING_CALL_REJECTED_SOUND',
			 'OUTGOING_CALL_RINGING_SOUND',
			 'OUTGOING_CALL_START_SOUND',
			 'PARTICIPANT_JOINED_SOUND',
			 'PARTICIPANT_LEFT_SOUND',
			 'RAISE_HAND_SOUND',
			 'REACTION_SOUND',
			 'RECORDING_OFF_SOUND',
			 'RECORDING_ON_SOUND',
			 'TALK_WHILE_MUTED_SOUND'
		]
    });

	api.executeCommand('setTileView',false);
	
	var currentDiv = document.getElementById("timer");
	const newDiv = currentDiv.cloneNode(true);
	newDiv.setAttribute("id", "timer2");
	document.getElementById("debate-timer").appendChild(newDiv);
	$( "#timer2" ).show();
	
}

document.querySelectorAll('.chat-submit')[0].addEventListener('click', function() {
	var messageBody = document.querySelectorAll('.chat-input')[0].value;
	sendMessage(messageBody);
});
	
function setDebateMotion() {
	api.executeCommand('subject', 'Debata');
	
}

function uuidv4() {
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  );
}

function utf8_to_b64(str) {
  return window.btoa(unescape(encodeURIComponent(str)));
}

function b64_to_utf8(str) {
  return decodeURIComponent(escape(window.atob(str)));
}

function dominantSpeakerChanged(participantObject) {
	console.log(participantObject);
	const speakingParticipants = document.getElementsByClassName("speaking");
	//console.log(speakingParticipant);
	for (const participant of speakingParticipants) {
	  participant.classList.remove("speaking");
	}
	const participant = document.getElementById(participantObject.id);
	participant.className += " " + "speaking";
	api.pinParticipant(participantObject.id);
	
}
function editParticipantVisual(participantObject) {
	const participant = document.getElementById(participantObject.id);
	participant.innerHTML = participantObject.displayname;
}
function removeParticipantVisual(participantObject) {
	const participant = document.getElementById(participantObject.id);
	participant.remove();
}
var currentDiv = document.getElementById("local-participant");

function addParticipantVisual(participantObject) {
	  const newDiv = currentDiv.cloneNode(true);
	  newDiv.setAttribute("id", participantObject.id);
	  displayNameElement = newDiv.getElementsByClassName('display-name')[0];
	  if(displayNameElement != null){
		  displayNameElement.innerHTML = participantObject.displayName;
	  }
	  else{
		  console.log("display name null");
	  }

	  currentDiv.after(newDiv);
	  currentDiv = newDiv;	  
	  sendDebateConfig(participantObject)
}


function incomingMessage(messageBody) {
	if(messageBody.message !== ""){
		var lastMessageDiv = document.querySelectorAll(".message:last-child")[0];
		console.log(messageBody);
		if(messageBody.nick == null){
			var nick = "Ty";
		}		
		else{
			var nick = messageBody.nick;
		}
		if(messageBody.stamp == null){
			var messageTime = new Date(); 
		}		
		else{
			var messageTime = new Date(Date.parse(messageBody.stamp));
		}
		
		const newMessageDiv = lastMessageDiv.cloneNode(true);
		//newMessageDiv.setAttribute("id", participantObject.id);
		newMessageDiv.querySelectorAll(".from")[0].innerHTML = nick;
		newMessageDiv.querySelectorAll(".message-body")[0].innerHTML = messageBody.message;
		newMessageDiv.querySelectorAll(".message-time")[0].innerHTML = messageTime.getHours() + ":" + messageTime.getMinutes();

		lastMessageDiv.after(newMessageDiv);
		//lastMessageDiv = newMessageDiv;	

		}	
}

function sendDebateConfig(participantObject){
	//api.executeCommand('sendEndpointTextMessage', participantObject.id, config);
	api.executeCommand('sendChatMessage',
    'config', //the text message
    participantObject.id, // the receiving participant ID or empty string/undefined for group chat.
    true // true if the privacy notification should be ignored. Defaulted to false.
);
}

function sendMessage(messageBody){
	//api.executeCommand('sendEndpointTextMessage', participantObject.id, config);
	api.executeCommand('sendChatMessage',
    messageBody, //the text message
    '',// the receiving participant ID or empty string/undefined for group chat.
    true // true if the privacy notification should be ignored. Defaulted to false.
);
}

var peer = new Peer();
var peerid;
if(urlParams.get('peerid') === null){
	peerid = null;
}
else{
	peerid = urlParams.get('peerid');
}

var conn = peer.connect(peerid);
conn.on('open', function() {
	// Receive messages
	conn.on('data', function(data) {
	  console.log('Received', data);
	});

	// Send messages
	conn.send('Hello!');
});
peer.on('open', function(id) {
	console.log('My peer ID is: ' + id);
  });
