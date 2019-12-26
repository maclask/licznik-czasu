(function($) {
var sekundy;
var started = false;
var joker_started = false;
var joker_controls = true;
var interval;
var intervalJoker;
var minuty;
var imgNumber;
var soundEnabled=true;
		var minutyJoker;
		var sekundyJoker;

$('.alert').hide();
$('.joker-timer').hide();
$('.joker-controls').hide();
	$( "#settings" ).hide();
	$( "#help" ).hide();	
	minuty = $('.input-minuty').val().split(":")[0];
    sekundy = $('.input-minuty').val().split(":")[1];
	$('#timer').find('.timer-minutes').text(minuty);
	$('#timer').find('.timer-seconds').text(sekundy);
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
    $('.apply-advocem-time').click(adVocem);
	$('.joker').click(joker);
    
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
	});
	
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
    $(".timer-controls").toggle(this.checked);
    if(joker_controls)
        joker_controls = false;
    else
        joker_controls = true;
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
                $('.img-timer').css('display','block');
            };
            
            reader.readAsDataURL(input.files[0]);
        }
    }
	
function insert_img(name, imgNumber){
    if(imgNumber == 'dropdown1 show'){
                $('.img1').attr('src', 'img/'+name);
				$('.img1').attr('width', '400px');
				}
				else{
				$('.img2').attr('src', 'img/'+name);
				$('.img2').attr('width', '400px');
				}
}
$('.dropdown-item').click(function(){
    console.log($(this).parent().parent().attr('class'));
    insert_img($(this).attr('data'), $(this).parent().parent().attr('class'));

})
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
		minuty = $('.input-minuty').val().split(":")[0];
		sekundy = $('.input-minuty').val().split(":")[1];
        minuty = minuty.replace(/^0+/, '');
		$('#timer').find('.timer-minutes').text(minuty);
		$('#timer').find('.timer-seconds').text(sekundy);
	}
	
	function adVocem(){
		clearInterval(interval);
		started=false;
		minuty = 0;
		sekundy = 30;
		$('#timer').find('.timer-minutes').text(minuty);
		$('#timer').find('.timer-seconds').text(sekundy);
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
        if(joker_controls) 
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

	
$('#settings-link').click(function() {
	//site = "settings";
	$('#timer').hide();
	$('#settings').show();
	$('#help').hide();
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
    })(jQuery);