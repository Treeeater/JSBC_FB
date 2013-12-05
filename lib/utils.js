const {Cc,Ci,Cr} = require("chrome");
var file = require("file");
var tabs = require("sdk/tabs");
var conf = require("./configuration");
//var profilePath = require("system").pathFor("ProfD");
var fileComponent = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsILocalFile);
var cookieService = Cc["@mozilla.org/cookiemanager;1"].getService(Ci.nsICookieManager2);
var trustedDomains = [];
var rootOutputPath = "D:\\Research\\JSBC\\results\\";
var fileNameToStoreTraffic = "";

var window = Cc["@mozilla.org/appshell/appShellService;1"].getService(Ci.nsIAppShellService).hiddenDOMWindow;

var log = function(str)
{
	console.log(str);
}

function fileNameSanitize(str)
{
	return str.replace(/[^a-zA-Z0-9\.]*/g,"").substr(0,32);
}

function getTLDFromDomain(domain)
{
	var temp = domain.split('.');
	if (temp.length <= 2) return domain;
	else return temp[temp.length-2] + '.' + temp[temp.length-1];
}

tabs.on('open', function onOpen(tab) {
	tab.i = tabs.length;
});

function closeAllOtherTabs(){
	if (tabs.length <= 1) return;
	for each (var tabIterator in tabs){
		if (tabIterator.i != 1) tabIterator.close();
	}
}

function closeAllTabs(){
	for each (var tabIterator in tabs){
		tabIterator.close();
	}
}

function navigateFirstTab(url){
	trustedDomains.push(getTLDFromURL(url));
	tabs[0].url = url;
	fileNameToStoreTraffic = rootOutputPath + fileNameSanitize(url);
	if (!file.exists(fileNameToStoreTraffic)) {
		file.mkpath(fileNameToStoreTraffic);
		fileNameToStoreTraffic = fileNameToStoreTraffic + "\\1.txt";
	}
	else {
		var i = 1;
		while (file.exists(fileNameToStoreTraffic + "\\" + i.toString() + ".txt"))
		{
			i++;
		}
		fileNameToStoreTraffic = fileNameToStoreTraffic + "\\" + i.toString() + ".txt";
	}
}

function refreshFirstTab(){
	url = tabs[0].url;
	trustedDomains.push(getTLDFromURL(url));
	tabs[0].reload();
	fileNameToStoreTraffic = rootOutputPath + fileNameSanitize(url);
	if (!file.exists(fileNameToStoreTraffic)) {
		file.mkpath(fileNameToStoreTraffic);
		fileNameToStoreTraffic = fileNameToStoreTraffic + "\\1.txt";
	}
	else {
		var i = 1;
		while (file.exists(fileNameToStoreTraffic + "\\" + i.toString() + ".txt"))
		{
			i++;
		}
		fileNameToStoreTraffic = fileNameToStoreTraffic + "\\" + i.toString() + ".txt";
	}
}

function deleteCookies()
{
	cookieService.removeAll();
}

function getTLDFromURL(url)
{
	var domain = "";
	if (url.indexOf('http')!=-1) domain = url.substr(url.indexOf('/')+2,url.length);			//get rid of protocol if there's one.
	if (domain.indexOf('/')!=-1) domain = domain.substr(0,domain.indexOf('/'));					//get rid of paths if there's one.
	if (domain.indexOf(':')!=-1) domain = domain.substr(0,domain.indexOf(':'));					//get rid of port if there's one.
	var domainArray = domain.split('.');
	if (domainArray.length < 2) return "";			//error. Never return TLD.
	domain = domainArray[domainArray.length-2] + '.' + domainArray[domainArray.length-1];
	return domain;
}

function initTab(){
	//called after firefox start-up.
	tabs.activeTab.attach({
		contentScript: 'document.location="http://www.cs.virginia.edu/~yz8ra/blank.html"'
	});
}

function resetTab(){
	//closeAllOtherTabs();
	//called after a test is done, reset testSuiteWorker and such that a dead worker cannot halt all tests.
	window.setTimeout(function(){tabs.open({
		url: "http://www.cs.virginia.edu/~yz8ra/blank.html",
		onOpen: function onOpen(tab) {
			function callthis(){
				for each (var tabIterator in tabs) {if (typeof tabIterator.shouldStay == "undefined" || !tabIterator.shouldStay) tabIterator.close();}
				tab.shouldStay = false;
			}
			tab.shouldStay = true;
			window.setTimeout(callthis,500);
		}
	});},500);
}

exports.saveToFile = function(content, fileName)
{
	if (fileName) {
		fileName = fileNameSanitize(fileName)+".txt";
		fileComponent.initWithPath(rootOutputPath+fileName);  // The path passed to initWithPath() should be in "native" form.
	}
	else {
		if (fileNameToStoreTraffic == "") {
			log("Error: fileNameToStoreTraffic not initialized!!!");
			return;
		}
		fileComponent.initWithPath(fileNameToStoreTraffic);  // The path passed to initWithPath() should be in "native" form.
	}
	var foStream = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
	foStream.init(fileComponent, 0x02 | 0x08 | 0x10, 0666, 0); 
	foStream.write(content+"\n", content.length+1);
	foStream.close();
}

exports.getTLDFromDomain = getTLDFromDomain;
exports.getTLDFromURL = getTLDFromURL;
exports.closeAllOtherTabs = closeAllOtherTabs;
exports.closeAllTabs = closeAllTabs;
exports.resetTab = resetTab;
exports.initTab = initTab;
exports.log = log;
exports.navigateFirstTab = navigateFirstTab;
exports.refreshFirstTab = refreshFirstTab;
exports.deleteCookies = deleteCookies;
exports.getTrustedDomains = function(){return trustedDomains;};