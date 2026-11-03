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
				var ident = { rpcVersion: 1, eventSubscriptions: 4 }; // Scenes
				if (d.d.authentication) {
					var secret = await sha256b64(PASS + d.d.authentication.salt);
					ident.authentication = await sha256b64(secret + d.d.authentication.challenge);
				}
				ws.send(JSON.stringify({ op: 1, d: ident }));
			} else if (d.op === 2) {
				status.textContent = "";
				status.style.display = "none";
				send("GetSceneList");
			} else if (d.op === 7) {
				var r = d.d.responseData || {};
				if (d.d.requestType === "GetSceneList" && r.scenes) {
					scenes = r.scenes.slice().sort(function (a, b) { return b.sceneIndex - a.sceneIndex; }).map(function (s) { return s.sceneName; });
					current = r.currentProgramSceneName || current;
					render();
				}
			} else if (d.op === 5) {
				var ev = d.d.eventType;
				if (ev === "CurrentProgramSceneChanged") {
					current = d.d.eventData.sceneName;
					render();
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
