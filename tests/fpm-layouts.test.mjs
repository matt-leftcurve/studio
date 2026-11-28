// node tests/fpm-layouts.test.mjs — geometry SSOT invariants (SPEC I2/I7)
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const L = require("../fpm-layouts.js");
import assert from "assert";

assert.deepStrictEqual(L.FRAME_OPENING, {x:37,y:87,w:1846,h:956,r:25});
assert.strictEqual(L.FRAME_BLEED, 20);
assert.deepStrictEqual(L.OUTER, {x:17,y:67,w:1886,h:996}, "OUTER = opening + 20px bleed");
assert.ok(L.PANELS.solo.host && L.PANELS.trio.g2 && L.OVERLAYS.share, "panel/overlay tables present");
assert.strictEqual(L.TAG_INSET, 57);
console.log("fpm-layouts: all tests pass");

// ===== Onstage model (SPEC v2, Matt 2026-11-05; share rule v2: row-above-share for >3) =====
assert.deepStrictEqual(L.rowSplit(1), [1]); assert.deepStrictEqual(L.rowSplit(3), [3]);
assert.deepStrictEqual(L.rowSplit(4), [2,2]); assert.deepStrictEqual(L.rowSplit(5), [3,2]);
assert.deepStrictEqual(L.rowSplit(6), [3,3]); assert.deepStrictEqual(L.rowSplit(9), [5,4]);
// solo = FULL CANVAS so the camera bleeds under the frame (Matt 2026-11-27 evening)
assert.deepStrictEqual(L.gridLayout(1), [[0,0,1920,1080]]);
assert.strictEqual(L.gridLayout(12).length, 9, "clamped to 9");
// 2 people: halves, full bleed height, inner gutter 15
{const g=L.gridLayout(2); assert.strictEqual(g.length,2); assert.strictEqual(g[0][3],996); assert.ok(Math.abs(g[0][2]-936)<=2); assert.strictEqual(g[1][0]-(g[0][0]+g[0][2]),15);}
// 5 people: 3 top 2 bottom; bottom row outer edges bleed to OUTER (fills the side margins)
{const g=L.gridLayout(5); assert.strictEqual(g.length,5); assert.strictEqual(g[3][0],L.OUTER.x); assert.strictEqual(g[4][0]+g[4][2],L.OUTER.x+L.OUTER.w);}
console.log("fpm-layouts: Onstage v2 tests pass");

// ===== Lacquer frame bleed (SPEC §9.4): tiles cover the opening and extend under the border =====
{
  const O=L.FRAME_OPENING, U=L.OUTER, B=L.FRAME_BLEED;
  const inOpening=(px,py)=>{
    if (px<O.x||py<O.y||px>O.x+O.w||py>O.y+O.h) return false;
    const cx=Math.min(Math.max(px,O.x+O.r),O.x+O.w-O.r), cy=Math.min(Math.max(py,O.y+O.r),O.y+O.h-O.r);
    return (px-cx)**2+(py-cy)**2 <= O.r*O.r;
  };
  const contains=(r,px,py)=>px>=r[0]&&px<=r[0]+r[2]&&py>=r[1]&&py<=r[1]+r[3];
  const insideCanvas=(r)=>r[0]>=0&&r[1]>=0&&r[0]+r[2]<=1920&&r[1]+r[3]<=1080;
  const insideOuter=(r)=>r[0]>=U.x&&r[1]>=U.y&&r[0]+r[2]<=U.x+U.w&&r[1]+r[3]<=U.y+U.h;

  const checkRect=(r,what,fullCanvas)=>{
    assert.ok(r.every(Number.isInteger), `${what}: integer ${r}`);
    assert.ok(insideCanvas(r), `${what}: on canvas ${r}`);
    if (!fullCanvas) assert.ok(insideOuter(r), `${what}: inside OUTER ${r}`);
  };

  const tagInside=(r,what)=>{
    const tp=L.tagPos(r);
    assert.ok(tp.every(Number.isInteger), `${what}: integer tag`);
    assert.ok(inOpening(tp[0],tp[1]), `${what}: tag origin ${tp} in opening`);
    assert.ok(contains(r,tp[0],tp[1]), `${what}: tag origin ${tp} on tile`);
    // 44px-tall tag stays in the opening (width varies with the name; origin is what we place)
    assert.ok(inOpening(tp[0],tp[1]+L.TAG_H-1), `${what}: tag bottom in opening`);
  };

  // no black between tiles and the frame: every point near the opening's inner edge
  // (including the rounded corners) is covered by a rect. Gutters between tiles are fine.
  const nearFrame=(x,y)=>{
    if (!inOpening(x,y)) return false;
    const d=Math.min(x-O.x,O.x+O.w-x,y-O.y,O.y+O.h-y);
    if (d<=8) return true;
    const cx=Math.min(Math.max(x,O.x+O.r),O.x+O.w-O.r), cy=Math.min(Math.max(y,O.y+O.r),O.y+O.h-O.r);
    return (x-cx)**2+(y-cy)**2 >= (O.r-8)*(O.r-8);
  };
  const coverOpening=(rects,what)=>{
    const step=3;
    for (let y=O.y;y<=O.y+O.h;y+=step) {
      for (let x=O.x;x<=O.x+O.w;x+=step) {
        if (!nearFrame(x,y)) continue;
        if (rects.some(r=>contains(r,x,y))) continue;
        const gap=16;
        const near=rects.filter(r=>x>=r[0]-gap&&x<=r[0]+r[2]+gap&&y>=r[1]-gap&&y<=r[1]+r[3]+gap);
        assert.ok(near.length>=2, `${what}: black at ${x},${y} against the frame (not a gutter)`);
      }
    }
  };

  // solo is full canvas (4K 0,0,3840x2160)
  assert.deepStrictEqual(L.gridLayout(1), [[0,0,1920,1080]]);

  for (let n=2;n<=9;n++) {
    const g=L.gridLayout(n);
    g.forEach((r,i)=>{checkRect(r,`grid n=${n} #${i}`); tagInside(r,`grid tag n=${n} #${i}`);});
    coverOpening(g,`grid n=${n}`);
    // outer edges reach OUTER
    assert.ok(Math.min(...g.map(r=>r[0]))===U.x, `grid n=${n} left bleed`);
    assert.ok(Math.max(...g.map(r=>r[0]+r[2]))===U.x+U.w, `grid n=${n} right bleed`);
    assert.ok(Math.min(...g.map(r=>r[1]))===U.y, `grid n=${n} top bleed`);
    assert.ok(Math.max(...g.map(r=>r[1]+r[3]))===U.y+U.h, `grid n=${n} bottom bleed`);
  }

  // share
  assert.deepStrictEqual(L.shareLayout(3).tiles, L.shareSlots(3));
  assert.deepStrictEqual(L.shareLayout(1).share, [17,67,1326,996]);
  assert.deepStrictEqual(L.shareLayout(1).tiles, [[1358,67,545,996]]);
  assert.deepStrictEqual(L.camBounds(0), {x:2716,y:134,w:1090,h:1992});
  assert.deepStrictEqual(L.camBounds(1), {x:2716,y:134,w:1090,h:984});
  assert.deepStrictEqual(L.camBounds(2), {x:2716,y:134,w:1090,h:662});
  for (const n of [1,2,3,4,5,7,9]) {
    const sh=L.shareLayout(n);
    checkRect(sh.share,`share n=${n}`);
    sh.tiles.forEach((r,i)=>{checkRect(r,`share tile n=${n} #${i}`); tagInside(r,`share tag n=${n} #${i}`);});
    coverOpening([sh.share].concat(sh.tiles),`share n=${n}`);
    if (n>=4) {
      assert.strictEqual(sh.tiles.length,n);
      assert.ok(sh.tiles.every(t=>t[1]===U.y), `share row at OUTER top n=${n}`);
      assert.strictEqual(sh.share[0],U.x);
      assert.strictEqual(sh.share[2],U.w, "share full OUTER width");
      assert.ok(sh.share[3]>=400, `share keeps height n=${n}: ${sh.share[3]}`);
    }
  }

  // live graphics: panel keeps 744 content width + left bleed; tiles stay right of it
  for (let n=1;n<=9;n++) {
    const g=L.graphicLayout(n);
    checkRect(g.panel,`gfx panel n=${n}`);
    g.tiles.forEach((r,i)=>{checkRect(r,`gfx tile n=${n} #${i}`); if (r[3]>=60) tagInside(r,`gfx tag n=${n} #${i}`);});
    assert.strictEqual(g.panel[0], U.x, `gfx panel left bleed n=${n}`);
    assert.strictEqual(g.panel[2], 744+B, `gfx panel 744 + left bleed n=${n}`);
    g.tiles.forEach(r=>assert.ok(r[0]>=g.panel[0]+g.panel[2], `gfx tiles right of the panel n=${n}`));
    coverOpening([g.panel].concat(g.tiles),`gfx n=${n}`);
  }
  assert.deepStrictEqual(L.graphicLayout(1), {panel:[17,67,764,996], tiles:[[796,67,1107,996]]});
}
console.log("fpm-layouts: lacquer frame-bleed tests pass");
