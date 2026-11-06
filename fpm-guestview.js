// FULLPORTMATT guest stage view v2 (2026-11-05, SPEC v2 "Onstage"). Guest pages (lowercase "fpm…"
// push IDs) and the host page (&stageview) draw the SAME stage as OBS via an embedded stage.html:
// the host page broadcasts {fpmStage:{scene, layout, cast, sharer, music}} over VDO's generic data
// channel. This file adds the LOCAL pieces on top: this person's own camera/share rendered with zero
// delay in their own tile slot, and — when this guest is NOT in the cast — a small own-camera
// preview with a grey "Backstage" chip. Parse-safe (no ?. / ??).
(function () {
	"use strict";
	var params = new URLSearchParams(window.location.search);
	var me = params.get("push") || "";
	var isHost = /^FPMHOST$/.test(me) && params.has("stageview");
	if ((!/^fpm/.test(me) && !isHost) || params.has("nostageview") || params.has("director") || params.has("scene")) {
		return;
	}
	var LGEO = window.fpmLayouts;
	var state = null;
	var root = null, stage = null, hostStage = null, hostStageKey = null;
	var vids = {}; // "self" | "share" -> <video>
	var backBadge = null;

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
		["self", "share"].forEach(function (role) {
			var v = el("video", "position:absolute;object-fit:cover;background:#0e1a2b;display:none;");
			v.muted = true; v.autoplay = true; v.playsInline = true;
			stage.appendChild(v);
			vids[role] = v;
		});
		backBadge = el("div", "position:absolute;display:none;z-index:40;background:rgba(90,96,106,0.92);color:#e8ebf0;" +
			"font:700 15px system-ui,-apple-system,sans-serif;letter-spacing:1px;padding:4px 10px;border-radius:6px;");
		backBadge.textContent = "BACKSTAGE";
		stage.appendChild(backBadge);
		// other people + overlays come from the SAME stage page OBS renders
		hostStage = el("iframe", "position:absolute;inset:0;width:1920px;height:1080px;border:0;pointer-events:none;background:transparent;");
		hostStage.allow = "autoplay";
		stage.appendChild(hostStage);
		document.body.appendChild(root);
		window.addEventListener("resize", fit);
		fit();
	}

	function fit() {
		if (!stage) return;
		var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
		stage.style.transform = "translate(" + (window.innerWidth - 1920 * s) / 2 + "px," + (window.innerHeight - 1080 * s) / 2 + "px) scale(" + s + ")";
	}

	function myIndex() {
		if (isHost) return 0;
		var cast = (state && state.cast) || [];
		for (var i = 0; i < cast.length; i++) if (cast[i][0] === me) return i + 1;
		return -1;
	}

	function myRects() {
		var n = 1 + ((state && state.cast) ? state.cast.length : 0);
		if (state && state.layout === "intro") return LGEO.introStrip(n);
		if (state && state.sharer) return LGEO.shareLayout(n).tiles;
		return LGEO.gridLayout(n);
	}

	function ownStreams() {
		var cam = null, shr = null;
		try { cam = session.streamSrc || (session.videoElement && session.videoElement.srcObject) || null; } catch (e) {}
		try { shr = (session.screenShareElement && session.screenShareElement.srcObject) || session.screenStream || null; } catch (e) {}
		return { cam: cam, shr: shr };
	}

	function setVid(role, rect, stream, contain) {
		var v = vids[role];
		if (!rect || !stream) { v.style.display = "none"; return; }
		v.style.display = "block";
		v.style.left = rect[0] + "px"; v.style.top = rect[1] + "px";
		v.style.width = rect[2] + "px"; v.style.height = rect[3] + "px";
		if (v.srcObject !== stream) { v.srcObject = stream; try { v.play(); } catch (e) {} }
		v.style.objectFit = contain ? "contain" : "cover";
		v.style.transform = contain ? "" : "scaleX(-1)";
		v.style.background = contain ? "#000" : "#0e1a2b";
	}

	function render() {
		if (!state || !window.session || !LGEO) return;
		build();
		var known = state.layout === "intro" || state.layout === "onstage";
		if (isHost && !known) { root.style.display = "none"; music(""); return; }
		root.style.display = "";
		var qp = new URLSearchParams();
		qp.set("cast", JSON.stringify(state.cast || []));
		qp.set("maxh", params.get("viewmaxh") || "720");
		qp.set("vbr", params.get("viewbitrate") || "1500");
		qp.set("vcodec", params.get("viewcodec") || "h264");
		if (params.get("icefilter")) qp.set("ice", params.get("icefilter"));
		qp.set("dpr", params.get("viewdpr") || "1");
		qp.set("self", me);
		qp.set("room", params.get("room") || "fpmshow");
		if (!isHost) qp.set("mode", "view");
		var hk = qp.toString();
		if (hk !== hostStageKey) {
			hostStageKey = hk;
			var bm = document.querySelector('meta[name="fpm-build"]');
			hostStage.src = "./stage.html?" + hk + "&b=" + encodeURIComponent(bm ? bm.content : Date.now());
		}
		try { hostStage.contentWindow.postMessage({ fpmStage: { layout: state.layout === "intro" ? "intro" : "onstage", sharer: state.sharer || "" } }, "*"); } catch (e) {}

		var idx = myIndex();
		var rects = myRects();
		var own = ownStreams();
		var intro = state.layout === "intro";
		if (idx >= 0) {
			setVid("self", rects[idx], own.cam, false);
			var small = intro;
			vids.self.style.zIndex = small ? "30" : "";
			vids.self.style.borderRadius = small ? "10px" : "";
			vids.self.style.boxShadow = small ? "0 0 0 3px #7fd4c1, 0 8px 24px rgba(0,0,0,.6)" : "";
			backBadge.style.display = "none";
		} else if (!isHost) {
			// BACKSTAGE: not on air — own preview bottom-right with the grey chip
			var r = [1920 - 340, 1080 - 282, 320, 180];
			setVid("self", r, own.cam, false);
			vids.self.style.zIndex = "40";
			vids.self.style.borderRadius = "10px";
			vids.self.style.boxShadow = "0 0 0 3px #5a606a, 0 8px 24px rgba(0,0,0,.6)";
			backBadge.style.display = "block";
			backBadge.style.left = r[0] + "px";
			backBadge.style.top = (r[1] - 34) + "px";
		} else {
			vids.self.style.display = "none";
			backBadge.style.display = "none";
		}
		// own share rendered locally (zero delay); others' shares come via the stage page
		if (state.sharer && state.sharer === (isHost ? "FPMHOST" : me) && !intro) {
			var n = 1 + ((state.cast) ? state.cast.length : 0);
			setVid("share", LGEO.shareLayout(n).share, own.shr, true);
		} else {
			vids.share.style.display = "none";
		}
		music(intro ? state.music : "");
	}

	// Intro music for the people in the room (audience gets it from OBS) — unchanged from v1.
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
				if (data && data.fpmStage) { state = data.fpmStage; render(); }
			} catch (e) {}
			return orig.apply(this, arguments);
		};
		return true;
	}
	var t = setInterval(function () { if (hook()) clearInterval(t); }, 500);

	// Announce own screen-share state (host page reflows the stage on this, instantly both ways).
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
	setInterval(render, 2000);

	(function badge() {
		if (!document.body) return setTimeout(badge, 500);
		var m = document.querySelector('meta[name="fpm-build"]');
		var b = el("div", "position:fixed;left:6px;bottom:4px;z-index:99999;font:10px ui-monospace,Menlo,monospace;color:#7d8aa0;opacity:.75;pointer-events:none");
		b.textContent = "build " + (m ? m.content : "?");
		document.body.appendChild(b);
	})();
	window.fpmGuestView = { state: function () { return state; }, render: render, set: function (s) { state = s; render(); } };
})();
