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

	// ===== Lacquer frame fit (Matt, 2026-11-27; SPEC §9.4) =====
	// OBS draws the animated LSM frame (scene item above Stage). Its opening, measured over the whole
	// 120 s loop in page units: x 37..1882, y 82-87..1042, corner radius ~25. Every Onstage layout
	// lives in SAFE = that opening (worst case top 87) inset by FRAME_PAD on all sides; at 16 the tile
	// corners also clear the rounded corners. With the frame off the same geometry just shows the
	// canvas around it. 4K canvas = 2x (x106 y206 w3628 h1848).
	var FRAME_OPENING = { x: 37, y: 87, w: 1846, h: 956, r: 25 };
	var FRAME_PAD = 16;
	var SAFE = {
		x: FRAME_OPENING.x + FRAME_PAD, y: FRAME_OPENING.y + FRAME_PAD,
		w: FRAME_OPENING.w - 2 * FRAME_PAD, h: FRAME_OPENING.h - 2 * FRAME_PAD
	}; // = { x: 53, y: 103, w: 1814, h: 924 }

	// Share layout: the right column splits among whoever is present (host + 0..2 guests), flush
	// with the SAFE right edge.
	var SHARE_COL = { x: SAFE.x + SAFE.w - 525, top: SAFE.y, w: 525, total: SAFE.h, gap: 12 }; // x 1342
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
	// 2026-11-27: the band art is gone; the stage is the frame-safe rect (was top 85 h 930 w 1920 x 0).
	var STAGE_BAND = { left: SAFE.x, top: SAFE.y, h: SAFE.h, w: SAFE.w, gap: 15 };
	function rowSplit(n) { if (n <= 3) return [n]; var a = Math.ceil(n / 2); return [a, n - a]; }
	function gridLayout(n) {
		n = Math.max(1, Math.min(9, n));
		// Solo = the whole frame-safe rect (2026-11-27: was the full canvas under the old bands; the
		// lacquer frame would cover its edges, so solo fits inside the opening like everything else).
		if (n === 1) return [[STAGE_BAND.left, STAGE_BAND.top, STAGE_BAND.w, STAGE_BAND.h]];
		var rows = rowSplit(n);
		var rh = (STAGE_BAND.h - STAGE_BAND.gap * (rows.length - 1)) / rows.length;
		var cols = Math.max.apply(null, rows);
		var tw = (STAGE_BAND.w - STAGE_BAND.gap * (cols - 1)) / cols;
		var out = [], y = STAGE_BAND.top;
		for (var r = 0; r < rows.length; r++) {
			var cnt = rows[r];
			var x = STAGE_BAND.left + (STAGE_BAND.w - (cnt * tw + (cnt - 1) * STAGE_BAND.gap)) / 2; // shorter row centered
			// round EDGES, not x and w separately (else the last tile pokes 1px past the SAFE edge)
			for (var i = 0; i < cnt; i++) { out.push([Math.round(x), Math.round(y), Math.round(x + tw) - Math.round(x), Math.round(y + rh) - Math.round(y)]); x += tw + STAGE_BAND.gap; }
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
			// ONE code path for the column (shareSlots) — a duplicate loop here rounded 1px differently
			return { share: [STAGE_BAND.left, STAGE_BAND.top, SHARE_COL.x - 15 - STAGE_BAND.left, STAGE_BAND.h], tiles: shareSlots(n) };
		}
		var tw = (STAGE_BAND.w - STAGE_BAND.gap * (n - 1)) / n;
		var th = Math.round(tw * 9 / 16);
		var tiles = [], x = STAGE_BAND.left;
		for (var j = 0; j < n; j++) { tiles.push([Math.round(x), STAGE_BAND.top, Math.round(x + tw) - Math.round(x), th]); x += tw + STAGE_BAND.gap; }
		return { share: [STAGE_BAND.left, STAGE_BAND.top + th + STAGE_BAND.gap, STAGE_BAND.w, STAGE_BAND.h - th - STAGE_BAND.gap], tiles: tiles };
	}
	// ===== Live graphics (2026-11-27, off-air prototype; SPEC §9.3) =====
	// A graphic panel on the LEFT of the stage band (same idea as the portrait iPhone share); Matt
	// (tiles[0]) + onstage guests pack into the remaining width as 16:9 tiles, 1-3 rows, whichever
	// gives the biggest tiles. n=1: Matt fills everything right of the panel.
	var GFX_PANEL_W = 744; // card design box is 744x930 (4:5); in the frame-safe band it is 744x924 (SVG meets)
	function inscribe169(cw, ch) {
		// whole pixels, never larger than the cell (cells can be fractional)
		cw = Math.floor(cw); ch = Math.floor(ch);
		if (cw * 9 >= ch * 16) return { w: Math.floor(ch * 16 / 9), h: ch };
		return { w: cw, h: Math.floor(cw * 9 / 16) };
	}
	function panelLayout(n, panelW) {
		n = Math.max(1, Math.min(9, n));
		var B = STAGE_BAND, panel = [B.left, B.top, panelW, B.h];
		var x0 = B.left + panelW + B.gap, W = B.left + B.w - x0, H = B.h, gap = B.gap;
		if (n === 1) return { panel: panel, tiles: [[x0, B.top, W, H]] };
		var best = null;
		for (var rows = 1; rows <= Math.min(n, 3); rows++) {
			var split = [], base = Math.floor(n / rows), extra = n % rows;
			for (var r = 0; r < rows; r++) split.push(base + (r < extra ? 1 : 0));
			var cols = Math.max.apply(null, split);
			var cw = (W - gap * (cols - 1)) / cols, ch = (H - gap * (rows - 1)) / rows;
			var ins = inscribe169(cw, ch), area = ins.w * ins.h;
			if (!best || area > best.area) best = { split: split, cw: cw, ch: ch, area: area };
		}
		var tiles = [], tot = best.split.length * best.ch + (best.split.length - 1) * gap;
		var y = B.top + (H - tot) / 2;
		for (var r2 = 0; r2 < best.split.length; r2++) {
			var cnt = best.split[r2], x = x0 + (W - (cnt * best.cw + (cnt - 1) * gap)) / 2;
			for (var i = 0; i < cnt; i++) {
				var i2 = inscribe169(best.cw, best.ch);
				tiles.push([Math.round(x + (best.cw - i2.w) / 2), Math.round(y + (best.ch - i2.h) / 2), i2.w, i2.h]);
				x += best.cw + gap;
			}
			y += best.ch + gap;
		}
		return { panel: panel, tiles: tiles };
	}
	function graphicLayout(n) { return panelLayout(n, GFX_PANEL_W); }
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
	var api = { PANELS: PANELS, OVERLAYS: OVERLAYS, SHARE_COL: SHARE_COL, shareSlots: shareSlots, camBounds: camBounds, TAG_INSET: TAG_INSET, STAGE_BAND: STAGE_BAND, FRAME_OPENING: FRAME_OPENING, FRAME_PAD: FRAME_PAD, SAFE: SAFE, gridLayout: gridLayout, shareLayout: shareLayout, rowSplit: rowSplit, introStrip: introStrip, GFX_PANEL_W: GFX_PANEL_W, panelLayout: panelLayout, graphicLayout: graphicLayout };
	if (typeof module !== "undefined" && module.exports) module.exports = api;
	root.fpmLayouts = api;
})(typeof window !== "undefined" ? window : this);
