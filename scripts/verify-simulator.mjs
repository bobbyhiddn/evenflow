// With Vite running: node scripts/verify-simulator.mjs [URL].
// This checks the actual SDK and simulator, not BLE or optical presentation.
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const forge = path.resolve(root, '../EvenForge')
const target = new URL(process.argv[2] ?? 'http://127.0.0.1:5187')
target.searchParams.set('compare', '1')
const base = 'http://127.0.0.1:9899'
const child = spawn('xvfb-run', ['-a', process.execPath,
  path.join(forge, 'node_modules/@evenrealities/evenhub-simulator/bin/index.js'),
  '--automation-port', '9899', target.href], { detached: true, stdio: ['ignore', 'ignore', 'pipe'] })
let stderr = ''
child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8000) })
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function entries() {
  const response = await fetch(`${base}/api/console`)
  if (!response.ok) throw new Error(`Console HTTP ${response.status}`)
  return (await response.json()).entries ?? []
}

try {
  const began = Date.now()
  let ready = false, rows = [], last = 0, complete = false
  while (Date.now() - began < 240000) {
    let data
    try { data = await entries() } catch {
      if (Date.now() - began > 45000) throw new Error(`Simulator not ready: ${stderr}`)
      await pause(250); continue
    }
    const errors = data.filter(row => /error|exception|rejection/i.test(`${row.level ?? ''} ${row.type ?? ''}`))
    if (errors.length) throw new Error(`Console errors: ${JSON.stringify(errors)}`)
    const messages = data.map(row => String(row.message ?? row.args ?? ''))
    ready ||= messages.some(message => message.includes('[evenforge] ready'))
    rows = messages.filter(message => message.includes('[evenflow] compare '))
    if (rows.length !== last) { last = rows.length; console.log(`Comparison complete: ${last}/12`) }
    complete = messages.some(message => message.includes('[evenflow] comparison complete'))
    if (complete) break
    await pause(500)
  }
  if (!ready || !complete || rows.length !== 12) throw new Error(`Incomplete comparison: ready=${ready}, trials=${rows.length}`)
  const trials = rows.map(message => {
    const match = message.match(/compare (serial|parallel) (2|4|8)px pass (1|2): (\d+)\/8 scenes, (\d+) calls, (\d+) refusals, valid=(true|false)/)
    if (!match) throw new Error(`Unexpected trial: ${message}`)
    const [, mode, detail, pass, scenes, calls, refused, valid] = match
    if (+scenes !== 8 || +calls !== 32 || +refused !== 0 || valid !== 'true') throw new Error(`Failed trial: ${message}`)
    return { mode, detail: +detail, pass: +pass, scenes: +scenes, calls: +calls, refused: +refused }
  })
  if (new Set(trials.map(row => `${row.mode}:${row.detail}:${row.pass}`)).size !== 12) throw new Error('Duplicate/missing trial')
  await mkdir(path.join(root, 'qa'), { recursive: true })
  for (const surface of ['glasses', 'webview']) {
    const response = await fetch(`${base}/api/screenshot/${surface}`)
    if (!response.ok) throw new Error(`Screenshot ${surface}: HTTP ${response.status}`)
    await writeFile(path.join(root, `qa/compare-${surface}.png`), Buffer.from(await response.arrayBuffer()))
  }
  const sources = {}
  for (const file of ['app.json', 'src/main.ts', 'src/model.ts', 'src/scenes.ts', 'src/encoder.ts', 'src/transport.ts', 'src/phone.ts', 'src/style.css',
    '../EvenForge/packages/toolkit/src/index.js', '../EvenForge/packages/toolkit/src/image-fragments.js']) {
    sources[file] = createHash('sha256').update(await readFile(path.join(root, file))).digest('hex')
  }
  const manifest = JSON.parse(await readFile(path.join(root, 'app.json'), 'utf8'))
  const report = { app: 'evenflow', version: manifest.version, checkedAt: new Date().toISOString(), simulator: '0.9.5',
    passed: true, hardwarePerformanceValidated: false, note: 'SDK and simulator acceptance; no BLE or optical performance claim.',
    trials, sources, consoleErrors: [] }
  await writeFile(path.join(root, 'qa/simulator-verification.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log('PASS: 12 trials / 96 full scenes, expected call counts, zero refusals or console errors')
} finally {
  if (child.pid) { try { process.kill(-child.pid, 'SIGTERM') } catch {} }
}
