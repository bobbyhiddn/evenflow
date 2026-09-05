# Evenflow 0.2.0 verification

2026-09-05. SDK 0.0.14, simulator 0.9.5, Node 20.19.2.
Shared toolkit: EvenForge commit `f22800bbf05fb0a554ba6cee8e16de13014d65d1`.

- Production TypeScript/Vite build and validated local packaging passed.
- 38 toolkit tests passed, including BMP decoding, exact fragment reassembly,
  nonzero sessions, withholding all completion bytes, observation gating,
  structured native refusal responses, cancellation, and draining final calls.
- 12 app core tests passed. Ribbons joins were checked through 240 mixtures
  of old/new quadrants across three detail settings and five animation times.
  Existing retention, pacing, overlap, cancellation, and frame markers passed.
- Chromium / Playwright 1.60.0 verified 36 complete retained panel states,
  decoding 114 PNG tiles. It independently decoded 12 actual 4-bit BMP tiles
  with frame markers and compared every pixel against the intended raster.
- Browser UI checks verified Comet's initial speed, Orbits at 0.5x, remembered
  speeds, serial comparison suggestions, four overlapping phone requests,
  refusal recovery, one Export button, and exit/resume behavior.
- With a mock native host, the staged probe stopped at the first unsupported
  field response. In the accepted case, 24 prefix calls left every image one
  byte short; only the wearer-observation step allowed four completion calls.
  All 83,416 BMP bytes were accounted for. Both observations were exported,
  the phone preview advanced on release, cancellation left no completion
  calls, and normal playback rebuilt the page before resuming.
- Forge simulator smoke QA passed: seven screenshots, zero console errors.
- Full SDK/simulator comparisons passed: 12 distinct trials, 96 measured
  complete scenes, 32 calls per trial, zero refusals and console errors.
  `simulator-verification.json` records app and shared fragment-source hashes.
- Desktop/mobile layouts and the staged-observation controls were inspected.
  `glasses-on-black.png` presents the simulator's transparent screenshot on
  black for inspection; it is not a photograph of the glasses.

Artifact: `../EvenForge/dist/evenflow-0.2.0.ehpk`, 52,916 bytes.
SHA-256: `f26ba5a231a01c76275732c7b89ed0f202a362b64d515c8ab958655ee5745664`.

The CLI's remote package-ID availability check was unavailable because it was
not authenticated; local validated packaging succeeded. No Even portal upload
was performed. Installation uses the GitHub release asset and Private builds.

These checks validate software behavior, not current native fragment support,
BLE throughput, or optical synchronization. The firmware staging interpretation
comes from recovered older firmware. The new probe needs wearer/device results.
