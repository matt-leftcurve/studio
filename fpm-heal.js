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
				var waiting = session.waitingWatchList && session.waitingWatchList[sid];
				if (!waiting) {
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

	setInterval(tick, 1000);
	window.fpmHeal = {
		state: function () {
			return { known: known, log: log.slice() };
		}
	};
})();
