// FULLPORTMATT upload status for &hiddenrecord guests.
// Policy: the recording file is invisible, the upload status is visible.
//  - Small top-right chip (cloud + percent) while a hidden-record Drive upload is running;
//    hover / tap expands it ("keep this tab open", rough time left). Completion shows a
//    check mark and fades out; failure shows a quiet amber "recording saved" note.
//  - If the guest leaves (or the session ends) while the upload is still running, a
//    full-screen hold page with a progress bar replaces the stock "hung up" view, and a
//    beforeunload confirm protects the tab only while the upload is incomplete.
// Driven by the "fpm-drive-upload" DOM event that lib.js dispatches from the Drive uploader's
// own progress/failure code (hiddenRecordUploadStatus). UI-only; no session state is touched.
// Loads after main.js; parse-safe for the older startup target (no ?. / ??).
(function () {
	"use strict";

	var params = new URLSearchParams(window.location.search);
	if (!params.has("hiddenrecord")) {
		return;
	}
	var excluded = ["director", "dir", "scene", "scn", "cleanoutput", "clean", "cleanviewer"];
	for (var i = 0; i < excluded.length; i++) {
		if (params.has(excluded[i])) {
			return;
		}
	}

	var pending = false; // an upload has started and is neither complete nor failed
	var state = ""; // "progress" | "complete" | "failed"
	var uploaded = 0;
	var recorded = 0;
	var finalized = false;
	var savedLocal = false; // the uploader saved the recording to the guest's Downloads (upload failed)
	var samples = []; // [time ms, uploaded bytes] over the last ~30 s, for the rough time-left estimate
	var chip = null;
	var hold = null;
	var fadeTimer = 0;
	var hidden = true;

	var ICON_CLOUD = '<svg class="fpm-upload__icon fpm-upload__icon--cloud" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18a4 4 0 0 1-.6-7.95A6 6 0 0 1 17.9 8.5 3.5 3.5 0 0 1 17.5 18H7z"></path><g class="fpm-upload__arrow"><path d="M12 15v-5"></path><path d="M9.6 12.4 12 10l2.4 2.4"></path></g></svg>';
	var ICON_CHECK = '<svg class="fpm-upload__icon fpm-upload__icon--check" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="m8.5 12.2 2.3 2.3 4.7-5"></path></svg>';
	var ICON_WARN = '<svg class="fpm-upload__icon fpm-upload__icon--warn" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 3 20h18L12 4z"></path><path d="M12 10v4"></path><path d="M12 17h.01"></path></svg>';

	function percent() {
		if (state === "complete") {
			return 100;
		}
		if (!recorded) {
			return 0;
		}
		var p = Math.floor((uploaded / recorded) * 100);
		if (p > 99 && state !== "complete") {
			p = 99; // the last piece is only confirmed by Drive's final response
		}
		return Math.max(0, p);
	}

	// Rough time left: bytes still to send / recent upload rate. While the recording is
	// still running the remainder keeps growing, so it is only ever "about".
	function timeLeftText() {
		if (state !== "progress") {
			return "";
		}
		var now = Date.now();
		while (samples.length && now - samples[0][0] > 30000) {
			samples.shift();
		}
		var remaining = recorded - uploaded;
		if (remaining <= 0) {
			return finalized || hold ? "Finishing up\u2026" : "Up to date, still recording";
		}
		if (samples.length < 2) {
			return "Estimating time left\u2026";
		}
		var dt = (samples[samples.length - 1][0] - samples[0][0]) / 1000;
		var dBytes = samples[samples.length - 1][1] - samples[0][1];
		if (dt < 3 || dBytes <= 0) {
			return "Estimating time left\u2026";
		}
		var seconds = remaining / (dBytes / dt);
		var text;
		if (seconds < 50) {
			text = "Less than a minute left";
		} else if (seconds < 90) {
			text = "About a minute left";
		} else if (seconds < 3600) {
			text = "About " + Math.round(seconds / 60) + " min left";
		} else {
			text = "About " + (seconds / 3600).toFixed(1) + " h left";
		}
		if (!finalized && !hold) {
			text += " \u00b7 still recording"; // after leaving, the recorder is only wrapping up
		}
		return text;
	}

	function sizeText(bytes) {
		if (bytes >= 1024 * 1024 * 1024) {
			return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
		}
		if (bytes >= 1024 * 1024) {
			return Math.round(bytes / (1024 * 1024)) + " MB";
		}
		return Math.max(1, Math.round(bytes / 1024)) + " KB";
	}

	// ---- Chip -------------------------------------------------------------------------

	function buildChip() {
		chip = document.createElement("div");
		chip.id = "fpmUpload";
		chip.setAttribute("role", "status");
		chip.setAttribute("aria-live", "polite");
		chip.innerHTML =
			'<button class="fpm-upload__chip" type="button" aria-expanded="false">' +
			ICON_CLOUD +
			ICON_CHECK +
			ICON_WARN +
			'<span class="fpm-upload__pct" id="fpmUploadPct">0%</span>' +
			"</button>" +
			'<div class="fpm-upload__card">' +
			'<p class="fpm-upload__title" id="fpmUploadTitle"></p>' +
			'<p class="fpm-upload__text" id="fpmUploadText"></p>' +
			'<p class="fpm-upload__eta" id="fpmUploadEta"></p>' +
			"</div>";
		document.body.appendChild(chip);
		var button = chip.querySelector(".fpm-upload__chip");
		button.addEventListener("click", function () {
			var open = chip.classList.toggle("fpm-upload--open");
			button.setAttribute("aria-expanded", open ? "true" : "false");
		});
	}

	function showChip() {
		if (!chip) {
			buildChip();
		}
		if (fadeTimer) {
			clearTimeout(fadeTimer);
			fadeTimer = 0;
		}
		chip.classList.remove("fpm-upload--fading");
		if (hidden) {
			hidden = false;
			setTimeout(function () {
				if (chip && !hidden) {
					chip.classList.add("fpm-upload--on");
				}
			}, 30);
		}
	}

	function fadeChip(delay) {
		if (!chip || fadeTimer) {
			return;
		}
		fadeTimer = setTimeout(function () {
			fadeTimer = 0;
			if (!chip || state === "progress") {
				return;
			}
			hidden = true;
			chip.classList.remove("fpm-upload--on");
			chip.classList.remove("fpm-upload--open");
			chip.classList.add("fpm-upload--fading");
		}, delay);
	}

	function renderChip() {
		if (!chip) {
			return;
		}
		chip.setAttribute("data-state", state);
		var pct = document.getElementById("fpmUploadPct");
		var title = document.getElementById("fpmUploadTitle");
		var text = document.getElementById("fpmUploadText");
		var eta = document.getElementById("fpmUploadEta");
		if (state === "progress") {
			pct.textContent = percent() + "%";
			title.textContent = finalized ? "Finishing your upload" : "Uploading your recording";
			text.textContent = "Please keep this tab open until your recording is fully uploaded.";
			eta.textContent = timeLeftText();
			chip.querySelector(".fpm-upload__chip").setAttribute("aria-label", "Recording upload " + percent() + " percent. Keep this tab open.");
		} else if (state === "complete") {
			pct.textContent = "Upload complete";
			title.textContent = "Upload complete";
			text.textContent = "Your recording is safely in the studio\u2019s Drive. Thanks!";
			eta.textContent = "";
			chip.querySelector(".fpm-upload__chip").setAttribute("aria-label", "Recording upload complete");
		} else if (state === "failed") {
			pct.textContent = savedLocal ? "Saved to Downloads" : "Upload stopped";
			title.textContent = savedLocal ? "Recording saved to your Downloads" : "Upload stopped";
			text.textContent = savedLocal
				? "The upload to the studio didn\u2019t finish, so your recording was saved to your Downloads folder (file ending in \u201c-backup\u201d). Please send that file to Matt."
				: "The upload to the studio stopped. Keep this tab open: when the show ends your recording will be saved to your Downloads folder.";
			eta.textContent = savedLocal ? "Please send the file to Matt" : "Keep this tab open";
			chip.querySelector(".fpm-upload__chip").setAttribute("aria-label", "Recording saved. The upload did not finish; we will recover it.");
		}
	}

	// ---- Hold page (guest left / session ended while uploading) -----------------------

	function buildHold() {
		hold = document.createElement("div");
		hold.id = "fpmUploadHold";
		hold.setAttribute("role", "status");
		hold.setAttribute("aria-live", "polite");
		hold.innerHTML =
			'<div class="fpm-upload-hold__wordmark"><span class="fpm-upload-hold__name">FULLPORTMATT</span><span class="fpm-upload-hold__sub">Studio</span></div>' +
			'<svg class="fpm-upload-hold__icon" viewBox="0 0 24 24" aria-hidden="true" id="fpmUploadHoldIcon"></svg>' +
			'<span class="fpm-upload-hold__eyebrow" id="fpmUploadHoldEyebrow"></span>' +
			'<h1 class="fpm-upload-hold__title" id="fpmUploadHoldTitle"></h1>' +
			'<p class="fpm-upload-hold__lede" id="fpmUploadHoldLede"></p>' +
			'<div class="fpm-upload-hold__bar" aria-hidden="true"><div class="fpm-upload-hold__fill" id="fpmUploadHoldFill"></div></div>' +
			'<div class="fpm-upload-hold__meta"><span id="fpmUploadHoldPct"></span><span id="fpmUploadHoldEta"></span></div>' +
			'<p class="fpm-upload-hold__fine" id="fpmUploadHoldFine"></p>';
		document.body.appendChild(hold);
		setTimeout(function () {
			if (hold) {
				hold.classList.add("fpm-upload-hold--on");
			}
		}, 30);
	}

	var HOLD_ICON_CLOUD = '<path d="M7 18a4 4 0 0 1-.6-7.95A6 6 0 0 1 17.9 8.5 3.5 3.5 0 0 1 17.5 18H7z"></path><g class="fpm-upload__arrow"><path d="M12 15v-5"></path><path d="M9.6 12.4 12 10l2.4 2.4"></path></g>';
	var HOLD_ICON_CHECK = '<circle cx="12" cy="12" r="9"></circle><path d="m8.5 12.2 2.3 2.3 4.7-5"></path>';
	var HOLD_ICON_SAVED = '<path d="M5 4h11l3 3v13H5z"></path><path d="M8 4v5h7V4"></path><path d="M8 20v-6h8v6"></path>';

	function renderHold() {
		if (!hold) {
			return;
		}
		hold.setAttribute("data-state", state);
		var icon = document.getElementById("fpmUploadHoldIcon");
		var eyebrow = document.getElementById("fpmUploadHoldEyebrow");
		var title = document.getElementById("fpmUploadHoldTitle");
		var lede = document.getElementById("fpmUploadHoldLede");
		var fine = document.getElementById("fpmUploadHoldFine");
		if (state === "progress") {
			icon.innerHTML = HOLD_ICON_CLOUD;
			eyebrow.textContent = "One more moment";
			title.innerHTML = "Please <em>keep this tab open</em> until the upload is done";
			lede.textContent = "Your recording is still on its way to the studio. It only takes a little while.";
			document.getElementById("fpmUploadHoldFill").style.width = percent() + "%";
			document.getElementById("fpmUploadHoldPct").innerHTML = "<strong>" + percent() + "%</strong> uploaded" + (recorded ? " \u00b7 " + sizeText(uploaded) + " of " + sizeText(recorded) : "");
			document.getElementById("fpmUploadHoldEta").textContent = timeLeftText();
			fine.textContent = "Closing this tab now would interrupt the upload. We\u2019ll tell you the moment it\u2019s safe.";
		} else if (state === "complete") {
			icon.innerHTML = HOLD_ICON_CHECK;
			eyebrow.textContent = "All done";
			title.innerHTML = "All done \u2014 you can <em>close this tab</em>";
			lede.textContent = "Thanks for coming on the show!";
			fine.textContent = "Your recording has been uploaded to the studio in full.";
		} else if (state === "failed") {
			icon.innerHTML = HOLD_ICON_SAVED;
			eyebrow.textContent = "Recording saved";
			title.innerHTML = "Your recording is in your <em>Downloads</em> folder";
			lede.textContent = "The upload to the studio didn\u2019t finish, so we saved your recording to your computer (file ending in \u201c-backup\u201d). Thanks for coming on the show!";
			fine.textContent = "Please send that file to Matt. Then you can close this tab.";
		}
	}

	// hangup() replaces the whole body (#main) with the contents of #hangupTemplate, so afterwards
	// #hangupContainer sits directly under <body> and the template (and our chip) are gone.
	function hungUp() {
		var c = document.getElementById("hangupContainer");
		return !!(c && !c.closest("#hangupTemplate"));
	}

	// Only an incomplete upload turns the stock "hung up" view into the hold page.
	function maybeShowHold() {
		if (hold || !pending || !hungUp()) {
			return;
		}
		// The chip went away with the old body; the hold page takes over.
		chip = null;
		hidden = true;
		buildHold();
		renderHold();
	}

	// ---- Events from lib.js ----------------------------------------------------------------

	function onUpload(e) {
		var d = e && e.detail ? e.detail : {};
		var up = Number(d.uploaded) || 0;
		var rec = Number(d.recorded) || 0;
		if (d.state === "progress" && (state !== "progress" || up < uploaded)) {
			samples = []; // a new recording / uploader started
		}
		uploaded = up;
		recorded = rec;
		finalized = !!d.finalized;
		if (d.savedLocal) savedLocal = true;
		if (d.state === "failed") {
			state = "failed";
			pending = false;
		} else if (d.state === "complete") {
			state = "complete";
			pending = false;
			uploaded = recorded = Math.max(up, rec);
		} else {
			state = "progress";
			pending = true;
			samples.push([Date.now(), uploaded]);
		}
		if (!hold) {
			showChip();
			renderChip();
			if (state === "complete") {
				fadeChip(6000);
			} else if (state === "failed") {
				fadeChip(15000);
			}
		} else {
			renderHold();
		}
		maybeShowHold();
	}

	function onBeforeUnload(e) {
		if (!pending) {
			return undefined; // nothing pending: stock behaviour
		}
		var text = "Your recording is still uploading. Please keep this tab open until it finishes.";
		e.preventDefault();
		e.returnValue = text;
		return text;
	}

	function init() {
		document.addEventListener("fpm-drive-upload", onUpload);
		window.addEventListener("beforeunload", onBeforeUnload);
		// Refresh the time-left text once a second while something is uploading.
		setInterval(function () {
			if (state === "progress") {
				if (hold) {
					renderHold();
				} else if (chip && !hidden) {
					renderChip();
				}
			}
		}, 1000);
		if (typeof MutationObserver === "undefined") {
			return;
		}
		// hangup() replaces #main's content with the stock "hung up" template (#hangupContainer).
		var main = document.getElementById("main");
		var observer = new MutationObserver(maybeShowHold);
		observer.observe(main || document.body, { childList: true });
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init, { once: true });
	} else {
		init();
	}
})();
