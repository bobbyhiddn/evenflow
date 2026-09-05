import test from 'node:test'
import assert from 'node:assert/strict'
import { FrameTransport } from '../src/transport'
import { sameBytes, TILES, type Detail, type Scene, type TileImage } from '../src/model'
import { renderScene, tilePixels } from '../src/scenes'

const frame = (value = 1): TileImage[] => TILES.map(tile => ({ containerID: tile.id, containerName: tile.name, imageData: new Uint8Array([value, tile.id]) }))
const flush = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve!: (value: unknown) => void; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
function clock() { let now = 10000; return { now: () => now, advance: (ms: number) => { now += ms }, sleep: async (ms: number) => { now += ms } } }

test('serial frames await every sector, retain accepted pixels, and count no-op scenes honestly', async () => {
  const time = clock(), starts: number[] = []
  const sender = new FrameTransport(async () => { starts.push(time.now()); time.advance(235); return 'success' }, time)
  const result = await sender.present(frame(), 'serial')
  assert.equal(result.complete, true)
  assert.equal(result.maxInFlight, 1)
  assert.equal(result.elapsedMs, 940)
  assert.equal(result.waitMs, 0)
  assert.deepEqual(starts, [10000, 10235, 10470, 10705])
  const retained = await sender.present(frame(), 'serial')
  assert.equal(retained.attempted, 0)
  assert.equal(retained.skipped, 4)
  assert.equal(retained.complete, false)
})

test('100ms floor applies to each serial send and survives a page reset', async () => {
  const time = clock(), starts: number[] = []
  const sender = new FrameTransport(async () => { starts.push(time.now()); time.advance(20); return 'success' }, time)
  const result = await sender.present(frame(), 'serial')
  assert.deepEqual(starts, [10000, 10100, 10200, 10300])
  assert.equal(result.waitMs, 240)
  sender.reset()
  await sender.present(frame().slice(0, 1), 'serial')
  assert.equal(starts.at(-1), 10400)
})

test('parallel dispatch overlaps four calls, drains them out of order, and prevents another frame', async () => {
  const time = clock(), requests = Array.from({ length: 4 }, deferred)
  let launched = 0, settled = false
  const sender = new FrameTransport(() => requests[launched++].promise, time)
  const source = frame()
  const pending = sender.present(source, 'parallel').then(value => { settled = true; return value })
  source[0].imageData[0] = 99
  await flush()
  assert.equal(launched, 4)
  await assert.rejects(sender.present(frame(2), 'parallel'), /already in flight/)
  assert.throws(() => sender.reset(), /Wait/)
  time.advance(200); requests[2].resolve('success'); requests[0].resolve('success')
  await flush(); assert.equal(settled, false)
  time.advance(35); requests[1].resolve('success'); requests[3].resolve('success')
  const result = await pending
  assert.equal(result.complete, true)
  assert.equal(result.maxInFlight, 4)
  assert.equal(result.elapsedMs, 235)
  assert.equal(result.settlementSpreadMs, 35)
  assert.equal((await sender.present(frame(), 'parallel')).attempted, 0, 'Snapshot must retain original bytes')
})

test('failed parallel requests invalidate only their sectors and are retried', async () => {
  const time = clock(), calls: number[] = []
  let refuse = true
  const sender = new FrameTransport(async image => {
    calls.push(image.containerID)
    if (refuse && image.containerID === 12) throw new Error('native send failed')
    return 'success'
  }, time)
  const bad = await sender.present(frame(), 'parallel')
  assert.equal(bad.complete, false)
  assert.equal(bad.refused, 1)
  assert.equal(bad.accepted, 3)
  refuse = false
  const retry = await sender.present(frame(), 'serial')
  assert.equal(retry.attempted, 1)
  assert.equal(retry.complete, true)
  assert.deepEqual(calls, [10, 11, 12, 13, 12])
})

test('controlled trials reset inherited refusal backoff while preserving the send boundary', async () => {
  const time = clock(); let outcome = 'sendFailed'
  const sender = new FrameTransport(async () => outcome, time)
  await sender.present(frame(), 'parallel')
  outcome = 'success'
  sender.reset({ pacing: true })
  const result = await sender.present(frame().slice(0, 1), 'serial')
  assert.equal(result.waitMs, 100)
  assert.equal(result.complete, true)
})

test('a refused replacement cannot fall back to an older cache entry', async () => {
  const time = clock(); let outcome = 'success'
  const sender = new FrameTransport(async () => outcome, time)
  await sender.present(frame().slice(0, 1), 'serial')
  outcome = 'sendFailed'; await sender.present(frame(2).slice(0, 1), 'serial')
  outcome = 'success'
  assert.equal((await sender.present(frame().slice(0, 1), 'serial')).attempted, 1)
})

test('serial abort stops after the active send; partial scenes are not completed frames', async () => {
  const time = clock(), controller = new AbortController(); let calls = 0
  const sender = new FrameTransport(async () => { calls++; time.advance(235); controller.abort(); return 'success' }, time)
  const result = await sender.present(frame(), 'serial', controller.signal)
  assert.equal(calls, 1); assert.equal(result.cancelled, true); assert.equal(result.complete, false)
})

test('parallel cancellation waits for all outstanding calls, including after a rejection', async () => {
  const time = clock(), controller = new AbortController(), requests = Array.from({ length: 4 }, deferred)
  let calls = 0, finished = false
  const sender = new FrameTransport(() => requests[calls++].promise, time)
  const pending = sender.present(frame(), 'parallel', controller.signal).then(row => { finished = true; return row })
  await flush(); controller.abort(); requests[0].resolve('sendFailed')
  await flush(); assert.equal(finished, false); assert.equal(calls, 4)
  requests[1].resolve('success'); requests[2].resolve('success'); requests[3].resolve('success')
  const result = await pending
  assert.equal(result.cancelled, true); assert.equal(result.complete, false); assert.equal(result.refused, 1)
})

test('every scene and detail setting covers the full panel with deterministic Gray4 pixels', () => {
  for (const scene of ['ribbons', 'orbits', 'comet'] as Scene[]) for (const detail of [2, 4, 8] as Detail[]) {
    const raster = renderScene(scene, 2, detail)
    assert.equal(raster.width * detail, 576); assert.equal(raster.height * detail, 288)
    assert.ok(raster.pixels.every(value => value <= 15))
    assert.ok(sameBytes(raster.pixels, renderScene(scene, 2, detail).pixels))
    for (let tile = 0; tile < 4; tile++) {
      const pixels = tilePixels(raster, tile), width = 288 / detail
      assert.ok(pixels.some(value => value > 0), `${scene}/${detail} sector ${tile} has content`)
      for (let y = 0; y < 144 / detail; y++) for (let x = 0; x < width; x++) {
        assert.equal(pixels[y * width + x], raster.pixels[(TILES[tile].y / detail + y) * raster.width + TILES[tile].x / detail + x])
      }
    }
  }
})

test('local comet movement retains three sectors and a seam crossing clears both affected sectors', () => {
  for (const detail of [2, 4, 8] as Detail[]) {
    const changes = (a: number, b: number) => TILES.map((_, i) => !sameBytes(tilePixels(renderScene('comet', a, detail), i), tilePixels(renderScene('comet', b, detail), i))).filter(Boolean).length
    assert.equal(changes(2, 2.12), 1)
    assert.equal(changes(4, 4.6), 2)
  }
})

test('frame numbers stamp the same readable ID into every sector and make all four change', () => {
  for (const detail of [2, 4, 8] as Detail[]) {
    const a = renderScene('ribbons', 0, detail, 42), b = renderScene('ribbons', 0, detail, 43)
    const crop = (index: number) => {
      const result: number[] = [], tile = tilePixels(a, index), width = 288 / detail
      for (let y = 16 / detail; y < 56 / detail; y++) for (let x = 16 / detail; x < 72 / detail; x++) result.push(tile[y * width + x])
      return result
    }
    for (let index = 0; index < 4; index++) {
      assert.deepEqual(crop(index), crop(0))
      assert.equal(sameBytes(tilePixels(a, index), tilePixels(b, index)), false)
    }
  }
})
