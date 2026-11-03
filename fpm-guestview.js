// FULLPORTMATT guest stage view (guest pages: lowercase "fpm…" push IDs).
// The host page broadcasts {fpmStage:{scene, layout, g1, g2, h1, h2}} over VDO's generic data channel
// (session.sendGenericData). This draws the same layout as OBS's stage page from video the browser already
// has: Matt from his direct camera feed (FPMHOST), other guests from their direct connections, and THIS guest
// from its own local camera (zero delay). Scenes the page can't rebuild (layout "") show the "Show" program
// feed (FPMPROG) full-screen. Before any state arrives, the stock grid stays visible.
// No new connections, no audio (VDO's own elements keep playing audio). Disable with &nostageview.
// Parse-safe (no ?. / ??).
(function () {
	"use strict";
	var params = new URLSearchParams(window.location.search);
	var me = params.get("push") || "";
	// Host page opts in with &stageview (push=FPMHOST): sees the same layout as guests. The host page excludes the
	// OBS program feed (FPMPROG), so for non-stage scenes it falls back to the stock grid instead of the "show" view.
	var isHost = /^FPMHOST$/.test(me) && params.has("stageview");
	if ((!/^fpm/.test(me) && !isHost) || params.has("nostageview") || params.has("director") || params.has("scene")) {
		return;
	}
	var LAYOUTS = {
		solo: { overlay: "stage/retro-solo.html", panels: { host: [0, 0, 1920, 1080] } },
		sbs: { overlay: "stage/retro-sbs.html", panels: { host: [0, 165, 950, 810], g1: [970, 165, 950, 810] } },
		trio: { overlay: "stage/retro-trio.html", panels: { host: [0, 165, 630, 810], g1: [645, 165, 630, 810], g2: [1290, 165, 630, 810] } },
		share: { overlay: "stage/retro-share.html", panels: { share: [0, 165, 1380, 810], host: [1395, 165, 525, 397], sharer: [1395, 578, 525, 397] } },
		show: { overlay: "", panels: { show: [0, 0, 1920, 1080] } }
	};
	var state = null;
	var root = null, stage = null, overlay = null, overlayKey = "";
	var vids = {}; // role -> <video>

	function el(tag, css) {
		var e = document.createElement(tag);
		if (css) e.style.cssText = css;
		return e;
	}

	function build() {
		if (root) return;
		root = el("div", "position:fixed;inset:0;z-index:900;background:#060b12;overflow:hidden;");
		root.className = "fpm-guestview";
		stage = el("div", "position:absolute;left:0;top:0;width:1920px;height:1080px;transform-origin:0 0;");
		root.appendChild(stage);
		["host", "g1", "g2", "share", "sharer", "show"].forEach(function (role) {
			var v = el("video", "position:absolute;object-fit:cover;background:#0e1a2b;display:none;");
			v.muted = true;
			v.autoplay = true;
			v.playsInline = true;
			stage.appendChild(v);
			vids[role] = v;
		});
		overlay = el("iframe", "position:absolute;inset:0;width:1920px;height:1080px;border:0;pointer-events:none;background:transparent;display:none;");
		stage.appendChild(overlay);
		document.body.appendChild(root);
		window.addEventListener("resize", fit);
		fit();
	}

	function fit() {
		if (!stage) return;
		var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
		stage.style.transform = "translate(" + (window.innerWidth - 1920 * s) / 2 + "px," + (window.innerHeight - 1080 * s) / 2 + "px) scale(" + s + ")";
	}

	function streamFor(sid) {
		if (!sid) return null;
		if (sid === me + ":s") {
			// our OWN screen share is local, not an incoming stream
			var se = session.screenShareElement;
			return (se && se.srcObject) || session.screenStream || null;
		}
		if (sid === me) {
			return session.streamSrc || (session.videoElement && session.videoElement.srcObject) || null; // own camera, local
		}
		for (var UUID in session.rpcs) {
			var r = session.rpcs[UUID];
			if (r && r.streamID === sid) {
				return r.streamSrc || (r.videoElement && r.videoElement.srcObject) || null;
			}
		}
		return null;
	}

	function render() {
		if (!state || !window.session) return;
		var name = LAYOUTS[state.layout] ? state.layout : "show";
		var L = LAYOUTS[name];
		build();
		if (isHost) {
			root.style.display = name === "show" ? "none" : "";
			if (name === "show") return;
		}
		var ids = { host: state.host || "FPMHOST", g1: state.g1, g2: state.g2, show: state.show || "FPMPROG", share: state.sharer ? state.sharer + ":s" : "", sharer: state.sharer || "" };
		Object.keys(vids).forEach(function (role) {
			var v = vids[role];
			var r = L.panels[role];
			if (!r) {
				v.style.display = "none";
				return;
			}
			v.style.display = "block";
			v.style.left = r[0] + "px";
			v.style.top = r[1] + "px";
			v.style.width = r[2] + "px";
			v.style.height = r[3] + "px";
			var s = streamFor(ids[role]);
			if (s && v.srcObject !== s) {
				v.srcObject = s;
				try { v.play(); } catch (e) {}
			}
			// mirror own camera like a normal self-view
			v.style.transform = ids[role] === me ? "scaleX(-1)" : "";
			v.style.objectFit = role === "share" ? "contain" : "cover";
			v.style.background = role === "share" ? "#000" : "#0e1a2b";
		});
		var h1 = state.h1 || "", h2 = state.h2 || "";
		if (name === "share") {
			h1 = state.sharer && state.sharer === state.g2 ? state.h2 || "" : state.h1 || "";
			h2 = "";
		}
		var key = L.overlay ? L.overlay + "?h1=" + encodeURIComponent(h1) + "&h2=" + encodeURIComponent(h2) : "";
		if (key !== overlayKey) {
			overlayKey = key;
			overlay.style.display = key ? "block" : "none";
			if (key) overlay.src = key;
		}
	}

	function hook() {
		if (!window.session || typeof session.gotGenericData !== "function" || session.__fpmGuestView) {
			return false;
		}
		session.__fpmGuestView = true;
		var orig = session.gotGenericData;
		session.gotGenericData = function (data, UUID) {
			try {
				if (data && data.fpmStage) {
					state = data.fpmStage;
					render();
				}
			} catch (e) {}
			return orig.apply(this, arguments);
		};
		return true;
	}

	var t = setInterval(function () {
		if (hook()) clearInterval(t);
	}, 500);
	// Announce our own screen-share state to the room (host page switches OBS on this, instantly both ways;
	// VDO keeps the ":s" stream connected and "live" after Stop, so the video alone can't tell).
	var lastShare = null, lastSent = 0;
	setInterval(function () {
		if (isHost || !window.session || typeof session.sendGenericData !== "function") return;
		var on = !!session.screenShareState;
		var now = Date.now();
		if (on !== lastShare || now - lastSent > 3000) {
			lastShare = on;
			lastSent = now;
			try { session.sendGenericData({ fpmShare: { id: me, on: on } }); } catch (e) {}
		}
	}, 300);
	setInterval(render, 2000); // re-bind streams that (re)connected
	// The host page's own broadcasts never come back to it, so fpm-scenes.js hands them over directly.
	window.fpmGuestView = { state: function () { return state; }, render: render, set: function (s) { state = s; render(); } };
})();
