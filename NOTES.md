# FULLPORTMATT guest studio notes

Two fork-specific pieces live here:

1. **Branded guest join flow** (`join.html`) — section A below.
2. **Hidden guest-side recording** (`&hiddenrecord`) — section B below.

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
word characters. Chrome/Edge deviceIds are 64-char hex, so the page sends the
**deviceId** there (unambiguous, exact match). Firefox/Safari ids contain
`+ / =` and would be mangled, so for any id failing `/^\w+$/` the page sends
the **normalized label** instead (`label.replace(/[\W]+/g,"_").toLowerCase()`),
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

Repo state caveat: `join.html` is fully self-contained. Any `join.css`,
`join.js` or `fpm-guestbar.*` files present in the checkout come from a
separate, concurrent attempt at this feature and are **not** referenced by this
`join.html` nor part of this commit; the deployed page needs only `join.html`.

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
