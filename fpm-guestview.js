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
		show: { overlay: "", panels: { show: [0, 0, 1920, 1080] } },
		intro: { overlay: "", panels: { host: [340, 775, 400, 225], g1: [760, 775, 400, 225], g2: [1180, 775, 400, 225] } },
		solo_pip: { overlay: "", panels: { host: [0, 0, 1920, 1080], g1: [1530, 200, 360, 203], g2: [1530, 418, 360, 203] } }
	};
	var state = null;
	var root = null, stage = null, overlay = null, overlayKey = "";
	var vids = {}; // role -> <video>
	var hostStage = null, hostStageKey = "", showFrame = null;

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
		// Other people come from the SAME stage page OBS uses (scene-type views: none of VDO's room-member caps, so the
		// same quality as OBS). Our own panel is transparent there; our LOCAL camera/share <video> shows underneath.
		hostStage = el("iframe", "position:absolute;inset:0;width:1920px;height:1080px;border:0;pointer-events:none;background:transparent;");
		hostStage.allow = "autoplay";
		stage.appendChild(hostStage);
		// Non-stage scenes: guests see the OBS program feed, also as a scene view.
		showFrame = el("iframe", "position:absolute;inset:0;width:1920px;height:1080px;border:0;pointer-events:none;background:#060b12;display:none;");
		showFrame.allow = "autoplay";
		stage.appendChild(showFrame);
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
		// Non-stage OBS scenes (Solo, TradingView, …): guests see Matt full-frame from the stage page. The OBS virtual
		// camera "Show" feed (FPMPROG) is retired (2026-11-03): nothing needs the virtual camera any more.
		var name = LAYOUTS[state.layout] ? state.layout : isHost ? "show" : "solo";
		var L = LAYOUTS[name];
		build();
		if (isHost) {
			root.style.display = name === "show" ? "none" : "";
			if (name === "show") { music(""); return; }
		}
		if (name === "show") {
			hostStage.style.display = "none";
			Object.keys(vids).forEach(function (role) { vids[role].style.display = "none"; });
			overlay.style.display = "none";
			overlayKey = "";
			if (!showFrame.getAttribute("src")) showFrame.src = "./?view=" + encodeURIComponent(state.show || "FPMPROG") + "&scene&room=fpmshow&cover&noaudio&label=Show";
			showFrame.style.display = "block";
			return;
		}
		showFrame.style.display = "none";
		hostStage.style.display = "block";
		var q = new URLSearchParams();
		["g1", "g2", "h1", "h2"].forEach(function (k) { if (state[k]) q.set(k, state[k]); });
		if (!isHost) {
			q.set("mode", "view"); // Matt's panel via a scene view of FPMHOST
			q.set("self", me);
		}
		var hk = q.toString();
		if (hk !== hostStageKey) {
			// (re)load only when the seats change; layout changes go by postMessage so nobody reconnects
			hostStageKey = hk;
			var bm = document.querySelector('meta[name="fpm-build"]');
			hostStage.src = "./stage.html?" + hk + "&layout=" + name + "&b=" + encodeURIComponent(bm ? bm.content : Date.now()); // &b: never a stale cached stage page // no &audio: audio comes from the room connections
		}
		try { hostStage.contentWindow.postMessage({ fpmStage: { layout: name, sharer: state.sharer || "" } }, "*"); } catch (e) {}
		overlay.style.display = "none"; // the stage page draws the overlay
		overlayKey = "";
		var Lp = LAYOUTS[name].panels;
		var local = {}; // role -> stream id, for panels that show OUR OWN media locally
		if (isHost) local.host = me;
		else {
			if (state.g1 === me && Lp.g1) local.g1 = me;
			if (state.g2 === me && Lp.g2) local.g2 = me;
			if (name === "share" && state.sharer === me) { local.sharer = me; local.share = me + ":s"; }
		}
		Object.keys(vids).forEach(function (role) {
			var v = vids[role], r = Lp[role];
			if (!local[role] || !r) { v.style.display = "none"; return; }
			v.style.display = "block";
			v.style.left = r[0] + "px"; v.style.top = r[1] + "px"; v.style.width = r[2] + "px"; v.style.height = r[3] + "px";
			var sm = streamFor(local[role]);
			if (sm && v.srcObject !== sm) { v.srcObject = sm; try { v.play(); } catch (e) {} }
			v.style.transform = local[role] === me ? "scaleX(-1)" : "";
			v.style.objectFit = role === "share" ? "contain" : "cover";
			v.style.background = role === "share" ? "#000" : "#0e1a2b";
			// small tiles (intro strip, solo PiP) sit ABOVE the stage page, whose intro background is opaque
			var small = r[2] < 800;
			v.style.zIndex = small ? "30" : "";
			v.style.borderRadius = small ? "10px" : "";
			v.style.boxShadow = small ? "0 0 0 3px #7fd4c1, 0 8px 24px rgba(0,0,0,.6)" : "";
		});
		music(name === "intro" ? state.music : "");
		return;

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

	// Intro music for the people IN the room (host + guests), played locally and quietly. The audience gets the same
	// track from OBS's "Intro Music" input. Volume via the YouTube iframe API (postMessage, enablejsapi=1).
	var MUSIC_VOL = parseInt(params.get("musicvol") || "15", 10);
	var musicFrame = null, musicNow = "", musicBtn = null;
	function ytCmd(func, args) {
		try { musicFrame.contentWindow.postMessage(JSON.stringify({ event: "command", func: func, args: args || [] }), "*"); } catch (e) {}
	}
	function music(id) {
		if (id === musicNow) return;
		musicNow = id;
		if (musicFrame) { musicFrame.remove(); musicFrame = null; }
		if (musicBtn) { musicBtn.remove(); musicBtn = null; }
		if (!id) return;
		musicFrame = el("iframe", "position:fixed;left:-400px;top:0;width:320px;height:180px;border:0;opacity:0;pointer-events:none");
		musicFrame.allow = "autoplay";
		musicFrame.src = "https://www.youtube.com/embed/" + id + "?enablejsapi=1&autoplay=1&loop=1&playlist=" + id + "&controls=0&origin=" + encodeURIComponent(location.origin);
		musicFrame.onload = function () {
			[300, 1200, 3000].forEach(function (t) { setTimeout(function () { ytCmd("setVolume", [MUSIC_VOL]); ytCmd("playVideo"); }, t); });
		};
		document.body.appendChild(musicFrame);
		// autoplay with sound can be blocked: offer a one-tap fallback
		musicBtn = el("button", "position:fixed;right:14px;top:14px;z-index:99999;border:0;border-radius:8px;padding:8px 12px;background:#1b2230;color:#d7dbe3;font:600 13px system-ui;cursor:pointer");
		musicBtn.textContent = "♪ music not playing? tap";
		musicBtn.onclick = function () { ytCmd("setVolume", [MUSIC_VOL]); ytCmd("playVideo"); musicBtn.remove(); musicBtn = null; };
		document.body.appendChild(musicBtn);
		setTimeout(function () { if (musicBtn) { musicBtn.remove(); musicBtn = null; } }, 20000);
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
	// Build stamp (bottom-left) so we can tell which deploy a guest actually loaded.
	(function badge() {
		if (!document.body) return setTimeout(badge, 500);
		var m = document.querySelector('meta[name="fpm-build"]');
		var b = el("div", "position:fixed;left:6px;bottom:4px;z-index:99999;font:10px ui-monospace,Menlo,monospace;color:#7d8aa0;opacity:.75;pointer-events:none");
		b.textContent = "build " + (m ? m.content : "?");
		document.body.appendChild(b);
	})();
	window.fpmGuestView = { state: function () { return state; }, render: render, set: function (s) { state = s; render(); } };
})();
