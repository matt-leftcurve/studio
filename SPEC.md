# FPM Studio Behavior Spec

Matt's standard (2026-11-05): **what Matt sees in the host view is what OBS airs, and every state
transition (guests, shares, scenes) lands correctly in both — automatically.** Anything that can't
be identical yet must be on the explicit exceptions list, not discovered on air.

Terms: **program** = OBS output (the audience); **host view** = Matt's host page (&stageview);
**guest view** = a guest's page; **seats** = Stage URL g1/g2; **present** = seated AND delivering
live video.

## 1. Invariants — must hold at all times

- **I1 Code parity.** The OBS stage page, host view, guest views, and overlays all run the same
  deployed build. (Mechanism: host page stamps its build into the Stage URL → OBS reloads;
  overlay URLs carry the build; single source of truth per I2.)
- **I2 One definition of geometry.** Layouts, the share-column split, tag anchoring, and the
  native-camera sizes derive from ONE module, consumed by stage.html, fpm-guestview.js,
  fpm-scenes.js, and the overlays. No renderer carries its own copy of the numbers.
- **I3 One writer of seat state.** The Stage input URL is the sole truth for g1/g2/n1/n2 (+legacy
  h1/h2); only the host page writes it. Preflight clears leftovers; ghosts never air.
- **I4 Tags.** A tag shows the seated person's entered name; it follows the person through
  rejoins and swaps; the 𝕏 badge appears only for explicit @handles; an empty seat has NO tag;
  a replaced person's old handle never survives onto their successor.
- **I5 No blank boxes.** An empty or video-dead seat renders nothing in tile layouts (solo PiP,
  intro, share tiles) in every view; SBS/Trio hold a seated-but-reconnecting guest's slot.
- **I6 Ticker.** Every airable scene shows live prices within ~60 s of becoming active, in host
  view and program alike; 429s back off and self-heal; "--" on air is a defect (exception:
  Starting Soon's decorative ticker — decision pending, see Open).
- **I7 Native camera follows layout.** In Stage - Share the camera's OBS transform matches the
  column split for the current present-count (solo 1620 / one 798 / two 524, 4K units) BEFORE the
  scene airs.
- **I8 Audio routing per scene.** Intro: audience hears music only, mic muted. Solo: Matt (+
  Safari audio by 11-05 decision). Stage scenes: Matt + present guests + active share audio
  (tab shares). Nothing reaches the audience twice; nothing intended is missing.
- **I9 View parity.** The host view renders every element the stage page gives OBS: band art,
  logo, tags, tiles, share, ticker. OBS-native-only layers are the explicit exceptions list
  (§5) and nothing else.
- **I10 Recording.** Streaming ⇒ program .mov + FX3 card recording; each guest ⇒ one Drive ISO
  from join to stop; no recordings of empty sources.

## 2. Scene parity matrix — host view vs program, element by element

| Scene | Must match | Known native-only (§5) |
|---|---|---|
| Solo | camera full frame, logo/band art, ticker, (tiles only if guests present) | chat overlay, captions, badges |
| Starting Soon | intro art, tile strip of present people | — (music is audio-only) |
| Stage - SBS | half/half panels, both tags, art, ticker | chat, captions |
| Stage - Trio | thirds, three tags, art, ticker | chat, captions |
| Stage - Share | share big; tile column = present people; tags per tile; art, ticker | chat, captions |
| TradingView / Browser1 | n/a — OBS-native capture; host view shows fallback | window capture itself |

## 3. Transition tests — each must pass in host view AND program AND a guest view

- **T1** Solo → Matt clicks share: auto-switch to Share from ANY scene; screen big; camera full
  column (web + native layers agree); tag at tile bottom; Matt's preview appears ≤2 s (local path).
- **T2** Guest joins while Matt shares solo: alert card + beep; nothing on air until Add; on Add:
  column splits to halves, native camera resizes, guest tile live, tag = their entered name,
  guest sees the share + correct layout.
- **T3** Second guest admitted mid-share: thirds, three tags, camera resizes.
- **T4** Guest leaves mid-share: their tile + tag disappear, column re-expands, camera resizes.
- **T5** Guest rejoins with a new connection, same name: retakes the same seat instantly (no
  click, no 60 s wait), tag correct, no duplicate.
- **T6** ⇄ swap positions: videos and tags swap together, in all views, in every layout.
- **T7** GUEST shares (0/1/2 other guests): auto-switch while a stage scene airs; the right
  share shown; their camera tile stays; back to prior scene on stop. Phone guests: no share
  button (platform limit).
- **T8** Matt stops sharing: return to the pre-share scene; column layout returns to the
  non-share arrangement.
- **T9** Scene changes propagate to guest views ≤2 s.
- **T10** auto-admit toggle ON restores join-order seating; OFF restores manual admit.
- **T11** Preflight seat-clear: after it, no ghost tags/tiles anywhere (incl. solo stream).
- **T12** Tag forms: plain name → no 𝕏 badge; @handle → badge; empty → no tag element.
- **T13** Share audio (tab share, audio toggle on) reaches the stream track at voice-band level —
  host share AND guest share.
- **T14** Mic/Aux mutes on intro scenes only; unmutes on leaving; never stuck either way.
- **T15** Guest Drive ISO: starts on join (green room incl.), survives token renewal, stops and
  finishes upload at stream stop; failure alerts Matt; terminal failure saves to guest Downloads.
- **T16** Build sync: after a deploy + host page reload, OBS stage page runs the new build with
  NO manual OBS touch.

## 4. Verification methods

1. **Parity pass (per scene):** capture host view (screenshot of the host tab) and program
   (GetSourceScreenshot with the scene ON PROGRAM — off-program browser sources don't render and
   screenshot black) → compare element-by-element against §2.
2. **Probes:** build stamps (page meta vs Stage URL &b), Stage URL params, camera transform
   (GetSceneItemTransform), ticker DOM/pixel check, Stage input meters + 15 s recording
   volumedetect for audio, Drive file listing for ISO.
3. **Live drill (laptop as guest, Matt optional):** run T1-T16 that need a real peer; screenshot
   proof per step. Required before the next guest show; required after any change to seats,
   layouts, share, or audio routing.

## 5. Accepted divergences (the ONLY permitted ones)

- OBS-native layers absent from host view: Chat Overlay, Captions, Platform Badges, TeachPanel,
  window captures (TradingView/Browser scenes). Candidate work: mirror chat + captions into the
  host view.
- Host view shows Matt/self with zero delay (by design); program runs ~350 ms behind.
- Program color/crop of Matt's camera is OBS-native and not reproduced exactly in the host view.
- Intro music is audience-audio in OBS only; room members get it via their pages.

## 6. Open items against this spec (2026-11-05)

- Host view Solo: fork solo overlay (logo band/ticker) NOT rendering → violates I9. Debug + fix.
- I2 not yet true: geometry lives in 4 places (stage.html, fpm-guestview.js, retro-share.html,
  fpm-scenes.js camera table) → extract fpm-layouts.js.
- Overlay files exist in two copies (fork stage/ vs mini ~/obs-overlays/) → single source +
  deploy sync; OBS keeps LOCAL copies for offline robustness, synced on every deploy.
- Starting Soon decorative ticker shows fake green numbers — Matt to decide: real prices or art.
- T2/T3/T4/T5/T7/T13-guest/T15 never proven with a real peer → first full drill pending.

## 7. Systematic coverage — how this spec stays complete (added after Matt's challenge, 2026-11-05)

A spec written from incidents is a lagging indicator. Completeness comes from three mechanical sources,
re-run whenever the system changes; every discovered element must map to a contract above, an accepted
divergence (§5), or land in §7.3 as an explicit open decision. "Not mentioned" is itself a spec violation.

### 7.1 Inventories (enumerate, don't remember)
- **OBS**: every scene, scene item, filter, input kind, audio track/monitor config (GetSceneList +
  GetSceneItemList + GetSourceFilterList walk). Current count: 14 scenes — the matrix in §2 covered 6.
- **Render files**: fork (stage/*.html, fpm-*.js, index/join) + mini ~/obs-overlays/*.html + SSN overlay.
  Every file must have exactly ONE consumer chain or be deleted/archived.
- **State writers**: who writes the Stage URL (host page only), camera transforms (host page), OBS config
  (preflight), seat state (fpm-seats via host page). A second writer to anything = defect.
- **Cache layers**: browser cache (ver= params), Pages CDN, OBS browser-source cache (&b build-sync),
  overlay iframes (&b). Any cached artifact without a bust mechanism = defect.
- **Audio routes**: per scene, the full source→track/monitor map (today: Mic/Aux global, Stage filtered,
  Intro Music monitor+output, share audio via Stage).

### 7.2 State-space matrix (test generation, not test listing)
Dimensions: scene (airable set) × seated guests (0/1/2) × present guests (⊆ seated) × share
(none/host/g1/g2) × per-guest camera (on/off) × stream (off/live). T1-T16 are samples from this product;
the drill and the parity harness walk the REACHABLE cells. Parity harness = drive a state via
websocket/room, capture host view (window capture), OBS program (scene on program), guest view, and
diff against §2 — automatable, run before every guest show.

### 7.3 Open decisions from inventory pass #1 — RESOLVED by Matt 2026-11-05 evening (history below)
Resolutions: (1,3,4) legacy scenes RETIRED — renamed "zz …" (Guest-SBS/-Photo/-Trio/-Share, iPad1,
Pocket, Tradingview, Browser1; host share replaced the chart scenes); airable set = Starting Soon, Solo,
Stage-SBS/Trio/Share (+TeachPanel as a building block). (2) TeachPanel KEPT, in every airable scene;
content only flows when the ZH caption bridge runs, so EN streams are naturally clean; mirroring it into
the host view is on the build list. (5) Platform Badges KEPT — contract: present+enabled in Solo.
(6) LocalVocal filter + source DELETED (one caption path only). (7) CAPTION LANGUAGE CONTRACT: EN stream =
Captions scene items disabled + bridge not running; ZH stream = Captions items enabled in airable scenes +
bridge up; preflight asserts whichever applies. (8) Starting Soon ticker = REAL prices — live crypto bar
(same COINS + backoff) covers the decorative strip painted into bg-laoshi.png; file adopted into the fork
(stage/starting-soon.html) and deploy-synced. (9) Retired Label Box/Text items deleted from Solo.

Original questions (for history):
1. **Retired Guest-* scenes + iPad1 + Pocket scene remain airable.** Proposal: prefix "zz " + move to a
   "retired" folder or delete; keep "Guest - SBS - Photo" only if the camera-less-guest flow still matters.
2. **TeachPanel** is in every scene and was live during an English stream. Contract needed: follows
   stream language? preflight toggle?
3. **iPad input carries an ENABLED Source Record filter** — records whenever iPad1 airs. Wanted?
4. **Duplicate "Retro Overlay" items (x3)** in Tradingview and Browser1 — dedupe or explain.
5. **Platform Badges (Solo)** — specless; keep/kill?
6. **LocalVocal filter on Mic/Aux + LocalVocal Subtitles source** — second caption path, both off;
   delete to prevent accidental double captions?
7. **Captions scene-item state per language plan** — contract: EN streams all caption items off;
   ZH streams on in airable scenes; preflight asserts it.
8. **Starting Soon decorative ticker** (fake green numbers) — real or art (pending since the sweep).
9. **Legacy Label Box/Text items** disabled in several scenes — delete (retired 2026-10-21) or keep as
   fallback?

## 8. SPEC v2 — the Onstage model (Matt, 2026-11-05 evening; supersedes §2's scene matrix when built)

**Two scenes: "Starting Soon" and "Onstage".** Everything else is state, not scenes.

- **Backstage**: every connected guest not onstage. Visible ONLY in Matt's host view, as live camera
  tiles with a grey "Backstage" badge; hover → **Bring Onstage**. Backstage guests are never on air,
  never in other guests' views, and their audio never reaches the stream (no stage slot = no stream
  path). A backstage guest's own page shows the stage + their own preview marked "Backstage".
- **Onstage set**: ordered list (Matt always first), up to 9 guests + Matt = 10 people. Hover an
  onstage tile (host view) → **Send Backstage**. Tags = names, per tile, any count.
- **Share is a stage update, not a scene**: when anyone onstage (Matt or guest) shares, the stage
  re-flows to share mode; when it stops, back to grid. No scene switch.
- **Grid (no share)**, people = Matt + onstage: 1 row up to 3; else 2 rows — even split evenly, odd
  ceil on top (5 → 3+2). Uniform tile size, shorter row centered. Minimum rows always.
- **Share mode**: screen panel + right side column(s): 1 column up to 4 people; more → 2 columns,
  odd ceil on the left (5 → 3+2). Minimum columns always. Column tile width 525 (1 col) / 400 (2 cols);
  the share panel takes the rest (≥1000px wide at every count).
- Engine: `fpm-layouts.js` `gridLayout(n)` / `shareLayout(n)`, unit-tested for n=1..10; legacy
  equivalence proven (2 people = SBS halves; share ≤3 people = the existing column pixel-for-pixel).

**Design calls made by bender, flag to change:** (a) Matt counts as a grid/column tile like everyone
else (solo = grid of 1 = full frame, matching today); his tile is still the native OBS camera, its
transform driven per-slot by the host page. (b) Join flow: beep + the backstage tile itself is the
persistent UI (alert cards retire); >60 s returnees land backstage again (ask-again rule carries over).
(c) Onstage ordering = admission order; explicit reordering UI deferred (swap button retires with the
2-seat model). (d) Per-tile frames + name tags move INTO stage.html (drawn dynamically for any n);
retro band art (logo/bands/ticker) stays as the background overlay; retro-sbs/trio/share per-layout
files retire after the migration.

**Migration order (build day 2026-11-06):** 1) stage.html renders grid/share from the onstage list
(new `stage` state: ordered ids + names, replacing g1/g2/n1/n2 — Stage URL carries `cast=` JSON).
2) fpm-seats generalizes to the backstage/onstage model. 3) Host-view backstage strip + hover
controls. 4) OBS: create "Onstage" scene (native camera + Stage + Chat Overlay + Captions +
TeachPanel + Platform Badges), retire Solo/Stage-SBS/Trio/Share (zz), camera transform per-slot.
5) Dynamic tags/frames in stage.html; retro art overlay slimmed. 6) Parity harness run across
n=0..9 synthetic cast + real-guest drill before any show.

## 9. Onstage model — BUILT AND DEPLOYED 2026-11-05 ~19:45 (same evening as spec'd)
Share rule v2 (Matt): >3 people = ONE ROW of everyone ABOVE the share, full-width share below;
<=3 people = the legacy right column (pixel-identical). Max 8 guests (9 people).
Shipped: fpm-layouts gridLayout/shareLayout/introStrip (tests n=1..9); fpm-seats v2 (ordered cast,
blip-hold, device-switch, >60s re-ask, cap 8); stage.html v2 (cast-driven, dynamic frames/tags, share
as state, single band overlay incl. the logo lockup — native Retro Logo Baked + Platform Badges items
retired from air for host parity); fpm-guestview v2 (own tile by cast index, backstage self-preview
with grey chip); fpm-scenes v2 (cast in Stage URL ?cast=JSON, backstage strip + Bring Onstage, hover
Send Backstage, camera transform follows slot 0 in BOTH modes, share switches no scenes); OBS scene
"Onstage" created (camera+Stage+Chat+Teach+Captions(off,EN)+Mic/Aux), program switched, Solo +
Stage-SBS/Trio/Share retired (zz). Airable: Starting Soon, Onstage.
AUDIT (rendered-pixel): host vs OBS parity shot n=1 identical (lockup/badges/tag/frame/ticker live
both); synthetic casts on the deployed page: n=5 grid = 3+2 centered, n=9 grid = 5+4, n=9 share =
row-above ✔; badge rule (𝕏 only for @names) ✔. UNTESTED WITH A REAL GUEST: backstage strip tiles,
Bring Onstage / Send Backstage clicks, guest view v2, share e2e on v2, OBS stage reload-on-admit
timing — needs the phone drill or next dry run BEFORE any show.

### 9.1 Audit completion pass (2026-11-06 afternoon)
Additional PROVEN items: host share FULL CYCLE on v2 (button → picker → share layout in OBS with
camera auto-moved to the column → stop → grid + full-band camera restored); intro mic-mute roundtrip
(Starting Soon mutes, Onstage unmutes); Starting Soon render (intro art + real ticker); build-sync
re-verified at 15:00. AUDIT CATCH: share-STOP left OBS stuck in share layout (stopped VDO :s streams
stay "live" — pixel detection can never see a stop). Fixed: sharer is authoritative in the Stage URL
(?sharer=, host page writes it; a toggle reloads the OBS source ~2-4s, accepted); people's views keep
the instant postMessage path. Pixel-inference of share state is now BANNED by this spec (I-rule:
share state has exactly one writer, the host page).
Remaining real-guest-only items (unchanged): backstage strip live video, Bring Onstage / Send
Backstage clicks, guest view v2, guest-side share, admit-reload timing, Drive ISO proof.
