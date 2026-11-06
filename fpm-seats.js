// FULLPORTMATT: stage seat planner (2026-11-05). Pure functions, no DOM: fpm-scenes.js feeds it the roster and
// applies the result; the same file runs under node for a unit test. Parse-safe (no ?. / ??).
//
// Seats are the OBS "Stage" input params g1/g2 (guest stream IDs); n1/n2 are the seated guests' names (room labels).
// Rules:
//   - a joiner whose name matches the name of a seated guest who is NOT here gets that seat back at once (rejoin);
//   - otherwise, with auto-admit, a joiner takes the first free seat; without it, they wait for "Add to stage";
//   - a seat is free when empty or when its guest has been gone longer than STALE_MS.
(function (root) {
	"use strict";
	var STALE_MS = 60000;
	var SEATS = ["g1", "g2"];

	function norm(s) {
		return String(s || "").trim().toLowerCase();
	}

	function copySeats(src) {
		var out = {};
		for (var i = 0; i < SEATS.length; i++) {
			out[SEATS[i]] = src && src[SEATS[i]] ? String(src[SEATS[i]]) : "";
		}
		return out;
	}

	// Seats a NEW guest may take: empty, or the occupant has been gone > STALE_MS (lastSeen missing = never seen).
	function freeSeats(seats, here, lastSeen, now) {
		var out = [];
		here = here || {};
		lastSeen = lastSeen || {};
		for (var i = 0; i < SEATS.length; i++) {
			var cur = seats[SEATS[i]];
			if (!cur || (!here[cur] && now - (lastSeen[cur] || 0) > STALE_MS)) {
				out.push(SEATS[i]);
			}
		}
		return out;
	}

	// Input: { seats:{g1,g2}, names:{g1,g2}, here:{id:name}, firstSeen:{id:ms}, lastSeen:{id:ms}, now:ms, autoAdmit:bool }
	// Output: { seats, names, rejoined:[{id,seat}], admitted:[{id,seat}], waiting:[id], free:[seat] }
	function plan(input) {
		var seats = copySeats(input.seats);
		var names = copySeats(input.names);
		var here = input.here || {};
		var firstSeen = input.firstSeen || {};
		var now = input.now || 0;
		var rejoined = [];
		var admitted = [];
		var i, seat, cur;

		// the name follows the person: a seated guest who is here refreshes their seat's name
		for (i = 0; i < SEATS.length; i++) {
			seat = SEATS[i];
			if (seats[seat] && here[seats[seat]]) {
				names[seat] = here[seats[seat]];
			}
		}

		var waiting = Object.keys(here).filter(function (id) {
			return seats.g1 !== id && seats.g2 !== id;
		});
		waiting.sort(function (a, b) {
			var d = (firstSeen[a] || 0) - (firstSeen[b] || 0);
			return d !== 0 ? d : a < b ? -1 : a > b ? 1 : 0;
		});

		// 1. rejoin by name: same person, new stream ID (new device / cleared storage) -> same seat, no admit
		// click — but only within STALE_MS of the occupant's disappearance (2026-11-05, Matt: someone who
		// LEFT and comes back later must be asked again; only short blips/device switches are seamless)
		var lastSeen = input.lastSeen || {};
		var still = [];
		for (var w = 0; w < waiting.length; w++) {
			var id = waiting[w];
			var took = "";
			if (norm(here[id])) {
				for (i = 0; i < SEATS.length && !took; i++) {
					seat = SEATS[i];
					cur = seats[seat];
					if (!cur || here[cur]) {
						continue; // empty, or its guest is present
					}
					if (now - (lastSeen[cur] || 0) > STALE_MS) {
						continue; // occupant long gone: successor must be admitted, not auto-seated
					}
					if (norm(names[seat]) === norm(here[id])) {
						took = seat;
					}
				}
			}
			if (took) {
				seats[took] = id;
				names[took] = here[id];
				rejoined.push({ id: id, seat: took });
			} else {
				still.push(id);
			}
		}
		waiting = still;

		// 2. auto-admit (optional): first free seat, in join order
		if (input.autoAdmit) {
			still = [];
			for (w = 0; w < waiting.length; w++) {
				var free = freeSeats(seats, here, input.lastSeen, now);
				if (free.length) {
					seats[free[0]] = waiting[w];
					names[free[0]] = here[waiting[w]];
					admitted.push({ id: waiting[w], seat: free[0] });
				} else {
					still.push(waiting[w]);
				}
			}
			waiting = still;
		}

		return { seats: seats, names: names, rejoined: rejoined, admitted: admitted, waiting: waiting, free: freeSeats(seats, here, input.lastSeen, now) };
	}

	// "Add to stage": first free seat for this guest, or "" when both seats are taken.
	function admit(input, id) {
		var free = freeSeats(copySeats(input.seats), input.here, input.lastSeen, input.now || 0);
		return free.length ? free[0] : "";
	}

	// "swap positions": g1 <-> g2, names travel with their guests.
	function swap(seats, names) {
		var s = copySeats(seats), n = copySeats(names);
		return { seats: { g1: s.g2, g2: s.g1 }, names: { g1: n.g2, g2: n.g1 } };
	}

	var api = { plan: plan, admit: admit, swap: swap, freeSeats: freeSeats, STALE_MS: STALE_MS };
	if (typeof module !== "undefined" && module.exports) {
		module.exports = api;
	}
	root.fpmSeats = api;
})(typeof window !== "undefined" ? window : this);
