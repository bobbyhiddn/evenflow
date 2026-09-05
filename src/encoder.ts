import { TILES, sameBytes, type TileImage } from './model'
import { tilePixels, type Raster } from './scenes'

/** Compare the small raw tiles BEFORE encoding. Canvases and unchanged PNGs
 * are reused; every encoded image still has the full 288x144 physical size. */
export class TileEncoder {
  private small = document.createElement('canvas')
  private full = document.createElement('canvas')
  private cached: { pixels: Uint8Array; detail: number; image: Uint8Array }[] = []

  constructor() { this.full.width = 288; this.full.height = 144 }

  async encode(raster: Raster): Promise<TileImage[]> {
    const images: TileImage[] = []
    for (const [index, tile] of TILES.entries()) {
      const pixels = tilePixels(raster, index), cached = this.cached[index]
      let image: Uint8Array
      if (cached?.detail === raster.detail && sameBytes(cached.pixels, pixels)) image = cached.image
      else {
        this.small.width = 288 / raster.detail
        this.small.height = 144 / raster.detail
        const ctx = this.small.getContext('2d')!
        const rgba = ctx.createImageData(this.small.width, this.small.height)
        for (let i = 0; i < pixels.length; i++) {
          rgba.data[i * 4] = rgba.data[i * 4 + 1] = rgba.data[i * 4 + 2] = pixels[i] * 17
          rgba.data[i * 4 + 3] = 255
        }
        ctx.putImageData(rgba, 0, 0)
        const full = this.full.getContext('2d')!
        full.imageSmoothingEnabled = false
        full.drawImage(this.small, 0, 0, 288, 144)
        const blob = await new Promise<Blob>((resolve, reject) => this.full.toBlob(
          blob => blob ? resolve(blob) : reject(new Error('PNG encoding failed')), 'image/png'))
        image = new Uint8Array(await blob.arrayBuffer())
        this.cached[index] = { pixels, detail: raster.detail, image }
      }
      images.push({ containerID: tile.id, containerName: tile.name, imageData: image })
    }
    return images
  }
}
