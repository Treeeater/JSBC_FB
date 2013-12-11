//enroller.js exports a function that takes two test FB accounts and a site that supports Facebook SSO, tries to register account for that site.

const {Cc,Ci,Cr} = require("chrome");

if (typeof CCIN == "undefined") {
	function CCIN(cName, ifaceName){
		return Cc[cName].createInstance(Ci[ifaceName]);
	}
}
if (typeof CCSV == "undefined") {
	function CCSV(cName, ifaceName){
		if (Cc[cName])
			// if fbs fails to load, the error can be _CC[cName] has no properties
			return Cc[cName].getService(Ci[ifaceName]); 
		else
			dumpError("CCSV fails for cName:" + cName);
	};
}
var window = Cc["@mozilla.org/appshell/appShellService;1"].getService(Ci.nsIAppShellService).hiddenDOMWindow;
var cookieService2 = Cc["@mozilla.org/cookiemanager;1"].getService(Ci.nsICookieManager2);

var fileComponent = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsILocalFile);
var file = require("file");
var profilePath = require("system").pathFor("ProfD");
var tabs = require("sdk/tabs");
var conf = require("./configuration");
var Utils = require('./utils');
var ccc = require("./ccc");
var AutomatedTesting = require("./automatedTesting");
//this is previously in utilities.js

var debug = (!!conf.debug) && true;
var writeFlag = (!!conf.writeFlag) && true;
var automatedTestingFlag = (!!conf.automatedTestingFlag) && true;
var cleanResultDirectoryUponInit = (!!conf.cleanResultDirectoryUponInit) || false;
var IdPDomains = ["https://www.facebook.com/dialog/oauth", "https://www.facebook.com/dialog/permissions.request", "https://www.facebook.com/login.php", "http://www.facebook.com/dialog/oauth"];
exports.IdPDomains = IdPDomains;
var excludedPattern = ['display=none'];
exports.excludedPattern = excludedPattern;

var pressLoginButtonWorker;
var automateSSOWorker;
var testSuiteWorker;
var registrationWorker;
var credentialsInserted = false;
var FBSDKDetermined = false;
var sawDialogOAuth = false;
var iframeRegistrationSubmitted = false;
var testRegistrationInProgress = false;	//if we are testing whether the registration is successful or not.
var readyToRecordSessionData = false;	//if delayRefreshTab has been called.
var loginButtonClicked = false;				//used to indicate whether login button has been clicked.
var SSOAutomationStarted = false;			//used to indicate whether SSOAutomation has started.
var removedObserver = false;			//used to indicate if observer has been removed.
var usedFBSDK = true;						//used to indicate if the site used FB SDK or not. If true, the redirect_uri parameter when calling dialog/oauth is set to http(s)://(s-)static.ak.facebook.com/connect/xd_arbiter.php?xxxx; otherwise it is customized to its own domain.
//https%3A%2F%2Fs-static.ak.facebook.com%2Fconnect%2Fxd_arbiter.php
var loginClickAttempts = 0;
var indexToClick = 0;					//currently clicking at which attrInfoMap index for first click.
var indexToClick2 = 0;					//currently clicking at which attrInfoMap index for second click.
var elementsToFill = [];
var buttonToClick = [];
var iframeClickedXPATH = [];
var iframeClickedOuterHTML = [];
var registerAttempts = 0;
var accountsInfo;

var stallCheckerTimer = 0;
var prepareLoginButtonIndexToClickTimer = 0;
var delayRefreshTestTabTimer = 0;
var checkLoginButtonRemovedTimer = 0;
var checkRedirectionAndAdjustTimer = 0;
var tryToRegisterInMainFrameTimer = 0;
var extractContentTimer = 0;
var testRegisterSuccessTimer = 0;
var testOverallSuccess = true;
var tryFindInvisibleLoginButton = conf.tryFindInvisibleLoginButton || false;
var registrationNeeded = conf.registrationNeeded || false;			//whether the site needs registration or not.
var searchForSignUpForFB = conf.searchForSignUpForFB || false;
var testedSearchForSignUp = false;				//used to indicate if we have tried to search for signup button.
var supportFBLogin = false;				//used in automatedTesting.js to determine whether to output vulnerability testing results for [2][4][5].
var searchingForLoginButton = true;		//used to determine if we allow changing indexToClick and stuff.
var operationMode = "enroll";			//either enroll or login.

var log = Utils.log;

var stallChecker = function (){
	if (!automatedTestingFlag) return;
	//if (ccc.recordingTrace) return;			//recording trace, nothing to do with us.
	//call this function with argument 'true' upon each start of test case.
	if (arguments.length == 0 && previousPhase == capturingPhase && previousSiteToTest == siteToTest) {
		//test has not made any progress.
		log("Test stalled at Phase " + capturingPhase.toString());
		AutomatedTesting.finishedTesting();			//calling this w/ no arguments, to report stalling.	
		return;
	}
	if (arguments.length > 0) {
		log("Stall timer reset.");
		window.clearTimeout(stallCheckerTimer);
	}
	previousPhase = capturingPhase;
	previousSiteToTest = siteToTest;
	stallCheckerTimer = window.setTimeout(stallChecker, 240000);
}

if (typeof String.prototype.startsWith != 'function') {
	String.prototype.startsWith = function (str){
		return this.indexOf(str) == 0;
	};
}

function resetIframeClickedInfo(){
	iframeClickedXPATH = [];
	iframeClickedOuterHTML = [];
};

var checkRedirectionAndAdjust = function()
{
	if (capturingPhase > 0) return;
	try {
		testSuiteWorker.port.emit("action",{action:"getURL"});
	}
	catch (ex) {
		log("Site probably still loading, wait 10 secs....");
		checkRedirectionAndAdjustTimer = window.setTimeout(checkRedirectionAndAdjust,10000);
	}
}

var checkAgainstFilter = function(url, capturingPhase)
{
	var i = 0;
	if ((capturingPhase == 2 || capturingPhase == 8) && (url.indexOf("http://www.facebook.com/dialog/return")==0 || url.indexOf("https://www.facebook.com/dialog/return")==0)) 
	{
		return true;
	}
	if (capturingPhase == 0 || capturingPhase == 1 || capturingPhase == 4 || capturingPhase == 6 || capturingPhase == 7 || capturingPhase == 10){
		if (url.indexOf('#')!=-1) url = url.substr(0,url.indexOf('#'))		//get rid of the sharp.
		for (; i < capturingURLs.length; i++)
		{
			if (url == capturingURLs[i] || url.substr(0,url.length-1) == capturingURLs[i] || url == capturingURLs[i].substr(0, capturingURLs[i].length-1)) {
				//to tackle www.google.com should equal to www.google.com/ problem.
				return true;
			}
		}
		return false;
	}
	else if (capturingPhase == 2 || capturingPhase == 8 || ((capturingPhase == 3 || capturingPhase == 9) && usedFBSDK)){
		//check idp domains and excluded patterns
		for (i = 0; i < excludedPattern.length; i++)
		{
			if (url.indexOf(excludedPattern[i])!=-1) {
				return false;
			}
		}
		for (i = 0; i < IdPDomains.length; i++)
		{
			if (url.startsWith(IdPDomains[i])) {
				return true;
			}
		}
		return false;
	}
	else if (!usedFBSDK && redirectDomain != "" && (capturingPhase == 3 || capturingPhase == 9))
	{
		//we also need to account for visits to redirectDomain
		if (redirectDomain[redirectDomain.length-1] == ':') redirectDomain = redirectDomain.substr(0,redirectDomain.length-1);
		if (redirectDomain.substr(redirectDomain.length-3,3) == ':80') redirectDomain = redirectDomain.substr(0,redirectDomain.length-3);
		if (redirectDomain.substr(redirectDomain.length-4,4) == ':443') redirectDomain = redirectDomain.substr(0,redirectDomain.length-4);
		if (redirectDomain.indexOf(':80/')!=-1) redirectDomain = redirectDomain.substr(0,redirectDomain.indexOf(':80/')) + redirectDomain.substr(redirectDomain.indexOf(':80/')+3,redirectDomain.length);			//keep that slash, so the substr index is 3.
		if (redirectDomain.indexOf(':443/')!=-1) redirectDomain = redirectDomain.substr(0,redirectDomain.indexOf(':443/')) + redirectDomain.substr(redirectDomain.indexOf(':443/')+4,redirectDomain.length);
		if (redirectDomain[redirectDomain.length-1] == '/') redirectDomain = redirectDomain.substr(0,redirectDomain.length-1);		//get rid of the last slash.
		if (url.startsWith(redirectDomain) && credentialsInserted) {
			return true;
		}
	}
	return false;
}

var trafficRecord = function(){
	this.url = "";
	this.anonymousSessionRequest = {};
	this.anonymousSessionResponse = {};
	this.anonymousSessionRequest2 = {};
	this.anonymousSessionResponse2 = {};
	this.facebookDialogOAuthRequest = {};
	this.facebookDialogOAuthResponse = {};
	this.authenticatedSessionRequest = {};
	this.authenticatedSessionResponse = {};
	this.authenticatedSessionRequest2 = {};
	this.authenticatedSessionResponse2 = {};
	return this;
}

var RequestRecord = function(){
	this.cookies = "";
	this.postDATA = "";
	this.url = "";
}

var ResponseRecord = function(){
	this.setCookies = "";
	this.body = "";
	this.url = "";
}

var deleteCookies = function(){
	cookieService2.removeAll();
}

var deleteFBCookies = function(){
	var iterator = cookieService2.getCookiesFromHost(".facebook.com");
	while (iterator.hasMoreElements()){
		var currentCookie = iterator.getNext().QueryInterface(Ci.nsICookie);
		var name = currentCookie.name;
		var path = currentCookie.path;
		cookieService2.remove(".facebook.com",name,path,false); 
	}
}

function writeToFileRequest(str)
{
	if (writeFlag) Utils.saveToFile(siteToTest,str);
}

function assume(bool, message){
	if (!bool) {log(message); temp=error;}		//this intends to throw out an error.
}


var siteToTest = "";
var capturingURLs = [];						//urls to look for in the sea of requests.
var capturingPhase = -1;
var bufferedRequests = {};					//used to store freshly captured requests
var bufferedResponses = {};
var responseTextContent = [];				//index: FBAccount
var storageRecord = {};						//used by processing functions to dump buffered requests to 'more persistent and managed records'.
var testTab;								//reference to the tab that's being used to test.
var FBAccount = 1;
var redirectDomain = "";					//if the website doesn't use FBSDK, this stores its redirect_uri parameter.
var oldRedirectDomain = "";					//if the website doesn't use FBSDK and redirects after first redirect_uri, this temporarily holds the previous value.
var oldCapturingURLs = [];					//This stores the original capturingURLs.
var loginButtonXPath = "";
var loginButtonOuterHTML = "";
var additionalRedirectInfo = "";			//used to store 302 in phase 3, for checkToken.js to use to identify if access_token is seen.
var callback = function(){};

function startOver(){
	supportFBLogin = false;
	loginClickAttempts = 0;
	registerAttempts = 0;
	indexToClick = 0;
	indexToClick2 = 0;
	Utils.closeAllOtherTabs();
	capturingPhase = -1;
	loginButtonOuterHTML = "";
	loginButtonXPath = "";
	redirectDomain = "";
	oldRedirectDomain = "";
	additionalRedirectInfo = "";
	oldCapturingURLs = [];
	resetIframeClickedInfo();
	FBAccount = 1;
	loginButtonClicked = false;
	usedFBSDK = true;
	testOverallSuccess = true;
	FBSDKDetermined = false;
	iframeRegistrationSubmitted = false;
	testRegistrationInProgress = false;
	readyToRecordSessionData = false;
	sawDialogOAuth = false;
	searchingForLoginButton = true;
	testedSearchForSignUp = false;
	
	tryFindInvisibleLoginButton = conf.tryFindInvisibleLoginButton || false;
	registrationNeeded = conf.registrationNeeded || false;
	searchForSignUpForFB = conf.searchForSignUpForFB || false;
	
	deleteCookies();
	window.clearTimeout(delayRefreshTestTabTimer);
	window.clearTimeout(prepareLoginButtonIndexToClickTimer);
	window.clearTimeout(checkLoginButtonRemovedTimer);
	window.clearTimeout(stallCheckerTimer);
	window.clearTimeout(checkRedirectionAndAdjustTimer);
	window.clearTimeout(tryToRegisterInMainFrameTimer);
	window.clearTimeout(extractContentTimer);
	window.clearTimeout(testRegisterSuccessTimer);
	
	if (removedObserver) {
		observerService.addObserver(httpResponseObserver, "http-on-examine-response", false);
		observerService.addObserver(FBSSOErrorObserver, "http-on-examine-response", false);
		observerService.addObserver(bufferedRequestsObserver, "http-on-modify-request", false);	
		removedObserver = false;
	}
}

var startTest = function(site){
	//after user entered site to test, control is handed over here.
	startOver();
	capturingPhase++;
	siteToTest = site;
	capturingURLs = [];
	capturingURLs.push(siteToTest);
	try {
		stallChecker(true);
		testSuiteWorker.port.emit("action", {"site": siteToTest, "action": "navigateTo"});
		log("Testing site: "+siteToTest);
		checkRedirectionAndAdjustTimer = window.setTimeout(checkRedirectionAndAdjust,10000);	//check if phase is > 0, if not, indicates the website redirected itself. We make adjustments according to it.
	} catch(ex){
		//errors in between tests, just try again.
		log("testSuiteWorker hidden frame error 9 (while trying to start a new test), retrying in 10 secs...");
		window.setTimeout(startTest.bind(window,site),10000);				//call this function again.
	}
}

function testSuitePhase1(url){
	//Getting initial anonymous session headers data.
	assume(capturingPhase == 1, "Phase 1 violation");
	log('Phase 1 - recorded anonymous header data.\n');
	var tempRecord = new trafficRecord();
	tempRecord.url = siteToTest;
	tempRecord.anonymousSessionRequest = bufferedRequests[url];
	tempRecord.anonymousSessionResponse = bufferedResponses[url];
	storageRecord[siteToTest] = tempRecord;
	capturingPhase++;
}

function prepareLoginButtonIndexToClick(response){
	var shouldClick = (capturingPhase == 2 || capturingPhase == 8);
	if (shouldClick) {
		loginButtonClicked = true;
		try {	
			pressLoginButtonWorker.port.emit("doNotRespond","");
			testSuiteWorker.port.emit("doNotRespond","");
		} catch (ex) {
			log("waiting for page to load, 10sec .... ");
			prepareLoginButtonIndexToClickTimer = window.setTimeout(prepareLoginButtonIndexToClick,10000);			//wait longer for the page load.
			return;
		}
		if (loginClickAttempts >= 2) {
			//This above '2' is fixed - we only consider two clicks max to find FB SSO traffic.
			if (indexToClick >= 2 && indexToClick2 >= 2){			
				//searched through the first three candidates in first click and second click, need to give up or change to detect invisible button strategy.
				if (tryFindInvisibleLoginButton){
					//really give up.
					if (!searchForSignUpForFB){
						log("Too many attempts to click login button and still haven't seen FB traffic, probably failed to locate login button.");
						log("Site doesn't support FB login?\n");
						callback(false,true);			//we consider this as non-failure tests.
						return;
					}
					else {
						log("Too many attempts to click signup button and still haven't seen FB traffic, probably failed to locate signup button.");
						log("Signup button search doesn't help, test still fails.");			//This means cannot find signup button.
						callback(false,false);
						return;
					}
				}
				else {
					if (capturingPhase <= 5 && searchingForLoginButton){
						//switch to detect invisible button mode.
						loginClickAttempts = 0;
						loginButtonClicked = false;
						loginButtonOuterHTML = "";
						loginButtonXPath = "";
						redirectDomain = "";
						deleteCookies();
						FBSDKDetermined = false;
						sawDialogOAuth = false;
						capturingPhase = 1;
						indexToClick = 0;
						indexToClick2 = 0;
						tryFindInvisibleLoginButton = true;
						log("trying to switch to detecting invisible button mode...");
						//reset stall timer - going into this step means we have made some progress, but phase 2 might be too long.
						stallChecker(true);			//calling this w/ 'true' mean to reset timer.					
						try {testSuiteWorker.port.emit("action",{"action": "navigateTo", "site":siteToTest});} catch(ex){log("testSuiteWorker hidden frame error 1");}
					}
					else {
						log("Login button used to work for previous login attempts, but failed for this attempt.");
						callback(false,false);
						return;
					}
				}
			}
			else {
				//haven't searched through all combinations, we need to try other possibilities.
				if (capturingPhase <= 5 && searchingForLoginButton){
					if (indexToClick2<2) {indexToClick2++;}								//mix it up
					else if (indexToClick<2) {indexToClick++; indexToClick2 = 0;}		//mix it up
					loginClickAttempts = 0;
					loginButtonClicked = false;
					loginButtonOuterHTML = "";
					loginButtonXPath = "";
					redirectDomain = "";
					deleteCookies();
					FBSDKDetermined = false;
					sawDialogOAuth = false;
					capturingPhase = 1;
					log("trying to click the combination of " + (indexToClick+1).toString() + "th highest scoring node for the first click and " + (indexToClick2+1).toString() + "th highest scoring node for the second click.");
					try {testSuiteWorker.port.emit("action",{"action": "navigateTo", "site":siteToTest});} catch(ex){log("testSuiteWorker hidden frame error 2");}
				}
				else {
					log("Login button used to work for previous login attempts, but failed for this attempt.");
					callback(false,false);
					return;
				}
			}
			Utils.closeAllOtherTabs();
			return;
		}
		loginClickAttempts++;
		try {pressLoginButtonWorker.port.emit("indexOfLoginButtonToPress",{"shouldClick":shouldClick, "tryFindInvisibleLoginButton":tryFindInvisibleLoginButton, "indexToClick": (loginClickAttempts == 1 ? indexToClick : indexToClick2), "loginClickAttempts":loginClickAttempts});} catch(ex){log("pressLoginButtonWorker hidden frame error 1");}
		prepareLoginButtonIndexToClickTimer = window.setTimeout(prepareLoginButtonIndexToClick,10000);
	}
}

function testSuitePhase2(url){
	//Clicked on the facebook login button and https://www.facebook.com/dialog/oauth/ is visited.
	assume(capturingPhase == 2, "Phase 2 violation");
	log('Phase 2 - https://www.facebook.com/dialog/oauth/ request header and url captured for session A.\n');
	storageRecord[siteToTest].facebookDialogOAuthRequest = bufferedRequests[url];
	capturingPhase++;
	loginClickAttempts = 0;					//do not reset indexToClick or related variable to save for next time.
}

function testSuitePhase3(url){
	//After visit to https://www.facebook.com/dialog/oauth/, this function is called when subsequent visit to https://www.facebook.com/dialog/oauth/read or write or permissions.request happens.
	assume(capturingPhase == 3, "Phase 3 violation");
	resetIframeClickedInfo();
	if (usedFBSDK && (bufferedResponses[url].body.substr(0,42)=='<script type="text/javascript">var message' || bufferedResponses[url].body.substr(0,42)=='<script type="text/javascript">\nvar messag'))
	{
		log('Phase 3 - captured FB OAuth response.\n');
		storageRecord[siteToTest].facebookDialogOAuthResponse = bufferedResponses[url];
		capturingPhase++;
		if (!registrationNeeded){
			delayRefreshTestTabTimer = window.setTimeout(delayRefreshTestTab,15000);			//after 15 seconds, refresh the homepage.
		}
		else{
			tryToRegisterInMainFrameTimer = window.setTimeout(tryToRegisterInMainFrame, 15000);				//if the site needs register, after 15 seconds, try register the user.
		}
	}
	else if (!usedFBSDK)
	{
		log('Phase 3 - captured FB OAuth response.\n');
		storageRecord[siteToTest].facebookDialogOAuthResponse = bufferedRequests[url];			//If it doesn't use FBSDK, all we care about is the URL.
		if (additionalRedirectInfo!="") storageRecord[siteToTest].facebookDialogOAuthResponse.url = additionalRedirectInfo;		//if phase 3 had 302, add all the additional info.
		capturingPhase++;
		if (oldRedirectDomain != "") {
			log("restored redirect domain to previous value.");
			redirectDomain = oldRedirectDomain;
		}
		if (!registrationNeeded){
			delayRefreshTestTabTimer = window.setTimeout(delayRefreshTestTab,15000);			//after 15 seconds, refresh the homepage.
		}
		else{
			tryToRegisterInMainFrameTimer = window.setTimeout(tryToRegisterInMainFrame, 15000);				//if the site needs register, after 15 seconds, try register the user.
		}
	}
}

function testSuitePhase4(url){
	//Getting authenticated session headers data.
	assume(capturingPhase == 4, "Phase 4 violation");
	credentialsInserted = false;			//consume it.
	log('Phase 4 - Saw traffic to test site again.\n');
	supportFBLogin = true;				//this is set to true and is only changed back to false when a new test starts.
	storageRecord[siteToTest].authenticatedSessionRequest = bufferedRequests[url];					//Here the request/respond might not be correct, as the site might need registration;  However, testSuitePhase4 will be called multiple times and in the end we should eventually get the correct response and request.
	storageRecord[siteToTest].authenticatedSessionResponse = bufferedResponses[url];
	if (oldCapturingURLs.length != 0) capturingURLs = oldCapturingURLs;
	capturingPhase++;
	if (!registrationNeeded) checkLoginButtonRemovedTimer = window.setTimeout(checkLoginButtonRemoved, 12000);
	else extractContentTimer = window.setTimeout(extractContent,12000);
}

function tryToRegisterInMainFrame(){
	if (capturingPhase != 4 && capturingPhase != 10) return;			//HTTPS-iframe worker may have already registered, don't do anything here.
	if (iframeRegistrationSubmitted) {
		//HTTPS-iframe already submitted the registration, just call testRegisterSuccess
		testRegisterSuccessTimer = window.setTimeout(testRegisterSuccess, 1000);
		return;							
	}
	try {
		registrationWorker.port.emit("startRegister",{"elementsToFill":elementsToFill, "buttonToClick":buttonToClick});
	} catch (ex) {
		registrationWorker = originalRegistrationWorker;		//fall back to original worker, new worker might be already dead.
		tryToRegisterInMainFrameTimer = window.setTimeout(tryToRegisterInMainFrame,10000);
	}
}

function testRegisterSuccess(){
	testRegistrationInProgress = true;
	tabs.open({url: siteToTest, inBackground: true});
	checkLoginButtonRemovedTimer = window.setTimeout(checkLoginButtonRemoved, 10000);
}

function delayRefreshTestTab()
{
	if (capturingPhase == 4 || capturingPhase == 10) {
		readyToRecordSessionData = true;				//make sure delay refresh tab is executed before testSuitePhase4 and testSuitePhase10.
		try {
			testSuiteWorker.port.emit("action",{"action": "navigateTo", "site":siteToTest});
		} 
		catch(ex){
			log("testSuiteWorker phase 4 hidden frame error - probably page still loading... retry in 10 secs");
			delayRefreshTestTabTimer = window.setTimeout(delayRefreshTestTab, 10000);
		}
	}
}

function checkLoginButtonRemoved(){
	if (registrationNeeded) testRegistrationInProgress = false;
	try{
		pressLoginButtonWorker.port.emit("sendLoginButtonInformation", {"indexToClick":indexToClick, "tryFindInvisibleLoginButton": tryFindInvisibleLoginButton, "account":accountsInfo, "searchForSignUpForFB":searchForSignUpForFB});
	} catch(ex){
		log("pressloginworker hidden frame error - likely caused by host page still loading, will try again in 10 seconds.");
		checkLoginButtonRemovedTimer = window.setTimeout(checkLoginButtonRemoved, 10000);
	}
}

function revisitSiteAnonymously(){	
	assume(capturingPhase == 5, "revisitSiteAnonymously violation");
	log('Phase 5 - deleting cookies and revisit the test site for a second time.\n');
	iframeRegistrationSubmitted = false;			//reset this flag after account A registration is completed.
	registerAttempts = 0;							//reset this value too.
	deleteCookies();
	capturingPhase++;
	try{testSuiteWorker.port.emit("action",{"action": "navigateTo", "site":siteToTest});} catch(ex){log("testsuiteworker hidden frame error 3");}
}

function testSuitePhase7(url){
	assume(capturingPhase == 7, "Phase 7 violation");
	log('Phase 7 - recorded anonymous header data for a second time.\n');
	storageRecord[siteToTest].anonymousSessionRequest2 = bufferedRequests[url];
	storageRecord[siteToTest].anonymousSessionResponse2 = bufferedResponses[url];
	capturingPhase++;
}

function testSuitePhase8(url){
	//Clicked on the facebook login button and https://www.facebook.com/dialog/oauth/ is visited.
	assume(capturingPhase == 8, "Phase 8 violation");
	resetIframeClickedInfo();
	credentialsInserted = false;			//consume it.
	log('Phase 8 - For session B we saw visit to https://www.facebook.com/dialog/oauth/, but we do not need to capture this time.\n');
	capturingPhase++;
	loginClickAttempts = 0;				//reset login click attempts
}

function testSuitePhase9(url){
	//After visit to https://www.facebook.com/dialog/oauth/, this function is called when subsequent visit to https://www.facebook.com/dialog/oauth/read or write or permissions.request happens.
	assume(capturingPhase == 9, "Phase 9 violation");
	if ((bufferedResponses[url].body.substr(0,42)=='<script type="text/javascript">var message' || bufferedResponses[url].body.substr(0,42)=='<script type="text/javascript">\nvar messag')&& usedFBSDK)
	{
		log('Phase 9 - seen FB OAuth response for session B.\n');
		capturingPhase++;
		if (!registrationNeeded){
			delayRefreshTestTabTimer = window.setTimeout(delayRefreshTestTab,15000);			//after 15 seconds, refresh the homepage.
		}
		else{
			tryToRegisterInMainFrameTimer = window.setTimeout(tryToRegisterInMainFrame, 15000);				//if the site needs register, after 10 seconds, try register the user.
		}
	}
	else if (!usedFBSDK)
	{
		log('Phase 9 - seen FB OAuth response for session B.\n');
		capturingPhase++;
		if (oldRedirectDomain != "") {
			log("restored redirect domain to previous value.");
			redirectDomain = oldRedirectDomain;
		}
		if (!registrationNeeded){
			delayRefreshTestTabTimer = window.setTimeout(delayRefreshTestTab,15000);			//after 15 seconds, refresh the homepage.
		}
		else{
			tryToRegisterInMainFrameTimer = window.setTimeout(tryToRegisterInMainFrame, 15000);				//if the site needs register, after 10 seconds, try register the user.
		}
	}
}

function extractContent(){
	try{testSuiteWorker.port.emit("action",{"action":"extractContent"});} catch(ex){
		log("testSuiteworker hidden frame error 4, retrying in 10 secs...");
		extractContentTimer = window.setTimeout(extractContent,10000);
	}
}

function testSuitePhase10(url){
	if (capturingPhase == 1) {
		try {testSuiteWorker.port.emit("action",{"action": "navigateTo", "site":siteToTest});} catch(ex){
			window.setTimeout(testSuitePhase10.bind(window,url),10000);
			log("testSuiteWorker hidden frame error 1, waiting for 10 secs.");
		}
		return;
	}
	else if (capturingPhase != 10) {
		return;
	}
	assume(capturingPhase == 10, "Phase 10 violation");
	log('Phase 10 - recorded account B header data.\n');
	if (!searchForSignUpForFB){
		storageRecord[siteToTest].authenticatedSessionRequest2 = bufferedRequests[url];
		storageRecord[siteToTest].authenticatedSessionResponse2 = bufferedResponses[url];
		if (oldCapturingURLs.length != 0) capturingURLs = oldCapturingURLs;
		capturingPhase++;
		if (!registrationNeeded) checkLoginButtonRemovedTimer = window.setTimeout(checkLoginButtonRemoved, 12000);
		else extractContentTimer = window.setTimeout(extractContent,12000);
	}
	else {
		startOver();
		capturingPhase = 1;
		testedSearchForSignUp = true;
		log("Register completed, now wait 10 secs (for page to load) and go back to phase 1 and restart the login SSO process");
		window.setTimeout(testSuitePhase10.bind(window,url),10000);
	}
}

function processBuffer(url)
{
	//Phase 0: onload event fired on first visit to test page, anonymous session 1.
	//Phase 1: headers received on second visit to test page, anonymous session 1.
	if (capturingPhase == 1 && checkAgainstFilter(url, capturingPhase))
	{
		//visit the page for the second time, anonymous session 1.
		testSuitePhase1(url);
		FBAccount = 1;
		return;
	}
	//Phase 2: headers received on FB login SSO page.
	if (capturingPhase == 2 && checkAgainstFilter(url, capturingPhase) && loginButtonClicked && sawDialogOAuth)
	{
		testSuitePhase2(url);
		sawDialogOAuth = false;
		searchingForLoginButton = false;
		return;
	}
	//Phase 3: saw response from FB SSO process for session A.
	if (capturingPhase == 3 && checkAgainstFilter(url, capturingPhase) && loginButtonClicked)
	{
		testSuitePhase3(url);
		return;
	}
	//Phase 4: headers received on first visit to test page, authenticated session A.
	if (capturingPhase == 4 && checkAgainstFilter(url, capturingPhase))
	{
		if (!readyToRecordSessionData) return;
		readyToRecordSessionData = false;
		//visit the page with authenticated cookies
		loginButtonClicked = false;				//set it up for the next authenticated session visit.
		testSuitePhase4(url);
		return;
	}
	//Phase 5: From 5 seconds after Phase 4. Delete all cookies and revisit the test page. Not triggered by an event.
	//Phase 6: onload event fired on first visit to test page, anonymous session 2.
	//Phase 7: headers received on second visit to test page, anonymous session 2.
	if (capturingPhase == 7 && checkAgainstFilter(url, capturingPhase))
	{
		//revisit the page without cookies
		testSuitePhase7(url);
		FBAccount = 2;
		return;
	}
	//Phase 8: onload event fired on FB login SSO page for account B.
	if (capturingPhase == 8 && checkAgainstFilter(url, capturingPhase) && loginButtonClicked && sawDialogOAuth)
	{
		testSuitePhase8(url);
		sawDialogOAuth = false;
		return;
	}
	//Phase 9: saw response from FB SSO process for session B.
	if (capturingPhase == 9 && checkAgainstFilter(url, capturingPhase) && loginButtonClicked)
	{
		testSuitePhase9(url);
		return;
	}
	//Phaes 10: headers received on first visit to test page, authenticated session B.
	if (capturingPhase == 10 && checkAgainstFilter(url, capturingPhase))
	{
		//after clicking login button, enter different credential and receive headers.
		if (!readyToRecordSessionData) return;
		readyToRecordSessionData = false;
		loginButtonClicked = false;				//set it up for the next authenticated session visit.
		testSuitePhase10(url);
		return;
	}
}

function processLoaded(url){
	if (capturingPhase == 0 && checkAgainstFilter(url, capturingPhase))
	{
		//first visit done
		log('Phase 0 - done loading anonymously the first time.\n');
		capturingPhase++;
		window.setTimeout( function(){try{testSuiteWorker.port.emit("action",{"action": "navigateTo", "site":siteToTest});} catch(ex){log("testSuiteWorker hidden frame error 5");}}, 2000);
		return;
	}
	if (capturingPhase == 6 && checkAgainstFilter(url, capturingPhase))
	{
		//second visit done
		log('Phase 6 - done loading anonymously the second time.\n');
		window.setTimeout( function(){capturingPhase++;try{testSuiteWorker.port.emit("action",{"action": "navigateTo", "site":siteToTest});} catch(ex){log("testSuiteworker hidden frame error 6");}}, 2000);
		return;
	}
}


//Traffic interceptors.

var observerService = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);

var bufferedRequestsObserver = {
    observe: function(aSubject, aTopic, aData) {
		if ("http-on-modify-request" == aTopic) {
			var gchannel = aSubject.QueryInterface(Ci.nsIHttpChannel)
			var url = gchannel.URI.spec;
			if (!checkAgainstFilter(url, capturingPhase)) return;									//this filters lots of urls.
			//--------This is the url of interest, we should start recording here--------------
			var postDATA = "";
			var cookies = "";
			var requestRecord = new RequestRecord();
			requestRecord.url = url;
			try {cookies = gchannel.getRequestHeader("cookie");} catch(e){}						//this creates lots of errors if not caught
			requestRecord.cookies = cookies;
			if (gchannel.requestMethod == "POST")
			{
				var channel = gchannel.QueryInterface(Ci.nsIUploadChannel).uploadStream;  
				var prevOffset = channel.QueryInterface(Ci.nsISeekableStream).tell();
				channel.QueryInterface(Ci.nsISeekableStream).seek(Ci.nsISeekableStream.NS_SEEK_SET, 0);  
				var stream = Cc["@mozilla.org/binaryinputstream;1"].createInstance(Ci.nsIBinaryInputStream);  
				stream.setInputStream(channel);  
				var postBytes = stream.readByteArray(stream.available());  			//this is going to mess up with POST action.
				poststr = String.fromCharCode.apply(null, postBytes);  
				
				//This is a workaround that sometimes the POST data contains Content-type and Content-length header.
				//This here may cause a bug, as we are simply discarding all \ns and get the last segment.
				var splitted = poststr.split('\n');									
				poststr = splitted[splitted.length-1];
				requestRecord.postDATA = poststr;
				
				channel.QueryInterface(Ci.nsISeekableStream).seek(Ci.nsISeekableStream.NS_SEEK_SET, prevOffset);
				//This following may alter post data.
				//var inputStream = Cc["@mozilla.org/io/string-input-stream;1"].createInstance(Ci.nsIStringInputStream);
				//inputStream.setData(poststr, poststr.length); 
				//var uploadChannel = gchannel.QueryInterface(Ci.nsIUploadChannel);
				//uploadChannel.setUploadStream(inputStream, "application/x-www-form-urlencoded", -1);
				//uploadChannel.requestMethod = "POST";
			}
			bufferedRequests[url] = requestRecord;
		}
    }
}

observerService.addObserver(bufferedRequestsObserver, "http-on-modify-request", false);

function TracingListener() {
    this.originalListener = null;
	this.receivedData = [];
	this.setCookieHeader = "";
}

TracingListener.prototype =
{
    onDataAvailable: function(request, context, inputStream, offset, count)
    {
        var binaryInputStream = CCIN("@mozilla.org/binaryinputstream;1",
                "nsIBinaryInputStream");
        var storageStream = CCIN("@mozilla.org/storagestream;1", "nsIStorageStream");
        var binaryOutputStream = CCIN("@mozilla.org/binaryoutputstream;1",
                "nsIBinaryOutputStream");

        binaryInputStream.setInputStream(inputStream);
        storageStream.init(8192, count, null);
        binaryOutputStream.setOutputStream(storageStream.getOutputStream(0));

        // Copy received data as they come.
        var data = binaryInputStream.readBytes(count);
        this.receivedData.push(data);
				
		//to modify response, modify the variable 'data' above. The next statement is going to write data into outputStream and then pass it to the next listener (and eventually the renderer).
        binaryOutputStream.writeBytes(data, count);

        this.originalListener.onDataAvailable(request, context,
            storageStream.newInputStream(0), offset, count);
		
    },

    onStartRequest: function(request, context) {
        this.originalListener.onStartRequest(request, context);
    },

    onStopRequest: function(request, context, statusCode)
    {
        // Get entire response
        var responseBody = this.receivedData.join();
		var url = request.URI.spec;										//request.URI means the current URI (after 302 redirect)
		//if (capturingPhase == 2 || capturingPhase == 8) url = request.originalURI.spec;		//request.originalURI means the first URI (before 302 redirect)
		//For FB, oauth/dialog API is the original URI.
		//Note: originalURI at observe function (outside of this) needs to be URI, not originalURI, lol.
		if (checkAgainstFilter(url, capturingPhase))
		{
			var responseRecord = new ResponseRecord();
			responseRecord.url = url;
			responseRecord.body = responseBody.substr(0,1500);				//now only record 1500 characters
			responseRecord.setCookies = this.setCookieHeader;
			bufferedResponses[url] = responseRecord;
			processBuffer(url);
		}
        this.originalListener.onStopRequest(request, context, statusCode);
    },

    QueryInterface: function (aIID) {
        if (aIID.equals(Ci.nsIStreamListener) ||
            aIID.equals(Ci.nsISupports)) {
            return this;
        }
        throw Cr.NS_NOINTERFACE;
    }
}

var httpResponseObserver =
{
    observe: function(aSubject, aTopic, aData)
    {
        if (aTopic == "http-on-examine-response")
        {
			var gchannel = aSubject.QueryInterface(Ci.nsIHttpChannel)
			var url = gchannel.URI.spec;
			if (checkAgainstFilter(url, capturingPhase)){
			
				var notAppsFacebookComDomain = true;
				var isHostRelatedDomain = true;
				if ((capturingPhase == 3 || capturingPhase == 9) && !usedFBSDK)
				{
					//This helps tackle the 'in-between-hop' two redirects situation seen in pinterest and imgur.
					try {
						var newRedirectURI = gchannel.getResponseHeader('Location');
						if (newRedirectURI && newRedirectURI!=""){
							//if there is a redirect, we need to add that to storageRecord.facebookDialogOAuthResponse
							if (additionalRedirectInfo.indexOf(gchannel.originalURI.spec)==-1) additionalRedirectInfo = additionalRedirectInfo + gchannel.originalURI.spec + "\n";
							var urlWithoutHash = url.substr(0,url.indexOf('#'));
							if (additionalRedirectInfo.indexOf(urlWithoutHash)==-1) additionalRedirectInfo = additionalRedirectInfo + url + "\n";
							additionalRedirectInfo = additionalRedirectInfo + newRedirectURI +"\n";
						}
						if (newRedirectURI && newRedirectURI.indexOf('http')==0) {
							//still keep the old value so that we can restore it later.
							var protocol = newRedirectURI.substr(0,newRedirectURI.indexOf('/')) + "//";
							newRedirectURI = newRedirectURI.substr(newRedirectURI.indexOf('/')+2,newRedirectURI.length);
							if (newRedirectURI.indexOf('/')!=-1) newRedirectURI = newRedirectURI.substr(0,newRedirectURI.indexOf('/'));
							newRedirectURI = protocol + newRedirectURI;
							if (newRedirectURI != redirectDomain){
								log("Redirect domain changed to: " + newRedirectURI);
								if (oldRedirectDomain == "") oldRedirectDomain = redirectDomain;
								redirectDomain = newRedirectURI;
							}
						}
					}
					catch(ex){};
				}
				if (capturingPhase == 4 || capturingPhase == 10){
					try {
						var newSiteToDetect = gchannel.getResponseHeader('Location');
						if (newSiteToDetect.indexOf('#')!=-1) newSiteToDetect = newSiteToDetect.substr(0,newSiteToDetect.indexOf('#'))		//get rid of the sharp.
						if (newSiteToDetect) {
							//if it's a relative path, we need to pad it to full path.
							if (newSiteToDetect.indexOf('http')!=0){
								//if the first char is a slash, add URL's domain in front of it.
								if (newSiteToDetect.indexOf('/')==0) {
									var temp = url.substr(url.indexOf('/')+2,url.length);
									if (temp.indexOf('/')!=-1){
										var protocol = url.substr(0,url.indexOf('/')) + "//";
										newSiteToDetect = protocol + temp.substr(0,temp.indexOf('/')) + newSiteToDetect;
									}
									else {
										newSiteToDetect = url + newSiteToDetect;
									}
								}
								else {
									newSiteToDetect = url + newSiteToDetect;
								}
							}
							//still keep the old value so that we can restore it later.
							if (capturingURLs.indexOf(newSiteToDetect)==-1){
								if (oldCapturingURLs.length == 0) oldCapturingURLs = capturingURLs;
								capturingURLs.push(newSiteToDetect);
								log("capturingURLs appended with: " + newSiteToDetect);
							}
						}
					}
					catch(ex){};
				}
				
				if (url.startsWith("https://www.facebook.com/dialog/oauth") || url.startsWith("http://www.facebook.com/dialog/oauth")) {
					//eliminate situation where redirect_uri starts with "http://apps.facebook.com".
					if (url.indexOf("static.ak.facebook.com")==-1) {
						var temp = url.substr(url.indexOf('redirect_uri='),url.length);
						if (temp.indexOf('&')!=-1)
						{
							temp = decodeURIComponent(temp.substr(13,temp.indexOf('&')-13));
						}
						else
						{
							temp = decodeURIComponent(temp.substr(13,temp.length));
						}
						if (temp.indexOf("http://www.facebook.com/dialog/return")!=0 && temp.indexOf("https://www.facebook.com/dialog/return")!=0) {
							if (temp.indexOf('http://apps.facebook.com') == 0 || temp.indexOf('https://apps.facebook.com') == 0)
							{
								notAppsFacebookComDomain = false;
							}
							//also test if the redirect domain is in any of the capturing URLs' root domains, if it's not http://www.facebook.com/dialog/return.
							temp = Utils.getTLDFromURL(temp);
							var i = 0;
							var flag = !conf.mustBeHostRelatedDomain;
							for (i = 0; i < capturingURLs.length; i++){
								if (temp == Utils.getTLDFromURL(capturingURLs[i])) {
									flag = true;
									break;
								}
							}
							isHostRelatedDomain = flag;
						}
					}
				}
				if ((url.startsWith("https://www.facebook.com/dialog/oauth") || url.startsWith("http://www.facebook.com/dialog/oauth")) && !FBSDKDetermined && notAppsFacebookComDomain && isHostRelatedDomain){
					FBSDKDetermined = true;
					if (url.indexOf("static.ak.facebook.com")==-1) 
					{
						log('This site does NOT use FB SDK');
						usedFBSDK = false;
						if (redirectDomain=="")
						{
							redirectDomain = url.substr(url.indexOf('redirect_uri='),url.length);
							if (redirectDomain.indexOf('&')!=-1)
							{
								redirectDomain = decodeURIComponent(redirectDomain.substr(13,redirectDomain.indexOf('&')-13));
							}
							else
							{
								redirectDomain = decodeURIComponent(redirectDomain.substr(13,redirectDomain.length));
							}
							if (redirectDomain.indexOf("http://www.facebook.com/dialog/return")==0) {
								loginButtonClicked = true;			//this must be clicked from an iframe, let's make sure this var is set to true.
								log("Site uses social plugin button.php, redirect domain changed to http://static.ak.facebook.com/connect/xd_arbiter.php");
								redirectDomain = "http://static.ak.facebook.com/connect/xd_arbiter.php";
							}
							else if (redirectDomain.indexOf("https://www.facebook.com/dialog/return")==0) {
								loginButtonClicked = true;			//this must be clicked from an iframe, let's make sure this var is set to true.
								log("Site uses social plugin button.php, redirect domain changed to https://s-static.ak.facebook.com/connect/xd_arbiter.php");
								redirectDomain = "https://s-static.ak.facebook.com/connect/xd_arbiter.php";
							}
							else {
								var protocol = redirectDomain.substr(0,redirectDomain.indexOf('/')) + "//";
								redirectDomain = redirectDomain.substr(redirectDomain.indexOf('/')+2,redirectDomain.length);
								if (redirectDomain.indexOf('/')!=-1) redirectDomain = redirectDomain.substr(0,redirectDomain.indexOf('/'));
								redirectDomain = protocol + redirectDomain;
								//this is a workaround on FB's decode URI function differs from JS's decodeURIComponent function. It abandons the tail of the URL.
							}
						}
						log('the redirect domain is: '+redirectDomain);
					}
					else {
						usedFBSDK = true;
						log('This site uses FB SDK');
					}
				}
				
				//need to check dialog oauth existence to allow capturingPhase to grow to 3/9
				if ((url.startsWith("https://www.facebook.com/dialog/oauth") || url.startsWith("http://www.facebook.com/dialog/oauth")) && notAppsFacebookComDomain && isHostRelatedDomain)
				{
					sawDialogOAuth = true;
				}
				
				//for registration plugins
				if (url.indexOf("social_plugin%3Dregistration")!=-1 && searchForSignUpForFB && (capturingPhase == 2 || capturingPhase == 8)){
					sawDialogOAuth = true;
					usedFBSDK = false;
					redirectDomain = "https://www.facebook.com/plugins/registration.php";
				}
				var newListener = new TracingListener();
				try {newListener.setCookieHeader = gchannel.getResponseHeader('Set-Cookie');} catch(ex){};		//stupid FF sliently fails if no set-cookie header is present in a response header, STUPID!  This is a workaround.
				aSubject.QueryInterface(Ci.nsITraceableChannel);
				newListener.originalListener = aSubject.setNewListener(newListener);
			}
        }
    },

    QueryInterface : function (aIID)
    {
        if (aIID.equals(Ci.nsIObserver) ||
            aIID.equals(Ci.nsISupports))
        {
            return this;
        }

        throw Cr.NS_NOINTERFACE;

    }
};

observerService.addObserver(httpResponseObserver, "http-on-examine-response", false);

//For detecting error configurations in app

function FBSSOErrorTracingListener() {
    this.originalListener = null;
}

FBSSOErrorTracingListener.prototype =
{
    onDataAvailable: function(request, context, inputStream, offset, count)
    {
       var binaryInputStream = CCIN("@mozilla.org/binaryinputstream;1",
                "nsIBinaryInputStream");
        var storageStream = CCIN("@mozilla.org/storagestream;1", "nsIStorageStream");
        var binaryOutputStream = CCIN("@mozilla.org/binaryoutputstream;1",
                "nsIBinaryOutputStream");

        binaryInputStream.setInputStream(inputStream);
        storageStream.init(8192, count, null);
        binaryOutputStream.setOutputStream(storageStream.getOutputStream(0));

        // Copy received data as they come.
        var data = binaryInputStream.readBytes(count);
		//we leave this here because we want to interrupt normal data
		if (data.indexOf('This app is in sandbox mode.  Edit the app configuration at')!=-1 || data.indexOf('This+app+is+in+sandbox+mode.++Edit+the+app+configuration+at')!=-1)
		{
			log('Site support FB but its configuration is in an error state.\n');
			callback(false,true);
			return;
		}				
		//to modify response, modify the variable 'data' above. The next statement is going to write data into outputStream and then pass it to the next listener (and eventually the renderer).
        binaryOutputStream.writeBytes(data, count);

        try {
			this.originalListener.onDataAvailable(request, context,storageStream.newInputStream(0), offset, count);
		}
		catch(ex){
			//some wierd errors, ignored.
		}
		
    },

    onStartRequest: function(request, context) {
        try {
			this.originalListener.onStartRequest(request, context);
		}
		catch (ex){
			//some wierd errors, ignored.
		}
    },

    onStopRequest: function(request, context, statusCode)
    {
        try {
			this.originalListener.onStopRequest(request, context, statusCode);
		}
		catch (ex){
			//some wierd errors, ignored.
		}
    },

    QueryInterface: function (aIID) {
        if (aIID.equals(Ci.nsIStreamListener) ||
            aIID.equals(Ci.nsISupports)) {
            return this;
        }
        throw Cr.NS_NOINTERFACE;
    }
}

var FBSSOErrorObserver =
{
    observe: function(aSubject, aTopic, aData)
    {
        if (aTopic == "http-on-examine-response")
        {
			var newListener = new FBSSOErrorTracingListener();
			aSubject.QueryInterface(Ci.nsITraceableChannel);
			newListener.originalListener = aSubject.setNewListener(newListener);
        }
    },

    QueryInterface : function (aIID)
    {
        if (aIID.equals(Ci.nsIObserver) ||
            aIID.equals(Ci.nsISupports))
        {
            return this;
        }

        throw Cr.NS_NOINTERFACE;

    }
};

observerService.addObserver(FBSSOErrorObserver, "http-on-examine-response", false);
///////

//exports
exports.initPressLoginButton = function(worker){
	pressLoginButtonWorker = worker;
	//listen to events
	pressLoginButtonWorker.port.on("loginInfo",function(info){
			resetIframeClickedInfo();
			if (capturingPhase == 2 && loginClickAttempts == 1) {
				loginButtonOuterHTML = info.loginButtonOuterHTML;			//only record when pressing login button in phase 2.
				loginButtonXPath = info.loginButtonXPath;
				log("Recorded First 100 chars of the outerHTML of the clicked login button is: "+loginButtonOuterHTML.substr(0,100));
				log("Recorded XPath of the clicked login button is: "+loginButtonXPath);
			}
			log("pressing Login button @ XPath from top: " + info.loginButtonXPath);
			try { pressLoginButtonWorker.port.emit("readyToClick","readyToClick");} catch(ex){log("pressLoginButtonWorker hidden frame error 2");}
		}
	);
	pressLoginButtonWorker.port.on("noLoginButtonFound",function(){
		resetIframeClickedInfo();
		//performance optimization, this function body can be empty if we don't care about performance.
		log("No login button found under this configuration, fast-forwarding...");
		if (loginClickAttempts == 2) indexToClick2 = 2;
		if (loginClickAttempts == 1) {indexToClick = 2;indexToClick2 = 2;loginClickAttempts=2;}
		if (prepareLoginButtonIndexToClickTimer) window.clearTimeout(prepareLoginButtonIndexToClickTimer);
		prepareLoginButtonIndexToClick();
	});
	pressLoginButtonWorker.port.on("getIndexOfLoginButtonToPress", prepareLoginButtonIndexToClick);
	pressLoginButtonWorker.port.on("clearPressLoginButtonTimer", function(response){
		if (prepareLoginButtonIndexToClickTimer) window.clearTimeout(prepareLoginButtonIndexToClickTimer);			//this happens when a new page loads. When this happens, we want to clear the old timer, and try to click the login button in this new page.
	});
	pressLoginButtonWorker.port.on("checkTestingStatus", function(response){
		var shouldClick = (capturingPhase == 2 || capturingPhase == 8);
		try {if (shouldClick) pressLoginButtonWorker.port.emit("checkTestingStatus",{"shouldClick":shouldClick, "account":accountsInfo, "searchForSignUpForFB":searchForSignUpForFB});} catch(ex){log("pressLoginButtonWorker hidden frame error 3");}
	});
	pressLoginButtonWorker.port.on("sendLoginButtonInformation", function(response){
		var loginFailure;
		log("Current login button xpath: "+response.loginButtonXPath);
		log("Recorded login button xpath: "+loginButtonXPath);
		if (response.loginButtonXPath == "USER_INFO_EXISTS!" && response.loginButtonOuterHTML == "USER_INFO_EXISTS!") {
			log("login successful! After logging in the user information is present!");
			loginFailure = false;
		}
		else if (response.loginButtonXPath == loginButtonXPath || response.loginButtonOuterHTML == loginButtonOuterHTML) {
			//if loginButtonXPath == "FACEBOOK_PLUGIN!", this branch would never be taken and will always go to else branch (blame oracle). We assume FB plugin will always disappear after user successfully logs in.
			log("login failed! After logging in the login button is still present!");
			loginFailure = true;
		}
		else {
			log("login successful, but oracle failed.");
			if (storageRecord[siteToTest].facebookDialogOAuthResponse) {
				var res = storageRecord[siteToTest].facebookDialogOAuthResponse.body;
				if (!usedFBSDK) res = storageRecord[siteToTest].facebookDialogOAuthResponse.url;		//means the app didn't use the SDK, which means the actual redirect url is in the 302 url, as opposed to javascript content.
				var score = 0;
				if (typeof res == "string" && res.indexOf('access_token')==-1) {
					log("This doesn't matter because access_token is not seen in this traffic.");
					log(siteToTest + " is not vulnerable to [1], access_token not spotted (oracle not working).");
					score++;
				}
				if (typeof res == "string" && res.indexOf('signed_request')==-1) {
					log("This doesn't matter because signed_request is not seen in this traffic.");
					log(siteToTest + " is not vulnerable to [3], signed_request not spotted (oracle not working).");
					score++;
				}
				if (score<2) {
					log(siteToTest + " failed because oracle failed though we are able to login.");
					callback(false,false);
					return;
				}
				else {
					callback(false,true);
					return;
				}
			}
			return;
		}
		if (loginFailure){
			if (testedSearchForSignUp && !searchForSignUpForFB){
				//already tried to search for signup and register and did successfully, but afterwards again we cannot login successfully.  Make sure we don't go into the endless loop of trying to search for signup button and register again. Just fail the test here.
				log("Cannot login to this site after registered successfully, this is a corner case.");
				callback(false,false);
				return;
			}
			if (!registrationNeeded) {
				//Need to return to phase - 4 and set registration flag.
				loginClickAttempts = 0;
				loginButtonClicked = false;
				deleteCookies();
				sawDialogOAuth = false;
				capturingPhase = capturingPhase - 4;
				registrationNeeded = true;
				Utils.closeAllOtherTabs();
				log("Site needs registration, returning to phase " + capturingPhase.toString() + " and set the flag");
				try {testSuiteWorker.port.emit("action",{"action": "navigateTo", "site":siteToTest});} catch(ex){log("testSuiteWorker hidden frame error 7");}
				return;
			}
			else {
				//HTTPS-Iframe submission already clicked twice, don't need to do it again; Host page submission only clicked once, need to do it again.
				if (registerAttempts < 2 && !iframeRegistrationSubmitted)
				{
					registerAttempts++;
					Utils.closeAllOtherTabs();
					log("Trying to register for the " + registerAttempts.toString() + "th time...");
					tryToRegisterInMainFrame();
					return;
				}
				else {
					//registration failed.
					if (searchForSignUpForFB) {
						log("Cannot register this site when searching for signup button... Give up.");
						callback(false,false);
						return;
					}
					else {
						if (capturingPhase <= 5) {
							testedSearchForSignUp = true;
							searchForSignUpForFB = true;
							loginClickAttempts = 0;
							loginButtonClicked = false;
							loginButtonOuterHTML = "";
							loginButtonXPath = "";
							redirectDomain = "";
							deleteCookies();
							FBSDKDetermined = false;
							sawDialogOAuth = false;
							capturingPhase = 1;
							indexToClick = 0;
							indexToClick2 = 0;
							tryFindInvisibleLoginButton = conf.tryFindInvisibleLoginButton || false;
							searchingForLoginButton = true;
							registrationNeeded = conf.registrationNeeded || false;
							Utils.closeAllOtherTabs();
							iframeRegistrationSubmitted = false;
							registerAttempts = 0;
							stallChecker(true);
							log("trying to switch to detecting signup button mode...");
							log("Cannot register this site when searching for login button, switching to detect sign up button.");
							try {testSuiteWorker.port.emit("action",{"action": "navigateTo", "site":siteToTest});} catch(ex){log("testSuiteWorker hidden frame error 1");}
						}
						else {
							log("Registration used to work for previous login attempts, but failed for this attempt.");
							callback(false,false);
							return;
						}
					}
				}
			}
		}
		else {
			//login successful.
			if (!registrationNeeded) {
				assume(capturingPhase == 5 || 11, "sendLoginButtonInformation violation");
				try{ testSuiteWorker.port.emit("action",{"action":"extractContent"});} catch(ex){log("testSuiteWorker hidden frame error 8");}
			}
			else {
				assume(capturingPhase == 4 || 10, "sendLoginButtonInformation violation");
				Utils.closeAllOtherTabs();
				delayRefreshTestTabTimer = window.setTimeout(delayRefreshTestTab,2000)					//Now we can refresh main tab.
			}
		}
	});
};

exports.initIFramePressLoginButtonWorker = function(worker) {
	worker.port.on("checkTestingStatus", function(response){
		var shouldClick = (capturingPhase == 2 || capturingPhase == 8);
		try {if (shouldClick) worker.port.emit("checkTestingStatus",{shouldClick:shouldClick, indexToClick:indexToClick2, "account":accountsInfo, "loginClickAttempts":loginClickAttempts+1, "debug":debug, "searchForSignUpForFB":searchForSignUpForFB, "iframeClickedXPATH":iframeClickedXPATH, "iframeClickedOuterHTML":iframeClickedOuterHTML, "tryFindInvisibleLoginButton":tryFindInvisibleLoginButton});} catch(ex){log("IFrame press login button worker hidden frame error");}			//Only gives indexToClick2 because we assume the first click is not from iframe, the second is.
	});
	worker.port.on('loginButtonClicked', function(response){
		if (redirectDomain == 'http://static.ak.facebook.com/connect/xd_arbiter.php' || redirectDomain == 'https://s-static.ak.facebook.com/connect/xd_arbiter.php'){
			loginButtonClicked = true;			//if it's the social login widget scenario.
		}
		if (response.shouldCountClick && loginClickAttempts == 0){
			if (capturingPhase == 2) {
				log("Recorded login XPATH in plugin iframe!");
				loginButtonOuterHTML = "FACEBOOK_PLUGIN!";			//only record when pressing login button in phase 2.
				loginButtonXPath = "FACEBOOK_PLUGIN!";
			}
			loginButtonClicked = true;			//if it's the social registration widget scenario.
		}
		//record what's been clicked and inform iframes next time they ask.
		iframeClickedXPATH.push(response.loginButtonXPath);
		iframeClickedOuterHTML.push(response.loginButtonOuterHTML);
	});
	worker.port.on("writeToFileRequest",writeToFileRequest);
}

exports.initAutomateSSOWorker = function(worker){
	if (worker.tab.i == undefined)
	{
		worker.tab.i = tabs.length;
		if (worker.tab.i != 1) log("Tab " + worker.tab.i.toString()+" created.");
	}
	automateSSOWorker = worker;
	automateSSOWorker.port.emit("issueUserInfo",accountsInfo);
	automateSSOWorker.port.on("requestFBAccount",function(){
		try {automateSSOWorker.port.emit("requestFBAccount",{FBAccount:FBAccount, shouldAutomateSSO:(capturingPhase == 3 || capturingPhase == 9)});}
		catch (ex) {log("Tab closed itself too quick, must not be automateSSO situation, ignore hidden frame error.");}
	});
	automateSSOWorker.port.on("credentialsInserted",function(){
		credentialsInserted = true;
		automateSSOWorker.port.emit("goAheadAndClick","");
	});
	automateSSOWorker.port.on("appError",function(){
		log('Site support FB but its configuration is in an error state.\n');
		callback(false,true);
		return;
	});
}

exports.initRegistrationWorker = function(worker){
	var prepareUserInfo = function (response){
		if (typeof accountsInfo != "undefined"){
			try {registrationWorker.port.emit("issueUserInfo",{"accountsInfo":accountsInfo[FBAccount-1], "debug":debug});} catch (ex) {
				//dont do anything, since the previous window is closed.
			}
		}
		else {
			window.setTimeout(prepareUserInfo,500);
		}
	}
	if (worker.tab.i == 1)
	{
		originalRegistrationWorker = worker;
	}
	registrationWorker = worker;
	registrationWorker.port.on("registrationSubmitted",function(response){
		buttonToClick = response.buttonToClick;
		elementsToFill = response.elementsToFill;
		testRegisterSuccessTimer = window.setTimeout(testRegisterSuccess,10000);			//after 10 seconds, test if registration is successful.
	});
	registrationWorker.port.on("registrationFailed", function(response){
		//this message is received because worker cannot find submit button.
		log(response.errorMsg);
		if (searchForSignUpForFB){
			log("Cannot register this site when searching for signup button... Give up.");
			callback(false,false);
			return;
		}
		else {
			if (capturingPhase <= 5) {
				testedSearchForSignUp = true;
				searchForSignUpForFB = true;
				loginClickAttempts = 0;
				loginButtonClicked = false;
				loginButtonOuterHTML = "";
				loginButtonXPath = "";
				redirectDomain = "";
				deleteCookies();
				FBSDKDetermined = false;
				sawDialogOAuth = false;
				capturingPhase = 1;
				indexToClick = 0;
				indexToClick2 = 0;
				tryFindInvisibleLoginButton = conf.tryFindInvisibleLoginButton || false;
				searchingForLoginButton = true;
				registrationNeeded = conf.registrationNeeded || false;
				stallChecker(true);
				iframeRegistrationSubmitted = false;
				registerAttempts = 0;
				Utils.closeAllOtherTabs();
				log("trying to switch to detecting signup button mode...");
				log("Cannot register this site when searching for login button, switching to detect sign up button.");
				try {testSuiteWorker.port.emit("action",{"action": "navigateTo", "site":siteToTest});} catch(ex){log("testSuiteWorker hidden frame error 1");}
			}
			else {
				log("Registration used to work for previous login attempts, but failed for this attempt.");
				callback(false,false);
				return;
			}
		}
	});
	registrationWorker.port.on("getUserInfo",prepareUserInfo);
	registrationWorker.port.on("writeToFileRequest",writeToFileRequest);
}

exports.initIFrameRegistrationWorker = function(worker) {
	var prepareUserInfo = function (response){
		if (typeof accountsInfo != "undefined"){
			worker.port.emit("issueUserInfo",accountsInfo[FBAccount-1]);
		}
		else {
			window.setTimeout(prepareUserInfo,500);
		}
	}
	worker.port.on("shouldRegisterIframe", function (response){
		try {
			worker.port.emit("shouldRegisterIframe", {"shouldRegisterIframe":((capturingPhase == 4 || capturingPhase == 10) && registrationNeeded), "debug":debug});
		} catch(ex){
			log("initFrameRegistrationWorker hidden frame error.");
		}
	});
	worker.port.on("getUserInfo",prepareUserInfo);
	worker.port.on("registrationSubmitted",function(response){
		//iframe https submitted
		buttonToClick = response.buttonToClick;
		elementsToFill = response.elementsToFill;
		iframeRegistrationSubmitted = true;
		//10 seconds after initial submit button click, call checkloginstatus. Note that during this 10 secs submit button may be clicked for a second time.
	});
	worker.port.on("writeToFileRequest",writeToFileRequest);
}
	
exports.initTestSuiteWorker = function(worker){
	if (worker.tab.i == 1)
	{
		testSuiteWorker = worker;
	}
	else if (worker.tab.shouldBeTestSuiteWorker)
	{
		//in the middle of reset tab call
		worker.tab.i = 1;
		testSuiteWorker = worker;
	}
	else return;
	testSuiteWorker.port.on("loadedURL",function(url){
		if (typeof url == "undefined") return;
		processLoaded(url);
	});
	
	var extraCapturingURLs = function (site){
		if (capturingPhase != 0) return;
		if (site.indexOf('#')!=-1) site = site.substr(0,site.indexOf('#'))		//get rid of the sharp.
		log("Redirection detected - capturingURLs appended with " + site);
		capturingURLs.push(site);
		try {
			testSuiteWorker.port.emit("action", {"site": siteToTest, "action": "navigateTo"});
		} catch(ex){log("testSuiteWorker hidden frame error 10");}
		checkRedirectionAndAdjustTimer = window.setTimeout(checkRedirectionAndAdjust,10000);	//check if phase is > 0, if not, indicates the website redirected itself. We make adjustments according to it.
	}
	testSuiteWorker.port.on("getURL", extraCapturingURLs);
	testSuiteWorker.port.on("extractedContent", function(response){
		responseTextContent[FBAccount] = response;
		if (FBAccount == 1){
			log("Recorded extracted content from session 1.");
			if (operationMode == "enroll") {
				revisitSiteAnonymously();
			}
			else if (operationMode == "login") {
				callback(true, true);
				return;
			}
		}
		else if (FBAccount == 2){
			log("Phase 11: recorded extracted content from session 2.");
			capturingPhase++;
			observerService.removeObserver(httpResponseObserver, "http-on-examine-response");			
			observerService.removeObserver(FBSSOErrorObserver, "http-on-examine-response");			
			observerService.removeObserver(bufferedRequestsObserver, "http-on-modify-request");			
			removedObserver = true;
			callback(true, true);
			return;
		}
	});
}

exports.deleteCookies = deleteCookies;

exports.supportFBLogin = function(){return supportFBLogin;};
exports.resetIframeClickedInfo = resetIframeClickedInfo;
exports.log = log;
exports.debug = function(){return debug;};
exports.siteToTest = function(){return siteToTest;};
exports.storageRecord = function(){return storageRecord;};
exports.responseTextContent = function(){return responseTextContent;};
exports.testSuiteWorker = function(){return testSuiteWorker;};
exports.automateSSOWorker = function(){return automateSSOWorker;};
exports.pressLoginButtonWorker = function(){return pressLoginButtonWorker;};
exports.registrationWorker = function(){return registrationWorker;};
exports.capturingPhase = function(){return capturingPhase;};
exports.capturingURLs = function(){return capturingURLs;};
exports.loginButtonXPath = function(){return loginButtonXPath;};
exports.loginButtonOuterHTML = function(){return loginButtonOuterHTML;};
exports.indexToClick = function(){return indexToClick;};
exports.indexToClick2 = function(){return indexToClick2;};
exports.credentialsInserted = function(){return credentialsInserted;};
exports.testOverallSuccess = function(){return testOverallSuccess;};
exports.detectionMode = function(){return detectionMode};
exports.tryFindInvisibleLoginButton = function(){return tryFindInvisibleLoginButton;};
exports.usedFBSDK = function(){return usedFBSDK;};
exports.testRegistrationInProgress = function(){return testRegistrationInProgress;};
exports.redirectDomain = function(){return redirectDomain;};
exports.loginButtonClicked = function(){return loginButtonClicked;};
exports.setCapturingPhase = function(p){capturingPhase = p; return;};
exports.setFBAccount = function(p){FBAccount = p; return;};
exports.setRedirectDomain = function(p){redirectDomain = p; return;};
exports.setTestOverallSuccess = function(p){testOverallSuccess = p; return;};
exports.setCredentialsInserted = function(p){credentialsInserted = p; return;};
exports.pushCapturingURLs = function(p){capturingURLs.push(p); return;};
exports.restoreCapturingURLs = function(){if (oldCapturingURLs.length!=0) capturingURLs = oldCapturingURLs; return;};
exports.startOver = startOver;

Utils.initTab();

exports.enroll = function(accounts, site, cb){
	accountsInfo = accounts;
	callback = cb;
	Utils.resetTab();
	operationMode = "enroll";
	//start the entire process.
	window.setTimeout(startTest.bind(window,site),2000);
}

exports.login = function(accounts, userIndex, site, cb){
	//This actually can also register the account if the account doesn't exist.
	accountsInfo = new Array();			
	accountsInfo.push(accounts[userIndex]);
	accountsInfo.push(accounts[userIndex]);			//make the two accounts the same for the login situation
	callback = cb;
	Utils.resetTab();
	operationMode = "login";
	//start the entire process.
	window.setTimeout(startTest.bind(window,site),2000);
}