// FULLPORTMATT: OBS scene switcher on the HOST page (push page with &obspass=<OBS websocket password>).
// One button per OBS scene; tap = SetCurrentProgramScene. Highlight follows the live program scene, whoever
// changed it (OBS, bridge, bender). Talks to the local OBS (ws://127.0.0.1:4455 unless &obsurl=).
// Optional &scenes=Solo,Guest - SBS,... limits/orders the buttons. Parse-safe (no ?. / ??).
(function () {
	"use strict";
	var params = new URLSearchParams(window.location.search);
	var PASS = params.get("obspass");
	if (!PASS || !params.has("push")) {
		return;
	}
	var URL_ = params.get("obsurl") || "ws://127.0.0.1:4455";
	// Scene buttons: Matt's show set by default (2026-11-04); &scenes=A,B,... overrides, &scenes=all shows every scene.
	var DEFAULT_SCENES = ["Starting Soon", "Solo", "Stage - SBS", "Stage - Trio", "Stage - Share"];
	var ONLY = params.get("scenes") === "all" ? null : params.get("scenes") ? params.get("scenes").split(",").map(function (s) { return s.trim(); }).filter(Boolean) : DEFAULT_SCENES;

	var bar = document.createElement("div");
	bar.className = "fpm-scenes";
	bar.style.cssText =
		"position:fixed;top:24px;left:50%;transform:translateX(-50%);z-index:99999;display:flex;flex-wrap:wrap;gap:6px;" +
		"justify-content:center;max-width:94vw;padding:6px 8px;border-radius:12px;background:rgba(14,18,26,.86);" +
		"font:600 13px/1 system-ui,-apple-system,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.45)";
	var status = document.createElement("span");
	status.style.cssText = "color:#f88;padding:6px 4px";
	status.textContent = "OBS: connecting…";
	bar.appendChild(status);

	var ws = null;
	var reqId = 0;
	var scenes = [];
	var current = "";
	var buttons = {};
	// Stage relay: guests' pages (fpm-guestview.js) draw the same layout as OBS's stage page.
	var STAGE_INPUT = params.get("stageinput") || "Stage";
	var ME = params.get("push") || "FPMHOST"; // host's own stream ID; host screen share publishes as ME + ":s"
	var stageInfo = { g1: "", g2: "", h1: "", h2: "", n1: "", n2: "" }; // n1/n2 = seated guests' NAMES (room labels); h1/h2 = legacy @handles (fallback)
	var stageUrl = ""; // full current Stage input URL (kept so seat/handle edits preserve audio/vcodec/etc.)
	function layoutFor(name) {
		var n = String(name || "").toLowerCase();
		if (n.indexOf("starting soon") !== -1 || n.indexOf("intro") !== -1) return "intro";
		if (n === "solo") return "solo_pip"; // the OBS Solo scene: guests see Matt full + themselves in small tiles
		if (n.indexOf("stage") === -1) return ""; // other non-stage scenes: guests see Matt solo
		if (n.indexOf("share") !== -1) return "share";
		if (n.indexOf("trio") !== -1) return "trio";
		if (n.indexOf("sbs") !== -1) return "sbs";
		if (n.indexOf("solo") !== -1) return "solo";
		return "";
	}
	function broadcast() {
		if (!window.session || typeof session.sendGenericData !== "function" || !current) return;
		try {
			var st = { scene: current, layout: layoutFor(current), g1: stageInfo.g1, g2: stageInfo.g2, h1: stageInfo.h1, h2: stageInfo.h2, n1: stageInfo.n1, n2: stageInfo.n2, sharer: typeof sharing === "string" ? sharing : "" };
			st.music = musicId;
			session.sendGenericData({ fpmStage: st });
		} catch (e) {}
		try {
			if (window.fpmGuestView && window.fpmGuestView.set && st) window.fpmGuestView.set(st); // host's own stage view (&stageview)
		} catch (e) {}
	}
	setInterval(broadcast, 4000);

	// Auto screen-share switching: when a guest's share ("<id>:s") goes live while a stage scene is on air,
	// switch OBS to the Share scene; when it ends, return to the scene we came from (unless Matt moved on).
	var SHARE_SCENE = params.get("sharescene") || "Stage - Share";
	var sharing = ""; // guest id currently sharing
	var beforeShare = "";
	var shareDbg = document.createElement("span");
	shareDbg.style.cssText = "color:#9ab;font:11px ui-monospace,Menlo,monospace;padding:0 6px;align-self:center";
	// Guests announce {fpmShare:{id,on}} (fpm-guestview.js) the moment they click Share / Stop.
	var shareAnnounce = {}; // id -> {on, ts}
	(function hookShare() {
		if (!window.session || typeof session.gotGenericData !== "function") return setTimeout(hookShare, 500);
		if (session.__fpmShareHook) return;
		session.__fpmShareHook = true;
		var orig = session.gotGenericData;
		session.gotGenericData = function (data) {
			try {
				if (data && data.fpmShare && data.fpmShare.id) {
					var prevA = shareAnnounce[data.fpmShare.id];
					shareAnnounce[data.fpmShare.id] = { on: !!data.fpmShare.on, ts: Date.now(), since: prevA && prevA.on && data.fpmShare.on ? prevA.since : 0 };
				}
			} catch (e) {}
			return orig.apply(this, arguments);
		};
	})();
	function liveShareId() {
		if (!window.session) return "";
		// HOST share first (2026-11-05): Matt's own share is local state, not an incoming rpc. The host pressing
		// "share screen" is an explicit act, so it wins over a guest share already on air.
		if (session.screenShareState) {
			shareDbg.textContent = "share: host (" + ME + ":s) · before=" + (beforeShare || "-");
			if (!shareDbg.isConnected) bar.appendChild(shareDbg);
			return ME;
		}
		if (!session.rpcs) return "";
		var dbg = [];
		for (var U0 in session.rpcs) {
			var r0 = session.rpcs[U0];
			var sid0 = r0 && r0.streamID ? String(r0.streamID) : "";
			if (sid0.slice(-2) !== ":s") continue;
			var st0 = r0.streamSrc || (r0.videoElement && r0.videoElement.srcObject);
			var vt = st0 && st0.getVideoTracks ? st0.getVideoTracks() : [];
			dbg.push(sid0 + " pc=" + r0.connectionState + " v=" + vt.map(function (t) { return t.readyState + (t.muted ? "/muted" : "/on"); }).join("+"));
		}
		shareDbg.textContent = "share: " + (dbg.length ? dbg.join(" | ") : "none") + " · before=" + (beforeShare || "-");
		if (!shareDbg.isConnected) bar.appendChild(shareDbg);
		var ann = Object.keys(shareAnnounce).filter(function (id) { return Date.now() - shareAnnounce[id].ts < 10000; });
		shareDbg.textContent += " · ann=" + (ann.length ? ann.map(function (id) { return id + ":" + (shareAnnounce[id].on ? "on" : "off"); }).join(",") : "-");
		for (var a = 0; a < ann.length; a++) {
			var an = shareAnnounce[ann[a]];
			if (!an.on) continue;
			if (!an.since) an.since = Date.now();
			// Go to the Share scene once the share video has reached us (so the panel isn't black on air),
			// or after 1.5 s regardless.
			var arrived = false;
			for (var U1 in session.rpcs) {
				if (session.rpcs[U1] && session.rpcs[U1].streamID === ann[a] + ":s") arrived = true;
			}
			if (arrived || Date.now() - an.since > 1500) return ann[a];
		}
		for (var U in session.rpcs) {
			var r = session.rpcs[U];
			var sid = r && r.streamID ? String(r.streamID) : "";
			if (sid.slice(-2) !== ":s") continue;
			if (shareAnnounce[sid.slice(0, -2)] && Date.now() - shareAnnounce[sid.slice(0, -2)].ts < 10000) continue; // guest says off
			var st = r.streamSrc || (r.videoElement && r.videoElement.srcObject);
			if (st && st.getVideoTracks && st.getVideoTracks().some(function (t) { return t.readyState === "live" && !t.muted; })) {
				return sid.slice(0, -2);
			}
		}
		return "";
	}
	setInterval(function () {
		var now = liveShareId();
		if (now === sharing) return;
		var prev = sharing;
		sharing = now;
		if (now && !prev) {
			// guests: auto-switch only while a stage scene is on air; HOST share: always (pressing the button IS the intent)
			if ((now === ME || /stage/i.test(current)) && current !== SHARE_SCENE && scenes.indexOf(SHARE_SCENE) !== -1) {
				beforeShare = current;
				send("SetCurrentProgramScene", { sceneName: SHARE_SCENE });
			}
		} else if (!now && prev) {
			if (current === SHARE_SCENE && beforeShare) {
				send("SetCurrentProgramScene", { sceneName: beforeShare });
			}
			beforeShare = "";
		}
		broadcast();
	}, 300);

	// INTRO SCENE AUDIO (2026-11-04): the audience hears only the intro music. Matt's mic (OBS "Mic/Aux", a global
	// device = every scene) is muted while an intro scene is live and unmuted when it ends. Guests never reach the
	// stream outside stage scenes (their only stream path is the "Stage" input). Matt + guests keep talking via the room.
	var MIC = params.get("micinput") || "Mic/Aux";
	var MUSIC_INPUT = params.get("musicinput") || "Intro Music";
	var micMutedByUs = false;
	function applyIntroMute() {
		var intro = layoutFor(current) === "intro";
		if (intro && !micMutedByUs) {
			micMutedByUs = true;
			send("SetInputMute", { inputName: MIC, inputMuted: true });
		} else if (!intro && micMutedByUs) {
			micMutedByUs = false;
			send("SetInputMute", { inputName: MIC, inputMuted: false });
		}
	}
	// Intro music: paste any YouTube link; sets OBS "Intro Music" (audience) and tells everyone's page to play it quietly.
	var musicId = "";
	function ytId(u) {
		var m = String(u || "").match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/live\/|\/shorts\/)([A-Za-z0-9_-]{11})/);
		return m ? m[1] : /^[A-Za-z0-9_-]{11}$/.test(String(u || "").trim()) ? String(u).trim() : "";
	}
	function musicUrl(id) {
		return "https://www.youtube.com/embed/" + id + "?autoplay=1&loop=1&playlist=" + id + "&controls=0&rel=0";
	}
	var musicBox = document.createElement("input");
	musicBox.type = "text";
	musicBox.placeholder = "♪ intro music: paste YouTube link";
	musicBox.style.cssText = "width:230px;border:0;border-radius:8px;padding:8px 10px;font:inherit;font-weight:500;background:#1b2230;color:#d7dbe3";
	musicBox.addEventListener("keydown", function (e) {
		if (e.key !== "Enter") return;
		var id = ytId(musicBox.value);
		if (!id) { musicBox.style.outline = "2px solid #e5484d"; return; }
		musicBox.style.outline = "";
		musicId = id;
		send("SetInputSettings", { inputName: MUSIC_INPUT, inputSettings: { url: musicUrl(id) } });
		musicBox.value = "♪ " + id;
		broadcast();
	});

	function mount() {
		if (document.body && !bar.isConnected) {
			document.body.appendChild(bar);
		}
		// Intro music moved to a visible Safari window on the mini (no ads w/ Premium, seekable), captured by OBS
		// "Intro Music (Safari)". The embed-based box stays available behind &musicbox.
		if (params.has("musicbox") && !musicBox.isConnected) bar.appendChild(musicBox);
	}

	// SEATING (2026-11-05, was AUTO-SEATING 2026-11-04): fpm-seats.js plans, this applies. New guests now WAIT
	// off-stage: the host gets an alert card (name + beep) with an "Add to stage" button. A rejoiner whose NAME
	// matches an absent seated guest retakes that seat instantly (new tab/device, no click, no 60 s wait). The
	// optional "auto-admit" toggle (localStorage) restores the old join-order auto-seating. Stage tags are the
	// guests' entered names (n1/n2, follow the person); h1/h2 @handles remain as a legacy fallback/override.
	// Writes the OBS "Stage" input URL.
	var firstSeen = {}, lastSeen = {};
	function setStage(changes) {
		if (!stageUrl) return;
		var u;
		try { u = new URL(stageUrl); } catch (e) { return; }
		Object.keys(changes).forEach(function (k) {
			if (changes[k]) u.searchParams.set(k, changes[k]); else u.searchParams.delete(k);
		});
		stageUrl = u.toString();
		send("SetInputSettings", { inputName: STAGE_INPUT, inputSettings: { url: stageUrl } });
	}
	function guestsHere() {
		var out = {};
		if (!window.session || !session.rpcs) return out;
		for (var U in session.rpcs) {
			var r = session.rpcs[U];
			var id = r && r.streamID ? String(r.streamID) : "";
			if (!/^fpm[A-Za-z0-9]{6,}$/.test(id)) continue; // guests only: "fpm" + id (case-sensitive: FPM* host feeds and ":s" shares excluded)
			out[id] = (r.label || id);
		}
		return out;
	}
	var labels = {};
	var AUTO_KEY = "fpmAutoAdmit";
	var autoAdmit = false;
	try { autoAdmit = localStorage.getItem(AUTO_KEY) === "1"; } catch (e) {}

	// New-guest beep: two short rising tones. AudioContext may start suspended until the page has had a
	// user gesture; we resume on the first click, so at worst the very first card is silent.
	var actx = null;
	function beep() {
		try {
			if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
			if (actx.state === "suspended") actx.resume();
			[[880, 0], [1320, 0.14]].forEach(function (t) {
				var o = actx.createOscillator(), g = actx.createGain();
				o.frequency.value = t[0];
				g.gain.setValueAtTime(0.0001, actx.currentTime + t[1]);
				g.gain.exponentialRampToValueAtTime(0.12, actx.currentTime + t[1] + 0.02);
				g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + t[1] + 0.12);
				o.connect(g); g.connect(actx.destination);
				o.start(actx.currentTime + t[1]); o.stop(actx.currentTime + t[1] + 0.14);
			});
		} catch (e) {}
	}
	document.addEventListener("click", function () { if (actx && actx.state === "suspended") actx.resume(); }, true);

	// Alert row: one card per waiting guest (stacks), plus transient notices (rejoins). Below the scene bar,
	// never covering it, no dismissal needed.
	var alertRow = document.createElement("div");
	alertRow.className = "fpm-alerts";
	alertRow.style.cssText = "position:fixed;top:78px;left:50%;transform:translateX(-50%);z-index:99998;display:flex;flex-direction:column;gap:6px;align-items:center;font:600 13px system-ui,-apple-system,sans-serif";
	function mountAlerts() { if (document.body && !alertRow.isConnected) document.body.appendChild(alertRow); }
	function card(bg) {
		var c = document.createElement("div");
		c.style.cssText = "display:flex;gap:10px;align-items:center;padding:8px 12px;border-radius:10px;background:" + bg + ";color:#fff;box-shadow:0 2px 12px rgba(0,0,0,.45)";
		return c;
	}
	function notice(text) {
		mountAlerts();
		var c = card("rgba(26,59,43,.95)");
		c.textContent = text;
		alertRow.appendChild(c);
		setTimeout(function () { c.remove(); }, 6000);
	}
	var waitCards = {}; // waiting guest id -> {card, name, btn}
	function updateWaiting(waiting, here, hasFree) {
		Object.keys(waitCards).forEach(function (id) {
			if (waiting.indexOf(id) === -1) { waitCards[id].card.remove(); delete waitCards[id]; }
		});
		waiting.forEach(function (id) {
			var name = here[id] || id;
			var w = waitCards[id];
			if (!w) {
				mountAlerts();
				var c = card("rgba(64,30,36,.96)");
				var nm = document.createElement("span");
				var btn = document.createElement("button");
				btn.type = "button";
				btn.style.cssText = "border:0;border-radius:8px;padding:7px 12px;cursor:pointer;font:inherit;background:#2f855a;color:#fff";
				btn.onclick = function () {
					var seat = window.fpmSeats ? fpmSeats.admit({ seats: { g1: stageInfo.g1, g2: stageInfo.g2 }, here: guestsHere(), lastSeen: lastSeen, now: Date.now() }, id) : "";
					if (!seat) return;
					var ch = {};
					ch[seat] = id;
					ch[seat === "g1" ? "n1" : "n2"] = labels[id] || "";
					ch[seat === "g1" ? "h1" : "h2"] = ""; // old @handle belonged to the seat's previous guest
					stageInfo[seat] = id;
					stageInfo[seat === "g1" ? "n1" : "n2"] = labels[id] || "";
					stageInfo[seat === "g1" ? "h1" : "h2"] = "";
					setStage(ch);
					broadcast();
					renderSeats();
					c.remove();
					delete waitCards[id];
				};
				c.appendChild(nm); c.appendChild(btn);
				alertRow.appendChild(c);
				waitCards[id] = { card: c, nm: nm, btn: btn };
				beep();
				w = waitCards[id];
			}
			w.nm.textContent = "🔔 " + name + " joined";
			w.btn.textContent = hasFree ? "Add to stage" : "seats full";
			w.btn.disabled = !hasFree;
			w.btn.style.background = hasFree ? "#2f855a" : "#3a4254";
			w.btn.style.cursor = hasFree ? "pointer" : "default";
		});
	}

	setInterval(function () {
		if (!stageUrl || !ws || ws.readyState !== 1 || !window.fpmSeats) return;
		var here = guestsHere(), now = Date.now();
		Object.keys(here).forEach(function (id) { if (!firstSeen[id]) firstSeen[id] = now; lastSeen[id] = now; labels[id] = here[id]; });
		var res = fpmSeats.plan({
			seats: { g1: stageInfo.g1, g2: stageInfo.g2 },
			names: { g1: stageInfo.n1, g2: stageInfo.n2 },
			here: here, firstSeen: firstSeen, lastSeen: lastSeen, now: now, autoAdmit: autoAdmit
		});
		var ch = {};
		["g1", "g2"].forEach(function (seat, i) {
			var nk = i ? "n2" : "n1";
			if (res.seats[seat] !== stageInfo[seat]) { stageInfo[seat] = res.seats[seat]; ch[seat] = res.seats[seat]; }
			if ((res.names[seat] || "") !== (stageInfo[nk] || "")) { stageInfo[nk] = res.names[seat] || ""; ch[nk] = stageInfo[nk]; }
		});
		// a DIFFERENT person in a seat makes its old @handle wrong; rejoins (same person) keep theirs
		res.admitted.forEach(function (a) {
			var hk = a.seat === "g1" ? "h1" : "h2";
			if (stageInfo[hk]) { stageInfo[hk] = ""; ch[hk] = ""; }
		});
		if (Object.keys(ch).length) { setStage(ch); broadcast(); }
		res.rejoined.forEach(function (r) { notice("↩ " + (here[r.id] || r.id) + " rejoined — back on stage"); });
		res.admitted.forEach(function (a) { notice("✓ " + (here[a.id] || a.id) + " auto-admitted to stage"); });
		updateWaiting(res.waiting, here, res.free.length > 0);
		renderSeats();
	}, 2000);

	var seatBox = document.createElement("span");
	seatBox.style.cssText = "display:inline-flex;gap:6px;align-items:center;color:#d7dbe3;font:600 12px system-ui;padding:0 4px";
	var seatText = document.createElement("span");
	var swapBtn = document.createElement("button");
	swapBtn.type = "button";
	swapBtn.textContent = "⇄ swap positions";
	swapBtn.title = "Swap which guest is in seat 1 vs seat 2 (names travel with the guests)";
	swapBtn.style.cssText = "border:0;border-radius:8px;padding:7px 10px;cursor:pointer;font:inherit;background:#2a3140;color:#d7dbe3";
	swapBtn.onclick = function () {
		var s = { g1: stageInfo.g2, g2: stageInfo.g1, n1: stageInfo.n2, n2: stageInfo.n1, h1: stageInfo.h2, h2: stageInfo.h1 };
		Object.keys(s).forEach(function (k) { stageInfo[k] = s[k]; });
		setStage(s);
		renderSeats();
		broadcast();
	};
	var autoLab = document.createElement("label");
	autoLab.style.cssText = "display:inline-flex;gap:4px;align-items:center;cursor:pointer;font:500 11px system-ui;color:#9ab";
	var autoChk = document.createElement("input");
	autoChk.type = "checkbox";
	autoChk.checked = autoAdmit;
	autoChk.onchange = function () {
		autoAdmit = autoChk.checked;
		try { localStorage.setItem(AUTO_KEY, autoAdmit ? "1" : "0"); } catch (e) {}
	};
	autoLab.appendChild(autoChk);
	autoLab.appendChild(document.createTextNode("auto-admit"));
	// Host screen share (2026-11-05): same second-stream share as guests (publishes ME + ":s"); the share
	// auto-switch above sees session.screenShareState and flips OBS to the Share scene / back.
	var shareBtn = document.createElement("button");
	shareBtn.type = "button";
	shareBtn.textContent = "🖥 share screen";
	shareBtn.style.cssText = "border:0;border-radius:8px;padding:7px 10px;cursor:pointer;font:inherit;background:#2a3140;color:#d7dbe3";
	shareBtn.onclick = function () {
		if (typeof createSecondStream === "function") createSecondStream();
		else shareBtn.textContent = "share: unavailable";
	};
	setInterval(function () {
		var on = !!(window.session && session.screenShareState);
		shareBtn.textContent = on ? "■ stop sharing" : "🖥 share screen";
		shareBtn.style.background = on ? "#e5484d" : "#2a3140";
		shareBtn.style.color = on ? "#fff" : "#d7dbe3";
	}, 500);
	seatBox.appendChild(seatText);
	seatBox.appendChild(swapBtn);
	seatBox.appendChild(autoLab);
	seatBox.appendChild(shareBtn);
	function seatLabel(seat, i) {
		var id = stageInfo[seat];
		var nm = i ? stageInfo.n2 : stageInfo.n1;
		var hk = i ? stageInfo.h2 : stageInfo.h1;
		var who = id ? (nm || labels[id] || id) : "empty";
		return (seat === "g1" ? "Seat 1: " : "Seat 2: ") + who + (hk ? " (" + hk + ")" : "");
	}
	function renderSeats() {
		seatText.textContent = seatLabel("g1", 0) + "  ·  " + seatLabel("g2", 1);
		if (!seatBox.isConnected && bar.isConnected) bar.appendChild(seatBox);
	}

	function render() {
		mount();
		var list = ONLY ? ONLY.filter(function (n) { return scenes.indexOf(n) !== -1; }) : scenes;
		var key = list.join("|");
		if (bar.dataset.key !== key) {
			bar.dataset.key = key;
			Object.keys(buttons).forEach(function (k) { buttons[k].remove(); });
			buttons = {};
			list.forEach(function (name) {
				var b = document.createElement("button");
				b.type = "button";
				b.textContent = name;
				b.style.cssText = "border:0;border-radius:8px;padding:8px 12px;cursor:pointer;font:inherit";
				b.addEventListener("click", function () {
					send("SetCurrentProgramScene", { sceneName: name });
				});
				buttons[name] = b;
				bar.appendChild(b);
			});
		}
		Object.keys(buttons).forEach(function (name) {
			var live = name === current;
			buttons[name].style.background = live ? "#e5484d" : "#2a3140";
			buttons[name].style.color = live ? "#fff" : "#d7dbe3";
			buttons[name].title = live ? "On air" : "Switch to " + name;
		});
	}

	function send(type, data) {
		if (!ws || ws.readyState !== 1) {
			return;
		}
		reqId += 1;
		ws.send(JSON.stringify({ op: 6, d: { requestType: type, requestId: type + ":" + reqId, requestData: data || {} } }));
	}

	async function sha256b64(str) {
		var buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
		var bin = "";
		new Uint8Array(buf).forEach(function (b) { bin += String.fromCharCode(b); });
		return btoa(bin);
	}

	function connect() {
		try {
			ws = new WebSocket(URL_);
		} catch (e) {
			setTimeout(connect, 3000);
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
				var ident = { rpcVersion: 1, eventSubscriptions: 12 }; // Scenes + Inputs
				if (d.d.authentication) {
					var secret = await sha256b64(PASS + d.d.authentication.salt);
					ident.authentication = await sha256b64(secret + d.d.authentication.challenge);
				}
				ws.send(JSON.stringify({ op: 1, d: ident }));
			} else if (d.op === 2) {
				status.textContent = "";
				status.style.display = "none";
				send("GetSceneList");
				send("GetInputSettings", { inputName: STAGE_INPUT });
				send("GetInputSettings", { inputName: MUSIC_INPUT });
			} else if (d.op === 7) {
				var r = d.d.responseData || {};
				if (d.d.requestType === "GetInputSettings" && r.inputSettings && r.inputSettings.url && /youtube/.test(r.inputSettings.url)) {
					musicId = ytId(r.inputSettings.url) || musicId;
					if (musicId) musicBox.value = "♪ " + musicId;
				} else if (d.d.requestType === "GetInputSettings" && r.inputSettings && /stage\.html/.test(r.inputSettings.url || "")) {
					try {
						var sp = new URL(r.inputSettings.url).searchParams;
						stageInfo = { g1: sp.get("g1") || "", g2: sp.get("g2") || "", h1: sp.get("h1") || "", h2: sp.get("h2") || "", n1: sp.get("n1") || "", n2: sp.get("n2") || "" };
						stageUrl = r.inputSettings.url;
						renderSeats();
					} catch (e) {}
					broadcast();
				}
				if (d.d.requestType === "GetSceneList" && r.scenes) {
					scenes = r.scenes.slice().sort(function (a, b) { return b.sceneIndex - a.sceneIndex; }).map(function (s) { return s.sceneName; });
					current = r.currentProgramSceneName || current;
					applyIntroMute();
					render();
					broadcast();
				}
			} else if (d.op === 5) {
				var ev = d.d.eventType;
				if (ev === "CurrentProgramSceneChanged") {
					current = d.d.eventData.sceneName;
					applyIntroMute();
					render();
					broadcast();
				} else if (ev === "InputSettingsChanged" && d.d.eventData.inputName === STAGE_INPUT) {
					send("GetInputSettings", { inputName: STAGE_INPUT });
				} else if (ev === "SceneListChanged" || ev === "SceneNameChanged" || ev === "SceneCreated" || ev === "SceneRemoved") {
					send("GetSceneList");
				}
			}
		};
		ws.onclose = function () {
			status.style.display = "";
			status.textContent = "OBS: reconnecting…";
			mount();
			setTimeout(connect, 3000);
		};
	}

	setTimeout(function () {
		mount();
		connect();
	}, 1000);
})();
