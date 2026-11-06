// node tests/fpm-seats.test.mjs — onstage/backstage planner v2 (SPEC v2)
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const S = require("../fpm-seats.js");
import assert from "assert";
const T = 1_000_000;

// joiners land backstage (manual mode), join order preserved
let r = S.plan({ onstage: [], here: { fpmB: "Ann", fpmA: "Joe" }, firstSeen: { fpmA: 1, fpmB: 2 }, lastSeen: { fpmA: T, fpmB: T }, now: T, autoAdmit: false });
assert.deepStrictEqual(r.onstage, []); assert.deepStrictEqual(r.backstage, ["fpmA", "fpmB"]);

// autoAdmit appends in join order
r = S.plan({ onstage: [], here: { fpmB: "Ann", fpmA: "Joe" }, firstSeen: { fpmA: 1, fpmB: 2 }, lastSeen: { fpmA: T, fpmB: T }, now: T, autoAdmit: true });
assert.deepStrictEqual(r.onstage, [["fpmA", "Joe"], ["fpmB", "Ann"]]); assert.deepStrictEqual(r.admitted, ["fpmA", "fpmB"]);

// admit/demote round trip + cap
let cast = S.admit([], "fpmA", "Joe");
cast = S.admit(cast, "fpmA", "Joe"); // idempotent
assert.deepStrictEqual(cast, [["fpmA", "Joe"]]);
assert.deepStrictEqual(S.demote(cast, "fpmA"), []);
cast = [];
for (let i = 0; i < 10; i++) cast = S.admit(cast, "fpm" + i, "G" + i);
assert.strictEqual(cast.length, S.MAX_GUESTS, "cap at 8 guests");

// name refresh while present
r = S.plan({ onstage: [["fpmA", "Joe"]], here: { fpmA: "Joseph" }, firstSeen: { fpmA: 1 }, lastSeen: { fpmA: T }, now: T, autoAdmit: false });
assert.deepStrictEqual(r.onstage, [["fpmA", "Joseph"]]);

// blip (gone < STALE): tile held; gone > STALE: removed
r = S.plan({ onstage: [["fpmA", "Joe"]], here: {}, firstSeen: {}, lastSeen: { fpmA: T - 10000 }, now: T, autoAdmit: false });
assert.deepStrictEqual(r.onstage, [["fpmA", "Joe"]], "blip holds the tile");
r = S.plan({ onstage: [["fpmA", "Joe"]], here: {}, firstSeen: {}, lastSeen: { fpmA: T - 61000 }, now: T, autoAdmit: false });
assert.deepStrictEqual(r.onstage, []); assert.deepStrictEqual(r.removed, [["fpmA", "Joe"]]);

// device switch: same name, new id, old id gone <= STALE -> replaced IN PLACE (order kept)
r = S.plan({ onstage: [["fpmA", "Joe"], ["fpmB", "Ann"]], here: { fpmB: "Ann", fpmNew: "joe " }, firstSeen: { fpmNew: T }, lastSeen: { fpmA: T - 5000, fpmB: T }, now: T, autoAdmit: false });
assert.deepStrictEqual(r.onstage, [["fpmNew", "joe "], ["fpmB", "Ann"]]);
assert.deepStrictEqual(r.rejoined, [{ oldId: "fpmA", newId: "fpmNew", name: "joe " }]);

// long-gone (> STALE): removed first, name-match does NOT rescue — newcomer lands backstage
r = S.plan({ onstage: [["fpmA", "Joe"]], here: { fpmNew: "Joe" }, firstSeen: { fpmNew: T }, lastSeen: { fpmA: T - 120000 }, now: T, autoAdmit: false });
assert.deepStrictEqual(r.onstage, []); assert.deepStrictEqual(r.backstage, ["fpmNew"]);

// imposter can't steal: member present, same-name newcomer goes backstage
r = S.plan({ onstage: [["fpmA", "Joe"]], here: { fpmA: "Joe", fpmFake: "Joe" }, firstSeen: { fpmA: 1, fpmFake: T }, lastSeen: { fpmA: T, fpmFake: T }, now: T, autoAdmit: false });
assert.deepStrictEqual(r.onstage, [["fpmA", "Joe"]]); assert.deepStrictEqual(r.backstage, ["fpmFake"]);

console.log("fpm-seats v2: all tests pass");
