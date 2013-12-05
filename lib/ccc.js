//command and control for entire extension

Observer = require('./observer');
Enroller = require('./enroller');
Accounts = require('./accounts');
Utils = require('./utils');

function logInAsUser(site, accounts){
	
}


function start(site, accounts){
	var callback = function(success,reason){
		//takes two parameters: 1st: enroller successful or not. 
		//2nd: failure reason: true means failed due to the site bug, false means due to our bug.
		if (success) {
			logInAsUser(site, accounts);
		}
		else {
			Utils.log("Enroller failed due to "+((reason)?"their bugs.":"our bugs."));
		}
	}
	Enroller.enroll(accounts, site, callback);
}

exports.start = start.bind(this,"http://www.slashdot.org",Accounts.accounts);