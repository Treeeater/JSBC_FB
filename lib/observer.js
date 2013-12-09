//observer.js is used to capture requests and record them.

const {Cc,Ci,Cr} = require("chrome");
var Utils = require('./utils');
var Enroller = require('./enroller');
var file = require("file");
var ccc = require("./ccc");
var fileComponent = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsILocalFile);
//Traffic interceptors.

var observerService = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
var window = Cc["@mozilla.org/appshell/appShellService;1"].getService(Ci.nsIAppShellService).hiddenDOMWindow;
var observerAttached = false;
var callback = function(){};
var siteToTest;
var userIndex;
var trustedDomains = [];
var fileNameToStoreTraffic = "";

var removeTimer;
var refreshTimer;

function refreshTestSuiteTab(siteToTest,userIndex){
	window.clearTimeout(refreshTimer);
	try {
		url = Enroller.testSuiteWorker().tab.url;
		trustedDomains.push(Utils.getTLDFromURL(url));
		fileNameToStoreTraffic = Utils.rootOutputPath + Utils.fileNameSanitize(siteToTest) + "\\" + (userIndex==0 ? "userA":"userB");
		if (!file.exists(fileNameToStoreTraffic)) {
			file.mkpath(fileNameToStoreTraffic);
			fileNameToStoreTraffic = fileNameToStoreTraffic + "\\1"+ (ccc.secondTimeRecording()? "_2":"") +".txt";
		}
		else {
			var i = 1;
			while (file.exists(fileNameToStoreTraffic + "\\" + i.toString() + (ccc.secondTimeRecording()? "_2":"") + ".txt"))
			{
				i++;
			}
			fileNameToStoreTraffic = fileNameToStoreTraffic + "\\" + i.toString() + (ccc.secondTimeRecording()? "_2":"") + ".txt";
		}
		
		//tabs[0].reload();
		Enroller.testSuiteWorker().tab.reload();
		removeTimer = window.setTimeout(removeObserverIfAttached,30000);			//timeout if we have to (passed 30 secs)
	}
	catch (ex){
		Utils.log("Test suite worker not ready for refresh, waiting for 10 secs");
		refreshTimer = window.setTimeout(refreshTestSuiteTab.bind(window, siteToTest, userIndex),10000);
	}
}

var saveTrace = function(content)
{
	if (!fileNameToStoreTraffic) return;
	fileComponent.initWithPath(fileNameToStoreTraffic);  // The path passed to initWithPath() should be in "native" form.
	var foStream = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
	foStream.init(fileComponent, 0x02 | 0x08 | 0x10, 0666, 0); 
	foStream.write(content+"\n", content.length+1);
	foStream.close();
}

function removeObserverIfAttached(){
	window.clearTimeout(removeTimer);
	if (observerAttached) {
		observerService.removeObserver(observer, "http-on-modify-request");
		Utils.log('observer removed');
		observerAttached = false;
		var temp = callback;			//reset the callback function
		callback = function(){};
		if (ccc.recordingTrace()) temp(siteToTest, userIndex);
	}
}

function addObserverIfUnattached(){
	if (!observerAttached) {
		observerService.addObserver(observer, "http-on-modify-request", false);
		Utils.log('observer attached');
		observerAttached = true;
	}
}

var observer = {
	observe: function(aSubject, aTopic, aData) {
		if ("http-on-modify-request" == aTopic) {
			var gchannel = aSubject.QueryInterface(Ci.nsIHttpChannel)
			var url = gchannel.URI.spec;
			if (trustedDomains.indexOf(Utils.getTLDFromURL(url))!=-1) return;
			//--------This is the url of interest, we should start recording here--------------
			var postDATA = "";
			var cookies = "";
			headers = "";
			poststr = "";
			var isOCSP = false;
			gchannel.visitRequestHeaders(function(header, value){
				if (header == "Content-Type" && value == "application/ocsp-request") {isOCSP = true;}
				headers += header + ": "+ value + "\r\n";
			});
			if (isOCSP) return;
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
				
				channel.QueryInterface(Ci.nsISeekableStream).seek(Ci.nsISeekableStream.NS_SEEK_SET, prevOffset);
				//This following may alter post data.
				//var inputStream = Cc["@mozilla.org/io/string-input-stream;1"].createInstance(Ci.nsIStringInputStream);
				//inputStream.setData(poststr, poststr.length); 
				//var uploadChannel = gchannel.QueryInterface(Ci.nsIUploadChannel);
				//uploadChannel.setUploadStream(inputStream, "application/x-www-form-urlencoded", -1);
				//uploadChannel.requestMethod = "POST";
			}
			if (poststr != "")
			{
				saveTrace(url+"\r\n"+headers+"\r\nJSBC_POSTDATA:\r\n"+poststr+"\r\n--------------\r\n");
			}
			else { 
				saveTrace(url+"\r\n"+headers+"\r\n--------------\r\n");
			}
		}
	}
}

/*exports.initTabInfoWorker = function(worker){
	worker.port.on("DomainReport", function(msg){
		Utils.saveToFile("Visiting "+msg+"\r\n");
		trustedHostDomains.push(Utils.getTLDFromDomain(msg));
	});
	worker.port.on("clearTrustedDomain",function(msg){
		trustedHostDomains = [];
	});
	worker.port.emit("reportDomain",{});
}*/
//Utils.deleteCookies();

exports.navAndRecord = function(site){
	observerService.addObserver(observer, "http-on-modify-request", false);
	Utils.navigateFirstTab(site);
	removeTimer = window.setTimeout(function(){observerService.removeObserver(observer, "http-on-modify-request");},10000);
}

exports.refreshAndRecord = function(site, u_i, cb){
	siteToTest = site;
	userIndex = u_i;
	callback = cb;
	addObserverIfUnattached();
	refreshTestSuiteTab(site, u_i);
}

exports.initTestSuiteWorker = function(worker){
	worker.port.on("loadedURL",function(resp){
		removeTimer = window.setTimeout(removeObserverIfAttached,10000);		//default timeout is 10 secs after load.
	});
}
//window.setTimeout(Utils.navigateFirstTab.bind(this,testSites[0]),1000);
//window.setTimeout(Utils.closeAllTabs,10000);
