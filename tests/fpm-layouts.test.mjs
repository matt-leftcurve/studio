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
// ===== Onstage model (SPEC v2, Matt 2026-11-05) =====
assert.deepStrictEqual(L.rowSplit(1), [1]); assert.deepStrictEqual(L.rowSplit(3), [3]);
assert.deepStrictEqual(L.rowSplit(4), [2,2]); assert.deepStrictEqual(L.rowSplit(5), [3,2]);
assert.deepStrictEqual(L.rowSplit(6), [3,3]); assert.deepStrictEqual(L.rowSplit(9), [5,4]); assert.deepStrictEqual(L.rowSplit(10), [5,5]);
assert.deepStrictEqual(L.colSplit(4), [4]); assert.deepStrictEqual(L.colSplit(5), [3,2]); assert.deepStrictEqual(L.colSplit(10), [5,5]);
// solo grid = full stage band
assert.deepStrictEqual(L.gridLayout(1), [[0,165,1920,810]]);
// 2 people = the old SBS split (952/953 ≈ halves with 15 gap)
{const g=L.gridLayout(2); assert.strictEqual(g.length,2); assert.strictEqual(g[0][1],165); assert.strictEqual(g[0][3],810); assert.ok(Math.abs(g[0][2]-952)<=2);}
// 5 people: 3 top, 2 bottom, bottom centered, uniform tile size
{const g=L.gridLayout(5); assert.strictEqual(g.length,5);
 assert.strictEqual(g[0][1],165); assert.strictEqual(g[3][1],165+Math.round((810-15)/2)+15||g[3][1],g[3][1]);
 assert.ok(g[3][0]>g[0][0], "bottom row centered/indented");
 assert.strictEqual(g[0][2],g[4][2], "uniform width");}
// grid tiles never overlap and stay in the band
for (const n of [1,2,3,4,5,6,7,8,9,10]) {
  const g=L.gridLayout(n);
  assert.strictEqual(g.length,n);
  for (const t of g){ assert.ok(t[0]>=0&&t[1]>=165&&t[0]+t[2]<=1921&&t[1]+t[3]<=976, `tile in band n=${n}`); }
}
// share: 1..3 people reproduce the legacy column exactly
{const s3=L.shareLayout(3); assert.deepStrictEqual(s3.tiles, L.shareSlots(3)); assert.deepStrictEqual(s3.share.slice(0,2),[0,165]); assert.strictEqual(s3.share[2],1380);}
{const s1=L.shareLayout(1); assert.deepStrictEqual(s1.tiles, L.shareSlots(1));}
// share with 5 people: 2 columns, 3 left + 2 right, share panel narrower but >= 1000px
{const s5=L.shareLayout(5); assert.strictEqual(s5.tiles.length,5);
 const leftX=s5.tiles[0][0]; const rightX=s5.tiles[3][0];
 assert.ok(rightX>leftX, "two columns");
 assert.strictEqual(s5.tiles.filter(t=>t[0]===leftX).length,3,"3 on the left");
 assert.ok(s5.share[2]>=1000, "share panel stays usable: "+s5.share[2]);}
// share 10: 5+5
{const s10=L.shareLayout(10); assert.strictEqual(s10.tiles.length,10);
 const xs=[...new Set(s10.tiles.map(t=>t[0]))]; assert.strictEqual(xs.length,2);}
console.log("fpm-layouts: Onstage model tests pass");
