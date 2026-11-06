// FULLPORTMATT: onstage/backstage planner (v2, 2026-11-05 — SPEC v2 Onstage model; v1 two-seat
// planner replaced the same day). Pure functions, no DOM: fpm-scenes.js feeds the roster and applies
// the result; runs under node for tests (tests/fpm-seats.test.mjs). Parse-safe (no ?. / ??).
//
// Model: ONE ordered onstage list of [id, name] (Matt is implicit, always first on stage, never in
// this list; max MAX_GUESTS entries). Everyone else connected is backstage. Rules:
//   - an onstage member's name refreshes from the roster while they are present;
//   - an onstage member gone longer than STALE_MS is REMOVED (short blips keep their tile);
//   - a newcomer whose name matches an onstage member gone <= STALE_MS replaces them IN PLACE
//     (device switch / reload keeps the spot, no click);
//   - with autoAdmit, backstage guests are appended in join order while slots remain;
//   - otherwise backstage guests wait for an explicit admit() ("Bring Onstage").
(function (root) {
	"use strict";
	var STALE_MS = 60000;
	var MAX_GUESTS = 8; // + Matt = 9 people

	function norm(s) {
		return String(s || "").trim().toLowerCase();
	}

	function copyCast(cast) {
		var out = [];
		for (var i = 0; i < (cast || []).length; i++) out.push([String(cast[i][0]), String(cast[i][1] || "")]);
		return out;
	}

	// Input: { onstage:[[id,name],...], here:{id:name}, firstSeen:{id:ms}, lastSeen:{id:ms}, now:ms, autoAdmit:bool }
	// Output: { onstage, backstage:[id], removed:[[id,name]], rejoined:[{oldId,newId,name}], admitted:[id] }
	function plan(input) {
		var cast = copyCast(input.onstage);
		var here = input.here || {};
		var firstSeen = input.firstSeen || {};
		var lastSeen = input.lastSeen || {};
		var now = input.now || 0;
		var removed = [], rejoined = [], admitted = [];
		var i;

		// 1. refresh names for present members; drop members gone > STALE_MS
		var kept = [];
		for (i = 0; i < cast.length; i++) {
			var id = cast[i][0];
			if (here[id]) {
				kept.push([id, here[id]]);
			} else if (now - (lastSeen[id] || 0) <= STALE_MS) {
				kept.push(cast[i]); // short blip: hold the tile
			} else {
				removed.push(cast[i]);
			}
		}
		cast = kept;

		var onIds = {};
		for (i = 0; i < cast.length; i++) onIds[cast[i][0]] = true;
		var waiting = Object.keys(here).filter(function (id) { return !onIds[id]; });
		waiting.sort(function (a, b) {
			var d = (firstSeen[a] || 0) - (firstSeen[b] || 0);
			return d !== 0 ? d : a < b ? -1 : a > b ? 1 : 0;
		});

		// 2. device-switch: newcomer's name matches an onstage member who is absent (gone <= STALE_MS)
		var still = [];
		for (var w = 0; w < waiting.length; w++) {
			var nid = waiting[w], took = -1;
			if (norm(here[nid])) {
				for (i = 0; i < cast.length && took < 0; i++) {
					if (!here[cast[i][0]] && norm(cast[i][1]) === norm(here[nid])) took = i;
				}
			}
			if (took >= 0) {
				rejoined.push({ oldId: cast[took][0], newId: nid, name: here[nid] });
				cast[took] = [nid, here[nid]];
				onIds[nid] = true;
			} else {
				still.push(nid);
			}
		}
		waiting = still;

		// 3. auto-admit (optional): append in join order while guest slots remain
		if (input.autoAdmit) {
			still = [];
			for (w = 0; w < waiting.length; w++) {
				if (cast.length < MAX_GUESTS) {
					cast.push([waiting[w], here[waiting[w]]]);
					admitted.push(waiting[w]);
				} else {
					still.push(waiting[w]);
				}
			}
			waiting = still;
		}

		return { onstage: cast, backstage: waiting, removed: removed, rejoined: rejoined, admitted: admitted };
	}

	// "Bring Onstage": append if room; returns the new cast (unchanged when full or already on).
	function admit(cast, id, name) {
		var out = copyCast(cast);
		for (var i = 0; i < out.length; i++) if (out[i][0] === id) return out;
		if (out.length >= MAX_GUESTS) return out;
		out.push([String(id), String(name || "")]);
		return out;
	}

	// "Send Backstage": remove by id.
	function demote(cast, id) {
		return copyCast(cast).filter(function (m) { return m[0] !== id; });
	}

	var api = { plan: plan, admit: admit, demote: demote, STALE_MS: STALE_MS, MAX_GUESTS: MAX_GUESTS };
	if (typeof module !== "undefined" && module.exports) module.exports = api;
	root.fpmSeats = api;
})(typeof window !== "undefined" ? window : this);
