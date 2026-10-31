// FULLPORTMATT guest control bar: labels + state-aware tooltips.
// UI-only. Reads the existing button state (the `red` class and icon swaps set by
// toggleMute / toggleVideoMute in lib.js) and writes data-fpm-* attributes that
// fpm-guestbar.css renders. Does not touch session state or call core functions.
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

	var labels = {
		mutebutton: "Audio",
		mutevideobutton: "Video",
		hangupbutton: "Leave",
		hangupbutton2: "Leave",
		screensharebutton: "Share",
		screenshare2button: "Share",
		screenshare3button: "Share",
		chatbutton: "Chat",
		mutespeakerbutton: "Speaker",
		settingsbutton: "Settings",
		sharefilebutton: "Files",
		websitesharebutton: "Website",
		raisehandbutton: "Raise hand",
		fullscreenPage: "Fullscreen",
		PictureInPicturePage: "Pop out",
		flipcamerabutton: "Flip",
		recordLocalbutton: "Record",
		queuebutton: "Queue",
		blackoutmode: "Black out",
		unmuteSelf: "Monitor"
	};

	function isOn(el) {
		return el.classList.contains("red");
	}

	// Tooltip text follows the current state: "Mute mic" while live, "Unmute mic" while muted.
	function tipFor(el) {
		switch (el.id) {
			case "mutebutton":
				return isOn(el) ? "Unmute mic" : "Mute mic";
			case "mutevideobutton":
				return isOn(el) ? "Turn on camera" : "Turn off camera";
			case "mutespeakerbutton":
				return isOn(el) ? "Unmute speaker" : "Mute speaker";
			case "hangupbutton":
			case "hangupbutton2":
				return "Leave the studio";
			case "screensharebutton":
			case "screenshare2button":
			case "screenshare3button":
				return "Share your screen";
			case "chatbutton":
				return "Open chat";
			case "settingsbutton":
				return "Camera and mic settings";
			case "raisehandbutton":
				return el.getAttribute("data-raised") === "1" ? "Lower hand" : "Raise hand";
			case "fullscreenPage":
				return "Full screen";
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
			attributeFilter: ["class", "title", "aria-label", "data-raised"],
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
