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
	// OBS draws the animated LSM frame above Stage. Opening over the 120 s loop, page units:
	// x 37..1882, y 82-87..1042, corner radius ~25 (worst-case top 87). Tiles are laid out in
	// that opening, then OUTER edges grow FRAME_BLEED (20) under the border so no black shows
	// in the opening or at the rounded corners. Inner gutters stay put. Solo = the full canvas
	// (4K 0,0,3840x2160) and bleeds under the whole frame. Name tags use tagPos() so they stay
	// visible in the opening even when their tile extends under the border.
	var FRAME_OPENING = { x: 37, y: 87, w: 1846, h: 956, r: 25 };
	var FRAME_BLEED = 20;
	var OUTER = {
		x: FRAME_OPENING.x - FRAME_BLEED, y: FRAME_OPENING.y - FRAME_BLEED,
		w: FRAME_OPENING.w + 2 * FRAME_BLEED, h: FRAME_OPENING.h + 2 * FRAME_BLEED
	}; // = { x: 17, y: 67, w: 1886, h: 996 }
	// kept as an alias for the visible hole (was the 16px inset; that inset is what left the black gap)
	var SAFE = { x: FRAME_OPENING.x, y: FRAME_OPENING.y, w: FRAME_OPENING.w, h: FRAME_OPENING.h };
	var FRAME_PAD = 0;

	function overlapsY(a, b) { return a[1] < b[1] + b[3] && b[1] < a[1] + a[3]; }
	function overlapsX(a, b) { return a[0] < b[0] + b[2] && b[0] < a[0] + a[2]; }
	// Grow any edge that has a clear path to the opening boundary out to OUTER. Sibling
	// gutters stay put. (16:9 letterbox next to the graphic panel is intentional packing.)
	function bleedOuter(rects) {
		var ox1 = OUTER.x, oy1 = OUTER.y, ox2 = ox1 + OUTER.w, oy2 = oy1 + OUTER.h;
		var out = [];
		for (var i = 0; i < rects.length; i++) {
			var r = rects[i], x = r[0], y = r[1], w = r[2], h = r[3];
			var blockL = false, blockR = false, blockT = false, blockB = false;
			for (var j = 0; j < rects.length; j++) {
				if (j === i) continue;
				var o = rects[j];
				if (overlapsY(r, o)) {
					if (o[0] + o[2] <= x + 1) blockL = true;
					if (o[0] >= x + w - 1) blockR = true;
				}
				if (overlapsX(r, o)) {
					if (o[1] + o[3] <= y + 1) blockT = true;
					if (o[1] >= y + h - 1) blockB = true;
				}
			}
			if (!blockL) { w += x - ox1; x = ox1; }
			if (!blockR) w = ox2 - x;
			if (!blockT) { h += y - oy1; y = oy1; }
			if (!blockB) h = oy2 - y;
			out.push([Math.round(x), Math.round(y), Math.round(w), Math.round(h)]);
		}
		return out;
	}

	// Share layout: the right column splits among whoever is present (host + 0..2 guests), flush
	// with the opening's right edge (then bled on the outer sides).
	var SHARE_COL = { x: FRAME_OPENING.x + FRAME_OPENING.w - 525, top: FRAME_OPENING.y, w: 525, total: FRAME_OPENING.h, gap: 12 }; // x 1358
	function shareColumn(n) {
		n = Math.max(1, Math.min(3, n));
		var h = Math.round((SHARE_COL.total - SHARE_COL.gap * (n - 1)) / n);
		var out = [];
		for (var i = 0; i < n; i++) out.push([SHARE_COL.x, SHARE_COL.top + i * (h + SHARE_COL.gap), SHARE_COL.w, h]);
		return out;
	}
	function shareSlots(n) { return shareLayout(Math.max(1, Math.min(3, n))).tiles; }

	// The native OBS camera item (4K canvas = 2x these page units). The host page applies this
	// via obs-websocket so the camera matches slot 0 of the current layout (share column when sharing).
	function camBounds(presentGuests) {
		var r = shareSlots(1 + Math.max(0, Math.min(2, presentGuests)))[0];
		return { x: r[0] * 2, y: r[1] * 2, w: r[2] * 2, h: r[3] * 2 };
	}

	// Name tags sit at the bottom-left of their tile, but are clamped into the visible opening
	// so a tile that bleeds under the frame doesn't hide its tag. TAG_INSET kept for callers.
	var TAG_PAD = 14;
	var TAG_H = 44;
	var TAG_INSET = 57;
	function tagPos(rect) {
		var minX = Math.max(rect[0] + TAG_PAD, FRAME_OPENING.x + TAG_PAD);
		var maxX = Math.min(rect[0] + rect[2] - TAG_PAD, FRAME_OPENING.x + FRAME_OPENING.w - TAG_PAD);
		var minY = Math.max(rect[1] + TAG_PAD, FRAME_OPENING.y + TAG_PAD);
		var maxY = Math.min(rect[1] + rect[3] - TAG_H, FRAME_OPENING.y + FRAME_OPENING.h - TAG_H - TAG_PAD);
		var x = rect[0] + TAG_PAD, y = rect[1] + rect[3] - TAG_H;
		if (minX <= maxX) x = Math.max(minX, Math.min(x, maxX));
		else x = rect[0] + TAG_PAD;
		if (minY <= maxY) y = Math.max(minY, Math.min(y, maxY));
		else y = rect[1] + Math.max(0, rect[3] - TAG_H);
		return [Math.round(x), Math.round(y)];
	}

	// ===== ONSTAGE MODEL (Matt, 2026-11-05 evening; SPEC v2) =====
	// Two scenes only: Starting Soon + Onstage. people = Matt + onstage guests (1..9, max 8 guests), Matt first.
	// No share: 1 row up to 3 people, else 2 rows (even: split evenly; odd: ceil on top — 5 -> 3+2).
	// Share, up to 3 people: screen left + the proven right-hand column. More than 3: EVERYONE in ONE ROW
	// ABOVE the screenshare (Matt's rule 2026-11-05), share takes the full width below. Minimum rows always.
	// 2026-11-27: band art is gone. Layout is computed in the frame opening, then bleedOuter grows
	// the outer edges under the border (solo = full canvas).
	var STAGE_BAND = { left: FRAME_OPENING.x, top: FRAME_OPENING.y, h: FRAME_OPENING.h, w: FRAME_OPENING.w, gap: 15 };
	function rowSplit(n) { if (n <= 3) return [n]; var a = Math.ceil(n / 2); return [a, n - a]; }
	function gridLayout(n) {
		n = Math.max(1, Math.min(9, n));
		// Solo = the FULL CANVAS so the native camera bleeds under the entire frame (Matt, 2026-11-27
		// evening: no black gap between the camera and the frame).
		if (n === 1) return [[0, 0, 1920, 1080]];
		var rows = rowSplit(n);
		var rh = (STAGE_BAND.h - STAGE_BAND.gap * (rows.length - 1)) / rows.length;
		var cols = Math.max.apply(null, rows);
		var tw = (STAGE_BAND.w - STAGE_BAND.gap * (cols - 1)) / cols;
		var out = [], y = STAGE_BAND.top;
		for (var r = 0; r < rows.length; r++) {
			var cnt = rows[r];
			var x = STAGE_BAND.left + (STAGE_BAND.w - (cnt * tw + (cnt - 1) * STAGE_BAND.gap)) / 2; // shorter row centered
			// round EDGES, not x and w separately (else the last tile pokes 1px past the opening)
			for (var i = 0; i < cnt; i++) { out.push([Math.round(x), Math.round(y), Math.round(x + tw) - Math.round(x), Math.round(y + rh) - Math.round(y)]); x += tw + STAGE_BAND.gap; }
			y += rh + STAGE_BAND.gap;
		}
		return bleedOuter(out);
	}
	// share mode: { share:[x,y,w,h], tiles:[[x,y,w,h],...] } — tiles in people order (Matt first).
	// n<=3: screen left + right column (12px gaps: reproduces the proven legacy column pixel-for-pixel).
	// n>=4: one row of everyone across the top (16:9-ish tiles), share full-width below.
	function shareLayout(n) {
		n = Math.max(1, Math.min(9, n));
		if (n <= 3) {
			var col = shareColumn(n);
			var share0 = [STAGE_BAND.left, STAGE_BAND.top, SHARE_COL.x - STAGE_BAND.gap - STAGE_BAND.left, STAGE_BAND.h];
			var bled = bleedOuter([share0].concat(col));
			return { share: bled[0], tiles: bled.slice(1) };
		}
		var tw = (STAGE_BAND.w - STAGE_BAND.gap * (n - 1)) / n;
		var th = Math.round(tw * 9 / 16);
		var tiles = [], x = STAGE_BAND.left;
		for (var j = 0; j < n; j++) { tiles.push([Math.round(x), STAGE_BAND.top, Math.round(x + tw) - Math.round(x), th]); x += tw + STAGE_BAND.gap; }
		var share = [STAGE_BAND.left, STAGE_BAND.top + th + STAGE_BAND.gap, STAGE_BAND.w, STAGE_BAND.h - th - STAGE_BAND.gap];
		var bled2 = bleedOuter([share].concat(tiles));
		return { share: bled2[0], tiles: bled2.slice(1) };
	}
	// ===== Live graphics (2026-11-27, off-air prototype; SPEC §9.3) =====
	// A graphic panel on the LEFT of the stage band (same idea as the portrait iPhone share); Matt
	// (tiles[0]) + onstage guests pack into the remaining width as 16:9 tiles, 1-3 rows, whichever
	// gives the biggest tiles. n=1: Matt fills everything right of the panel.
	var GFX_PANEL_W = 744; // card design box is 744x930 (4:5); panel is 744 wide in the opening, then left-bled
	function inscribe169(cw, ch) {
		// whole pixels, never larger than the cell (cells can be fractional)
		cw = Math.floor(cw); ch = Math.floor(ch);
		if (cw * 9 >= ch * 16) return { w: Math.floor(ch * 16 / 9), h: ch };
		return { w: cw, h: Math.floor(cw * 9 / 16) };
	}
	function panelLayout(n, panelW, fill) {
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
				if (fill) tiles.push([Math.round(x), Math.round(y), Math.round(best.cw), Math.round(best.ch)]);
				else tiles.push([Math.round(x + (best.cw - i2.w) / 2), Math.round(y + (best.ch - i2.h) / 2), i2.w, i2.h]);
				x += best.cw + gap;
			}
			y += best.ch + gap;
		}
		return { panel: panel, tiles: tiles };
	}
	function graphicLayout(n) {
		// fill the cells (no 16:9 letterbox). Bleed the panel on the left/top/bottom only
		// (right edge stays, gutter preserved). Bleed tiles among themselves so a short
		// bottom row grows to the sides, then clamp left of the panel gutter.
		var L = panelLayout(n, GFX_PANEL_W, true);
		var p = L.panel;
		var panel = [OUTER.x, OUTER.y, p[0] + p[2] - OUTER.x, OUTER.h];
		var minX = STAGE_BAND.left + GFX_PANEL_W + STAGE_BAND.gap;
		var tiles = bleedOuter(L.tiles).map(function (r) {
			if (r[0] < minX) { r[2] -= minX - r[0]; r[0] = minX; }
			return r;
		});
		return { panel: panel, tiles: tiles };
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
	var api = { PANELS: PANELS, OVERLAYS: OVERLAYS, SHARE_COL: SHARE_COL, shareSlots: shareSlots, camBounds: camBounds, TAG_INSET: TAG_INSET, TAG_PAD: TAG_PAD, TAG_H: TAG_H, tagPos: tagPos, STAGE_BAND: STAGE_BAND, FRAME_OPENING: FRAME_OPENING, FRAME_BLEED: FRAME_BLEED, FRAME_PAD: FRAME_PAD, SAFE: SAFE, OUTER: OUTER, bleedOuter: bleedOuter, gridLayout: gridLayout, shareLayout: shareLayout, shareColumn: shareColumn, rowSplit: rowSplit, introStrip: introStrip, GFX_PANEL_W: GFX_PANEL_W, panelLayout: panelLayout, graphicLayout: graphicLayout };
	if (typeof module !== "undefined" && module.exports) module.exports = api;
	root.fpmLayouts = api;
})(typeof window !== "undefined" ? window : this);
