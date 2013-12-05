var pageMod = require("sdk/page-mod");
var ccc = require("./ccc");
var Enroller = require("./enroller");
var data = require("sdk/self").data;

exports.main = function() {

	//Enroller:
	
	pageMod.PageMod({
		include: "*",
		contentScriptFile: [data.url("enroller/testSuite.js")],
		contentScriptWhen: 'end',
		onAttach: function(worker) {
			Enroller.initTestSuiteWorker(worker);
		},
		attachTo: ["top"]
    });
	
	pageMod.PageMod({
		include: "*",
		contentScriptFile: [data.url("enroller/jquery-2.1.0-beta2.js"), data.url("enroller/pressLoginButton.js")],
		contentScriptWhen: 'end',
		onAttach: function(worker) {
			Enroller.initPressLoginButton(worker);
		},
		attachTo: ["top"]
    });
	
	pageMod.PageMod({
		include: ["https://*", "http://www.facebook.com/plugins/login_button.php*"],
		contentScriptFile: [data.url("enroller/jquery-2.1.0-beta2.js"), data.url("enroller/pressLoginButtonIFrame.js")],
		contentScriptWhen: 'end',
		onAttach: function(worker) {
			Enroller.initIFramePressLoginButtonWorker(worker);
		},
		attachTo: ["frame"]
    });
	
	pageMod.PageMod({
		include: "*",
		contentScriptFile: [data.url("enroller/automateSSO.js")],
		contentScriptWhen: 'start',
		onAttach: function(worker) {
			Enroller.initAutomateSSOWorker(worker);
		},
		attachTo: ["top"]
    });
	
	pageMod.PageMod({
		include: "*",
		contentScriptFile: [data.url("enroller/jquery-2.1.0-beta2.js"), data.url("enroller/finishRegistration.js")],
		contentScriptWhen: 'end',
		onAttach: function(worker) {
			if (Enroller.testRegistrationInProgress()) return;			//when we are testing registration success, don't try to submit anything again.
			Enroller.initRegistrationWorker(worker);
		},
		attachTo: ["top"]
    });
	
	pageMod.PageMod({
		include: "https://*",
		contentScriptFile: [data.url("enroller/jquery-2.1.0-beta2.js"), data.url("enroller/finishRegistrationIFrame.js")],
		contentScriptWhen: 'end',
		onAttach: function(worker) {
			if (Enroller.testRegistrationInProgress()) return;
			Enroller.initIFrameRegistrationWorker(worker);
		},
		attachTo: ["frame"]
    });
	
	//popup
	
	var popup = require("sdk/panel").Panel({
      width: 120,
      height: 230,
      contentURL: data.url("popup.html"),
      contentScriptFile: data.url("popup.js"),
	  contentScriptWhen: "end"
    });
     
    // Create a widget, and attach the panel to it, so the panel is
    // shown when the user clicks the widget.
    require("sdk/widget").Widget({
      label: "Popup",
      id: "popup",
      contentURL: data.url("icon/icon.png"),
      panel: popup
    });
     
    // When the panel is displayed it generated an event called
    // "show": we will listen for that event and when it happens,
    // send our own "show" event to the panel's script, so the
    // script can prepare the panel for display.
    popup.port.on("panelActions", function(w) {
		switch(w.action)
		{
			case "navAndRecord":
				ccc.start();
			default:
				break;
		}
		popup.hide();
    });
}