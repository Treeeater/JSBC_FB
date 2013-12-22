var testFile = require("./testSites.js");
var ccc = require("./ccc");
var Enroller = require("./enroller");
var Utils = require("./utils");
var file = require("file");
var conf = require("./configuration");
const {Cc,Ci} = require("chrome");
var window = Cc["@mozilla.org/appshell/appShellService;1"].getService(Ci.nsIAppShellService).hiddenDOMWindow;

var firstTimeStart = true;
var testSucceed = false;
var timedOut = true;
//var timer;
var started = false;
var allTestDone = false;
var retry = false;
var stalledSites = [];

var i = 0;

var testSites = testFile.testSites;

var readyToProceedAfterTabReset = function (){
	file.mkpath(Utils.rootOutputPath + Utils.fileNameSanitize(testSites[i]));
	ccc.logInAsUser(testSites[i],-1);
	i++;
	//timer = window.setTimeout(testNext, 600000);
}

var testNext = function(){
	if (!testSucceed && !firstTimeStart) {
		if (timedOut) {
			if (stalledSites.indexOf(testSites[i-1])==-1) {
				i--;
				stalledSites.push(testSites[i]);
				Utils.log("Test timed out, retrying (2nd time)...");
				//delete what's already been written there.
				Utils.cleanDir(Utils.rootOutputPath + Utils.fileNameSanitize(testSites[i]));
				retry = true;
			}
			else {
				Utils.log("Test failed a second time due to timeout, skipping this...\n");
			}
		}
		else {
			Utils.log("Test failed on " + testSites[i-1]);
		}
	}
	if (i >= testSites.length) {
		Enroller.startOver();
		Utils.log("All Test done!");
		Utils.saveToFile("finished","");
		allTestDone = true;
		return;
	}
	//ignore previously tested sites.
	if (!retry) {
		while (file.exists(Utils.rootOutputPath + Utils.fileNameSanitize(testSites[i]))){
			i++;
			if (i >= testSites.length){
				Enroller.startOver();
				Utils.log("All Test done!");
				Utils.saveToFile("finished","");
				allTestDone = true;
				return;
			}
		}
	}
	testSucceed = false;
	timedOut = true;
	firstTimeStart = false;
	retry = false;
	window.setTimeout(readyToProceedAfterTabReset,2000);
}

exports.finishedTesting = function (succeed){
	//expedite the process if they tell me to continue
	if (arguments.length == 0) {timedOut = true; testSucceed = false;}
	else {
		testSucceed = succeed;
		timedOut = false;
	}
	//window.clearTimeout(timer);
	testNext();
}

exports.startTestIfHaventStarted = function(){
	if (conf.automatedTestingFlag && !started) {
		started = true;
		window.setTimeout(testNext, 1000);
	}
}

exports.allTestDone = function(){return allTestDone};