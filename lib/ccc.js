//command and control for entire extension

const {Cc,Ci,Cr} = require("chrome");
Observer = require('./observer');
Enroller = require('./enroller');
Accounts = require('./accounts');
Utils = require('./utils');
AutomatedTesting = require('./automatedTesting');
recordingTrace = false;
secondTimeRecording = false;		//flag to check if the second recording has been done or not.

numberOfTracesNeeded = 5;
var window = Cc["@mozilla.org/appshell/appShellService;1"].getService(Ci.nsIAppShellService).hiddenDOMWindow;

var accounts = Accounts.accounts;

function recordTrace(site, userIndex){
	if (userIndex == 0){
		if (numberOfTracesNeeded == 5){
			Utils.log("login to user A completed");
		}
		if (numberOfTracesNeeded == 0){
			if (secondTimeRecording) {
				recordingTrace = false;
				secondTimeRecording = false;
				logInAsUser(site,1)
				numberOfTracesNeeded = 5;
				return;
			}
			else {
				recordingTrace = false;
				logInAsUser(site,0)
				numberOfTracesNeeded = 5;
				secondTimeRecording = true;
				return;
			}
		}
		if (numberOfTracesNeeded <= 5 && numberOfTracesNeeded > 0){
			Observer.refreshAndRecord(site, 0, recordTrace);
			numberOfTracesNeeded--;
			return;
		}
	}
	else {
		if (numberOfTracesNeeded == 5){
			Utils.log("login to user B completed");
		}
		if (numberOfTracesNeeded == 0){
			Utils.log("Traces recording complete.")
			recordingTrace = false;
			numberOfTracesNeeded = 5;
			AutomatedTesting.finishedTesting(true);
			return;
		}
		if (numberOfTracesNeeded <= 5 && numberOfTracesNeeded > 0){
			Observer.refreshAndRecord(site, 1, recordTrace);
			numberOfTracesNeeded--;
			return;
		}
	}
}

function logInAsUser(site, userIndex){			//userIndex stands for which user you want to login, basically 1st or 2nd.
	if (userIndex == 0){
		Utils.log("Enrollment completed");
	}
	else if (userIndex == 1){
		if (secondTimeRecording) {
			Utils.log("User A traces recording completed for the second time.");
		}
		else {
			Utils.log("User A traces recording completed for the first time.");
		}
	}
	var callback = function(success,reason){
		//takes two parameters: 1st: login successful or not. 
		//2nd: failure reason: true means failed due to the site bug, false means due to our bug.
		if (success) {
			recordingTrace = true;
			recordTrace(site, userIndex);
		}
		else {
			if (userIndex == 0){
				Utils.log("Login to user A failed due to "+((reason)?"their bugs.":"our bugs."));
				AutomatedTesting.finishedTesting(false);
			}
			else {
				Utils.log("Login to user B failed due to "+((reason)?"their bugs.":"our bugs."));
				AutomatedTesting.finishedTesting(false);
			}
		}
	}
	Enroller.login(accounts, userIndex, site, callback);
}

//for now we are not using this one.
function enroll(site){
	var callback = function(success,reason){
		//takes two parameters: 1st: enroller successful or not. 
		//2nd: failure reason: true means failed due to the site bug, false means due to our bug.
		if (success) {
			logInAsUser(site, 0);
		}
		else {
			Utils.log("Enroller failed due to "+((reason)?"their bugs.":"our bugs."));
			AutomatedTesting.finishedTesting(false);
		}
	}
	Enroller.enroll(accounts, site, callback);
}

Utils.deleteCookies();

AutomatedTesting.startTestIfHaventStarted();
//exports.start = recordTrace.bind(window, "http://www.ask.com", 0);
exports.start = logInAsUser.bind(window, "http://www.huffingtonpost.com", 0);
exports.recordingTrace = function(){return recordingTrace;};
exports.logInAsUser = logInAsUser;
exports.secondTimeRecording = function(){return secondTimeRecording;};
//exports.start = enroll.bind(this,"http://www.ask.com");