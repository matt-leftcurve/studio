// node tests/fpm-layouts.test.mjs — geometry SSOT invariants (SPEC I2/I7)
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const L = require("../fpm-layouts.js");
import assert from "assert";
// frame-safe rect (SPEC §9.4): lacquer frame opening x37..1882 y87..1042, inset 16
assert.deepStrictEqual(L.SAFE, {x:53,y:103,w:1814,h:924}, "SAFE = opening - FRAME_PAD");
assert.deepStrictEqual(L.shareSlots(3), [[1342,103,525,300],[1342,415,525,300],[1342,727,525,300]], "n=3 column (SAFE 103..1027)");
assert.deepStrictEqual(L.shareSlots(2), [[1342,103,525,456],[1342,571,525,456]], "n=2 halves");
assert.deepStrictEqual(L.shareSlots(1), [[1342,103,525,924]], "n=1 full column");
assert.deepStrictEqual(L.camBounds(0), {x:2684,y:206,w:1050,h:1848});
assert.deepStrictEqual(L.camBounds(1), {x:2684,y:206,w:1050,h:912});
assert.deepStrictEqual(L.camBounds(2), {x:2684,y:206,w:1050,h:600});
assert.ok(L.PANELS.solo.host && L.PANELS.trio.g2 && L.OVERLAYS.share, "panel/overlay tables present");
assert.strictEqual(L.TAG_INSET, 57);
console.log("fpm-layouts: all tests pass");
// ===== Onstage model (SPEC v2, Matt 2026-11-05; share rule v2: row-above-share for >3) =====
assert.deepStrictEqual(L.rowSplit(1), [1]); assert.deepStrictEqual(L.rowSplit(3), [3]);
assert.deepStrictEqual(L.rowSplit(4), [2,2]); assert.deepStrictEqual(L.rowSplit(5), [3,2]);
assert.deepStrictEqual(L.rowSplit(6), [3,3]); assert.deepStrictEqual(L.rowSplit(9), [5,4]);
// solo grid = the whole frame-safe rect (2026-11-27; was full canvas under the bands); clamp at 9
assert.deepStrictEqual(L.gridLayout(1), [[53,103,1814,924]]);
assert.strictEqual(L.gridLayout(12).length, 9, "clamped to 9");
// 2 people ~ SBS halves
{const g=L.gridLayout(2); assert.strictEqual(g.length,2); assert.strictEqual(g[0][3],924); assert.ok(Math.abs(g[0][2]-900)<=2);}
// 5 people: 3 top 2 bottom, bottom centered, uniform width
{const g=L.gridLayout(5); assert.strictEqual(g.length,5); assert.ok(g[3][0]>g[0][0]); assert.ok(Math.abs(g[0][2]-g[4][2])<=1, "uniform width (edge rounding: ±1px)");}
// all counts: tiles inside the band, no overlap with share rules
for (const n of [1,2,3,4,5,6,7,8,9]) {
  for (const t2 of L.gridLayout(n)) assert.ok(t2[0]>=53&&t2[1]>=103&&t2[0]+t2[2]<=1867&&t2[1]+t2[3]<=1027, `grid in SAFE n=${n}`);
}
// share <=3 people: legacy column pixel-for-pixel
{const s3=L.shareLayout(3); assert.deepStrictEqual(s3.tiles, L.shareSlots(3)); assert.deepStrictEqual(s3.share,[53,103,1274,924]);}
{const s1=L.shareLayout(1); assert.deepStrictEqual(s1.tiles, L.shareSlots(1));}
// share >3 people: ONE ROW above, share full width below
for (const n of [4,5,7,9]) {
  const sh=L.shareLayout(n);
  assert.strictEqual(sh.tiles.length,n);
  assert.ok(sh.tiles.every(t2=>t2[1]===103), `single row n=${n}`);
  assert.strictEqual(sh.share[0],53); assert.strictEqual(sh.share[2],1814, "share full SAFE width");
  assert.ok(sh.share[1]>103 && sh.share[1]+sh.share[3]<=1027, "share below row, inside SAFE");
  assert.ok(sh.share[3]>=400, `share keeps height n=${n}: ${sh.share[3]}`);
}
console.log("fpm-layouts: Onstage v2 tests pass");
// ===== Lacquer frame fit (SPEC §9.4): EVERY Onstage rect + its name tag inside the frame opening,
// clear of the rounded corners, integer pixels =====
{
  const O=L.FRAME_OPENING, S=L.SAFE;
  const inCorner=(px,py)=>{ // is (px,py) inside the rounded opening?
    const cx=Math.min(Math.max(px,O.x+O.r),O.x+O.w-O.r), cy=Math.min(Math.max(py,O.y+O.r),O.y+O.h-O.r);
    return (px-cx)**2+(py-cy)**2 <= O.r*O.r;
  };
  const check=(r,what)=>{
    assert.ok(r.every(Number.isInteger), `${what}: integer rect ${r}`);
    assert.ok(r[0]>=S.x&&r[1]>=S.y&&r[0]+r[2]<=S.x+S.w&&r[1]+r[3]<=S.y+S.h, `${what}: inside SAFE ${r}`);
    for (const [px,py] of [[r[0],r[1]],[r[0]+r[2],r[1]],[r[0],r[1]+r[3]],[r[0]+r[2],r[1]+r[3]]])
      assert.ok(inCorner(px,py), `${what}: corner ${px},${py} clear of the frame radius`);
  };
  const tag=(r)=>[r[0]+14, r[1]+r[3]-44, 200, 38]; // stage.html tag box (left/top), ~38px tall
  for (let n=1;n<=9;n++) {
    L.gridLayout(n).forEach((r,i)=>{check(r,`grid n=${n} #${i}`); if (n>1&&r[3]>=60) check(tag(r).map((v,k)=>k===2?Math.min(v,r[2]-28):v),`grid tag n=${n} #${i}`);});
    const sh=L.shareLayout(n); check(sh.share,`share n=${n}`); sh.tiles.forEach((r,i)=>check(r,`share tile n=${n} #${i}`));
    const g=L.graphicLayout(n); check(g.panel,`gfx panel n=${n}`); g.tiles.forEach((r,i)=>check(r,`gfx tile n=${n} #${i}`));
    assert.strictEqual(g.panel[2], 744, "gfx panel keeps 744 wide");
    g.tiles.forEach(r=>assert.ok(r[0]>=g.panel[0]+g.panel[2]+L.STAGE_BAND.gap, `gfx tiles right of the panel n=${n}`));
  }
  assert.deepStrictEqual(L.graphicLayout(1), {panel:[53,103,744,924], tiles:[[812,103,1055,924]]});
}
console.log("fpm-layouts: lacquer frame-fit tests pass");
