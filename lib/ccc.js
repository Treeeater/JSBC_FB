//command and control for entire extension

Observer = require('./observer');
Enroller = require('./enroller');
Accounts = require('./accounts');
Utils = require('./utils');

function observe(){
	console.log("login completed");
}

function logInAsUser(site, accounts, userIndex){			//userIndex stands for which user you want to login, basically 1st or 2nd.
	console.log("enroll completed");
	var callback = function(success,reason){
		//takes two parameters: 1st: login successful or not. 
		//2nd: failure reason: true means failed due to the site bug, false means due to our bug.
		if (success) {
			observe();
		}
		else {
			Utils.log("Enroller failed due to "+((reason)?"their bugs.":"our bugs."));
		}
	}
	Enroller.login(accounts, userIndex, site, callback);
}


function start(site, accounts){
	var callback = function(success,reason){
		//takes two parameters: 1st: enroller successful or not. 
		//2nd: failure reason: true means failed due to the site bug, false means due to our bug.
		if (success) {
			logInAsUser(site, accounts, 0);
		}
		else {
			Utils.log("Enroller failed due to "+((reason)?"their bugs.":"our bugs."));
		}
	}
	Enroller.enroll(accounts, site, callback);
}

exports.start = start.bind(this,"http://www.ask.com",Accounts.accounts);