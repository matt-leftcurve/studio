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
	var ONLY = params.get("scenes") ? params.get("scenes").split(",").map(function (s) { return s.trim(); }).filter(Boolean) : null;

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
	var stageInfo = { g1: "", g2: "", h1: "", h2: "" };
	function layoutFor(name) {
		var n = String(name || "").toLowerCase();
		if (n.indexOf("stage") === -1) return ""; // non-stage scenes: guests see the Show program feed
		if (n.indexOf("share") !== -1) return "share";
		if (n.indexOf("trio") !== -1) return "trio";
		if (n.indexOf("sbs") !== -1) return "sbs";
		if (n.indexOf("solo") !== -1) return "solo";
		return "";
	}
	function broadcast() {
		if (!window.session || typeof session.sendGenericData !== "function" || !current) return;
		try {
			session.sendGenericData({ fpmStage: { scene: current, layout: layoutFor(current), g1: stageInfo.g1, g2: stageInfo.g2, h1: stageInfo.h1, h2: stageInfo.h2, sharer: typeof sharing === "string" ? sharing : "" } });
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
	function liveShareId() {
		if (!window.session || !session.rpcs) return "";
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
		for (var U in session.rpcs) {
			var r = session.rpcs[U];
			var sid = r && r.streamID ? String(r.streamID) : "";
			if (sid.slice(-2) !== ":s") continue;
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
			if (/stage/i.test(current) && current !== SHARE_SCENE && scenes.indexOf(SHARE_SCENE) !== -1) {
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
	}, 1000);

	function mount() {
		if (document.body && !bar.isConnected) {
			document.body.appendChild(bar);
		}
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
			} else if (d.op === 7) {
				var r = d.d.responseData || {};
				if (d.d.requestType === "GetInputSettings" && r.inputSettings && r.inputSettings.url) {
					try {
						var sp = new URL(r.inputSettings.url).searchParams;
						stageInfo = { g1: sp.get("g1") || "", g2: sp.get("g2") || "", h1: sp.get("h1") || "", h2: sp.get("h2") || "" };
					} catch (e) {}
					broadcast();
				}
				if (d.d.requestType === "GetSceneList" && r.scenes) {
					scenes = r.scenes.slice().sort(function (a, b) { return b.sceneIndex - a.sceneIndex; }).map(function (s) { return s.sceneName; });
					current = r.currentProgramSceneName || current;
					render();
					broadcast();
				}
			} else if (d.op === 5) {
				var ev = d.d.eventType;
				if (ev === "CurrentProgramSceneChanged") {
					current = d.d.eventData.sceneName;
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
