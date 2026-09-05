# Evenflow 0.1.0 verification

2026-09-05. SDK 0.0.14, simulator 0.9.5, Node 20.19.2.

- TypeScript and the production Vite build passed.
- 11 core tests passed: serial pacing, retained content, overlapping calls,
  cancellation/draining, refusal recovery, isolation of comparison pacing,
  full-panel raster coverage, local movement, seam clearing, and frame markers.
- Chromium / Playwright 1.60.0 verified 36 complete rendered scenes and decoded
  114 PNG tiles. Every retained panel pixel matched the desired image at all
  three detail settings. Unchanged PNGs were reused.
- Browser UI checks used the real SDK with a mock native host. They verified
  four overlapping requests, pause/exit draining, automatic serial fallback
  after an injected refusal, all 12 comparisons, one Export action, recorded
  sector observations, and resuming after a dismissed exit dialog.
- Forge simulator smoke QA passed: seven screenshots, zero console errors.
- The full SDK/simulator comparison passed: 12 distinct trials, 96 measured
  complete scenes, 32 image calls per trial, zero refusals and console errors.
  `simulator-verification.json` records source hashes and counts.
- Desktop/mobile phone screenshots were inspected. `glasses-on-black.png`
  displays the simulator's transparent `compare-glasses.png` on black for
  inspection; it is not a photograph of the glasses.
- Local validated packaging passed. The portal package-ID availability check
  was unavailable because the CLI was not authenticated. No portal upload was
  performed; the package is distributed through the GitHub release.

Artifact: `../EvenForge/dist/evenflow-0.1.0.ehpk`, 50,379 bytes.
SHA-256: `73f1e0ff7abafb4c318bcb95757a3cfb716152b2cbdde446e28bef51650b14e0`.

These checks establish rendering and control behavior, not BLE throughput or
optical frame rate. Concurrent sends remain an experiment. A wearer must
inspect sector completeness and motion; a successful static sector check
does not establish synchronized presentation while the picture changes.
