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
