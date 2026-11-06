// FULLPORTMATT: single source of truth for stage geometry (2026-11-05, SPEC.md invariant I2).
// Consumed by stage.html, fpm-guestview.js, fpm-scenes.js and stage/retro-share.html. Pure data +
// pure functions, parse-safe (no ?. / ??), runs in browsers and under node for tests.
// EDIT GEOMETRY HERE AND NOWHERE ELSE.
(function (root) {
	"use strict";

	// Panel rects per layout, 1920x1080 canvas: [x, y, w, h]
	var PANELS = {
		solo: { host: [0, 0, 1920, 1080] },
		sbs: { host: [0, 165, 950, 810], g1: [970, 165, 950, 810] },
		trio: { host: [0, 165, 630, 810], g1: [645, 165, 630, 810], g2: [1290, 165, 630, 810] },
		share: { share: [0, 165, 1380, 810] }, // the right-hand tile column comes from shareSlots(n)
		intro: { host: [340, 775, 400, 225], g1: [760, 775, 400, 225], g2: [1180, 775, 400, 225] },
		solo_pip: { host: [0, 0, 1920, 1080], g1: [1530, 200, 360, 203], g2: [1530, 418, 360, 203] }
	};

	var OVERLAYS = {
		solo: "stage/retro-solo.html",
		sbs: "stage/retro-sbs.html",
		trio: "stage/retro-trio.html",
		share: "stage/retro-share.html",
		intro: "stage/intro.html",
		solo_pip: "stage/retro-solo.html"
	};

	// Share layout: the right column splits among whoever is present (host + 0..2 guests).
	// n=3 reproduces the original fixed grid exactly (y 165/439/713, h 262).
	var SHARE_COL = { x: 1395, top: 165, w: 525, total: 810, gap: 12 };
	function shareSlots(n) {
		n = Math.max(1, Math.min(3, n));
		var h = Math.round((SHARE_COL.total - SHARE_COL.gap * (n - 1)) / n);
		var out = [];
		for (var i = 0; i < n; i++) out.push([SHARE_COL.x, SHARE_COL.top + i * (h + SHARE_COL.gap), SHARE_COL.w, h]);
		return out;
	}

	// The native OBS camera item in "Stage - Share" (4K canvas = 2x these page units). The host
	// page applies this via obs-websocket so the camera matches slot 1 of the current split.
	function camBounds(presentGuests) {
		var r = shareSlots(1 + Math.max(0, Math.min(2, presentGuests)))[0];
		return { x: r[0] * 2, y: r[1] * 2, w: r[2] * 2, h: r[3] * 2 };
	}

	// Name tags hug their tile's bottom edge with this inset (page units), fixed size at any tile size.
	var TAG_INSET = 57;

	// ===== ONSTAGE MODEL (Matt, 2026-11-05 evening; SPEC v2) =====
	// Two scenes only: Starting Soon + Onstage. people = Matt + onstage guests (1..9, max 8 guests), Matt first.
	// No share: 1 row up to 3 people, else 2 rows (even: split evenly; odd: ceil on top — 5 -> 3+2).
	// Share, up to 3 people: screen left + the proven right-hand column. More than 3: EVERYONE in ONE ROW
	// ABOVE the screenshare (Matt's rule 2026-11-05), share takes the full width below. Minimum rows always.
	var STAGE_BAND = { top: 165, h: 810, w: 1920, gap: 15 };
	function rowSplit(n) { if (n <= 3) return [n]; var a = Math.ceil(n / 2); return [a, n - a]; }
	function gridLayout(n) {
		n = Math.max(1, Math.min(9, n));
		var rows = rowSplit(n);
		var rh = (STAGE_BAND.h - STAGE_BAND.gap * (rows.length - 1)) / rows.length;
		var cols = Math.max.apply(null, rows);
		var tw = (STAGE_BAND.w - STAGE_BAND.gap * (cols - 1)) / cols;
		var out = [], y = STAGE_BAND.top;
		for (var r = 0; r < rows.length; r++) {
			var cnt = rows[r];
			var x = (STAGE_BAND.w - (cnt * tw + (cnt - 1) * STAGE_BAND.gap)) / 2; // shorter row centered
			for (var i = 0; i < cnt; i++) { out.push([Math.round(x), Math.round(y), Math.round(tw), Math.round(rh)]); x += tw + STAGE_BAND.gap; }
			y += rh + STAGE_BAND.gap;
		}
		return out;
	}
	// share mode: { share:[x,y,w,h], tiles:[[x,y,w,h],...] } — tiles in people order (Matt first).
	// n<=3: screen left + right column (12px gaps: reproduces the proven legacy column pixel-for-pixel).
	// n>=4: one row of everyone across the top (16:9-ish tiles), share full-width below.
	function shareLayout(n) {
		n = Math.max(1, Math.min(9, n));
		if (n <= 3) {
			var col = [], hC = (STAGE_BAND.h - 12 * (n - 1)) / n, yC = STAGE_BAND.top;
			for (var i = 0; i < n; i++) { col.push([1395, Math.round(yC), 525, Math.round(hC)]); yC += hC + 12; }
			return { share: [0, STAGE_BAND.top, 1380, STAGE_BAND.h], tiles: col };
		}
		var tw = (STAGE_BAND.w - STAGE_BAND.gap * (n - 1)) / n;
		var th = Math.round(tw * 9 / 16);
		var tiles = [], x = 0;
		for (var j = 0; j < n; j++) { tiles.push([Math.round(x), STAGE_BAND.top, Math.round(tw), th]); x += tw + STAGE_BAND.gap; }
		return { share: [0, STAGE_BAND.top + th + STAGE_BAND.gap, STAGE_BAND.w, STAGE_BAND.h - th - STAGE_BAND.gap], tiles: tiles };
	}
	// intro strip: everyone in one small bottom row, centered (Starting Soon tile strip)
	function introStrip(n) {
		n = Math.max(1, Math.min(9, n));
		var tw = Math.min(400, Math.round((1920 - 15 * (n - 1)) / n));
		var th = Math.round(tw * 9 / 16);
		var x0 = Math.round((1920 - (n * tw + (n - 1) * 15)) / 2);
		var out = [];
		for (var i = 0; i < n; i++) out.push([x0 + i * (tw + 15), 1080 - th - 80, tw, th]);
		return out;
	}
	var api = { PANELS: PANELS, OVERLAYS: OVERLAYS, SHARE_COL: SHARE_COL, shareSlots: shareSlots, camBounds: camBounds, TAG_INSET: TAG_INSET, STAGE_BAND: STAGE_BAND, gridLayout: gridLayout, shareLayout: shareLayout, rowSplit: rowSplit, introStrip: introStrip };
	if (typeof module !== "undefined" && module.exports) module.exports = api;
	root.fpmLayouts = api;
})(typeof window !== "undefined" ? window : this);
