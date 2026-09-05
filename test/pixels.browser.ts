import { TileEncoder } from '../src/encoder'
import { encodeGray4Bmp } from '@evenforge/toolkit'
import { FrameTransport } from '../src/transport'
import { TILES, type Detail, type Scene } from '../src/model'
import { renderScene, tilePixels } from '../src/scenes'

function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message) }
const report = { scenes: 0, decodedTiles: 0, decodedBmpTiles: 0, retainedPixelEquivalence: false, physicalDimensions: false, pngCache: false }
try {
  const panel = document.createElement('canvas'); panel.width = 576; panel.height = 288
  document.body.append(panel)
  const ctx = panel.getContext('2d')!
  let now = 10000
  for (const detail of [2, 4, 8] as Detail[]) for (const scene of ['ribbons', 'orbits', 'comet'] as Scene[]) {
    const encoder = new TileEncoder()
    const transport = new FrameTransport(async image => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(image.imageData)], { type: 'image/png' }))
      assert(bitmap.width === 288 && bitmap.height === 144, 'The physical image must remain 288x144')
      const tile = TILES.find(tile => tile.id === image.containerID)!
      ctx.drawImage(bitmap, tile.x, tile.y); bitmap.close()
      now += 235; report.decodedTiles++
      return 'success'
    }, { now: () => now, sleep: async ms => { now += ms } })
    let previous: Awaited<ReturnType<TileEncoder['encode']>> | null = null
    for (const seconds of [2, 2.12, 4, 4.6]) {
      const raster = renderScene(scene, seconds, detail)
      const images = await encoder.encode(raster)
      if (scene === 'comet' && seconds === 2.12) {
        const reused = images.filter((image, i) => image.imageData === previous![i].imageData).length
        assert(reused === 3, 'The three unchanged PNGs must be reused without re-encoding')
      }
      const sent = await transport.present(images, 'serial')
      assert(sent.complete, 'Expected a complete changed scene')
      for (let index = 0; index < 4; index++) {
        const tile = TILES[index], expected = tilePixels(raster, index)
        const actual = ctx.getImageData(tile.x, tile.y, 288, 144).data
        for (let y = 0; y < 144; y++) for (let x = 0; x < 288; x++) {
          const value = expected[Math.floor(y / detail) * (288 / detail) + Math.floor(x / detail)] * 17
          const at = (y * 288 + x) * 4
          assert(actual[at] === value && actual[at + 1] === value && actual[at + 2] === value && actual[at + 3] === 255,
            `Stale or incorrect pixel: ${scene}/${detail}/${seconds} sector ${index}, ${x},${y}`)
        }
      }
      previous = images; report.scenes++
    }
  }
  // Decode the actual experimental BMPs with Chromium, independently of the
  // encoder's header/nibble tests and the mock host's fragment accounting.
  for (const detail of [2, 4, 8] as Detail[]) {
    const raster = renderScene('ribbons', 2, detail, 42)
    for (let index = 0; index < 4; index++) {
      const pixels = tilePixels(raster, index)
      const bmp = encodeGray4Bmp(pixels, 288 / detail, 144 / detail, detail)
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(bmp)], { type: 'image/bmp' }))
      assert(bitmap.width === 288 && bitmap.height === 144, 'BMP dimensions must match the physical container')
      ctx.drawImage(bitmap, TILES[index].x, TILES[index].y); bitmap.close()
      const actual = ctx.getImageData(TILES[index].x, TILES[index].y, 288, 144).data
      for (let y = 0; y < 144; y++) for (let x = 0; x < 288; x++) {
        const value = pixels[Math.floor(y / detail) * (288 / detail) + Math.floor(x / detail)] * 17
        const at = (y * 288 + x) * 4
        assert(actual[at] === value && actual[at + 1] === value && actual[at + 2] === value && actual[at + 3] === 255,
          `Incorrect BMP pixel: ${detail}px sector ${index}, ${x},${y}`)
      }
      report.decodedBmpTiles++
    }
  }
  report.retainedPixelEquivalence = report.physicalDimensions = report.pngCache = true
  document.querySelector('#result')!.textContent = JSON.stringify(report, null, 2)
  document.body.dataset.result = 'passed'
} catch (error) {
  document.querySelector('#result')!.textContent = String((error as Error).stack ?? error)
  document.body.dataset.result = 'failed'
}
