# Evenflow

A full-screen visualizer for Even Realities G2. Three animated patterns span
the complete 576×288 canvas: **Ribbons**, **Orbits**, and **Comet**. The phone
controls playback, detail, motion speed, and an experimental concurrent mode.

Version 0.1.0 builds on Evenbench's controlled hardware measurements: image
calls dominated frame time, unchanged sectors could be retained, and repeated
4px blocks were faster than fine detail. The current renderer combines those
lessons. Its hardware frame rate still needs a device run.

## Install and run

Download `evenflow-0.1.0.ehpk` from the GitHub release, upload it to your Even
Hub **Private builds**, and install it through the Even Realities app. Launch
Evenflow; the visualizer starts immediately. SDK 0.0.14, host app 2.2.9+.

- Tap on the glasses to pause or play; swipe to change pattern.
- Use **Fine / Balanced / Fast** for 2px, 4px, or 8px repeated blocks. The
  physical canvas remains 576×288 at every setting. Larger blocks lose detail.
- **Comet** is useful for the highest local-motion rate: most of the picture
  stays fixed while only the sectors touched by its motion are updated.
- **Send sectors concurrently** submits up to four changed sectors together.
  This is experimental; serial sends are the default supported path.
- Hold on the glasses, or tap **Compare speeds**, for a controlled comparison.
- Double press opens the system exit confirmation.

## Find the fastest usable setting

**Compare speeds** runs the same eight full-screen Ribbons states at 2px,
4px, and 8px, using serial and concurrent sends. It repeats the six profiles
in reverse order: 12 trials, roughly two minutes on a device. Each trial
initializes the panel, starts at the same 100ms pacing floor, and measures only
the subsequent eight states. Interrupted or refused trials are excluded from
the suggested fastest setting. Playback settings are chosen by the wearer.

After choosing a mode/detail setting, tap **Check sectors**. The app sends
one scene with the same two-digit number in all four sectors and holds it.
Look through the glasses, let the image settle, and report whether all four
match. **Show frame numbers** also makes mismatched sectors visible during
motion; the markers themselves change all four sectors and add work.

An SDK `success` is acceptance, not a display receipt. Concurrent calls may
appear successful even if the host misses an update. A static sector match
does not prove simultaneous presentation or absence of tearing during motion;
an optical recording is needed for those measurements. The simulator cannot
validate the BLE path.

**Export** is the only export action. It copies current settings, aggregate
timings, all comparison results and sector observations, and the most recent
600 frame samples, with copy confirmation and a selectable fallback. The
export explicitly counts any older raw samples discarded from this bounded
history; aggregate counters remain. It contains no account or device IDs.

## Renderer behavior

- Four 288×144 containers cover the panel with one input container behind them.
- Scenes use flat Gray4 levels, filled shapes, and repeated pixel blocks.
- Small raw tiles are compared before PNG encoding. Unchanged PNGs and canvas
  objects are reused; physical image sizes remain 288×144.
- Retention tracks only SDK-accepted payloads. A refused replacement invalidates
  that sector so it is retried, even if a later desired image matches an older one.
- Live animation samples elapsed time when the previous frame finishes. There
  is one scene in flight and no queue of old animation frames.
- Serial mode awaits each call and respects the 100ms floor. Concurrent mode
  uses a bounded burst of up to four calls, then awaits **all** of them before
  another frame. It is outside Even's documented serial-image contract.
- A concurrent refusal drains the frame, invalidates retained state, and switches
  live playback to serial sends. Repeated serial failures pause playback.
- Pause, comparison, page rebuild, and exit wait for outstanding image calls.
  A stall watchdog stops future frames without pretending a pending native call
  has completed. A native call that never returns can still prevent a clean drain.
- The headline rate counts complete accepted scene changes, not individual sector
  calls. Its time window includes rendering, encoding, pacing and UI/scheduling gaps.

See [EvenForge's measured image-performance notes](https://github.com/bobbyhiddn/EvenForge/blob/main/docs/even-hub/image-performance.md)
and [Even's image API](https://hub.evenrealities.com/docs/build/display#image-containers).

## Development and verification

Keep this checkout beside `EvenForge`; the toolkit uses a local `file:` dependency.
Node 20 or 22+ and the pinned EvenForge toolchain are required.

```sh
npm install
npm test
npm run build
```

From EvenForge:

```sh
make qa APP=evenflow
make pack APP=evenflow
```

Start Vite on port 5187 for the extended checks:

```sh
npm run dev -- --host 127.0.0.1 --port 5187
uv run --with playwright==1.60.0 python scripts/verify-browser.py
node scripts/verify-simulator.mjs
```

The browser script needs Playwright's Chromium installed. It checks actual PNG
pixels against complete retained panel states, then exercises the UI through
the real SDK with a mock native host: overlapping calls, draining, refusal
fallback, comparisons, export, and resuming after the exit dialog. The simulator
script runs all 12 comparison trials through the real SDK and simulator.
Evidence is recorded in `qa/`; none of these checks reports mock or simulator
timings as hardware performance.
