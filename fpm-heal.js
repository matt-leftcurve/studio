// FULLPORTMATT: reconnect watchdog for room pages that VIEW guests without a fixed &view list
// (director pages, and the studio host/program pushes FPM*).
// Stock behaviour: when an incoming connection fails, the page closes it after 5 s and never asks again;
// only pages with an explicit &view list retry (session.retryWatchInterval). The guest is still in the
// room and still publishing, so it simply vanishes from this page until a reload.
// This remembers every stream ID it has received and, if one disappears, re-requests it with
// session.requestStream() (the app's own "watch this stream" call) on a backoff until it is back.
// Disable with &noheal. Parse-safe (no ?. / ??).
(function () {
	"use strict";
	var params = new URLSearchParams(window.location.search);
	if (params.has("noheal")) {
		return;
	}
	// --- Publisher-side half (every publishing page, guests included) ---
	// Stock offerSDP() ignores a viewer's new "play" request if our PC to that viewer still reads "connected"
	// ("the other end is just being a keener"). When the VIEWER's end has died, that leaves it unable to ever
	// reconnect without a reload. A repeat request for a peer that has been up > 10 s means the viewer lost us:
	// close our stale end and offer fresh. Genuine double-requests arrive within seconds and are still ignored.
	(function patchOffer() {
		if (!window.session || typeof session.offerSDP !== "function") {
			return setTimeout(patchOffer, 500);
		}
		if (session.__fpmOfferPatched) return;
		session.__fpmOfferPatched = true;
		var orig = session.offerSDP;
		session.offerSDP = async function (UUID) {
			try {
				var pc = session.pcs && session.pcs[UUID];
				if (pc && pc.connectionState === "connected" && pc.__fpmBorn && Date.now() - pc.__fpmBorn > 10000) {
					try { console.warn("[fpm-heal] stale peer re-requested; resetting", UUID); } catch (e) {}
					session.closePC(UUID);
				}
			} catch (e) {}
			var r = await orig.apply(this, arguments);
			try {
				if (session.pcs && session.pcs[UUID] && !session.pcs[UUID].__fpmBorn) {
					session.pcs[UUID].__fpmBorn = Date.now();
				}
			} catch (e) {}
			return r;
		};
	})();

	var isDirector = params.has("director") || params.has("dir");
	var push = params.get("push") || params.get("id") || "";
	var isStudioPush = /^FPM/.test(push);
	if (!isDirector && !isStudioPush) {
		return;
	}

	var known = {}; // streamID -> { lastSeen, lostAt, nextTry, tries }
	var LOG_MAX = 50;
	var log = [];

	function note(msg) {
		log.push(new Date().toISOString().slice(11, 19) + " " + msg);
		if (log.length > LOG_MAX) {
			log.shift();
		}
	}

	function delayFor(tries) {
		// 3 s, then 5 s, then every 10 s for ~10 min, then every 30 s
		if (tries < 1) {
			return 3000;
		}
		if (tries < 2) {
			return 5000;
		}
		if (tries < 60) {
			return 10000;
		}
		return 30000;
	}

	function tick() {
		if (!window.session || !session.rpcs || typeof session.requestStream !== "function") {
			return;
		}
		var now = Date.now();
		var present = {};
		Object.keys(session.rpcs).forEach(function (UUID) {
			var r = session.rpcs[UUID];
			if (r && r.streamID) {
				present[r.streamID] = true;
			}
		});
		Object.keys(present).forEach(function (sid) {
			if (sid === session.streamID) {
				return;
			}
			// Screen shares ("<id>:s") start and stop on purpose; never resurrect them.
			if (sid.slice(-2) === ":s") {
				return;
			}
			if (known[sid] && known[sid].lostAt) {
				note("recovered " + sid + " after " + Math.round((now - known[sid].lostAt) / 1000) + "s");
			}
			known[sid] = { lastSeen: now, lostAt: 0, nextTry: 0, tries: 0 };
		});
		Object.keys(known).forEach(function (sid) {
			if (present[sid]) {
				return;
			}
			var k = known[sid];
			if (!k.lostAt) {
				k.lostAt = now;
				k.nextTry = now + delayFor(0);
				note("lost " + sid);
				return;
			}
			if (now >= k.nextTry) {
				// A previous re-request that got no answer leaves waitingWatchList[sid] set forever; clear it so the
				// retry really goes out again.
				if (session.waitingWatchList && session.waitingWatchList[sid]) {
					delete session.waitingWatchList[sid];
				}
				{
					try {
						session.requestStream(sid);
						note("re-request " + sid + " (#" + (k.tries + 1) + ")");
					} catch (e) {
						note("re-request failed " + sid + ": " + (e && e.message ? e.message : e));
					}
				}
				k.tries += 1;
				k.nextTry = now + delayFor(k.tries);
			}
		});
	}

	// Small visible badge (bottom-right) so the operator can see the watchdog is alive and what it did.
	var badge = document.createElement("div");
	badge.style.cssText = "position:fixed;right:8px;bottom:8px;z-index:99998;max-width:46vw;padding:4px 8px;border-radius:6px;" +
		"font:11px/1.3 ui-monospace,Menlo,monospace;color:#cfe;background:rgba(10,20,30,.8);pointer-events:none;white-space:pre";
	function paint() {
		if (!document.body) return;
		if (!badge.isConnected) document.body.appendChild(badge);
		var ids = Object.keys(known);
		var lost = ids.filter(function (k) { return known[k].lostAt; });
		var bm = document.querySelector('meta[name="fpm-build"]');
		badge.textContent = "build " + (bm ? bm.content : "?") + " · heal v4 · watching " + ids.length + (lost.length ? " · LOST " + lost.join(",") : "") + (log.length ? "\n" + log.slice(-2).join("\n") : "");
	}
	setInterval(function () { tick(); paint(); }, 1000);
	window.fpmHeal = {
		state: function () {
			return { known: known, log: log.slice() };
		}
	};
})();
