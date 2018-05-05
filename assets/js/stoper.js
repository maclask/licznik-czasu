
var sekundy = 0;
var started = false;
var interval;
var intervalJoker;
var minuty;
var imgNumber;
var soundEnabled=true;
		var minutyJoker;
		var sekundyJoker;

 $('.alert').hide();
$('.joker-timer').hide();
	$( "#settings" ).hide();
	$( "#help" ).hide();	
	minuty = $('.input-minuty').val();
	$('#timer').find('.timer-minutes').text(minuty);
	$('#timer').find('.timer-seconds').text("0"+sekundy);
	//$(".timer-controls").toggle();

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
	$('.joker').click(joker);
	
		$('.sound-test1').click(playsound1);
		$('.sound-test2').click(playsound2);
		
		$('.sound-switch').click(soundSwitch);
	
	$('#settings').find(':submit').click(done);
	
		$('.zastosuj-teza').click(function(){
		var teza = $('.input-teza').val();
		$('#teza').text(teza);
	});
	
	$(window).keyup(function(e){
	// sprawdza czy wcisnieto spacje
	if (e.keyCode == 32  && !$(e.target).is(':input')) {
		e.preventDefault();
		if(started){
			clearInterval(interval);
			started=false;
		}
		else{
			interval = setInterval(updateDisplay, 1000);
			started=true;
		}
	}
	if (e.keyCode == 49 && !$(e.target).is(':input')){
		reset();
	}
	if (e.keyCode == 50 && !$(e.target).is(':input')){
		adVocem();
	}
	if (e.keyCode == 74 && !$(e.target).is(':input')){
		joker();
	}
});
 $(".imgInp").change(function(){
		imgNumber = $(this).attr('id');
       readURL(this, imgNumber);
 });
	$('.controls-checkbox').click(function() {
    $(".timer-controls").toggle(this.checked);
});

function readURL(input, imgNumber) {
        if (input.files && input.files[0]) {
            var reader = new FileReader();
            
            reader.onload = function (e) {
				if(imgNumber == 'imgInp1'){
                $('.img1').attr('src', e.target.result);
																$('.img1').attr('width', '400px');
				}
				else{
				$('.img2').attr('src', e.target.result);
				$('.img2').attr('width', '500px');
				}
            };
            
            reader.readAsDataURL(input.files[0]);
        }
    }
	
function updateDisplay(){

	if(sekundy==0 & minuty==0){
			clearInterval(interval);
			if(soundEnabled)
			playsound2();
	}
	else
	sekundy--;

if(soundEnabled && minuty==0 && sekundy==30) playsound1();
if(sekundy<0 && minuty!=0){
		sekundy=59;
		updateDisplay2();
	}
	if(sekundy<10)
	$('#timer').find('.timer-seconds').text("0"+sekundy);
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
		minuty = $('.input-minuty').val();
		sekundy = 0;
		$('#timer').find('.timer-minutes').text(minuty);
		$('#timer').find('.timer-seconds').text("0"+sekundy);
	}
	
	function adVocem(){
		clearInterval(interval);
		started=false;
		minuty = 0;
		sekundy = 30;
		$('#timer').find('.timer-minutes').text(minuty);
		$('#timer').find('.timer-seconds').text(sekundy);
	}
	

		function joker(){
		clearInterval(intervalJoker);
		$('.joker-timer').show();
	 minutyJoker = 0;
	 sekundyJoker = 30;
		$('#timer').find('.joker-minutes').text(minutyJoker);
		$('#timer').find('.joker-seconds').text(sekundyJoker);
			intervalJoker = setInterval(jokerUpdate, 1000);
	}
	
	function jokerUpdate(){
		//sekundyJoker = $('#timer').find('.joker-seconds');
		if(sekundyJoker==0 & minutyJoker==0){
		clearInterval(intervalJoker);
		if(soundEnabled)
		playsound1();
		$('.joker-timer').hide();
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
	
	
	
$( "#settings-link" ).click(function() {
	//site = "settings";
	$( "#timer" ).hide();
	$( "#settings" ).show();
	$( "#help" ).hide();
});

$( "#timer-link" ).click(function() {
	//site = "settings";
	$( "#timer" ).show();
	$( "#settings" ).hide();
	$( "#help" ).hide();
});

$( "#help-link" ).click(function() {
	//site = "settings";
	$( "#help" ).show();
	$( "#settings" ).hide();
		$( "#timer" ).hide();	
});