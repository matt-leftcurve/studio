// FULLPORTMATT guest control bar: five buttons, labels + state-aware tooltips.
// UI-only. Reads the existing button state (the `red` class set by toggleMute / toggleVideoMute,
// the `green` class set by the screen-share code in lib.js) and writes data-fpm-* attributes that
// fpm-guestbar.css renders. Buttons outside the five (chat, speaker, website, flip, files, ...)
// are hidden by fpm-guestbar.css. Does not touch session state or call core functions.
// Loads after main.js; parse-safe for the older startup target (no ?. / ??).
(function () {
	"use strict";

	var params = new URLSearchParams(window.location.search);
	var excluded = ["director", "dir", "scene", "scn", "cleanoutput", "clean", "cleanviewer"];
	for (var i = 0; i < excluded.length; i++) {
		if (params.has(excluded[i])) {
			return; // director and OBS/scene views keep the stock control bar
		}
	}

	// The five guest buttons, in bar order: AUDIO · VIDEO · SHARE SCREEN · SETTINGS · LEAVE.
	// The stock code shows one of the three screenshare buttons depending on the share type
	// (room guests get #screenshare3button, which publishes the <id>:s stream).
	var labels = {
		mutebutton: "Audio",
		mutevideobutton: "Video",
		screensharebutton: "Share screen",
		screenshare2button: "Share screen",
		screenshare3button: "Share screen",
		settingsbutton: "Settings",
		hangupbutton: "Leave"
	};

	function isOn(el) {
		return el.classList.contains("red");
	}

	function isSharing(el) {
		return el.classList.contains("green");
	}

	// Tooltip text follows the current state: "Mute mic" while live, "Unmute mic" while muted.
	function tipFor(el) {
		switch (el.id) {
			case "mutebutton":
				return isOn(el) ? "Unmute mic" : "Mute mic";
			case "mutevideobutton":
				return isOn(el) ? "Turn on camera" : "Turn off camera";
			case "hangupbutton":
				return "Leave the studio";
			case "screensharebutton":
			case "screenshare2button":
			case "screenshare3button":
				return isSharing(el) ? "Stop sharing" : "Share your screen";
			case "settingsbutton":
				return "Camera and mic settings";
			default:
				// fall back to the stock title text, minus any keyboard shortcut hint
				var t = el.getAttribute("title") || el.dataset.fpmOrigTitle || "";
				return t.replace(/\s*\([^)]*\)\s*$/, "");
		}
	}

	function apply(el) {
		if (!el || !el.id || !(el.id in labels)) {
			return;
		}
		if (el.getAttribute("data-fpm-label") !== labels[el.id]) {
			el.setAttribute("data-fpm-label", labels[el.id]);
		}
		var tip = tipFor(el);
		if (el.getAttribute("data-fpm-tip") !== tip) {
			el.setAttribute("data-fpm-tip", tip);
		}
		// The custom tooltip replaces the native one, so drop `title` (the translation pass
		// skips elements with an empty title) and keep the accessible name in sync instead.
		if (el.getAttribute("title")) {
			if (!el.dataset.fpmOrigTitle) {
				el.dataset.fpmOrigTitle = el.getAttribute("title");
			}
			el.setAttribute("title", "");
		}
		if (tip && el.getAttribute("aria-label") !== tip) {
			el.setAttribute("aria-label", tip);
		}
	}

	function applyAll(bar) {
		var ids = Object.keys(labels);
		for (var j = 0; j < ids.length; j++) {
			var el = document.getElementById(ids[j]);
			if (el && bar.contains(el)) {
				apply(el);
			}
		}
	}

	function init() {
		var bar = document.getElementById("subControlButtons");
		if (!bar) {
			return;
		}
		document.body.classList.add("fpm-guest");
		applyAll(bar);

		if (typeof MutationObserver === "undefined") {
			return;
		}
		var observer = new MutationObserver(function (mutations) {
			for (var k = 0; k < mutations.length; k++) {
				var m = mutations[k];
				if (m.type === "attributes") {
					apply(m.target);
				} else if (m.type === "childList") {
					applyAll(bar);
				}
			}
		});
		observer.observe(bar, {
			attributes: true,
			attributeFilter: ["class", "title", "aria-label"],
			childList: true,
			subtree: true
		});
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init, { once: true });
	} else {
		init();
	}
})();
