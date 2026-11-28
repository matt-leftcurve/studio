// Live graphics card renderer: card spec (cards.py) -> SVG. Pure, no deps; used by the queue
// thumbnails, the on-air panel and the preview. Draws in a fixed 744x930 design box (the graphic
// panel in stage units, fpmLayouts.graphicLayout) and scales with the SVG viewBox.
(function (root) {
	"use strict";
	var W = 744, H = 930;
	function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
	function niceTicks(lo, hi, n) {
		var span = hi - lo || Math.abs(hi) || 1, step = Math.pow(10, Math.floor(Math.log10(span / n)));
		[1, 2, 2.5, 5, 10].some(function (m) { if (span / (step * m) <= n) { step *= m; return true; } return false; });
		var out = [], v = Math.ceil(lo / step) * step;
		for (; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
		return out;
	}
	function fmtTick(v, unit) {
		if (unit === "%") return (v > 0 ? "+" : "") + (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(Math.abs(v) < 10 ? 1 : 0)) + "%";
		var a = Math.abs(v);
		if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M";
		if (a >= 1e4) return (v / 1e3).toFixed(0) + "k";
		if (a >= 1e3) return (v / 1e3).toFixed(1) + "k";
		if (a >= 10) return v.toFixed(0);
		return v.toFixed(2);
	}
	function fmtDate(ms, spanDays) {
		var d = new Date(ms);
		var mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
		if (spanDays > 400) return mo + " '" + String(d.getFullYear()).slice(2);
		if (spanDays > 3) return mo + " " + d.getDate();
		return d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0");
	}
	function render(card, opts) {
		opts = opts || {};
		var lines = card.lines || [];
		var t0 = Infinity, t1 = -Infinity, lo = Infinity, hi = -Infinity;
		lines.forEach(function (l) { l.points.forEach(function (p) { t0 = Math.min(t0, p[0]); t1 = Math.max(t1, p[0]); lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); }); });
		if (card.level) { lo = Math.min(lo, card.level.value); hi = Math.max(hi, card.level.value); }
		if (card.yunit === "%") { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
		var pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
		// chart box
		var cx = 40, cy = 408, cw = W - 40 - 92, ch = 384;
		function X(t) { return cx + (t - t0) / ((t1 - t0) || 1) * cw; }
		function Y(v) { return cy + ch - (v - lo) / ((hi - lo) || 1) * ch; }
		var s = [];
		s.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="100%" font-family="Helvetica Neue,Helvetica,Arial,sans-serif">');
		s.push('<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#12161d"/><stop offset="1" stop-color="#0a0c10"/></linearGradient>');
		lines.forEach(function (l, i) { s.push('<linearGradient id="fill' + i + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + l.color + '" stop-opacity=".28"/><stop offset="1" stop-color="' + l.color + '" stop-opacity="0"/></linearGradient>'); });
		s.push('</defs>');
		s.push('<rect x="1" y="1" width="' + (W - 2) + '" height="' + (H - 2) + '" rx="14" fill="url(#bg)" stroke="rgba(201,161,95,0.55)" stroke-width="2"/>');
		// kicker + title
		s.push('<text x="40" y="70" fill="#7fd4c1" font-size="22" font-weight="700" letter-spacing="3">● LIVE CHART</text>');
		s.push('<text x="' + (W - 40) + '" y="70" fill="#5d6675" font-size="20" font-weight="600" text-anchor="end" letter-spacing="1">longshortmatt</text>');
		var title = card.title || "";
		var tsize = title.length > 22 ? 46 : title.length > 16 ? 56 : 66;
		s.push('<text x="40" y="146" fill="#f4f1ea" font-size="' + tsize + '" font-weight="800">' + esc(title) + '</text>');
		s.push('<text x="40" y="190" fill="#9aa4b2" font-size="28" font-weight="500">' + esc(card.subtitle) + '</text>');
		// stats row
		var st = card.stats || [], sw = (W - 80) / Math.max(1, st.length);
		st.forEach(function (x, i) {
			var sx = 40 + i * sw;
			s.push('<rect x="' + sx + '" y="218" width="' + (sw - 14) + '" height="122" rx="10" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.07)"/>');
			s.push('<rect x="' + sx + '" y="218" width="6" height="122" rx="3" fill="' + x.color + '"/>');
			s.push('<text x="' + (sx + 22) + '" y="252" fill="#9aa4b2" font-size="21" font-weight="600">' + esc(x.label) + '</text>');
			var vs = String(x.value).length > 8 ? 40 : 48;
			s.push('<text x="' + (sx + 22) + '" y="302" fill="' + x.color + '" font-size="' + vs + '" font-weight="800">' + esc(x.value) + '</text>');
			s.push('<text x="' + (sx + 22) + '" y="330" fill="#6b7482" font-size="18">' + esc(x.sub) + '</text>');
		});
		// grid + y ticks (right side)
		niceTicks(lo, hi, 5).forEach(function (v) {
			var y = Y(v);
			s.push('<line x1="' + cx + '" x2="' + (cx + cw) + '" y1="' + y + '" y2="' + y + '" stroke="' + (v === 0 && card.yunit === "%" ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.07)") + '" stroke-width="' + (v === 0 && card.yunit === "%" ? 2 : 1) + '"/>');
			s.push('<text x="' + (cx + cw + 12) + '" y="' + (y + 7) + '" fill="#6b7482" font-size="19">' + fmtTick(v, card.yunit) + '</text>');
		});
		// x labels (start, middle, end)
		var spanDays = (t1 - t0) / 864e5;
		[t0, (t0 + t1) / 2, t1].forEach(function (t, i) {
			s.push('<text x="' + X(t) + '" y="' + (cy + ch + 34) + '" fill="#6b7482" font-size="19" text-anchor="' + ["start", "middle", "end"][i] + '">' + fmtDate(t, spanDays) + '</text>');
		});
		// level line
		if (card.level) {
			var ly = Y(card.level.value);
			s.push('<line x1="' + cx + '" x2="' + (cx + cw) + '" y1="' + ly + '" y2="' + ly + '" stroke="#f4f1ea" stroke-width="2.5" stroke-dasharray="10 8" opacity=".85"/>');
			s.push('<rect x="' + (cx + 8) + '" y="' + (ly - 40) + '" width="' + (card.level.label.length * 14 + 28) + '" height="32" rx="6" fill="#f4f1ea"/>');
			s.push('<text x="' + (cx + 22) + '" y="' + (ly - 17) + '" fill="#0b0d11" font-size="21" font-weight="800">' + esc(card.level.label) + '</text>');
		}
		// series
		lines.forEach(function (l, i) {
			if (!l.points.length) return;
			var d = l.points.map(function (p, j) { return (j ? "L" : "M") + X(p[0]).toFixed(1) + " " + Y(p[1]).toFixed(1); }).join(" ");
			if (lines.length === 1) s.push('<path d="' + d + ' L' + X(l.points[l.points.length - 1][0]).toFixed(1) + ' ' + (cy + ch) + ' L' + X(l.points[0][0]).toFixed(1) + ' ' + (cy + ch) + ' Z" fill="url(#fill' + i + ')"/>');
			s.push('<path d="' + d + '" fill="none" stroke="' + l.color + '" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>');
			var lp = l.points[l.points.length - 1];
			s.push('<circle cx="' + X(lp[0]) + '" cy="' + Y(lp[1]) + '" r="7" fill="' + l.color + '" stroke="#0a0c10" stroke-width="3"/>');
		});
		// legend for comparisons
		if (lines.length > 1) {
			var lx = 40;
			lines.forEach(function (l) {
				s.push('<rect x="' + lx + '" y="' + (cy - 26) + '" width="22" height="6" rx="3" fill="' + l.color + '"/>');
				s.push('<text x="' + (lx + 30) + '" y="' + (cy - 17) + '" fill="#c9ced6" font-size="19" font-weight="600">' + esc(l.label) + '</text>');
				lx += 50 + l.label.length * 11;
			});
		}
		// headline + footer
		s.push('<text x="40" y="' + (H - 62) + '" fill="#f4f1ea" font-size="27" font-weight="700">' + esc(card.headline) + '</text>');
		s.push('<text x="40" y="' + (H - 28) + '" fill="#5d6675" font-size="18">Data: ' + esc(card.source) + ' · as of ' + esc(card.asof) + '</text>');
		s.push('</svg>');
		return s.join("");
	}
	var api = { render: render, W: W, H: H };
	if (typeof module !== "undefined" && module.exports) module.exports = api;
	root.fpmCard = api;
})(typeof window !== "undefined" ? window : this);
