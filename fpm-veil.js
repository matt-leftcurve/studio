// FULLPORTMATT "Entering the studio…" veil.
// UI-only. Guests arrive from join.html with their devices already chosen (&webcam&autostart), so
// the stock arming screen ("Waiting for Camera to Load" / "No Audio") only flashes on the way in.
// This script covers the page from load until the guest is actually in the room (the control bar
// appears when publishWebcam joins the room in lib.js), then fades out. It never hides a real
// problem: any stock modal/prompt lifts it at once, and so does a 10 s timeout, after which the
// underlying stock state is visible again (and logged). Never changes session state or calls core
// functions. Loads after main.js; parse-safe for the older startup target (no ?. / ??).
(function () {
	"use strict";

	var params = new URLSearchParams(window.location.search);
	var excluded = ["director", "dir", "scene", "scn", "cleanoutput", "clean", "cleanviewer"];
	for (var i = 0; i < excluded.length; i++) {
		if (params.has(excluded[i])) {
			return; // director and OBS/scene views: nothing to mask
		}
	}
	// Only the handoff from join.html: a camera/mic publish that starts by itself.
	if (!(params.has("webcam") || params.has("wc")) || !(params.has("autostart") || params.has("as") || params.has("autojoin") || params.has("aj"))) {
		return;
	}

	var TIMEOUT_MS = 10000;
	var veil = null;
	var lifted = false;
	var pollTimer = 0;
	var timeoutTimer = 0;
	var observer = null;
	var startedAt = Date.now();

	function build() {
		veil = document.createElement("div");
		veil.id = "fpmVeil";
		veil.setAttribute("role", "status");
		veil.setAttribute("aria-live", "polite");
		veil.innerHTML =
			'<div class="fpm-veil__wordmark"><span class="fpm-veil__name">FULLPORTMATT</span><span class="fpm-veil__sub">Studio</span></div>' +
			'<div class="fpm-veil__orb" aria-hidden="true"><span class="fpm-veil__ring"></span><span class="fpm-veil__ring"></span><span class="fpm-veil__disc"></span></div>' +
			'<span class="fpm-veil__eyebrow">Guest entrance</span>' +
			'<h1 class="fpm-veil__title">Entering the <em>studio</em>…</h1>' +
			'<p class="fpm-veil__lede">Connecting your camera and microphone.</p>';
		document.body.appendChild(veil);
		document.body.classList.add("fpm-veiling");
	}

	function inRoom() {
		var bar = document.getElementById("controlButtons");
		if (bar && !bar.classList.contains("hidden")) {
			return true; // publishWebcam showed the bar: we are in the room
		}
		var hung = document.getElementById("hangupContainer");
		if (hung && !hung.closest("#hangupTemplate")) {
			return true; // already hung up (hangup() replaced the body)
		}
		return false;
	}

	// Anything the stock app wants the guest to see or answer (password prompt, permission error,
	// the hold notice, ...) must not sit behind the veil.
	function stockDialogShown() {
		return !!(document.getElementById("alertModal") || document.getElementById("promptModal") || document.getElementById("modalBackdrop"));
	}

	function describeState() {
		var go = document.getElementById("gowebcam");
		var head3 = document.getElementById("head3");
		return "head3=" + (head3 ? (head3.classList.contains("hidden") ? "hidden" : "shown") : "none") + " gowebcam=\"" + (go ? go.textContent.replace(/\s+/g, " ").trim() : "none") + "\"" + " controlButtons=" + (inRoom() ? "shown" : "hidden");
	}

	function lift(reason) {
		if (lifted) {
			return;
		}
		lifted = true;
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = 0;
		}
		if (timeoutTimer) {
			clearTimeout(timeoutTimer);
			timeoutTimer = 0;
		}
		if (observer) {
			observer.disconnect();
			observer = null;
		}
		document.body.classList.remove("fpm-veiling");
		if (reason === "timeout") {
			console.warn("[fpm-veil] not in the room after " + Math.round((Date.now() - startedAt) / 1000) + " s; showing the stock screen (" + describeState() + ")");
		} else {
			console.log("[fpm-veil] lifted: " + reason + " after " + (Date.now() - startedAt) + " ms");
		}
		if (!veil) {
			return;
		}
		if (!veil.parentNode) {
			veil = null;
			return;
		}
		// Fade with a timer, not rAF: the guest tab is often in the background and does not paint.
		veil.classList.add("fpm-veil--leaving");
		setTimeout(function () {
			if (veil && veil.parentNode) {
				veil.parentNode.removeChild(veil);
			}
			veil = null;
		}, 600);
	}

	function check() {
		if (lifted) {
			return;
		}
		if (!veil || !veil.parentNode) {
			lift("page replaced"); // hangup() swapped the body out from under us
		} else if (inRoom()) {
			lift("in room");
		} else if (stockDialogShown()) {
			lift("stock dialog");
		}
	}

	function init() {
		if (!document.body) {
			return;
		}
		build();
		check();
		if (lifted) {
			return;
		}
		timeoutTimer = setTimeout(function () {
			lift("timeout");
		}, TIMEOUT_MS);
		pollTimer = setInterval(check, 150);
		if (typeof MutationObserver !== "undefined") {
			// warnUser inserts #alertModal directly under <body>; the poll above catches the control bar.
			observer = new MutationObserver(check);
			observer.observe(document.body, { childList: true });
		}
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init, { once: true });
	} else {
		init();
	}
})();
