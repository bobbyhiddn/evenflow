import { WIDTH, HEIGHT, TILES, type Detail, type Scene } from './model'

export interface Raster { pixels: Uint8Array; width: number; height: number; detail: Detail }

/** Flat 4-bit greys, no noise/dithering, rasterized on repeated pixel blocks.
 * Time is supplied by the controller; the animation never accumulates queued frames. */
export function renderScene(scene: Scene, seconds: number, detail: Detail, frame?: number): Raster {
  const width = WIDTH / detail, height = HEIGHT / detail
  const pixels = new Uint8Array(width * height)
  const dot = (cx: number, cy: number, radius: number, level: number) => {
    const x0 = Math.max(0, Math.floor((cx - radius) / detail)), x1 = Math.min(width - 1, Math.ceil((cx + radius) / detail))
    const y0 = Math.max(0, Math.floor((cy - radius) / detail)), y1 = Math.min(height - 1, Math.ceil((cy + radius) / detail))
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if ((x * detail - cx) ** 2 + (y * detail - cy) ** 2 <= radius ** 2) pixels[y * width + x] = level
    }
  }
  if (scene === 'ribbons') {
    for (let x = 0; x < width; x++) {
      const px = x * detail
      const centre = 144 + 74 * Math.sin(px / 125 - seconds * 0.8) + 20 * Math.sin(px / 52 + seconds * 0.45)
      const second = 144 - 82 * Math.sin(px / 150 - seconds * 0.57 + 0.8)
      for (let y = 0; y < height; y++) {
        const d = Math.abs(y * detail - centre), e = Math.abs(y * detail - second)
        const a = d < 6 ? 15 : d < 16 ? 9 : d < 28 ? 4 : 0
        const b = e < 4 ? 10 : e < 12 ? 5 : e < 22 ? 2 : 0
        pixels[y * width + x] = Math.max(a, b)
      }
    }
  } else {
    // Static context spans the entire canvas. Retention can preserve it while
    // the moving discs touch only one or two sectors.
    for (let i = 0; i < 36; i++) dot(16 + (i * 137) % 544, 12 + (i * 73) % 264, detail, i % 3 === 0 ? 3 : 1)
    if (scene === 'comet') {
      for (let tail = 5; tail >= 0; tail--) {
        const t = seconds * 0.38 - tail * 0.045
        dot(288 + 244 * Math.cos(t), 144 + 110 * Math.sin(t), tail ? 4 + tail : 12, tail ? 7 - tail : 15)
      }
    } else {
      for (let ring = 0; ring < 3; ring++) {
        for (let i = 0; i < 40; i++) {
          const a = i * Math.PI / 20
          dot(288 + (105 + ring * 65) * Math.cos(a), 144 + (38 + ring * 37) * Math.sin(a), detail / 2, 2)
        }
        const a = seconds * (0.8 - ring * 0.17) + ring * 2
        dot(288 + (105 + ring * 65) * Math.cos(a), 144 + (38 + ring * 37) * Math.sin(a), 11 + ring * 2, 15 - ring * 3)
      }
      dot(288, 144, 8, 6)
    }
  }
  if (frame !== undefined) stamp(pixels, width, detail, frame)
  return { pixels, width, height, detail }
}

const DIGITS = [
  '111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001',
  '111100111001111', '111100111101111', '111001010010010', '111101111101111', '111101111001111',
]

function stamp(pixels: Uint8Array, width: number, detail: Detail, frame: number) {
  const digits = String(frame % 100).padStart(2, '0')
  // Same two-digit frame ID in every sector. This deliberately changes all
  // four tiles; diagnostic mode is never mixed into performance comparisons.
  const scale = Math.max(1, 8 / detail)
  for (const tile of TILES) {
    const ox = tile.x / detail + 16 / detail, oy = tile.y / detail + 16 / detail
    for (let y = -1; y <= 5 * scale; y++) for (let x = -1; x <= 7 * scale; x++) pixels[(oy + y) * width + ox + x] = 0
    for (const [index, digit] of [...digits].entries()) {
      for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) {
        if (DIGITS[+digit][y * 3 + x] !== '1') continue
        for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
          pixels[(oy + y * scale + sy) * width + ox + (index * 4 + x) * scale + sx] = 15
        }
      }
    }
  }
}

export function tilePixels(raster: Raster, index: number): Uint8Array {
  const tile = TILES[index], width = 288 / raster.detail, height = 144 / raster.detail
  const out = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    const at = (tile.y / raster.detail + y) * raster.width + tile.x / raster.detail
    out.set(raster.pixels.subarray(at, at + width), y * width)
  }
  return out
}
