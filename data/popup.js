// Copyright (c) 2012 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

function navAndRecord_wrapper(e){
	//var site = window.prompt("Enter the site you want to test");
	//self.port.emit("panelActions", {action: "navAndRecord", site: site});
	self.port.emit("panelActions", {action: "navAndRecord"});
}

document.getElementById('navAndRecord').addEventListener('click',navAndRecord_wrapper);

function refreshAndRecord_wrapper(e){
	self.port.emit("panelActions", {action: "refreshAndRecord"});
}

document.getElementById('refreshAndRecord').addEventListener('click',refreshAndRecord_wrapper);
