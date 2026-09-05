import { CreateStartUpPageContainer, ImageContainerProperty, ImageRawDataUpdate, RebuildPageContainer,
  TextContainerProperty, waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import { listenForInput } from '@evenforge/toolkit'
import { DEFAULTS, SCENES, TILES, type Comparison, type Detail, type RenderSample, type SectorCheck,
  type SendMode, type Settings } from './model'
import { renderScene } from './scenes'
import { TileEncoder } from './encoder'
import { FrameTransport } from './transport'
import { mountPhone, type PhoneState } from './phone'
import app from '../app.json'

const state: PhoneState = { settings: { ...DEFAULTS }, running: null, message: 'Connecting to the glasses…',
  history: [], comparisons: [], checking: null }
const checks: SectorCheck[] = []
const totals = { completedScenes: 0, calls: 0, refused: 0, bytes: 0, measuredMs: 0, discardedSamples: 0 }
const query = new URLSearchParams(location.search)
if (query.get('mode') === 'parallel') state.settings.mode = 'parallel'
let ready = false, active: AbortController | null = null, job: Promise<void> | null = null
let commandBusy = false, exiting = false, frameNumber = 0, signature = '', sceneTime = 0
let needsRebuild = false
let runId = 0
let pendingCheck: { frame: number; settings: Settings } | null = null
const ui = mountPhone({
  toggle: () => command(async () => { if (active) await stop(); else play() }),
  compare: () => command(async () => { await stop(); launch('compare', compare) }),
  check: () => command(async () => { await stop(); launch('check', checkSectors) }),
  report: reportCheck, change,
  session: () => ({ app: 'evenflow', appVersion: app.version, schemaVersion: 1, capturedAt: new Date().toISOString(),
    userAgent: navigator.userAgent, settings: { ...state.settings }, totals: { ...totals },
    measurement: 'Complete scene updates accepted by the SDK; optical refresh is not measured. Concurrent sends are experimental.',
    opticalRefreshMeasured: false, sectorChecks: checks, comparisons: state.comparisons,
    recentFrames: state.history, rawFrameLimit: 600, rawFramesDiscarded: totals.discardedSamples }),
})
ui.preview(renderScene(state.settings.scene, 0, state.settings.detail))

const bridge = await waitForEvenAppBridge()
const encoder = new TileEncoder()
const transport = new FrameTransport(image => bridge.updateImageRawData(new ImageRawDataUpdate(image)))

function containers() {
  return { containerTotalNum: 5,
    textObject: [new TextContainerProperty({ containerID: 1, containerName: 'events', xPosition: 0, yPosition: 0,
      width: 576, height: 288, borderWidth: 0, paddingLength: 0, content: ' ', textColor: 0, isEventCapture: 1, zOrderIndex: 0 })],
    imageObject: TILES.map((tile, index) => new ImageContainerProperty({ containerID: tile.id, containerName: tile.name,
      xPosition: tile.x, yPosition: tile.y, width: 288, height: 144, zOrderIndex: index + 1 })) }
}

function publish() { ui.update(state) }
function command(action: () => Promise<void>) {
  if (!ready || commandBusy || exiting) return
  commandBusy = true
  void action().catch(error => {
    state.message = `Could not complete the action: ${String((error as Error)?.message ?? error)}`
    console.error('[evenflow] action failed', error)
  }).finally(() => { commandBusy = false; publish() })
}

function change(next: Partial<Settings>) {
  if (state.running === 'compare' || state.running === 'check') return
  Object.assign(state.settings, next)
  pendingCheck = null; state.checking = null
  state.message = state.settings.mode === 'parallel'
    ? 'Concurrent sends enabled. Check the sectors on the glasses; acceptance does not confirm display.'
    : 'Serial sends · unchanged sectors stay on the glasses.'
  if (ready) publish()
}

function launch(kind: NonNullable<PhoneState['running']>, run: (signal: AbortSignal) => Promise<void>) {
  if (active || exiting) return
  const controller = new AbortController()
  runId++
  active = controller; state.running = kind; state.checking = null; pendingCheck = null
  publish()
  job = (async () => {
    try {
      if (needsRebuild) {
        const ok = await bridge.rebuildPageContainer(new RebuildPageContainer(containers()))
        if (!ok) throw new Error('The host refused the visualizer page')
        needsRebuild = false; transport.reset(); signature = ''
      }
      if (!controller.signal.aborted) await run(controller.signal)
    } catch (error) {
      if (!controller.signal.aborted) {
        state.message = `Playback stopped: ${String((error as Error)?.message ?? error)}`
        console.error('[evenflow] playback failed', error)
      }
    } finally {
      if (active === controller) { active = null; state.running = null }
      publish()
    }
  })()
}

async function stop() {
  active?.abort()
  if (active) { state.message = 'Stopping after outstanding image calls finish…'; publish() }
  await job
  pendingCheck = null; state.checking = null
  state.message = 'Paused. The last scene stays on the glasses.'
  publish()
}

async function draw(settings: Settings, seconds: number, context: RenderSample['context'], signal?: AbortSignal,
  explicitFrame?: number): Promise<RenderSample> {
  const key = `${settings.scene}:${settings.detail}:${settings.mode}:${settings.markers}`
  if (key !== signature) { transport.reset(); signature = key }
  const began = performance.now(), frame = explicitFrame ?? ++frameNumber
  const raster = renderScene(settings.scene, seconds, settings.detail, settings.markers ? frame : undefined)
  const renderMs = performance.now() - began
  ui.preview(raster)
  const encodedAt = performance.now()
  const images = await encoder.encode(raster)
  const encodeMs = performance.now() - encodedAt
  // Stop future work on a stall, but do not pretend outstanding native calls
  // have drained. Rebuild, retry and exit still wait for their real resolution.
  const watchdog = setTimeout(() => {
    active?.abort()
    state.message = 'The host is taking a long time. Waiting for outstanding image calls; no more frames will be queued.'
    publish()
  }, 8000)
  let sent
  try { sent = await transport.present(images, settings.mode, signal) }
  finally { clearTimeout(watchdog) }
  if (!sent.required && !signal?.aborted) await new Promise(resolve => setTimeout(resolve, 16))
  const endedAtMs = performance.now()
  const sample: RenderSample = { ...sent, frame, scene: settings.scene, detail: settings.detail,
    renderMs, encodeMs, totalMs: endedAtMs - began, startedAtMs: began, endedAtMs, runId, context }
  state.history.push(sample)
  if (state.history.length > 600) { state.history.shift(); totals.discardedSamples++ }
  totals.completedScenes += Number(sent.complete)
  totals.calls += sent.attempted; totals.refused += sent.refused; totals.bytes += sent.bytes; totals.measuredMs += sample.totalMs
  publish()
  return sample
}

function play() {
  state.message = state.settings.mode === 'parallel' ? 'Playing with concurrent sends · experimental.' : 'Playing · only changed sectors are sent.'
  launch('live', async signal => {
    let previous = performance.now(), failures = 0
    while (!signal.aborted) {
      const now = performance.now()
      sceneTime += (now - previous) * state.settings.speed / 1000
      previous = now
      const settings = { ...state.settings }
      const sample = await draw(settings, sceneTime, 'live', signal)
      if (signal.aborted) break
      if (sample.refused) {
        failures++
        if (settings.mode === 'parallel') {
          state.settings.mode = 'serial'; signature = ''
          state.message = 'A concurrent image call failed. Continuing with serial sends and refreshing every sector.'
          console.warn('[evenflow] concurrent refusal; falling back to serial')
        } else if (failures >= 3) {
          state.message = 'The host refused three consecutive scene updates. Playback paused; results are available in Export.'
          break
        }
      } else failures = 0
    }
  })
}

async function compare(signal: AbortSignal) {
  state.comparisons = []
  const profiles = ([2, 4, 8] as Detail[]).flatMap(detail => (['serial', 'parallel'] as SendMode[]).map(mode => ({ detail, mode })))
  for (let pass = 1; pass <= 2; pass++) {
    const order = pass === 1 ? profiles : [...profiles].reverse()
    for (const profile of order) {
      if (signal.aborted) return
      const settings: Settings = { ...DEFAULTS, ...profile, scene: 'ribbons', markers: false }
      state.message = `Comparing ${state.comparisons.length + 1}/12 · ${profile.mode === 'serial' ? 'serial' : 'concurrent'} · ${profile.detail}px · pass ${pass}`
      publish()
      transport.reset({ pacing: true }); signature = ''
      const warm = await draw(settings, -0.4, 'compare', signal)
      const row: Comparison = { ...profile, pass, planned: 8, completed: 0, calls: 0, refused: warm.refused,
        elapsedMs: 0, acceptedFps: 0, valid: false }
      const began = performance.now()
      if (warm.complete) for (let phase = 0; phase < 8; phase++) {
        if (signal.aborted) break
        const sample = await draw(settings, phase * 0.4, 'compare', signal)
        row.completed += Number(sample.complete); row.calls += sample.attempted; row.refused += sample.refused
        if (sample.refused) break
      }
      row.elapsedMs = performance.now() - began
      row.acceptedFps = row.elapsedMs ? row.completed * 1000 / row.elapsedMs : 0
      row.valid = !signal.aborted && warm.complete && row.completed === row.planned && row.refused === 0
      state.comparisons.push(row)
      console.log(`[evenflow] compare ${profile.mode} ${profile.detail}px pass ${pass}: ${row.completed}/8 scenes, ${row.calls} calls, ${row.refused} refusals, valid=${row.valid}`)
      publish()
    }
  }
  const candidates = profiles.flatMap(profile => {
    const rows = state.comparisons.filter(row => row.mode === profile.mode && row.detail === profile.detail && row.valid)
    return rows.length === 2 ? [{ ...profile, rate: rows.reduce((sum, row) => sum + row.acceptedFps, 0) / 2 }] : []
  }).sort((a, b) => b.rate - a.rate)
  const best = candidates[0]
  state.message = best ? `Fastest accepted rate: ${best.mode === 'serial' ? 'serial' : 'concurrent'} / ${best.detail}px at ${best.rate.toFixed(2)} scenes/sec. Select it and Check sectors on the glasses.`
    : 'Comparison finished without a complete pair of passes. Export contains the failed and partial results.'
  console.log('[evenflow] comparison complete')
}

async function checkSectors(signal: AbortSignal) {
  const settings = { ...state.settings, markers: true }, frame = ++frameNumber
  state.message = 'Sending one numbered scene, then holding it for inspection…'; publish()
  transport.reset(); signature = ''
  const result = await draw(settings, sceneTime, 'check', signal, frame)
  if (signal.aborted) return
  if (!result.complete) { state.message = 'The host refused part of the check. Select serial sends and try again.'; return }
  pendingCheck = { frame, settings }; state.checking = frame
  state.message = 'Scene held. Check that the same number appears in all four sectors, then report below.'
}

function reportCheck(matches: boolean) {
  if (!pendingCheck) return
  checks.push({ at: new Date().toISOString(), mode: pendingCheck.settings.mode, detail: pendingCheck.settings.detail,
    frame: pendingCheck.frame, result: matches ? 'match' : 'mismatch' })
  if (!matches && pendingCheck.settings.mode === 'parallel') state.settings.mode = 'serial'
  pendingCheck = null; state.checking = null; signature = ''
  state.message = matches ? 'Sector match recorded. Press Play to resume; Export includes your observation.'
    : 'Sector mismatch recorded. Serial sends selected for the next playback.'
  publish()
}

async function exitApp() {
  if (exiting) return
  exiting = true
  try { await stop(); await bridge.shutDownPageContainer(1); needsRebuild = true }
  finally { exiting = false; publish() }
}

function nextScene(direction: number) {
  const index = SCENES.findIndex(scene => scene.id === state.settings.scene)
  change({ scene: SCENES[(index + direction + SCENES.length) % SCENES.length].id })
}

const created = await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(containers()))
if (created !== 0) throw new Error(`The host refused the visualizer page (${created})`)
await draw({ ...state.settings }, 0, 'live')
ready = true
const unsubscribe = listenForInput(bridge, {
  click: () => command(async () => { if (active) await stop(); else play() }),
  up: () => nextScene(1), down: () => nextScene(-1),
  long_press: () => command(async () => { await stop(); launch('compare', compare) }),
  double_click: () => void exitApp(),
  unknown: input => {
    const type = (input.raw as { sysEvent?: { eventType?: number } })?.sysEvent?.eventType
    if (type === 5 || type === 6 || type === 7) active?.abort()
  },
})
window.addEventListener('pagehide', () => { active?.abort(); unsubscribe() })
console.log(`[evenforge] ready; evenflow ${app.version}`)
if (query.get('compare') === '1') launch('compare', compare)
else play()
