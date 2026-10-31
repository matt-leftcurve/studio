// FULLPORTMATT waiting room for &hold guests.
// UI-only. The stock app shows a "please wait until the director brings you in" modal
// (warnUser(..., 123) from youreWaitingToBeActivated in lib.js) and removes it again when
// the director activates the guest (closeModal(false, "123") in youveBeenActivated).
// This script watches for that modal, hides it with CSS (fpm-hold.css) and shows a branded
// full-screen waiting state instead. It never changes session state or calls core functions.
// Loads after main.js; parse-safe for the older startup target (no ?. / ??).
(function () {
	"use strict";

	var params = new URLSearchParams(window.location.search);
	if (!params.has("hold") && !params.has("queue3") && !params.has("holdwithvideo") && !params.has("queue4")) {
		return;
	}
	var excluded = ["director", "dir", "scene", "scn", "cleanoutput", "clean", "cleanviewer"];
	for (var i = 0; i < excluded.length; i++) {
		if (params.has(excluded[i])) {
			return;
		}
	}

	var overlay = null;
	var holding = false;
	var leaveTimer = 0;
	var pollTimer = 0;

	function holdModal() {
		return document.querySelector("#alertModal[data-modalID='123']");
	}

	// The app flips session.queue to false the moment the director activates the guest.
	function stillHeld() {
		try {
			return !!(window.session && session.queue && (session.queueType == 3 || session.queueType == 4));
		} catch (e) {
			return false;
		}
	}

	function build() {
		overlay = document.createElement("div");
		overlay.id = "fpmHold";
		overlay.setAttribute("role", "status");
		overlay.setAttribute("aria-live", "polite");
		overlay.innerHTML =
			'<div class="fpm-hold__wordmark"><span class="fpm-hold__name">FULLPORTMATT</span><span class="fpm-hold__sub">Studio</span></div>' +
			'<div class="fpm-hold__orb" aria-hidden="true"><span class="fpm-hold__ring"></span><span class="fpm-hold__ring"></span><span class="fpm-hold__ring"></span><span class="fpm-hold__disc"></span></div>' +
			'<span class="fpm-hold__eyebrow">Green room</span>' +
			'<h1 class="fpm-hold__title">You\u2019re <em>all set</em></h1>' +
			'<p class="fpm-hold__lede">Matt will bring you in shortly.</p>' +
			'<p class="fpm-hold__fine">Your camera and microphone are connected. <strong>Nobody can see or hear you yet</strong> \u2014 you\u2019ll know the moment you\u2019re on.</p>';
		document.body.appendChild(overlay);
	}

	function enter() {
		if (holding) {
			return;
		}
		holding = true;
		if (leaveTimer) {
			clearTimeout(leaveTimer);
			leaveTimer = 0;
		}
		if (!overlay) {
			build();
		}
		document.body.classList.add("fpm-holding");
		overlay.classList.remove("fpm-hold--leaving");
		// Deferred so the opacity transition runs on first show (a timer, not rAF: background tabs do not paint).
		setTimeout(function () {
			if (overlay && holding) {
				overlay.classList.add("fpm-hold--on");
			}
		}, 30);
		if (!pollTimer) {
			pollTimer = setInterval(poll, 400);
		}
	}

	function leave() {
		if (!holding) {
			return;
		}
		holding = false;
		document.body.classList.remove("fpm-holding");
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = 0;
		}
		if (overlay) {
			overlay.classList.add("fpm-hold--leaving");
			leaveTimer = setTimeout(function () {
				leaveTimer = 0;
				if (overlay && !holding) {
					if (overlay.parentNode) {
						overlay.parentNode.removeChild(overlay);
					}
					overlay = null;
				}
			}, 600);
		}
	}

	// Released when the app clears the held state (activation) or the guest has left
	// (hangup() replaces the whole body, which detaches the overlay).
	function poll() {
		if (!stillHeld() || !overlay || !overlay.parentNode) {
			leave();
		}
	}

	function check() {
		if (holdModal()) {
			enter();
		} else if (holding && !stillHeld()) {
			leave();
		}
	}

	function init() {
		check();
		if (typeof MutationObserver === "undefined") {
			return;
		}
		// warnUser inserts #alertModal directly under <body>, closeModal removes it.
		var observer = new MutationObserver(check);
		observer.observe(document.body, { childList: true });
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init, { once: true });
	} else {
		init();
	}
})();
