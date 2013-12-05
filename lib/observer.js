//observer.js is used to capture requests and record them.

const {Cc,Ci,Cr} = require("chrome");
var Utils = require('./utils');
var TestSites = require('./testSites');
//Traffic interceptors.

var observerService = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
var testSites = TestSites.testSites;
var window = Cc["@mozilla.org/appshell/appShellService;1"].getService(Ci.nsIAppShellService).hiddenDOMWindow;
var observerAttached = false;

function removeObserverIfAttached(){
	if (observerAttached) {
		observerService.removeObserver(observer, "http-on-modify-request");
		Utils.log('observer removed');
		observerAttached = false;
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
			if (Utils.getTrustedDomains().indexOf(Utils.getTLDFromURL(url))!=-1) return;
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
				Utils.saveToFile(url+"\r\n"+headers+"\r\nJSBC_POSTDATA:\r\n"+poststr+"\r\n--------------\r\n");
			}
			else { 
				Utils.saveToFile(url+"\r\n"+headers+"\r\n--------------\r\n");
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
	window.setTimeout(function(){observerService.removeObserver(observer, "http-on-modify-request");},10000);
}

exports.refreshAndRecord = function(site){
	addObserverIfUnattached();
	Utils.refreshFirstTab();
	window.setTimeout(removeObserverIfAttached,10000);
}
//window.setTimeout(Utils.navigateFirstTab.bind(this,testSites[0]),1000);
//window.setTimeout(Utils.closeAllTabs,10000);
