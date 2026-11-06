// FULLPORTMATT host-page controller v2 (2026-11-05, SPEC v2 "Onstage"). On the HOST page only
// (&obspass=<OBS websocket password> + &push). Owns ALL control-plane state:
//   - scene buttons (Starting Soon / Onstage) + OBS websocket + intro mic-mute
//   - the CAST: ordered onstage guests in the OBS "Stage" input URL (?cast=JSON [[id,name],...]);
//     fpm-seats.js plans joins/blips/leaves; backstage strip + hover controls admit/demote
//   - share as STATE, not a scene: host button (second stream FPMHOST:s) + guest announces reflow
//     the stage everywhere via the broadcast; nothing switches scenes
//   - the native camera transform in "Onstage" follows Matt's slot (fpm-layouts geometry)
//   - build-sync: stamps its own build into the Stage URL so OBS always runs matching code
// Talks to local OBS (ws://127.0.0.1:4455 unless &obsurl=). Parse-safe (no ?. / ??).
(function () {
	"use strict";
	var params = new URLSearchParams(window.location.search);
	var PASS = params.get("obspass");
	if (!PASS || !params.has("push")) return;
	var URL_ = params.get("obsurl") || "ws://127.0.0.1:4455";
	var ME = params.get("push") || "FPMHOST";
	var DEFAULT_SCENES = ["Starting Soon", "Onstage"];
	var ONLY = params.get("scenes") === "all" ? null : params.get("scenes") ? params.get("scenes").split(",").map(function (s) { return s.trim(); }).filter(Boolean) : DEFAULT_SCENES;
	var STAGE_INPUT = params.get("stageinput") || "Stage";
	var ONSTAGE_SCENE = params.get("onstagescene") || "Onstage";
	var CAM_SOURCE = params.get("camsource") || "Osmo Pocket 4";
	var MIC = params.get("micinput") || "Mic/Aux";
	var MUSIC_INPUT = params.get("musicinput") || "Intro Music";

	// ---------- toolbar ----------
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

	var ws = null, reqId = 0, scenes = [], current = "", buttons = {};
	var cast = []; // [[id,name],...] onstage guests, order = stage order
	var stageUrl = "";
	var labels = {}, firstSeen = {}, lastSeen = {};
	var camItemId = 0, camLastKey = "";
	var musicId = "";

	function layoutFor(name) {
		var n = String(name || "").toLowerCase();
		if (n.indexOf("starting") !== -1 || n.indexOf("intro") !== -1) return "intro";
		if (n.indexOf("onstage") !== -1 || n === "solo" || n.indexOf("stage") !== -1) return "onstage";
		return "";
	}

	function guestsHere() {
		var out = {};
		if (!window.session || !session.rpcs) return out;
		for (var U in session.rpcs) {
			var r = session.rpcs[U];
			var id = r && r.streamID ? String(r.streamID) : "";
			if (!/^fpm[A-Za-z0-9]{6,}$/.test(id)) continue;
			out[id] = (r.label || id);
		}
		return out;
	}

	// ---------- share (a state, never a scene) ----------
	var sharing = ""; // stream id of the active sharer ("FPMHOST" or an ONSTAGE fpm… id)
	var shareAnnounce = {}; // guest id -> {on, ts}
	(function hookShare() {
		if (!window.session || typeof session.gotGenericData !== "function") return setTimeout(hookShare, 500);
		if (session.__fpmShareHook) return;
		session.__fpmShareHook = true;
		var orig = session.gotGenericData;
		session.gotGenericData = function (data) {
			try {
				if (data && data.fpmShare && data.fpmShare.id) {
					shareAnnounce[data.fpmShare.id] = { on: !!data.fpmShare.on, ts: Date.now() };
				}
			} catch (e) {}
			return orig.apply(this, arguments);
		};
	})();
	function onstageIds() { return cast.map(function (m) { return m[0]; }); }
	function liveShareId() {
		if (window.session && session.screenShareState) return ME; // the host pressing share wins
		var on = onstageIds();
		for (var i = 0; i < on.length; i++) {
			var a = shareAnnounce[on[i]];
			if (a && a.on && Date.now() - a.ts < 10000) return on[i];
		}
		if (window.session && session.rpcs) {
			for (var U in session.rpcs) {
				var r = session.rpcs[U];
				var sid = r && r.streamID ? String(r.streamID) : "";
				if (sid.slice(-2) !== ":s") continue;
				var base = sid.slice(0, -2);
				if (on.indexOf(base) === -1) continue; // backstage shares never reflow the stage
				var a2 = shareAnnounce[base];
				if (a2 && !a2.on && Date.now() - a2.ts < 10000) continue;
				var st = r.streamSrc || (r.videoElement && r.videoElement.srcObject);
				if (st && st.getVideoTracks && st.getVideoTracks().some(function (t) { return t.readyState === "live" && !t.muted; })) return base;
			}
		}
		return "";
	}
	function setStageSharer(sid) {
		if (!stageUrl) return;
		var u;
		try { u = new URL(stageUrl); } catch (e) { return; }
		if (sid) u.searchParams.set("sharer", sid); else u.searchParams.delete("sharer");
		stageUrl = u.toString();
		send("SetInputSettings", { inputName: STAGE_INPUT, inputSettings: { url: stageUrl } });
	}
	setInterval(function () {
		var now = liveShareId();
		if (now !== sharing) { sharing = now; setStageSharer(now); broadcast(); hoverRender(); camApply(); }
	}, 300);

	// ---------- broadcast ----------
	function broadcast() {
		if (!window.session || typeof session.sendGenericData !== "function" || !current) return;
		var st = { scene: current, layout: layoutFor(current), cast: cast, sharer: sharing || "", music: musicId };
		try { session.sendGenericData({ fpmStage: st }); } catch (e) {}
		try { if (window.fpmGuestView && window.fpmGuestView.set) window.fpmGuestView.set(st); } catch (e) {}
	}
	setInterval(broadcast, 4000);

	// ---------- OBS Stage URL (cast lives here; OBS reloads the stage page on change) ----------
	function setCast(newCast, why) {
		cast = newCast;
		if (!stageUrl) return;
		var u;
		try { u = new URL(stageUrl); } catch (e) { return; }
		["g1", "g2", "h1", "h2", "n1", "n2"].forEach(function (k) { u.searchParams.delete(k); }); // legacy
		u.searchParams.set("cast", JSON.stringify(cast));
		stageUrl = u.toString();
		send("SetInputSettings", { inputName: STAGE_INPUT, inputSettings: { url: stageUrl } });
		broadcast();
		renderStatusText();
		hoverRender();
		camApply();
	}

	// ---------- native camera transform (Matt = slot 0) ----------
	function camApply() {
		if (!ws || ws.readyState !== 1 || !camItemId || !window.fpmLayouts) return;
		var n = 1 + cast.length;
		var r = sharing ? fpmLayouts.shareLayout(n).tiles[0] : fpmLayouts.gridLayout(n)[0];
		var key = (sharing ? "s" : "g") + r.join(",");
		if (key === camLastKey) return;
		camLastKey = key;
		send("SetSceneItemTransform", { sceneName: ONSTAGE_SCENE, sceneItemId: camItemId, sceneItemTransform: {
			positionX: r[0] * 2, positionY: r[1] * 2, boundsType: "OBS_BOUNDS_SCALE_OUTER", boundsAlignment: 0,
			boundsWidth: r[2] * 2, boundsHeight: r[3] * 2, cropToBounds: true } });
	}
	setInterval(camApply, 2000);

	// ---------- alerts / notices ----------
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
	var alertRow = document.createElement("div");
	alertRow.style.cssText = "position:fixed;top:78px;left:50%;transform:translateX(-50%);z-index:99998;display:flex;flex-direction:column;gap:6px;align-items:center;font:600 13px system-ui,-apple-system,sans-serif";
	function notice(text) {
		if (document.body && !alertRow.isConnected) document.body.appendChild(alertRow);
		try { if (bar.isConnected) alertRow.style.top = Math.round(bar.getBoundingClientRect().bottom + 8) + "px"; } catch (e) {}
		var c = document.createElement("div");
		c.style.cssText = "display:flex;gap:10px;align-items:center;padding:8px 12px;border-radius:10px;background:rgba(26,59,43,.95);color:#fff;box-shadow:0 2px 12px rgba(0,0,0,.45)";
		c.textContent = text;
		alertRow.appendChild(c);
		setTimeout(function () { c.remove(); }, 6000);
	}

	// ---------- backstage strip (host-only): live tiles + "Bring Onstage" ----------
	var strip = document.createElement("div");
	strip.style.cssText = "position:fixed;left:16px;bottom:96px;z-index:960;display:flex;gap:10px;align-items:flex-end;font:600 12px system-ui,-apple-system,sans-serif";
	var stripTiles = {}; // id -> {box, name, iframe}
	function stripSync(backstage) {
		if (document.body && !strip.isConnected) document.body.appendChild(strip);
		Object.keys(stripTiles).forEach(function (id) {
			if (backstage.indexOf(id) === -1) { stripTiles[id].box.remove(); delete stripTiles[id]; }
		});
		backstage.forEach(function (id) {
			if (stripTiles[id]) { stripTiles[id].name.textContent = labels[id] || id; return; }
			var box = document.createElement("div");
			box.style.cssText = "position:relative;width:240px;height:168px;border-radius:10px;overflow:hidden;background:#0e1a2b;box-shadow:0 0 0 3px #5a606a,0 8px 24px rgba(0,0,0,.6)";
			var f = document.createElement("iframe");
			f.allow = "autoplay";
			f.src = "./?view=" + encodeURIComponent(id) + "&scene&room=" + encodeURIComponent(params.get("room") || "fpmshow") + "&cover&noaudio&viewheight=360&videobitrate=500&label=Full_Port_Matt";
			f.style.cssText = "position:absolute;left:0;top:0;width:100%;height:135px;border:0;pointer-events:none";
			box.appendChild(f);
			var chip = document.createElement("div");
			chip.style.cssText = "position:absolute;left:8px;top:8px;background:rgba(90,96,106,.92);color:#e8ebf0;padding:2px 8px;border-radius:5px;font-size:11px;letter-spacing:1px";
			chip.textContent = "BACKSTAGE";
			box.appendChild(chip);
			var nm = document.createElement("div");
			nm.style.cssText = "position:absolute;left:0;right:0;bottom:0;height:33px;display:flex;align-items:center;justify-content:space-between;padding:0 8px;background:rgba(10,16,24,.95);color:#d7dbe3";
			var nmTxt = document.createElement("span");
			nmTxt.textContent = labels[id] || id;
			nmTxt.style.cssText = "overflow:hidden;white-space:nowrap;max-width:120px";
			var btn = document.createElement("button");
			btn.type = "button";
			btn.textContent = "Bring Onstage";
			btn.style.cssText = "border:0;border-radius:6px;padding:4px 8px;cursor:pointer;font:inherit;font-size:11px;background:#2f855a;color:#fff;opacity:0;transition:opacity .15s";
			btn.onclick = function () {
				var next = fpmSeats.admit(cast, id, labels[id] || "");
				if (next.length === cast.length) { notice("Stage is full (8 guests)"); return; }
				setCast(next, "admit");
				notice("🎬 " + (labels[id] || id) + " brought onstage");
			};
			nm.appendChild(nmTxt); nm.appendChild(btn);
			box.appendChild(nm);
			box.onmouseenter = function () { btn.style.opacity = "1"; };
			box.onmouseleave = function () { btn.style.opacity = "0"; };
			strip.appendChild(box);
			stripTiles[id] = { box: box, name: nmTxt, iframe: f };
			beep();
			notice("🔔 " + (labels[id] || id) + " joined — backstage");
		});
	}

	// ---------- hover layer over the stage view: "Send Backstage" on onstage tiles ----------
	var hover = document.createElement("div");
	hover.style.cssText = "position:fixed;inset:0;z-index:950;pointer-events:none";
	function hoverRender() {
		if (document.body && !hover.isConnected) document.body.appendChild(hover);
		hover.innerHTML = "";
		if (!window.fpmLayouts || !cast.length) return;
		if (layoutFor(current) !== "onstage") return;
		var n = 1 + cast.length;
		var rects = sharing ? fpmLayouts.shareLayout(n).tiles : fpmLayouts.gridLayout(n);
		var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
		var ox = (window.innerWidth - 1920 * s) / 2, oy = (window.innerHeight - 1080 * s) / 2;
		cast.forEach(function (m, i) {
			var r = rects[i + 1];
			if (!r) return;
			var z = document.createElement("div");
			z.style.cssText = "position:absolute;pointer-events:auto;left:" + (ox + r[0] * s) + "px;top:" + (oy + r[1] * s) + "px;width:" + (r[2] * s) + "px;height:" + (r[3] * s) + "px";
			var btn = document.createElement("button");
			btn.type = "button";
			btn.textContent = "Send Backstage";
			btn.style.cssText = "position:absolute;left:50%;top:12px;transform:translateX(-50%);border:0;border-radius:8px;padding:7px 12px;cursor:pointer;font:600 12px system-ui;background:rgba(120,44,50,.95);color:#fff;opacity:0;transition:opacity .15s";
			btn.onclick = function () {
				setCast(fpmSeats.demote(cast, m[0]), "demote");
				notice("↩ " + (m[1] || m[0]) + " sent backstage");
			};
			z.appendChild(btn);
			z.onmouseenter = function () { btn.style.opacity = "1"; };
			z.onmouseleave = function () { btn.style.opacity = "0"; };
			hover.appendChild(z);
		});
	}
	window.addEventListener("resize", hoverRender);

	// ---------- roster → planner loop ----------
	var AUTO_KEY = "fpmAutoAdmit";
	var autoAdmit = false;
	try { autoAdmit = localStorage.getItem(AUTO_KEY) === "1"; } catch (e) {}
	setInterval(function () {
		if (!stageUrl || !ws || ws.readyState !== 1 || !window.fpmSeats) return;
		var here = guestsHere(), now = Date.now();
		Object.keys(here).forEach(function (id) { if (!firstSeen[id]) firstSeen[id] = now; labels[id] = here[id]; });
		var res = fpmSeats.plan({ onstage: cast, here: here, firstSeen: firstSeen, lastSeen: lastSeen, now: now, autoAdmit: autoAdmit });
		Object.keys(here).forEach(function (id) { lastSeen[id] = now; });
		var changed = JSON.stringify(res.onstage) !== JSON.stringify(cast);
		res.removed.forEach(function (m) { notice("👋 " + (m[1] || m[0]) + " left the stage (gone > 60 s)"); });
		res.rejoined.forEach(function (m) { notice("↩ " + m.name + " reconnected — back in their spot"); });
		res.admitted.forEach(function (id) { notice("✓ " + (here[id] || id) + " auto-admitted onstage"); });
		if (changed) setCast(res.onstage, "plan");
		stripSync(res.backstage);
		renderStatusText();
	}, 2000);

	// ---------- toolbar widgets ----------
	var seatBox = document.createElement("span");
	seatBox.style.cssText = "display:inline-flex;gap:8px;align-items:center;color:#d7dbe3;font:600 12px system-ui;padding:0 4px";
	var seatText = document.createElement("span");
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
	seatBox.appendChild(autoLab);
	seatBox.appendChild(shareBtn);
	function renderStatusText() {
		seatText.textContent = "Onstage: " + cast.length + "/8 · Backstage: " + Object.keys(stripTiles).length;
		if (!seatBox.isConnected && bar.isConnected) bar.appendChild(seatBox);
	}

	// ---------- intro music + mic mute ----------
	var micMutedByUs = false;
	function applyIntroMute() {
		var intro = layoutFor(current) === "intro";
		if (intro && !micMutedByUs) { micMutedByUs = true; send("SetInputMute", { inputName: MIC, inputMuted: true }); }
		else if (!intro && micMutedByUs) { micMutedByUs = false; send("SetInputMute", { inputName: MIC, inputMuted: false }); }
	}
	function ytId(u) {
		var m = String(u || "").match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/live\/|\/shorts\/)([A-Za-z0-9_-]{11})/);
		return m ? m[1] : /^[A-Za-z0-9_-]{11}$/.test(String(u || "").trim()) ? String(u).trim() : "";
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
		send("SetInputSettings", { inputName: MUSIC_INPUT, inputSettings: { url: "https://www.youtube.com/embed/" + id + "?autoplay=1&loop=1&playlist=" + id + "&controls=0&rel=0" } });
		musicBox.value = "♪ " + id;
		broadcast();
	});

	function mount() {
		if (document.body && !bar.isConnected) document.body.appendChild(bar);
		if (params.has("musicbox") && !musicBox.isConnected) bar.appendChild(musicBox);
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
				b.addEventListener("click", function () { send("SetCurrentProgramScene", { sceneName: name }); });
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

	// ---------- OBS websocket ----------
	function send(type, data) {
		if (!ws || ws.readyState !== 1) return;
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
		try { ws = new WebSocket(URL_); } catch (e) { setTimeout(connect, 3000); return; }
		ws.onmessage = async function (m) {
			var d;
			try { d = JSON.parse(m.data); } catch (e) { return; }
			if (d.op === 0) {
				var ident = { rpcVersion: 1, eventSubscriptions: 12 };
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
				send("GetSceneItemList", { sceneName: ONSTAGE_SCENE });
			} else if (d.op === 7) {
				var r = d.d.responseData || {};
				if (d.d.requestType === "GetInputSettings" && r.inputSettings && r.inputSettings.url && /youtube/.test(r.inputSettings.url)) {
					musicId = ytId(r.inputSettings.url) || musicId;
					if (musicId) musicBox.value = "♪ " + musicId;
				} else if (d.d.requestType === "GetInputSettings" && r.inputSettings && /stage\.html/.test(r.inputSettings.url || "")) {
					try {
						var u = new URL(r.inputSettings.url);
						var sp = u.searchParams;
						stageUrl = r.inputSettings.url;
						var parsed = [];
						try { if (sp.get("cast")) parsed = JSON.parse(sp.get("cast")); } catch (e2) {}
						if (!sp.get("cast") && (sp.get("g1") || sp.get("g2"))) {
							// one-time legacy migration
							if (sp.get("g1")) parsed.push([sp.get("g1"), sp.get("n1") || sp.get("h1") || ""]);
							if (sp.get("g2")) parsed.push([sp.get("g2"), sp.get("n2") || sp.get("h2") || ""]);
							cast = parsed;
							setCast(parsed, "migrate-legacy");
						} else {
							cast = parsed.map(function (m) { return [String(m[0]), String(m[1] || "")]; });
						}
						renderStatusText();
						hoverRender();
						camApply();
						// BUILD SYNC: force OBS onto this page's build
						var bm0 = document.querySelector('meta[name="fpm-build"]');
						if (bm0 && bm0.content && sp.get("b") !== bm0.content) {
							var u2 = new URL(stageUrl);
							u2.searchParams.set("b", bm0.content);
							stageUrl = u2.toString();
							send("SetInputSettings", { inputName: STAGE_INPUT, inputSettings: { url: stageUrl } });
						}
					} catch (e) {}
					broadcast();
				}
				if (d.d.requestType === "GetSceneItemList" && r.sceneItems) {
					var camIt = r.sceneItems.filter(function (it) { return it.sourceName === CAM_SOURCE; })[0];
					if (camIt) { camItemId = camIt.sceneItemId; camLastKey = ""; camApply(); }
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
					hoverRender();
				} else if (ev === "InputSettingsChanged" && d.d.eventData.inputName === STAGE_INPUT) {
					send("GetInputSettings", { inputName: STAGE_INPUT });
				} else if (ev === "SceneListChanged" || ev === "SceneNameChanged" || ev === "SceneCreated" || ev === "SceneRemoved") {
					send("GetSceneList");
					send("GetSceneItemList", { sceneName: ONSTAGE_SCENE });
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
	setTimeout(function () { mount(); connect(); }, 1000);
})();
