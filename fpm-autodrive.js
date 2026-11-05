// FULLPORTMATT: automatic guest Google Drive recording (director pages with &autodrive).
// - Each guest starts recording to Drive as soon as they join (green room included); late joiners on arrival.
// - Skips studio-side pushes (any stream ID starting with uppercase FPM, e.g. FPMHOST, FPMPROG), screen shares, directors.
// - After a director reload it waits for guests' upload-progress messages first, so running recordings
//   are recognised instead of double-started.
// - With &obspass=<password>, it watches the local OBS websocket: when streaming STOPS it stops every guest
//   recording (they finish uploading) and stays disarmed until streaming starts again.
// - Google needs one user click per session to grant Drive access (browsers block unclicked OAuth popups):
//   the status bar shows a "Connect Google Drive" button until a token exists.
// Uses only existing lib.js functions: requestGoogleDriveRecord(), setupGoogleDriveUploader(),
// session.sendRequest(), and the "vdoninja:gdrive-progress" window event. Parse-safe (no ?. / ??).
(function () {
	"use strict";
	var params = new URLSearchParams(window.location.search);
	if (!params.has("autodrive")) {
		return;
	}
	if (!params.has("director") && !params.has("dir")) {
		return;
	}

	var BITRATE = parseInt(params.get("autodrivebitrate") || "3000", 10) || 3000; // was 6000: halved 2026-11-04 so the backup upload leaves room on weak guest uplinks (H.264 since recordcodec)
	var OBS_PASS = params.get("obspass") || "";
	var OBS_URL = params.get("obsurl") || "ws://127.0.0.1:4455";
	var GRACE_MS = 15000; // after load: listen for progress from already-running recordings first
	var START_RETRY_MS = 60000; // don't re-request the same guest more often than this
	var PROGRESS_FRESH_MS = 20000; // progress seen within this window = recording is alive

	var loadedAt = Date.now();
	var armed = true; // false after OBS stops streaming, until it starts again
	var obsLive = null; // null = unknown / no OBS link
	var progress = {}; // UUID -> {ts, up, rec, state}
	var requested = {}; // UUID -> ts of our last start request
	var stopped = {}; // UUID -> true once we sent a stop (this stream)
	var lastError = "";

	function el(tag, cls, text) {
		var e = document.createElement(tag);
		if (cls) {
			e.className = cls;
		}
		if (text) {
			e.textContent = text;
		}
		return e;
	}

	// ---- status bar -------------------------------------------------------------------------------------
	var bar = el("div", "fpm-autodrive");
	bar.style.cssText =
		"position:fixed;left:12px;bottom:12px;z-index:99999;max-width:560px;padding:8px 12px;border-radius:10px;" +
		"font:13px/1.4 system-ui,-apple-system,sans-serif;color:#fff;background:rgba(20,24,32,.92);box-shadow:0 2px 10px rgba(0,0,0,.4)";
	var line = el("div", "", "Auto Drive: starting…");
	var btn = el("button", "", "Connect Google Drive");
	btn.style.cssText = "margin-top:6px;padding:6px 10px;border-radius:8px;border:0;background:#e3b341;color:#111;font-weight:600;cursor:pointer;display:none";
	btn.addEventListener("click", connectDrive);
	bar.appendChild(line);
	bar.appendChild(btn);
	function mountBar() {
		if (document.body && !bar.isConnected) {
			document.body.appendChild(bar);
		}
	}

	function hasToken() {
		return !!(window.session && session.gdrive && session.gdrive.accessToken);
	}

	async function connectDrive() {
		try {
			if (session.gdrive && session.gdrive.accessToken && session.gdrive.requestAccessToken && tokenAge() > RENEW_AT) {
				session.gdrive.requestAccessToken(); // expired/expiring key: renew from the click (popup allowed)
			} else if (!(session.gdrive && session.gdrive.accessToken)) {
				session.gdrive = setupGoogleDriveUploader();
				if (session.gdrive.promise) {
					await session.gdrive.ensureInitialized();
					session.gdrive.requestAccessToken(); // inside the click handler: popup allowed
					await session.gdrive.promise;
				}
			}
			lastError = hasToken() ? "" : "Google Drive did not return a token";
		} catch (e) {
			lastError = "Drive connect failed: " + (e && e.message ? e.message : e);
		}
		render();
	}

	// ---- guest bookkeeping -------------------------------------------------------------------------------
	window.addEventListener("vdoninja:gdrive-progress", function (ev) {
		try {
			var d = ev.detail || {};
			if (!d.UUID || d.screen) {
				return;
			}
			var g = d.gdrive || {};
			progress[d.UUID] = { ts: Date.now(), up: g.up || 0, rec: g.rec || 0, state: g.state };
		} catch (e) {}
	});

	function isGuest(UUID) {
		var r = session.rpcs && session.rpcs[UUID];
		if (!r || !r.streamID) {
			return false;
		}
		var sid = String(r.streamID);
		// Studio-side feeds (FPMHOST camera, FPMPROG program, any future FPM* uppercase ID) are never guests.
		// Guest IDs from join.html are lowercase "fpm..." so this test is case-sensitive on purpose.
		if (sid.indexOf("FPM") === 0) {
			return false;
		}
		if (sid.indexOf(":s") !== -1 || r.screenShareState || r.screenshare) {
			return false;
		}
		if (session.directorList && session.directorList.indexOf(UUID) >= 0) {
			return false;
		}
		if (r.virtualHangup) {
			return false;
		}
		return true;
	}

	function recordingAlive(UUID) {
		var p = progress[UUID];
		return !!(p && Date.now() - p.ts < PROGRESS_FRESH_MS && p.state !== 2);
	}

	function driveButton(UUID) {
		return document.querySelector('[data-action-type="recorder-google-drive-remote"][data--u-u-i-d="' + UUID + '"]');
	}

	function label(UUID) {
		var r = session.rpcs[UUID];
		return (r && (r.label || r.streamID)) || UUID;
	}

	function startGuest(UUID) {
		var b = driveButton(UUID);
		if (!b || typeof requestGoogleDriveRecord !== "function") {
			return;
		}
		requested[UUID] = Date.now();
		try {
			// state=true, explicit bitrate => no prompt; lib.js handles upload-session errors with a warning.
			requestGoogleDriveRecord(b, true, BITRATE);
		} catch (e) {
			lastError = "start failed for " + label(UUID) + ": " + (e && e.message ? e.message : e);
		}
	}

	function stopAll(reason) {
		Object.keys(session.rpcs || {}).forEach(function (UUID) {
			if (!isGuest(UUID)) {
				return;
			}
			if (!(recordingAlive(UUID) || requested[UUID])) {
				return;
			}
			try {
				session.sendRequest({ requestVideoRecord: false, googleDriveRecord: false, UUID: UUID }, UUID);
				stopped[UUID] = true;
				var b = driveButton(UUID);
				if (b) {
					b.classList.remove("pressed");
				}
			} catch (e) {}
		});
		lastError = reason || "";
	}

	function tick() {
		mountBar();
		if (!window.session || !session.director) {
			render();
			return;
		}
		btn.style.display = hasToken() && tokenAge() < 59 * 60000 ? "none" : "inline-block";
		if (armed && hasToken() && Date.now() - loadedAt > GRACE_MS) {
			Object.keys(session.rpcs || {}).forEach(function (UUID) {
				if (!isGuest(UUID) || stopped[UUID] || recordingAlive(UUID)) {
					return;
				}
				if (requested[UUID] && Date.now() - requested[UUID] < START_RETRY_MS) {
					return;
				}
				startGuest(UUID);
			});
		}
		render();
	}

	function render() {
		var guests = Object.keys((window.session && session.rpcs) || {}).filter(isGuest);
		var parts = guests.map(function (UUID) {
			var p = progress[UUID];
			if (recordingAlive(UUID)) {
				var pct = p.rec ? Math.round((100 * p.up) / p.rec) : 0;
				return "● " + label(UUID) + " " + pct + "% up";
			}
			if (p && p.state === 2) {
				return "✓ " + label(UUID) + " done";
			}
			if (requested[UUID]) {
				return "… " + label(UUID) + " starting";
			}
			return "○ " + label(UUID);
		});
		var head = "Auto Drive: " + (armed ? "armed" : "off (stream ended)");
		var age = tokenAge();
		if (!hasToken() || age > 59 * 60000) {
			head += " · NOT CONNECTED (click below)";
			bar.style.background = "rgba(140,30,30,.95)";
		} else {
			head += " · Drive " + Math.max(0, Math.round((60 * 60000 - age) / 60000)) + " min left" + (age > RENEW_AT ? " (renewing…)" : "");
			bar.style.background = age > RENEW_AT + 5 * 60000 ? "rgba(150,100,10,.95)" : "rgba(20,24,32,.92)";
		}
		if (OBS_PASS) {
			head += " · OBS " + (obsLive === null ? "?" : obsLive ? "LIVE" : "off-air");
		}
		line.textContent = head + (parts.length ? " — " + parts.join("  ") : " — no guests") + (lastError ? " ⚠ " + lastError : "");
	}

	// ---- optional OBS link (stop on stream end, re-arm on stream start) ----------------------------------
	async function sha256b64(str) {
		var buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
		var bin = "";
		new Uint8Array(buf).forEach(function (b) {
			bin += String.fromCharCode(b);
		});
		return btoa(bin);
	}
	function connectObs() {
		if (!OBS_PASS) {
			return;
		}
		var ws;
		try {
			ws = new WebSocket(OBS_URL);
		} catch (e) {
			setTimeout(connectObs, 5000);
			return;
		}
		ws.onmessage = async function (m) {
			var d;
			try {
				d = JSON.parse(m.data);
			} catch (e) {
				return;
			}
			if (d.op === 0) {
				var ident = { rpcVersion: 1, eventSubscriptions: 64 }; // Outputs
				if (d.d.authentication) {
					var secret = await sha256b64(OBS_PASS + d.d.authentication.salt);
					ident.authentication = await sha256b64(secret + d.d.authentication.challenge);
				}
				ws.send(JSON.stringify({ op: 1, d: ident }));
			} else if (d.op === 2) {
				ws.send(JSON.stringify({ op: 6, d: { requestType: "GetStreamStatus", requestId: "s" } }));
			} else if (d.op === 7 && d.d.requestId === "s" && d.d.responseData) {
				obsLive = !!d.d.responseData.outputActive;
				render();
			} else if (d.op === 5 && d.d.eventType === "StreamStateChanged") {
				var active = !!d.d.eventData.outputActive;
				var st = d.d.eventData.outputState || "";
				if (st === "OBS_WEBSOCKET_OUTPUT_STARTED" || (active && obsLive === false)) {
					obsLive = true;
					armed = true;
					stopped = {};
					requested = {};
				} else if (st === "OBS_WEBSOCKET_OUTPUT_STOPPED") {
					obsLive = false;
					armed = false;
					stopAll("");
				}
				render();
			}
		};
		ws.onclose = function () {
			obsLive = null;
			render();
			setTimeout(connectObs, 5000);
		};
	}

	setInterval(tick, 4000);

	// DRIVE KEY RENEWAL (2026-11-04): the Google key the director holds lasts 1 h and is needed to START each guest's
	// upload session (running uploads keep going without it). Renew at 45 min so late joins / rejoins still record.
	// Renewal opens Google's popup without a click, so the mini's Chrome must ALLOW POP-UPS for this site.
	var RENEW_AT = 45 * 60000;
	var tokenSeen = "", tokenAtMs = 0, lastRenewTry = 0;
	function tokenAge() {
		var t = hasToken() ? session.gdrive.accessToken : "";
		if (t !== tokenSeen) { tokenSeen = t; tokenAtMs = t ? Date.now() : 0; }
		return tokenAtMs ? Date.now() - tokenAtMs : 0;
	}
	setInterval(function () {
		if (!hasToken()) return;
		if (tokenAge() > RENEW_AT && Date.now() - lastRenewTry > 120000) {
			lastRenewTry = Date.now();
			try { session.gdrive.requestAccessToken(); } catch (e) { lastError = "Drive renew failed: " + (e && e.message); }
		}
	}, 30000);
	setTimeout(tick, 1500);
	connectObs();
	window.fpmAutoDrive = {
		state: function () {
			return { armed: armed, obsLive: obsLive, progress: progress, requested: requested, stopped: stopped, token: hasToken(), lastError: lastError };
		},
		stopAll: stopAll
	};
})();
