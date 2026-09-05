import { mountExportPanel } from '@evenforge/toolkit'
import { SCENES, type Comparison, type RenderSample, type Settings } from './model'
import type { Raster } from './scenes'
import app from '../app.json'
import './style.css'

export interface PhoneState {
  settings: Settings; running: 'live' | 'compare' | 'check' | null; message: string
  history: RenderSample[]; comparisons: Comparison[]; checking: number | null
}
interface Actions {
  toggle: () => void; compare: () => void; check: () => void
  report: (matches: boolean) => void; change: (next: Partial<Settings>) => void; session: () => unknown
}

export function mountPhone(actions: Actions) {
  document.querySelector('#app')!.innerHTML = `
    <main>
      <header><div class="brand"><span class="orb"></span> EVENFLOW <span class="version">${app.version}</span></div>
        <span class="badge">576 × 288</span></header>
      <h1>A little space<br>to get lost in.</h1>
      <p class="lede">Full-screen motion for your glasses.</p>
      <div class="preview"><canvas id="preview" width="576" height="288" aria-label="Current full-screen scene preview"></canvas></div>
      <div class="preview-label"><span>SCENE PREVIEW</span><span>Glasses timing may differ</span></div>
      <div class="metrics"><div><strong id="rate">—</strong><span>accepted scenes / sec</span></div>
        <div><strong id="calls">—</strong><span>sector calls / scene</span></div>
        <div><strong id="failures">0</strong><span>refused calls</span></div></div>
      <div class="action-row"><button id="play" class="primary" disabled>Connecting…</button>
        <label class="pattern-label">Pattern <select id="scene">${SCENES.map(scene => `<option value="${scene.id}">${scene.label}</option>`).join('')}</select></label></div>
      <p id="status" role="status">Connecting to the glasses…</p>
      <section class="tuning"><div class="label-row"><span>Image detail</span><span id="detail-label">4px · balanced</span></div>
        <div class="segments" role="group" aria-label="Image detail">
          <button data-detail="2">Fine <small>2px</small></button>
          <button data-detail="4" class="selected">Balanced <small>4px</small></button>
          <button data-detail="8">Fast <small>8px</small></button>
        </div>
        <label class="label-row" for="speed"><span>Motion speed</span><span id="speed-label">0.75×</span></label>
        <input id="speed" type="range" min="0.25" max="2" step="0.25" value="0.75">
      </section>
      <details class="lab" open><summary>Performance lab</summary>
        <label class="switch"><input id="parallel" type="checkbox"><span>Send sectors concurrently <small>Experimental</small></span></label>
        <p class="hint">Sends all changed sectors together. The host may reject or miss updates; a fast number alone does not confirm what appeared. Refusals switch live playback back to serial sends.</p>
        <div class="lab-actions"><button id="compare">Compare speeds</button><button id="check">Check sectors</button></div>
        <p class="hint">Compare tests the same full-screen sequence at 2px, 4px and 8px, with serial and concurrent sends. Two passes, about two minutes.</p>
        <label class="switch"><input id="markers" type="checkbox"><span>Show frame numbers <small>Changes every sector</small></span></label>
        <div id="check-result" hidden><p id="check-prompt"></p><div class="lab-actions"><button id="match">All four match</button><button id="mismatch">Some differ / are missing</button></div></div>
        <div id="comparisons"></div>
      </details>
      <div id="export"></div>
      <footer>Tap: pause / play · Swipe: change pattern · Hold: compare · Double press: exit.<br>
        Rates count complete scene updates accepted by the SDK, not optical panel refresh.</footer>
    </main>`
  const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
  get<HTMLButtonElement>('play').onclick = actions.toggle
  get<HTMLButtonElement>('compare').onclick = actions.compare
  get<HTMLButtonElement>('check').onclick = actions.check
  get<HTMLButtonElement>('match').onclick = () => actions.report(true)
  get<HTMLButtonElement>('mismatch').onclick = () => actions.report(false)
  get<HTMLSelectElement>('scene').onchange = event => actions.change({ scene: (event.target as HTMLSelectElement).value as Settings['scene'] })
  get<HTMLInputElement>('parallel').onchange = event => actions.change({ mode: (event.target as HTMLInputElement).checked ? 'parallel' : 'serial' })
  get<HTMLInputElement>('markers').onchange = event => actions.change({ markers: (event.target as HTMLInputElement).checked })
  get<HTMLInputElement>('speed').oninput = event => actions.change({ speed: +(event.target as HTMLInputElement).value })
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-detail]')) {
    button.onclick = () => actions.change({ detail: +button.dataset.detail! as Settings['detail'] })
  }
  mountExportPanel(get('export'), { title: 'Session', session: actions.session,
    placeholder: 'The complete visualizer session appears here after Export.' })
  const canvas = get<HTMLCanvasElement>('preview'), ctx = canvas.getContext('2d')!
  const small = document.createElement('canvas')

  return {
    preview(raster: Raster) {
      small.width = raster.width; small.height = raster.height
      const source = small.getContext('2d')!, data = source.createImageData(raster.width, raster.height)
      for (let i = 0; i < raster.pixels.length; i++) {
        const brightness = raster.pixels[i] / 15
        data.data[i * 4] = Math.round(180 * brightness)
        data.data[i * 4 + 1] = Math.round(255 * brightness)
        data.data[i * 4 + 2] = Math.round(139 * brightness)
        data.data[i * 4 + 3] = 255
      }
      source.putImageData(data, 0, 0)
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(small, 0, 0, 576, 288)
    },
    update(state: PhoneState) {
      const locked = state.running === 'compare' || state.running === 'check'
      const play = get<HTMLButtonElement>('play')
      play.disabled = false
      play.textContent = state.running === 'live' ? 'Pause' : state.running ? 'Stop' : 'Play'
      get('status').textContent = state.message
      get<HTMLSelectElement>('scene').value = state.settings.scene
      get<HTMLInputElement>('parallel').checked = state.settings.mode === 'parallel'
      get<HTMLInputElement>('markers').checked = state.settings.markers
      get<HTMLInputElement>('speed').value = String(state.settings.speed)
      get('speed-label').textContent = `${state.settings.speed}×`
      get('detail-label').textContent = `${state.settings.detail}px · ${state.settings.detail === 2 ? 'fine' : state.settings.detail === 4 ? 'balanced' : 'fast'}`
      for (const control of document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('.tuning button, .tuning input, #scene, #parallel, #markers, #compare, #check')) control.disabled = locked
      for (const button of document.querySelectorAll<HTMLButtonElement>('[data-detail]')) {
        const selected = +button.dataset.detail! === state.settings.detail
        button.classList.toggle('selected', selected)
        button.setAttribute('aria-pressed', String(selected))
      }
      // A contiguous run window includes UI/scheduling gaps and never combines
      // old samples across a pause, a comparison, or a different configuration.
      const recent: RenderSample[] = [], last = state.history.at(-1)
      for (let i = state.history.length - 1; i >= 0 && recent.length < 12; i--) {
        const row = state.history[i]
        if (row.context !== 'live' || row.runId !== last?.runId || row.mode !== state.settings.mode
          || row.scene !== state.settings.scene || row.detail !== state.settings.detail) break
        recent.unshift(row)
      }
      const elapsed = recent.length ? recent.at(-1)!.endedAtMs - recent[0].startedAtMs : 0
      const completed = recent.filter(row => row.complete).length
      get('rate').textContent = elapsed ? (completed * 1000 / elapsed).toFixed(2) : '—'
      get('calls').textContent = completed ? (recent.reduce((sum, row) => sum + row.attempted, 0) / completed).toFixed(1) : '—'
      get('failures').textContent = String(state.history.reduce((sum, row) => sum + row.refused, 0))
      get('check-result').hidden = state.checking === null
      if (state.checking !== null) get('check-prompt').textContent = `Look at the glasses. After the picture settles, all four sectors should show ${String(state.checking % 100).padStart(2, '0')}.`
      const results = get('comparisons')
      results.replaceChildren()
      if (state.comparisons.length) {
        const table = document.createElement('table')
        table.innerHTML = '<thead><tr><th>Mode</th><th>Detail</th><th>Pass</th><th>Accepted / s</th></tr></thead>'
        const body = document.createElement('tbody')
        for (const row of state.comparisons) {
          const tr = document.createElement('tr')
          for (const value of [row.mode === 'serial' ? 'Serial' : 'Concurrent', `${row.detail}px`, row.pass, row.valid ? row.acceptedFps.toFixed(2) : 'Incomplete / refused']) {
            const td = document.createElement('td'); td.textContent = String(value); tr.append(td)
          }
          body.append(tr)
        }
        table.append(body); results.append(table)
      }
    },
  }
}
