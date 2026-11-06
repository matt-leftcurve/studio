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
	// Two scenes only: Starting Soon + Onstage. people = Matt + onstage guests (1..10), Matt first.
	// No share: 1 row up to 3 people, else 2 rows (even: split evenly; odd: ceil on top — 5 -> 3+2).
	// Share: screen + right-hand tile column(s): 1 column up to 4 people, else 2 columns
	// (odd: ceil on the left — 5 -> 3 left + 2 right). Always the minimum rows/columns.
	var STAGE_BAND = { top: 165, h: 810, w: 1920, gap: 15 };
	function rowSplit(n) { if (n <= 3) return [n]; var a = Math.ceil(n / 2); return [a, n - a]; }
	function gridLayout(n) {
		n = Math.max(1, Math.min(10, n));
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
	function colSplit(n) { if (n <= 4) return [n]; var a = Math.ceil(n / 2); return [a, n - a]; }
	// share mode: returns { share:[x,y,w,h], tiles:[[x,y,w,h],...] } — tiles in people order, column-major
	// (fills the left column top-to-bottom, then the right). Column gap matches the legacy 12px grid so
	// shareTiles(1..3) reproduces the proven column exactly.
	function shareLayout(n) {
		n = Math.max(1, Math.min(10, n));
		var cols = colSplit(n);
		var tileW = cols.length === 1 ? 525 : 400;
		var sideW = cols.length * tileW + (cols.length - 1) * STAGE_BAND.gap;
		var shareW = STAGE_BAND.w - sideW - STAGE_BAND.gap;
		var tiles = [], x = STAGE_BAND.w - sideW;
		for (var c = 0; c < cols.length; c++) {
			var cnt = cols[c];
			var th = (STAGE_BAND.h - 12 * (cnt - 1)) / cnt;
			var y = STAGE_BAND.top;
			for (var i = 0; i < cnt; i++) { tiles.push([Math.round(x), Math.round(y), tileW, Math.round(th)]); y += th + 12; }
			x += tileW + STAGE_BAND.gap;
		}
		return { share: [0, STAGE_BAND.top, Math.round(shareW), STAGE_BAND.h], tiles: tiles };
	}
	var api = { PANELS: PANELS, OVERLAYS: OVERLAYS, SHARE_COL: SHARE_COL, shareSlots: shareSlots, camBounds: camBounds, TAG_INSET: TAG_INSET, STAGE_BAND: STAGE_BAND, gridLayout: gridLayout, shareLayout: shareLayout, rowSplit: rowSplit, colSplit: colSplit };
	if (typeof module !== "undefined" && module.exports) module.exports = api;
	root.fpmLayouts = api;
})(typeof window !== "undefined" ? window : this);
