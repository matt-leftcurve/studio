// node tests/fpm-layouts.test.mjs — geometry SSOT invariants (SPEC I2/I7)
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const L = require("../fpm-layouts.js");
import assert from "assert";
assert.deepStrictEqual(L.shareSlots(3), [[1395,165,525,262],[1395,439,525,262],[1395,713,525,262]], "n=3 legacy grid");
assert.deepStrictEqual(L.shareSlots(2), [[1395,165,525,399],[1395,576,525,399]], "n=2 halves");
assert.deepStrictEqual(L.shareSlots(1), [[1395,165,525,810]], "n=1 full column");
assert.deepStrictEqual(L.camBounds(0), {x:2790,y:330,w:1050,h:1620});
assert.deepStrictEqual(L.camBounds(1), {x:2790,y:330,w:1050,h:798});
assert.deepStrictEqual(L.camBounds(2), {x:2790,y:330,w:1050,h:524});
assert.ok(L.PANELS.solo.host && L.PANELS.trio.g2 && L.OVERLAYS.share, "panel/overlay tables present");
assert.strictEqual(L.TAG_INSET, 57);
console.log("fpm-layouts: all tests pass");
// ===== Onstage model (SPEC v2, Matt 2026-11-05; share rule v2: row-above-share for >3) =====
assert.deepStrictEqual(L.rowSplit(1), [1]); assert.deepStrictEqual(L.rowSplit(3), [3]);
assert.deepStrictEqual(L.rowSplit(4), [2,2]); assert.deepStrictEqual(L.rowSplit(5), [3,2]);
assert.deepStrictEqual(L.rowSplit(6), [3,3]); assert.deepStrictEqual(L.rowSplit(9), [5,4]);
// solo grid = FULL CANVAS (bands overlay, no crop); clamp at 9
assert.deepStrictEqual(L.gridLayout(1), [[0,0,1920,1080]]);
assert.strictEqual(L.gridLayout(12).length, 9, "clamped to 9");
// 2 people ~ SBS halves
{const g=L.gridLayout(2); assert.strictEqual(g.length,2); assert.strictEqual(g[0][3],810); assert.ok(Math.abs(g[0][2]-952)<=2);}
// 5 people: 3 top 2 bottom, bottom centered, uniform width
{const g=L.gridLayout(5); assert.strictEqual(g.length,5); assert.ok(g[3][0]>g[0][0]); assert.strictEqual(g[0][2],g[4][2]);}
// all counts: tiles inside the band, no overlap with share rules
for (const n of [2,3,4,5,6,7,8,9]) { // n=1 is full-canvas by design
  for (const t2 of L.gridLayout(n)) assert.ok(t2[0]>=0&&t2[1]>=165&&t2[0]+t2[2]<=1921&&t2[1]+t2[3]<=976, `grid in band n=${n}`);
}
// share <=3 people: legacy column pixel-for-pixel
{const s3=L.shareLayout(3); assert.deepStrictEqual(s3.tiles, L.shareSlots(3)); assert.deepStrictEqual(s3.share,[0,165,1380,810]);}
{const s1=L.shareLayout(1); assert.deepStrictEqual(s1.tiles, L.shareSlots(1));}
// share >3 people: ONE ROW above, share full width below
for (const n of [4,5,7,9]) {
  const sh=L.shareLayout(n);
  assert.strictEqual(sh.tiles.length,n);
  assert.ok(sh.tiles.every(t2=>t2[1]===165), `single row n=${n}`);
  assert.strictEqual(sh.share[0],0); assert.strictEqual(sh.share[2],1920, "share full width");
  assert.ok(sh.share[1]>165 && sh.share[1]+sh.share[3]<=976, "share below row, inside band");
  assert.ok(sh.share[3]>=400, `share keeps height n=${n}: ${sh.share[3]}`);
}
console.log("fpm-layouts: Onstage v2 tests pass");
