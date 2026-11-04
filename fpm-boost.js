// FULLPORTMATT: headphone boost for the HOST page (&boost=N, e.g. 3 = +9.5 dB). Matt hears guests through this page
// (Mac output = RODECaster Chat channel, whose fader tops out and has no Mac-side volume). Each guest's room audio is
// routed through Web Audio: gain N -> limiter -> speakers, and the stock element is silenced. Only Matt's ears
// change: the Duo mix-minus keeps this off the stream and away from guests. Parse-safe (no ?. / ??).
(function () {
	"use strict";
	var params = new URLSearchParams(window.location.search);
	var N = parseFloat(params.get("boost") || "0");
	if (!(N > 0) || !params.has("push")) return;
	var ctx = null, master = null, done = {}, btn = null;
	function setup() {
		if (ctx) return;
		ctx = new (window.AudioContext || window.webkitAudioContext)();
		master = ctx.createGain();
		master.gain.value = N;
		var lim = ctx.createDynamicsCompressor();
		lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.003; lim.release.value = 0.15;
		master.connect(lim); lim.connect(ctx.destination);
	}
	function tick() {
		if (!window.session || !session.rpcs) return;
		setup();
		if (ctx.state !== "running") {
			ctx.resume();
			if (!btn && document.body) {
				btn = document.createElement("button");
				btn.textContent = "🔊 click to enable guest audio boost";
				btn.style.cssText = "position:fixed;left:50%;top:150px;transform:translateX(-50%);z-index:100000;border:0;border-radius:8px;padding:10px 16px;background:#e5484d;color:#fff;font:700 14px system-ui;cursor:pointer";
				btn.onclick = function () { ctx.resume(); btn.remove(); btn = null; };
				document.body.appendChild(btn);
			}
		} else if (btn) { btn.remove(); btn = null; }
		for (var U in session.rpcs) {
			var r = session.rpcs[U];
			if (!r || !r.streamSrc || !r.streamSrc.getAudioTracks) continue;
			var at = r.streamSrc.getAudioTracks()[0];
			if (!at) continue;
			if (r.videoElement) r.videoElement.volume = 0; // silence the stock path (we play the boosted copy)
			if (done[at.id]) continue;
			try {
				var src = ctx.createMediaStreamSource(new MediaStream([at]));
				src.connect(master);
				done[at.id] = src;
			} catch (e) {}
		}
	}
	setInterval(tick, 1000);
	window.fpmBoost = { set: function (n) { N = n; if (master) master.gain.value = n; }, state: function () { return { gain: N, ctx: ctx && ctx.state, tracks: Object.keys(done).length }; } };
})();
