# FULLPORTMATT guest studio notes

Fork-specific pieces, one section each:

1. **Branded guest join flow** (`join.html`) — section A.
2. **Hidden guest-side recording** (`&hiddenrecord`) — section B.
3. **Guest control bar polish** (`fpm-guestbar.css` / `fpm-guestbar.js`) — section C.
4. **Mic-only guests + minimal `?g=N` links** (`join.html`, `index.html`) — section D.
5. **Waiting room** (`&hold`, `fpm-hold.css` / `fpm-hold.js`) — section E.
6. **Upload status chip + leave/close hold page** (`fpm-upload.css` / `fpm-upload.js`, two hooks in `lib.js`) — section F.
7. **Screen-share → OBS scene bridge** (`bridge.html`) — section G.

---

# A. Branded guest join flow (`join.html`)

Branch: `deploy`. Deployed at `https://matt-leftcurve.github.io/studio/`.
Self-contained page (inline CSS + JS, no external assets, no CDNs). `lib.js`,
`main.js` and `webrtc.js` are **not** modified; the page hands off to the
stock app purely through documented URL parameters.

## Canonical guest link

```
https://matt-leftcurve.github.io/studio/join.html?id=<guestID>&room=fpmshow
```

- `id` is the guest's push/stream ID (`push` is accepted as an alias).
- `room` is the room name (default show room: `fpmshow`).
- Both are sanitized the same way the app does it (`[\W]+` → `_`), so the
  sanitized values the page shows in the console are exactly what the app will
  use. A link missing either value shows a "This invite link is incomplete"
  screen instead of a broken join.
- Optional `&name=<Guest_Name>` (or `&label=`) pre-fills the name field
  (underscores become spaces); otherwise the last name used on that device is
  offered.
- **Any other parameter on the invite link is passed through unchanged** to the
  studio URL (for example `&password=…`, `&bitrate=…`, `&proaudio`). Only the
  params the page consumes or sets itself (`id`, `push`, `room`, `name`,
  `label`, `l`, `videodevice`, `audiodevice`, `sink`, `aec`, `denoise`,
  `autogain`, `webcam`, `hiddenrecord`, `autostart`, `quality`, `q`,
  `darkmode`, `hidesolo`) are not forwarded.

## Flow

1. **Landing** — "Welcome to the FULLPORTMATT Studio", "You are about to join
   Matt's show. Have a great time!", one big **Continue** button. Clicking it
   triggers `getUserMedia({ video: {ideal 1920×1080, facingMode user}, audio })`.
   If the camera rejects the 1080p hint (`OverconstrainedError`) the page
   retries with `{ video: true, audio: true }` so nobody is blocked by an older
   webcam.
2. **Device check** — left: live, mirrored (CSS `scaleX(-1)`) preview with a chip
   showing the **actual** captured resolution from `track.getSettings()`
   ("1080p — this is how you'll be recorded (1920×1080 · 30 fps)"). Right:
   name field; camera select; microphone select with a live WebAudio RMS meter
   (AnalyserNode, −60..0 dBFS → 0..100 %, peak-hold); speaker select with a
   **Test tone** (C–E–G chime through an `<audio>` element, routed with
   `setSinkId` where supported, otherwise the select is disabled with a note);
   "Using headphones?" Yes/No segmented control (defaults to **No**, the safer
   assumption); big **Join studio** button, enabled once a name is typed.
   Switching camera/mic swaps only that track on the live stream and
   re-reads the resolution chip / rebuilds the meter. `devicechange` events
   refresh the lists (e.g. plugging in a headset).
3. **Join** — releases the preview tracks and navigates the same tab to the app.
4. **Denied / error UX** — one "blocked" screen whose title/text adapt to the
   error (`NotAllowedError` → unblock steps for the address-bar icon;
   `NotFoundError`; `NotReadableError` "another app is using your camera";
   `OverconstrainedError`; missing `getUserMedia` → unsupported browser). It has
   **Try again** (re-runs `getUserMedia`) and **Reload page**.

The guest's name is remembered in `localStorage` (`fpmGuestName`) so a
returning guest only has to confirm it.

## Constructed join URL

```
./?push=<id>&room=<room>&webcam&hiddenrecord&autostart
   &videodevice=<camera>&audiodevice=<mic>[&sink=<speakerDeviceId>]
   &label=<encodeURIComponent(name)>
   [&aec&denoise&autogain]          ← only when "Using headphones?" = No
   &quality=0&darkmode&hidesolo     ← in-room polish, see below
   [&<any other invite-link params, unchanged>]
```

`window.fpmBuildJoinURL()` returns the URL the Join button will use (handy in
DevTools); the page also logs `[join] joining studio: <url>` before navigating.

### `videodevice` / `audiodevice`: deviceId or label? (verified in this codebase)

`main.js:4794` / `main.js:4839` read the params and immediately pass the value
through `normalizeDeviceLabel()` (`lib.js:34373`: `replace(/[\W]+/g, "_")` +
lowercase); the audio value is additionally `split(",")` into an array.
`gotDevices()` then matches:

- video (`lib.js:34584`): label `startsWith` → label `includes` → **exact
  `deviceId ===`** as the fallback when no label matched.
- audio (`lib.js:34508`): `audioDevice.includes(deviceId)` **or**
  `includes(normalizeDeviceLabel(label))` → then label `includes` per entry.

So **both** work, but a deviceId only survives the normalization if it is made of
lowercase word characters. Chrome/Edge deviceIds are 64-char lowercase hex, so
the page sends the **deviceId** there (unambiguous, exact match). Firefox/Safari
ids contain `+ / =` and capitals and would be mangled, so for any id failing
`/^[a-z0-9_]+$/` the page sends the **normalized label** instead (`label.replace(/[\W]+/g,"_").toLowerCase()`),
which matches the app's `startsWith`/`includes` passes. When the browser's
"default" microphone entry is chosen the value is literally `default`, which
`main.js` maps to `session.audioDevice = 1` (system default). Note that any
`videodevice`/`audiodevice` presence also hides the app's own device menus and
its "headphones?" question (`main.js:4826`, `main.js:4868`), which is what we
want since join.html already asked.

`label`: `main.js:3502` does `decodeURIComponent` then `_` → space, then
`sanitizeLabel()`. The page single-encodes with `encodeURIComponent`; a literal
`_` in a name will therefore show as a space in-room (app behaviour).

`sink`: `main.js:6115` sets `session.sink` to the given output deviceId and the
app pre-selects it in its output menu (`lib.js:34834`). Only appended when
`setSinkId` is supported and a non-default speaker was chosen.

Headphones = **Yes** appends nothing: the app then sends no processing
constraints (`lib.js:38610`) and the browser default applies (Chrome's default
is AEC/NS/AGC on). If raw audio for headphone users is wanted later, append
`&aec=0&denoise=0&autogain=0` (or `&proaudio`) in that branch.

### In-room polish params (existing flags only, verified in `main.js`)

| param | why |
| --- | --- |
| `&quality=0` (`main.js:6057`) | In a room the app defaults to `quality_room = 1` (720p, `webrtc.js:1254`). `quality=0` requests 1920×1080 (`lib.js:34995`), matching what the preview chip showed, so "this is how you'll be recorded" is true for the local `&hiddenrecord` file. |
| `&darkmode` (`main.js:4758`) | Dark theme in-room; continuity with the join page. |
| `&hidesolo` (`main.js:2176`) | Hides the "solo link" controls guests never need. |
| `&webcam&autostart` | Skip the VDO chooser and the second "start" click (`main.js:1992`, `main.js:4928`). |
| `&hiddenrecord` | This fork's invisible guest-side recording (section B). |

Considered and left out: `&nosettings` (guests may legitimately need to swap a
mic mid-show), `&easyexit` (removes the leave prompt; risky during a recording),
`&hideheader`/`&hidemenu` (hides the control bar too), `&cleanish` (scene use).

## Test results (2026-10-31, headless Google Chrome 138, fake media)

Static server: `python3 -m http.server 8787 --bind 127.0.0.1` in the checkout.
Chrome: `--headless=new --use-fake-device-for-media-stream
--use-fake-ui-for-media-stream --autoplay-policy=no-user-gesture-required
--remote-debugging-port=9333`. A CDP driver (kept outside the repo, in
`/tmp/fpm-join-test/`) clicked through the page and blocked the final
navigation with `Fetch.failRequest` so the stock app never connected to
signaling.

| check | result |
| --- | --- |
| landing renders, Continue → device screen | pass |
| devices enumerate after permission | cameras=1, mics=3, speakers=3 (fake set) |
| resolution chip | `1080p`, "1920×1080 · 20 fps" (fake cam runs 20 fps) |
| mic meter | 12 samples over 1.8 s: 1.8 %…93.6 %, 11 distinct values, "We can hear you" |
| join disabled until name typed | pass |
| test tone button | "Playing…" then back to "Test tone" after 1.3 s |
| join URL (headphones=No, name `Jane O'Brien & Co`) | `./?push=guest_one&room=fpmshow&webcam&hiddenrecord&autostart&videodevice=<64-hex>&audiodevice=default&label=Jane%20O'Brien%20%26%20Co&aec&denoise&autogain&quality=0&darkmode&hidesolo` |
| join URL (headphones=Yes) | same without `&aec&denoise&autogain` |
| Join click | navigated to `/?push=…` (intercepted) |
| `join.html` without params | "This invite link is incomplete" screen |
| screenshots 1280×820 and 390×844 (mobile emulation) | two-column / single-column layouts as intended |

Not tested: a real Chrome 80 runtime, Firefox/Safari label fallback with real
hardware, real speakers/`setSinkId` routing, and the end-to-end join into a
live room (needs a real director session). Syntax: inline script passes
`node --check`; no `?.`, `??`, `aspect-ratio`, `inset` or newer APIs are used
(16:9 box uses a padding-top fallback). `backdrop-filter` is progressive.

Repo state: `join.html` is fully self-contained; the deployed page needs only
`join.html`. (A concurrent attempt at this feature briefly produced unreferenced
`join.css` / `join.js` files in the checkout; they were removed before commit.)
`fpm-guestbar.*` belong to the in-room control bar work in section C.

### Second verification pass (2026-10-31, independent CDP harness)

A second headless run (Google Chrome 138, same fake-media flags, harness kept
outside the repo) re-checked the committed page after the passthrough / name
prefill / deviceId-regex follow-up: landing copy, Continue → device screen,
`cameras=1 mics=3 speakers=3`, preview `videoWidth` 1920×1080 with chip
`1080p`, CSS mirror transform, meter width changing over 10 samples
(0 → 94 %), test tone click without exceptions, no horizontal overflow at
1366×860 or 390×844, Join navigation intercepted via `Fetch.fulfillRequest`.
Constructed URL for link `join.html?id=TESTGUEST&room=fpmshow&name=Test_Guest&extra=1&flag`:

```
./?push=TESTGUEST&room=fpmshow&webcam&hiddenrecord&autostart
  &videodevice=<64-hex>&audiodevice=default&label=Test%20Guest
  &aec&denoise&autogain&quality=0&darkmode&hidesolo&extra=1&flag
```

With "Using headphones?" = Yes the same URL is produced without
`&aec&denoise&autogain`. `name`, `id` and `room` are not forwarded as-is;
`extra=1` and the bare `flag` are.

---

# B. Hidden guest-side recording (`&hiddenrecord`)

Branch: `fpm-hidden-record`. Scope: FULLPORTMATT guest/push pages only.

## 1. Findings (exploration before any code change)

### Guest-side recording pipeline

- Director clicks the guest's record / Google Drive record button. On the
  director side this is `requestVideoRecord()` (`lib.js:49919`) or
  `requestGoogleDriveRecord()` (`lib.js:49595`). The Drive variant first opens a
  resumable upload session on the director's own Drive
  (`session.gdrive.startResumableUpload(filename)`) and sends the resulting
  session URI in `msg.googleDriveRecord` together with `msg.requestVideoRecord`.
- The guest receives the command over the data channel in `webrtc.js:14103`
  (`"requestVideoRecord" in msg`). If `msg.googleDriveRecord` is set it stores
  `session.gdrive = { sessionUri: ... }`, then calls
  `recordLocalVideo("start", bitrate, false, msg.altUUID || false)`.
  `webrtc.js` is NOT modified by this work (hosted-infrastructure rule in
  `AGENTS.md`); everything lives in `lib.js` + `main.js`.
- `recordLocalVideo()` (`lib.js:61315`) is the single guest-side recorder:
  - Creates a `MediaRecorder` on `session.videoElement.srcObject` (VP8/VP9/H264
    webm, or mp4 on Apple) with `start(1000)` → one `dataavailable` Blob per
    second.
  - `handleDataAvailable()` (`lib.js:61845`): writes the Blob into
    `recorder.writer` (a `TransformStream` that converts Blob → `Uint8Array`),
    then reports progress to directors (`msg.recorder = seconds`), then forwards
    the same Blob to Dropbox (`video.dropbox[filename](blob)`) and Google Drive
    (`video.gdrive[filename].addChunk(blob)`).
  - `recorder.setupWriter()` (`lib.js:61910`): the readable side of the
    TransformStream is piped into a `WritableStream` whose first `write` lazily
    calls **`streamSaver.createWriteStream(partName, recorder.stop)`**
    (`thirdparty/StreamSaver.js`). StreamSaver registers a service worker /
    mitm iframe and streams the bytes as a browser download → this is what
    puts the `.webm` into the guest's Downloads folder. No
    `showSaveFilePicker` / File System Access API is used anywhere for this
    path; the only `createObjectURL` download anchors are in `recordVideo()`
    (director-side recording of remote streams, `lib.js:60252`) and the WAV /
    session-log helpers. Neither is the guest path.
  - Split recordings (`session.recordingInterval`) rotate the writer; with a
    cloud uploader attached (`recorder.continuation`) only the local file is
    rotated (`name.webm`, `name.webm_1`, ...), the cloud upload stays one
    continuous container.
  - Stop path (`video.recorder.stop`, `lib.js:61466`): drains the writer, then
    calls `video.gdrive[filename].addChunk(false)` to finalize the Drive upload,
    sends `msg.recorder = -1/-2/-4` to directors, and deletes `video.recorder`.
    On guest-visible failure (`notify`) it calls `warnUser(...)` unless
    `session.cleanOutput`.
- The guest's own `recordLocalbutton` is only un-hidden when the guest itself
  uses `&record` (`session.recordLocal !== false`, `lib.js:26743` etc.). A
  director-triggered recording on a plain guest URL therefore shows no button;
  the state writes to that element are harmless.

### Google Drive uploader (guest side)

- `setupGoogleDriveUploader(filename, sessionUri)` (`lib.js:58914`). When a
  `sessionUri` is supplied (the director's resumable session), no Google sign-in
  is needed on the guest; it just `PUT`s to the URI.
- `gdrive.addChunk(blob)` accumulates Blobs and `uploadLoop()` uploads in
  256 KiB-aligned pieces **during** the recording. `addChunk(false)` marks
  finalization; `finalizeUpload()` sends the last piece with a known total
  length and stores the Drive `result` in `uploadResult`.
- `gdrive.finalize()` returns a `completionPromise` that resolves with the
  Drive file metadata when the upload is complete and rejects on
  `failUpload()`. If not yet finalized, it calls `addChunk(false)` itself. This
  is the natural hook for "delete the local buffer after upload completes".
- Progress UI: `updateProgressBar()` writes to `#progressBar` and
  `addChunk` un-hides `#progressContainer` unless `session.cleanOutput`. It also
  sends `msg.gdrive = {up, rec, state}` to directors (unchanged).

### URL parameter parsing

- `main.js` parses `urlParams` (e.g. `&record` at `main.js:2520`,
  `&cleanoutput` at `main.js:562`) and sets `session.*` flags. Session defaults
  live in `webrtc.js` (`session.recordLocal = false` at `webrtc.js:1465`), so
  a new flag must simply be falsy when absent (`session.hiddenRecord`
  undefined → no behaviour change).
- Script order in `index.html`: `webrtc.js` → `lib.js` → `main.js`, so helpers
  defined in `lib.js` are callable from `main.js` param parsing.

### Storage choice: IndexedDB, not OPFS `createWritable`

Chrome's OPFS `FileSystemWritableFileStream` (`createWritable()`) writes to a
temporary swap file and only commits on `close()`. A tab crash or early close
mid-recording discards everything, which defeats the recovery requirement.
`FileSystemSyncAccessHandle` is durable but worker-only (Chrome 102+) and would
need a new worker file and message protocol. IndexedDB with one `readwrite`
transaction per 1 s chunk gives committed-per-chunk durability on the main
thread with a small amount of code, and Chrome stores Blob values on disk (not
in memory), so a multi-GB recording is fine and recovery can re-assemble it as
`new Blob([...blobs])` without loading it into RAM. IndexedDB is therefore
used; the spec explicitly allows "OPFS or IndexedDB".

## 2. Design (what changed)

Files touched: `main.js`, `lib.js`, `NOTES.md`. The manual test page
`test/hiddenrecord-test.html` exists on disk but is **git-ignored** by the
repository's `**/test/` rule (release-repo policy in `AGENTS.md`), so it is not
committed; its full contents are reproduced in section 5 below.

- `main.js`: `&hiddenrecord` → `session.hiddenRecord = true`, then
  `hiddenRecordCheckLeftovers()` (logs leftovers, installs console helpers).
- `lib.js`:
  - New helpers placed just before `recordLocalVideo()`:
    `hiddenRecordOpenDB()`, `hiddenRecordCreateWriteStream(name)`,
    `hiddenRecordRead(prefix, onEntry, mode)`, `hiddenRecordDiscard(prefix)`,
    `hiddenRecordList()`, `hiddenRecordDownload(name)` and
    `hiddenRecordCheckLeftovers()`. The latter is only called when the param
    is present; it installs the console entry points
    `window.fpmRecoverRecordings(discardAfter)` and
    `window.fpmDiscardRecordings(name)` and logs any leftovers. Without the
    param no new `window` globals exist.
    IndexedDB database `fpmHiddenRecordings`, store `chunks`
    (`{ rec, seq, data: Blob }`, autoIncrement key, index `rec`).
  - `recorder.setupWriter()`: when `session.hiddenRecord`, the lazily-created
    output writer is `hiddenRecordCreateWriteStream(partName).getWriter()`
    instead of `streamSaver.createWriteStream(...)`. Everything upstream (the
    TransformStream, the Drive/Dropbox `addChunk` calls, split rotation) is
    untouched, so Drive chunks still upload during recording exactly as before.
  - Stop path: when `session.hiddenRecord` and a Drive uploader exists, call
    `gdrive.finalize()` (which performs the same `addChunk(false)`) and on
    resolution `hiddenRecordDiscard(filename)`; on rejection keep the buffer
    and log. Without a Drive uploader the buffer is simply kept (recoverable).
  - Guest-visible noise suppressed only when `session.hiddenRecord`:
    `#progressContainer` is not un-hidden, and the two `warnUser` calls in the
    stop path are skipped. Director-facing messages are unchanged.

Param absent ⇒ every new branch is skipped; no other lines change behaviour.

## 3. Manual test plan

No cameras are needed for the storage layer; a real guest/director pair is
needed for the end-to-end Drive check.

### A. Storage layer only (no camera, no signaling)

1. Serve the checkout: `python -m http.server 8080 --bind 127.0.0.1`
   (any port; on this machine 8080 was already in use so 8765 was used).
2. Open `http://localhost:8080/test/hiddenrecord-test.html`.
   The page loads `webrtc.js` + `lib.js` (not `main.js`, so no signaling
   connection is made) and drives the **real** `recordLocalVideo()` with a
   synthetic `MediaStream` from a `<canvas>` + oscillator, so no camera/mic
   permission is needed. `session.hiddenRecord` is set by the page.
3. Click **Record 5 s (no Drive)**. Expect: no download, no save dialog.
   DevTools → Application → Storage → IndexedDB → `fpmHiddenRecordings` →
   `chunks` shows ~5 rows with `rec = test_<timestamp>.webm`.
4. **Record 5 s + stub Drive (completes)**: a stubbed uploader resolves
   `finalize()`; after stop the `chunks` store is empty again and the console
   shows `hiddenrecord: Drive upload complete, discarding local buffer ...`.
5. **Record 5 s + stub Drive (fails)**: the stub rejects; the buffer stays.
   Reload the page: console shows `hiddenrecord: 1 leftover recording(s)
   found ...` plus a `console.table`.
6. **Recover** (calls `fpmRecoverRecordings()`): one `.webm` downloads and
   plays (VP8/Opus). Buffer is kept. **Discard all** empties the store.
7. Headless equivalent (what was actually run, see results below):

   ```sh
   for s in record check drive drivefail check; do
     timeout 20 google-chrome --headless=new --no-sandbox --disable-gpu \
       --user-data-dir=/tmp/hr-profile --enable-logging=stderr --v=0 \
       --autoplay-policy=no-user-gesture-required \
       "http://127.0.0.1:8765/test/hiddenrecord-test.html?auto=$s" > /tmp/hr-$s.log 2>&1
     grep -E "HRTEST|hiddenrecord" /tmp/hr-$s.log
   done
   ```

   (`--user-data-dir` persists IndexedDB between runs so the `check` run sees
   the previous run's leftovers; the `timeout` is what ends each run.)

#### Results (2026-10-31, Google Chrome stable on this machine, headless)

| scenario | result |
| --- | --- |
| `record` (real `recordLocalVideo`, no Drive) | 4 chunks / 138 232 bytes stored in `chunks`; `streamSaver` never referenced (it is not even loaded on the test page) |
| `check` after a crash-like end | leftover detected at load, `fpmRecoverRecordings()` downloaded it; `ffprobe` reports `matroska,webm`, streams `vp8` + `opus`; `fpmDiscardRecordings()` emptied the store |
| `drive` (stub uploader resolves) | `finalize()` called once, console `Drive upload complete, discarding local buffer`, store empty afterwards |
| `drivefail` (stub uploader rejects) | buffer kept (4 chunks / 136 291 bytes); next load reported 1 leftover |

### B. Real guest + director (Drive)

1. Guest: open `https://<host>/?push=TESTGUEST&room=TESTROOM&hiddenrecord`
   (Chrome desktop). Console should print `hiddenrecord: no leftover
   recordings` (or list leftovers).
2. Director: `https://<host>/?director=TESTROOM`, sign in to Drive when
   prompted, click the guest's **Google Drive** record button, choose a
   bitrate.
3. On the guest while recording, verify:
   - Chrome's download shelf/bubble shows nothing and nothing appears in
     `~/Downloads`.
   - No Drive progress bar is visible at the bottom of the guest page.
   - DevTools → Application → IndexedDB → `fpmHiddenRecordings/chunks` row
     count grows by ~1 per second.
   - Director UI still shows the recording timer and Drive upload progress.
4. Director stops the recording. On the guest console expect
   `hiddenrecord: Drive upload complete, discarding local buffer <name>`;
   the `chunks` store becomes empty. The file appears in the director's Drive
   (`recordings` folder, name `<label>_<streamID>_<timestamp>.webm`).
5. Crash test: start a Drive recording again, then close the guest tab (or
   kill the renderer via `chrome://crash`) mid-recording. Re-open the same
   guest URL with `&hiddenrecord`. Console lists the leftover recording. Run
   `fpmRecoverRecordings()` in the console → the partial `.webm` downloads
   (playable, truncated at the last committed second). Run
   `fpmDiscardRecordings()` to clear.
6. Control: repeat step 2–4 with a guest URL **without** `&hiddenrecord` →
   the `.webm` still lands in Downloads and the progress bar shows, as before.

### C. Syntax validation (run)

- `node --check main.js` and `node --check lib.js` both pass.
- `node .github/ci-validateTranslations.js` → "Translation validation passed."
  `node .github/ci-checkTranslationKeys.js` → no new missing keys.
- Line endings: both files are mixed CRLF/LF; edits were applied in binary
  mode so the diff is only the intended hunks (`git diff --stat`: lib.js
  +204/-6ish, main.js +6).
- New code uses `var`, plain functions, promises; no `?.`, `??`, class fields
  or newer syntax, so Chromium-75 parse safety is preserved. IndexedDB +
  Blob storage is available in Chrome 80; the feature itself is opt-in.
- Not tested in an actual Chrome 80 runtime.

## 4. Open questions / caveats

- When `&hiddenrecord` is set but the director uses the plain (non-Drive)
  record button, the recording goes only to IndexedDB and is never uploaded;
  it stays as a "leftover" until `fpmRecoverRecordings()` /
  `fpmDiscardRecordings()`. Intended? (Nothing else is user-visible.)
- Dropbox (`session.dbx`) is untouched and still works alongside; its
  completion does not trigger discard (only Drive does, per spec).
- Not verified end-to-end with a real director + Google Drive (needs two
  browsers, a room and Drive sign-in). The Drive uploader code itself is
  unchanged; only the stop-path call changed from `addChunk(false)` to
  `finalize()`, which internally performs the same `addChunk(false)`.
- `test/hiddenrecord-test.html` is git-ignored by repo policy; keep a copy
  outside the repo if it is needed later (contents in section 5).
- IndexedDB quota: Chrome allows a large share of free disk per origin, but a
  full disk will reject a write; the existing error path then stops the
  recording and notifies the director (`msg.recorder = -2`).

## 5. Test page source (`test/hiddenrecord-test.html`, git-ignored)

```html
<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8" />
	<title>&amp;hiddenrecord storage test</title>
	<style>
		body { font-family: sans-serif; margin: 20px; }
		button { margin: 4px; }
		pre { background: #eee; padding: 8px; min-height: 120px; white-space: pre-wrap; }
	</style>
</head>
<body>
	<h2>&amp;hiddenrecord storage test (no camera needed)</h2>
	<p>
		Loads <code>webrtc.js</code> + <code>lib.js</code> (no <code>main.js</code>, so no signaling connection) and drives the real
		<code>recordLocalVideo()</code> with a synthetic canvas + oscillator stream while <code>session.hiddenRecord</code> is set.
		Verify in DevTools &gt; Application &gt; IndexedDB &gt; <code>fpmHiddenRecordings</code> &gt; <code>chunks</code>.
		Query string <code>?auto=record|drive|drivefail|check</code> runs a scenario and logs <code>HRTEST</code> lines.
	</p>
	<div>
		<button onclick="runRecord(5)">Record 5 s (no Drive)</button>
		<button onclick="runRecord(5, 'ok')">Record 5 s + stub Drive (completes, buffer discarded)</button>
		<button onclick="runRecord(5, 'fail')">Record 5 s + stub Drive (fails, buffer kept)</button>
		<button onclick="runList()">List</button>
		<button onclick="fpmRecoverRecordings().then(function (l) { report('recover done: ' + l.length + ' file(s)'); })">Recover (download leftovers)</button>
		<button onclick="fpmDiscardRecordings().then(runList)">Discard all</button>
	</div>
	<video id="testvideo" width="320" height="180" muted autoplay playsinline></video>
	<canvas id="testcanvas" width="320" height="180" style="display:none"></canvas>
	<pre id="out"></pre>

	<script type="text/javascript" src="../webrtc.js"></script>
	<script type="text/javascript" src="../lib.js"></script>
	<script type="text/javascript">
		function report(msg) {
			console.log("HRTEST " + msg);
			document.getElementById("out").textContent += msg + "\n";
		}

		session.hiddenRecord = true;
		session.cleanOutput = true;
		session.directorList = [];
		session.directorUUID = false;
		session.label = "test";
		session.streamID = "hiddenrecordtest";
		session.recordingInterval = false;

		var canvas = document.getElementById("testcanvas");
		var ctx = canvas.getContext("2d");
		var frame = 0;
		setInterval(function () {
			frame++;
			ctx.fillStyle = "hsl(" + (frame % 360) + ",80%,50%)";
			ctx.fillRect(0, 0, canvas.width, canvas.height);
			ctx.fillStyle = "#fff";
			ctx.font = "40px sans-serif";
			ctx.fillText(String(frame), 20, 100);
		}, 40);

		var stream = canvas.captureStream(25);
		try {
			var actx = new (window.AudioContext || window.webkitAudioContext)();
			var osc = actx.createOscillator();
			var dest = actx.createMediaStreamDestination();
			osc.connect(dest);
			osc.start();
			stream.addTrack(dest.stream.getAudioTracks()[0]);
			actx.resume();
		} catch (e) {
			report("no audio track: " + e);
		}
		var video = document.getElementById("testvideo");
		video.srcObject = stream;
		session.videoElement = video;

		// Stub the Drive uploader so the stop path's finalize()/discard logic runs without network.
		var realSetupGoogleDriveUploader = setupGoogleDriveUploader;
		function stubDrive(mode) {
			setupGoogleDriveUploader = function (filename, sessionUri) {
				var uploaded = 0;
				var finalized = false;
				report("stub drive uploader created for " + filename + " (" + sessionUri + ")");
				return {
					addChunk: function (chunk) {
						if (chunk === false) {
							finalized = true;
						} else {
							uploaded += chunk.size;
						}
					},
					finalize: function () {
						if (!finalized) {
							finalized = true;
						}
						report("stub drive finalize called, uploaded " + uploaded + " bytes, mode=" + mode);
						if (mode === "ok") {
							return Promise.resolve({ id: "stub-file-id" });
						}
						return Promise.reject(new Error("stub upload failure"));
					}
				};
			};
			session.gdrive = { sessionUri: "https://stub.invalid/upload" };
		}

		function runList() {
			return hiddenRecordList().then(function (list) {
				report("list: " + list.length + " recording(s) " + JSON.stringify(list));
				return list;
			});
		}

		function runRecord(seconds, driveMode) {
			setupGoogleDriveUploader = realSetupGoogleDriveUploader;
			session.gdrive = false;
			if (driveMode) {
				stubDrive(driveMode);
			}
			report("starting recording for " + seconds + "s" + (driveMode ? " with stub drive (" + driveMode + ")" : ""));
			return recordLocalVideo("start", 500).then(function () {
				report("recording state: " + (video.recording ? "recording" : "NOT recording"));
				return new Promise(function (resolve) {
					setTimeout(resolve, seconds * 1000);
				});
			}).then(function () {
				return recordLocalVideo("stop");
			}).then(function () {
				return new Promise(function (resolve) {
					setTimeout(resolve, 1500);
				});
			}).then(function () {
				report("stopped; streamSaver defined: " + (typeof streamSaver !== "undefined"));
				return runList();
			});
		}

		var auto = new URLSearchParams(location.search).get("auto");
		if (auto) {
			var chain = hiddenRecordCheckLeftovers().then(runList);
			if (auto === "record") {
				chain = chain.then(function () { return runRecord(4); });
			} else if (auto === "drive") {
				chain = chain.then(function () { return runRecord(4, "ok"); });
			} else if (auto === "drivefail") {
				chain = chain.then(function () { return runRecord(4, "fail"); });
			} else if (auto === "check") {
				chain = chain.then(function () {
					return fpmRecoverRecordings();
				}).then(function (list) {
					report("recovered " + list.length + " recording(s)");
					return fpmDiscardRecordings();
				}).then(runList);
			}
			chain.then(function () {
				report("DONE");
			}).catch(function (e) {
				report("FAILED " + e);
			});
		} else {
			hiddenRecordCheckLeftovers();
		}
	</script>
</body>
</html>
```

---

# C. Guest control bar polish (`fpm-guestbar.css`, `fpm-guestbar.js`)

Branch: `deploy`. Scope: the bottom control bar guests see in the room page
(`index.html`). Director and OBS/scene views are untouched.

## What changed

Files: `fpm-guestbar.css` (new), `fpm-guestbar.js` (new), `index.html` (two
include lines: the stylesheet after `main.css`, the script after `main.js`).
`lib.js`, `main.js`, `webrtc.js` and `main.css` are **not** modified.

- **Scoping.** `fpm-guestbar.js` reads the URL once. If any of `director`,
  `dir`, `scene`, `scn`, `cleanoutput`, `clean` or `cleanviewer` is present it
  returns immediately and nothing changes. Otherwise it adds `fpm-guest` to
  `<body>`; every rule in `fpm-guestbar.css` is prefixed with `body.fpm-guest`,
  so the stock bar is what the director and every OBS scene link still get.
- **Markup is unchanged.** The existing `#controlButtons > .controlPositioning >
  #subControlButtons > div.float` buttons are restyled: dark `#0a161e` glass
  bar with a gold `rgba(201,161,95)` hairline, icon-over-label buttons, gold
  uppercase labels. Labels and tooltips are CSS pseudo-elements driven by two
  data attributes the script sets (`data-fpm-label`, `data-fpm-tip`), so no DOM
  nodes are inserted and the code in `lib.js` that does `className = "float"`
  or toggles `hidden` keeps working.
- **Labels.** Audio (`#mutebutton`), Video (`#mutevideobutton`), Leave
  (`#hangupbutton`), Share (`#screensharebutton` and the 2/3 variants), Chat,
  Speaker, Settings, Files, Website, Raise hand, Fullscreen, Pop out, Flip,
  Record, Queue, Black out, Monitor. `&webcam` guests do not get the Share
  button (`session.screensharebutton = false`, `main.js:1993`); it is styled
  for links that do show it.
- **State-aware tooltips.** The script derives the tooltip from the state the
  core code already writes: `toggleMute()` adds/removes the `red` class on
  `#mutebutton` (`lib.js:20524`), `toggleVideoMute()` does the same on
  `#mutevideobutton` (`lib.js:21717`), `toggleSpeakerMute()` on
  `#mutespeakerbutton`.
  - Audio: **"Mute mic"** while live, **"Unmute mic"** while muted.
  - Video: **"Turn off camera"** while live, **"Turn on camera"** while off.
  - Speaker: "Mute speaker" / "Unmute speaker". Leave: "Leave the studio".
  - Raise hand follows `data-raised`. Other buttons fall back to their stock
    `title` text minus the keyboard-shortcut suffix.
  A `MutationObserver` on `#subControlButtons` (attributes `class`, `title`,
  `aria-label`, `data-raised`; plus `childList`) re-applies after every toggle,
  after the translation pass re-writes titles (`lib.js:10667`), and after
  `translateAccessibleLabels()` resets `aria-label`. Each write is guarded by an
  equality check so the observer cannot loop.
- **Native vs custom tooltip.** The custom tooltip replaces the browser's
  `title` bubble, so the script blanks `title` on the buttons it manages
  (keeping the original in `data-fpm-orig-title`) and writes the same text to
  `aria-label`. The translation code skips elements whose `title` is empty.
  Tooltips also show on `:focus-visible` for keyboard users and are hidden
  under `@media (hover: none)` (touch devices).
- **Leave** is tinted red at rest (`rgba(168,40,40,.9)`, brighter on hover).
  Muted/camera-off keep the stock `red` class, re-toned to `#7d1d1d`.
- **Responsive.** Below 640 px the buttons shrink and labels drop to 9 px.
- **Language.** Labels/tooltips are English strings in `fpm-guestbar.js`; this
  is a fork-only guest skin, so they are not routed through the translation
  catalog (the stock titles remain available in `data-fpm-orig-title`).

## Test results (2026-10-31, headless Google Chrome, fake media)

Static server in the checkout, Chrome `--headless=new
--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`, driven over
CDP from `/tmp` (nothing added to the repo). Room name randomised per run; the
stock `webrtc.js` connected to the configured signaling as a normal guest.

| check | result |
| --- | --- |
| `./?push=…&room=…&webcam&hiddenrecord&autostart&videodevice=…&audiodevice=…&label=…&aec&denoise&autogain` loads, publishes | pass; `body.className` = `main fpm-guest ltr`; no `Runtime.exceptionThrown` |
| bar visible with labels | Files, Chat, Speaker, Audio, Video, Website, Settings, Leave (Leave red) |
| tooltips before toggle | Audio "Mute mic", Video "Turn off camera", Leave "Leave the studio" |
| after `toggleMute(); toggleVideoMute();` | both buttons `red`; tooltips "Unmute mic" / "Turn on camera"; `aria-label` matches |
| hover (`Input.dispatchMouseEvent`) | `::before` content "Unmute mic", opacity 1 |
| `./?director=…` | body `main ltr`, no `data-fpm-label` on `#mutebutton` (stock bar) |
| `./?scene&room=…&cleanoutput` | body `main ltr` (stock) |
| translation CI | `ci-validateTranslations.js` and `ci-checkTranslationKeys.js` pass |

Note for headless testing: new-headless Chrome matches `(hover: none)`, so the
tooltip rule is `display: none` there; the rendering was verified by forcing
`display: block` for the screenshot only. Not tested: a real Chrome 80 runtime
(the script uses only `URLSearchParams`, `classList`, `MutationObserver`,
`Object.keys`; no `?.`/`??`), Firefox/Safari, and a live director session
toggling a guest remotely (that path also ends in the same `red` class).

---

# D. Mic-only guests and minimal `?g=N` links

Branch: `deploy`. Files: `join.html`, one inline `<script>` in `index.html`.

## Canonical guest links

```
https://matt-leftcurve.github.io/studio/?g=1     → seat 1, push G5EgnZp, room fpmshow
https://matt-leftcurve.github.io/studio/?g=2     → seat 2, push G2FpmQx, room fpmshow
```

The seat map lives in the second inline `<script>` of `index.html` (right after
the IE check, before anything else loads). If `location.search` matches
`^\?g=\d+$` the page does `location.replace("./join.html?room=fpmshow&seat=N&id=<push>")`;
an unknown seat number still lands on `join.html` (no `id`), which shows its
"This invite link is incomplete" screen. Any other query string falls through
to the stock app untouched. `join.html` keeps accepting explicit
`?id=…&room=…` links and now also ignores `seat`/`g` when forwarding params.
The quality / hiddenrecord / hold defaults are added by `join.html`, so the
redirect URL stays minimal.

## Mic-only joins

- Landing: **Continue** (camera + mic) plus an always-visible ghost button
  **Join with microphone only** that calls `getUserMedia({ audio })` only.
- Automatic fallback: if the camera+mic request fails for a camera reason
  (`NotAllowedError`, `NotFoundError`, `NotReadableError`, anything else after
  the 1080p retry) the page immediately retries with `{ audio }` and, if that
  works, continues in mic-only mode with a friendly in-panel note ("Your camera
  is blocked, so we're bringing you in with audio only." / "No camera found…" /
  "Another app has your camera…"). The blocked screen only appears when the
  **microphone** itself is unavailable, with mic-specific copy.
- Mic-only state: the preview stage shows a branded audio placeholder (gold mic
  disc with two rings that scale with the live RMS level, "You're on mic",
  "We can hear you loud and clear" while speaking); the chip reads **audio ·
  your voice is what we'll record**; the camera select is replaced by
  "Off · joining with microphone only" + **Use my camera instead**, which adds
  a video track to the live stream and flips back to camera mode (a denied
  retry stays in audio-only with a calm note; no blocked screen).
- Join URL in mic-only mode carries `&videodevice=0` instead of a camera id.
  `main.js:4794` maps `videodevice=0` to `session.videoDevice = 0`, and with
  `&webcam&autostart` `lib.js:55616` calls `publishWebcam()` straight away with
  `constraint.video = false` (`lib.js:56167`): an audio-only push. `&quality=0`
  is still appended (harmless without video). No `audiobitrate` is added
  anywhere; the OBS view links keep using `opusbitrate`.

## `&hold` from the join flow (see section E)

Every URL built by `join.html` now ends with `&hold` unless the invite link
carries `&nohold` (handy for testing; not forwarded).

---

# E. Waiting room (`&hold`)

Files: `fpm-hold.css`, `fpm-hold.js` (new, self-contained), two include lines
in `index.html`. `lib.js` / `main.js` / `webrtc.js` untouched for this item.

## How hold works in this codebase (verified)

- `&hold` (alias `&queue3`, `main.js:7174`) sets `session.queue = true`,
  `session.queueType = 3`: full isolation. The guest's camera/mic are captured
  and the connection to the director exists, but publishing to peers is
  deferred (`needsPublishing`), the guest sees nobody and the director gets
  only the guest's control box with its label.
- After the local publish `session.postPublish()` (`lib.js:45065`) calls
  `youreWaitingToBeActivated()` → `warnUser(getTranslation("you-not-yet-activated"), false, false, 123)`:
  a stock `#alertModal[data-modalID="123"]` + `#modalBackdrop`.
- **Director control: the "Activate Guest" button** in the guest's control box
  (`data-action-type="remove-queue"`, class `removeFromQueue`, `+` icon,
  `lib.js:33298`). It is un-hidden only while the guest is queued/held. Clicking
  it runs `remoteRemoveQueue()` → `session.directMigrateIssue(room, {justResetting:true}, UUID)`.
  On the guest, `webrtc.js:8178` treats that as a hold reset (`session.queue = false`),
  then `youveBeenActivated()` closes modal 123, publishes to every deferred
  peer and shows the stock "The director has now allowed you to see others in
  the room" chat overlay. Verified headless (director tab + held guest tab):
  the button appears, clicking it releases the guest.

## What the overlay does

`fpm-hold.js` only runs when the URL has `hold`/`queue3`/`holdwithvideo`/`queue4`
and none of the director/scene/clean params. It watches `<body>` for the
stock modal 123 (MutationObserver, childList). When it appears the script
adds `fpm-holding` to `<body>` (CSS hides the stock modal and its backdrop)
and shows `#fpmHold`: full-screen FULLPORTMATT state, wordmark, three pulsing
gold rings around a breathing disc, "Green room — You're *all set* — Matt will
bring you in shortly — Your camera and microphone are connected. Nobody can
see or hear you yet — you'll know the moment you're on." `z-index: 900`, so
the guest control bar (995) stays usable (mute, settings, leave).
A 400 ms poll removes the overlay as soon as `session.queue` is no longer a
hold state (activation) or the overlay got detached (hangup replaces the
body). The stock chat overlay on activation is left as is.

---

# F. Upload status chip and leave/close hold page (`&hiddenrecord`)

Policy: invisible **file**, visible **status**. Files: `fpm-upload.css`,
`fpm-upload.js` (new, self-contained), include lines in `index.html`, and two
small hooks in `lib.js`.

## `lib.js` changes (surgical, byte-level patch, mixed CRLF/LF preserved)

- New `hiddenRecordUploadStatus(state, uploaded, recorded, finalized)` next to
  the hiddenrecord helpers: dispatches a plain DOM `CustomEvent("fpm-drive-upload")`
  on `document`. Nothing listens unless `fpm-upload.js` is active.
- Inside `setupGoogleDriveUploader`: `failUpload()` fires `"failed"`;
  `updateProgressBar()` fires `"progress"` (every recorded/uploaded chunk, the
  same place that sends `msg.gdrive = {up, rec, state}` to the director button)
  and `"complete"` (state 2, Drive's final response).
- **Bug fix needed for item 5:** `session.hangup()` deletes every `session.*`
  property 1.2 s after hangup (`lib.js` "delete session[i]"). The uploader kept
  running but `updateProgressBar()` read `session.directorList.length` → TypeError
  → caught by `uploadLoop()` → `failUpload()`. So a hidden-record upload that
  outlived the Leave click always failed. `updateProgressBar()` now reads
  `var directors = session.directorList || []` once. Verified: an upload that
  finishes well after teardown completes and the local buffer is discarded.

## Chip (item 4)

Gated on the `hiddenrecord` URL param and no director/scene/clean params.
Appears on the first progress event, top-right (`top: 36px`, under the stock
stats strip): cloud icon with a pulsing arrow + percent (capped at 99 % until
Drive confirms). Hover (desktop) or tap (toggles `.fpm-upload--open`) expands a
card: "Uploading your recording — Please keep this tab open until your
recording is fully uploaded." plus a rough time left computed from the last
30 s of upload rate ("About 2 min left · still recording", "Less than a
minute left", "Finishing up…"). Completion → ✓ **Upload complete**, auto-fades
after 6 s. Failure → amber **Recording saved** ("The upload didn't finish, but
your recording is kept safely on this device and we'll recover it."), fades
after 15 s. A second recording resets the chip. Hidden when nothing is
uploading; the stock `#progressContainer` stays hidden as before.

## Leave / close hold page (item 5)

`hangup()` copies `#hangupTemplate` into `#main`, which is the `<body>` itself,
so the whole page (chip included) is replaced by the stock 👋 + Refresh. A
MutationObserver on `<body>` detects `#hangupContainer` outside the template.
If an upload is still **pending** (progress seen, no complete/failed yet), the
script appends `#fpmUploadHold` (z 1100): "One more moment — Please *keep this
tab open* until the upload is done", progress bar, "43 % uploaded · 256 KB of
594 KB", time left, "Closing this tab now would interrupt the upload."
Completion → ✓ "All done — you can *close this tab* — Thanks for coming on the
show!"; failure → "Your recording is *safe* — you can close this tab" with the
recovery note. Nothing pending → stock behaviour (verified: no hold page, no chip).
`beforeunload`: the script's own listener calls `preventDefault()` and sets
`returnValue` **only while pending** (the stock `confirmUnload` is removed by
`session.hangup()`, so after Leave this is the only guard). Remote hangup by
the director goes through the same `hangup()` and is covered.

---

# G. Screen-share → OBS scene bridge (`bridge.html`)

Self-contained page for a Chrome tab on the Mac mini. It embeds the official,
unmodified app in an iframe and uses only documented IFRAME API events/commands
(`examples/iframeapi.md`): `view-connection`, `remote-screenshare-state`,
`joining-room`/`joined-room-complete`, `getDetailedState`.

```
https://matt-leftcurve.github.io/studio/bridge.html?room=fpmshow&watch=G5EgnZp,G2FpmQx
```

Defaults (all overridable): `obs=ws://127.0.0.1:4455`, `pass=bender-mini-4k`,
`sharescene=Guest - Share`, `sbsscene=Guest - SBS`, `debounce=2000`,
`site=./` (where the app lives), `password=` (room password if any).
Flags: `&test` adds manual trigger buttons, `&dryrun` logs scene switches
instead of sending them, `&noroom` skips the iframe (OBS-only check).
Note: the default OBS password is in the page source of a public repo; it only
reaches the loopback address, but pass `&pass=` and change the default if that
matters.

## Detection (why it listens to what it listens to)

In this codebase a room screen share is **type 3**: the share rides on the
guest's existing connection as a `<UUID>_screen` sub-stream whose stream ID is
`<id>:s` (`webrtc.js:24453`), not a separate room stream. A viewer therefore
has to be connected to the guest's base stream, so the iframe is
`./?room=fpmshow&view=G5EgnZp,G2FpmQx&novideo&noaudio&cleanoutput&nopreview&hidemenu&label=OBS bridge`
(data-only connections; `&view=` is what `main.js:4150` parses, a `:s` suffix
there is folded back to the base id anyway). Signals, all through one
`onShareSignal(baseId, on, source)`:

- `remote-screenshare-state` (value true/false, `streamID` = base id): the
  guest announced its share state over the data channel (`webrtc.js:10633`).
- `view-connection` with a `streamID` ending in `:s`: the `_screen` sub-stream
  connected/disconnected (`webrtc.js:12099`, `:24324`).
- `view-connection` false for the base id: the guest left → share off.
- Every 10 s `getDetailedState` reconciles: a share whose base stream is gone
  is cleared; a `:s` entry present while we think it is idle is picked up.

Only watched ids count. The state is "any watched share live?". Transitions are
debounced 2 s; a flicker inside the window collapses into a single evaluation.
`none → some` sends `SetCurrentProgramScene "Guest - Share"`, `some → none`
sends `"Guest - SBS"`. Nothing is sent at startup (Matt's current scene is left
alone until a share actually changes).

## OBS side

obs-websocket v5 over `ws://127.0.0.1:4455` (Chrome allows `ws://` to loopback
from an https page). Handshake: Hello → sha256/base64 challenge-salt auth →
Identify (`eventSubscriptions: 0`) → Identified, then `GetSceneList` verifies
both scene names exist and shows the current program scene. Reconnect with
backoff (2 s → 30 s); code 4009 is reported as a wrong password. **Never
switches when OBS is unreachable**: the wanted scene is logged as
"NOT switching" and applied once OBS is back (debounced). A missing scene name
is also refused.

## Verified (headless, fake OBS v5 server, synthetic signals)

auth handshake; scene list check; no switch at startup; share → Share after the
debounce; two shares then one → stays; flicker → one switch to SBS; exactly two
SetCurrentProgramScene; unwatched id ignored; events not from the bridge's
iframe ignored; OBS killed → "NOT switching", restart → pending switch
applied; `&dryrun` logs only; wrong password → clear log line, no switching.
**Not** verified: the live room path (needs real guests sharing); see recipe.

## Live-test recipe (bender, on the Mac mini)

1. OBS: Tools → WebSocket Server Settings: enabled, port 4455, password set;
   scenes `Guest - Share` and `Guest - SBS` exist (the Share scene already has a
   "Browser Share" source on `G5EgnZp:s`).
2. Open `https://matt-leftcurve.github.io/studio/bridge.html?room=fpmshow&watch=G5EgnZp,G2FpmQx&dryrun&test`
   in Chrome. The OBS card must read **connected** and the log "OBS scenes OK …
   program is <current>". If it says "rejected the password", add `&pass=`.
3. Join as a guest on another device via `?g=1` (activate from the director if
   held), press the stock screen-share button (or any `&screenshare` link for
   `G5EgnZp`). Within ~2 s the log should show `share appeared: G5EgnZp:s
   (remote-screenshare-state …)` and `DRY RUN: would set program scene to "Guest - Share"`;
   stopping the share logs `share disappeared …` and `… "Guest - SBS"`.
4. Repeat with seat 2; two shares at once must not switch back until both stop.
5. Drop `&dryrun` (keep the tab open on the mini). Switch program away from the
   two scenes, start a share: program must go to Guest - Share; stop → Guest - SBS.
6. Kill-switch check: close OBS while a share is live, stop the share → log says
   NOT switching; reopen OBS → the bridge reconnects and applies SBS.
7. Leave the tab open during the show; the "Shares live" pill and the log are
   the health indicator. A pinned Chrome tab is enough; no extension needed.

---

# H. Test results for sections D–G (2026-10-31, headless Google Chrome 138, fake media)

Static server `python3 -m http.server 47191 --bind 127.0.0.1` in the checkout;
CDP harnesses kept outside the repo (`/tmp/fpm-final-test/`): a mock Drive
resumable endpoint (308/200/500/slow) and a fake obs-websocket v5 server.
Rooms were random (`fpmtest…`) on the stock signaling; no recording was
started on the live room and OBS program was never touched.

| area | checks | result |
| --- | --- | --- |
| `?g=1` / `?g=2` / `?g=9` redirect | `join.html?room=fpmshow&seat=N&id=<push>`; unknown seat → incomplete-link screen | pass |
| mic-only button | audio stage, hidden video, chip "audio", camera row, meter + rings animate, URL has `&videodevice=0`, `&hold`, no camera id, "Use my camera instead" flips back | pass |
| camera denied / mic granted | device screen (no retry wall), friendly note, `&videodevice=0`; camera retry denied stays audio-only; mic denied too → "Microphone access was blocked" | pass |
| camera+mic path | unchanged URL shape, `1080p` chip, `&nohold` respected, passthrough intact, no JS exceptions | pass |
| hold overlay | stock modal 123 present but hidden, overlay opaque, control bar above it, copy present | pass |
| director | "Activate Guest" button visible for the held guest; click → `session.queue=false`, overlay + stock modal gone | pass |
| upload chip | appears during a real `recordLocalVideo` + mock Drive upload, 51 % mid-way, stock progress bar hidden, tap expands card, `beforeunload` guarded, → "Upload complete", guard released, auto-fade, local buffer discarded | pass |
| failure | second recording → chip again → 500 from Drive → "Recording saved" amber, buffer kept, fades | pass |
| leave while uploading | stock 👋 rendered, hold page with bar "43 % uploaded · 256 KB of 594 KB", guard on, completes **after** session teardown → "All done — you can close this tab", guard off | pass |
| control | guest without a pending upload → stock hangup, no hold page, no chip | pass |
| bridge | 18 checks listed in section G | pass |
| CI | `ci-validateTranslations.js`, `ci-checkTranslationKeys.js`, `node --check` on lib.js/main.js/new scripts | pass |

Not tested: real Chrome 80 runtime (new code uses `var`, plain functions,
`URLSearchParams`, `MutationObserver`, `CustomEvent`, `Element.closest`,
`crypto.subtle` in bridge.html only; no `?.`/`??`), real phones, the real
`beforeunload` dialog (checked via a synthetic cancelable event), a real
director Drive session, and the bridge against a live room/OBS.
Two implementation gotchas worth knowing: `requestAnimationFrame` never fires
in a background tab, so the overlays use short timers for their fade-in; and
`#hangupContainer` always exists inside the hidden `#hangupTemplate`, so
"hung up" means that element outside the template.

---

# I. Join-flow polish (2026-10-31, from Matt's phone testing)

Branch: `deploy`. Files: `join.html`, `fpm-guestbar.css`, `fpm-guestbar.js`,
`fpm-veil.css` + `fpm-veil.js` (new), two include lines in `index.html`.
`lib.js`, `main.js`, `webrtc.js` and `main.css` are **not** modified.

## 1. Camera on/off toggle on the device check (`join.html`)

A round button in the bottom-right corner of the preview (`#camToggle`,
camera / camera-with-slash icon). OFF stops and removes the video tracks (the
camera light goes out), sets the same `micOnly` state the "Join with
microphone only" option uses, and so shows the same branded audio-only stage,
mic meter rings, "Off · joining with microphone only" row and `audio` chip;
the join URL gets `&videodevice=0`. ON re-adds a video track: the camera that
was on before (`lastCameraId`), else any front camera, else `video: true`.
Both the toggle and the field-level link ("Turn my camera on") call the same
`enableCamera()`; a blocked camera lands in the same calm note as before.

## 2. Front camera only on phones

`isMobile` = phone/tablet UA (iPadOS counted via `Macintosh` + touch points).
On mobile the camera dropdown is filtered to user-facing devices:
`InputDeviceInfo.getCapabilities().facingMode` when the browser exposes it,
else the label (`front|user|facetime|selfie`; `back|rear|environment` is
rear), else the live track's `getSettings().facingMode`. If nothing identifies
as front the full list is kept. Desktops keep the full list. The first request
asks for `facingMode: "user"` with `ideal` 1920×1080 (never `exact`).

## 3. Cropped front-cam preview

Root cause: a fixed 16:9 box with `object-fit: cover`, so a 1080×1920 portrait
feed was cropped to its middle 30 %. Now `object-fit: contain` on a near-black
background (letterbox). Desktop keeps the 16:9 box; on phones the box follows
the feed via `--stage-ratio` (clamped between 16:9 and 4:5, `max-height: 62vh`)
so the device panel stays reachable. The chip always shows the true captured
size in a separate mono span (`1080×1920 · 30 fps`); on phones the "this is
how you'll be recorded" phrase is dropped so the chip stays one line.

## 4. Guest control bar: exactly five buttons

`fpm-guestbar.css` hides every child of `#subControlButtons` except
`#mutebutton`, `#mutevideobutton`, the screenshare button(s), `#settingsbutton`
and `#hangupbutton` (`display: none !important`); the stock code still toggles
`hidden` on those five. Order is the stock DOM order: AUDIO · VIDEO · SHARE
SCREEN · SETTINGS · LEAVE. `flex-wrap: nowrap` keeps one row; at ≤ 400 px the
buttons shrink so five fit in 320 px.

Share screen: `&webcam` sets `session.screensharebutton = false`
(`main.js:1994`), so `join.html` now appends `&ssb` (the stock URL option,
`main.js:6234`) on desktops — not on phones, where the app disables screen
share (`main.js:4910`) and there is no `getDisplayMedia`. In a room the stock
code shows `#screenshare3button` → `screenshareTypeDecider(3)` →
`createSecondStream()`, which publishes `<id>:s` (what `bridge.html` watches).
The share code toggles the `green` class and the title on that button
(`lib.js:76077`, `76246`); the bar reads it for the tooltip ("Share your
screen" / "Stop sharing") and a teal active state. Live mic stays the
non-red state; muted keeps the dimmed red.

## 5. "Entering the studio…" veil (`fpm-veil.js` / `fpm-veil.css`)

Guest contexts only (same exclusion list as the bar) and only when the URL has
`webcam` + `autostart` (the join.html handoff; the plain landing page and
manual publish pages never see it). Appended to `<body>` as soon as the script
runs, i.e. before the app un-hides the body, so the stock "Waiting for Camera
to Load" / "No Audio" card is never painted. Lifts (0.5 s fade, node removed)
when `#controlButtons` loses `hidden` (set by `publishWebcam` once the room is
joined), when any stock `#alertModal` / `#promptModal` / `#modalBackdrop`
appears (password prompt, permission error, the hold notice), when the body
was replaced by `hangup()`, or after 10 s — then it logs
`[fpm-veil] not in the room after 10 s; showing the stock screen (head3=…
gowebcam="…" controlButtons=…)` so the real state is visible and debuggable.
z-index 890: above the arming screen, below the `&hold` overlay (900) so the
hold screen fades in as the veil fades out, below the control bar (995).

Item 6 (iOS "No Audio" label on the arming screen) was left alone per Matt:
the veil makes that screen invisible and audio is fine once in the room.

## Test results (2026-10-31, headless Google Chrome 138, fake media)

Static server on a free port in the checkout; CDP harness kept outside the
repo (`/tmp/fpm-polish-test/`). Random rooms on the stock signaling.

| check | result |
| --- | --- |
| toggle visible, `aria-pressed` false, "Turn camera off", preview `object-fit: contain`, chip `1080p` + `1920×1080 · 20 fps`, desktop stage 16:9 | pass |
| toggle OFF → `stage--audio`, slash icon, audio placeholder, camera select → off row, chip `audio`, note "Camera off…", URL `&videodevice=0`, meter still animates | pass |
| toggle ON → camera back, chip `1080p`, note cleared, URL has camera id; "Turn my camera on" link does the same; Join with camera off navigates with `videodevice=0` | pass |
| phone emulation (390×844, iPhone UA, mocked Front/Back/Ultra Wide/Telephoto + 1080×1920 canvas feed) | first gUM `facingMode:"user"` + ideal sizes; dropdown = `["Front Camera"]`; chip `1080×1920 · 30 fps`; `--stage-ratio: 125%`, stage 452 px (≤ 62vh), contain; no horizontal overflow; off → 16:9 placeholder, on → portrait again | pass |
| Android UA, camera label without facing info | list kept (`["USB Camera 1"]`) | pass |
| desktop join URL | `…&quality=0&darkmode&hidesolo&ssb&hold`; phone URL has no `&ssb` | pass |
| room (`&webcam&autostart&ssb`) | veil present during arming (fixed, branded copy, `body.fpm-veiling`), lifted "in room" when the bar appeared, node removed | pass |
| bar | visible children exactly `mutebutton, mutevideobutton, screenshare3button, settingsbutton, hangupbutton`; chat/speaker/website/flip/files `display: none`; Leave red; `nowrap`; at 360 px all five on one row (bar 323 px wide) | pass |
| share | click `#screenshare3button` (headless `--auto-select-desktop-capture-source`) → `session.screenShareState === true`, button `green`, tooltip "Stop sharing", teal border; click again → reverted | pass |
| `?director=`, `?scene&cleanoutput`, plain `/` | no veil, no guest bar | pass |
| veil timeout (gUM never resolves) | lifted after 10.8 s with the warning line, stock "Waiting for Camera to Load" visible | pass |
| veil + stock dialog | `warnUser()` lifts it immediately | pass |
| CI | `ci-validateTranslations.js`, `ci-checkTranslationKeys.js`, `node --check` on the new/changed scripts, no `?.`/`??` | pass |

Not tested: a real Chrome 80 runtime (new code uses `var`, plain functions,
CSS custom properties, `Element.closest`, `MutationObserver`; no `?.`/`??`,
`aspect-ratio` or `inset`), a real iPhone/Android (the portrait and facing
logic was exercised with mocked devices), and `InputDeviceInfo.getCapabilities`
on Safari (the label fallback covers it).
