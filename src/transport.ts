import { createPacer } from '@evenforge/toolkit'
import { sameBytes, type CallSample, type FrameSample, type SendMode, type TileImage } from './model'

type Send = (image: TileImage) => Promise<unknown>
interface Options { now?: () => number; sleep?: (ms: number) => Promise<unknown> }

/** One frame in flight, at most four image calls. Parallel mode is experimental:
 * the official host contract only supports serial image sends. A resolved call
 * is acceptance, not proof of display. Always drain requests before a rebuild. */
export class FrameTransport {
  private accepted = new Map<string, Uint8Array>()
  private busy = false
  private lastStart = -Infinity
  private pacer = createPacer({ startMs: 100 })
  private now: () => number
  private sleep: (ms: number) => Promise<unknown>

  constructor(private send: Send, options: Options = {}) {
    this.now = options.now ?? (() => performance.now())
    this.sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  }

  reset({ pacing = false } = {}) {
    if (this.busy) throw new Error('Wait for image calls before resetting the renderer')
    this.accepted.clear()
    // Controlled trials must not inherit backoff from a different send mode.
    // Keep lastStart so even a fresh trial still respects the 100ms boundary.
    if (pacing) this.pacer = createPacer({ startMs: 100 })
  }

  async present(images: readonly TileImage[], mode: SendMode, signal?: AbortSignal): Promise<FrameSample> {
    if (this.busy) throw new Error('A frame is already in flight')
    if (images.length > 4 || new Set(images.map(image => image.containerID)).size !== images.length) {
      throw new Error('A frame must contain at most four distinct image containers')
    }
    this.busy = true
    const began = this.now()
    const stats: FrameSample = { mode, required: 0, skipped: 0, attempted: 0, accepted: 0,
      refused: 0, complete: false, cancelled: false, bytes: 0, elapsedMs: 0, waitMs: 0,
      maxInFlight: 0, settlementSpreadMs: 0, calls: [] }
    let inFlight = 0
    try {
      // Snapshot buffers before any await. Producers may reuse their storage.
      const frame = images.map(image => ({ ...image, imageData: new Uint8Array(image.imageData) }))
      const dirty = frame.filter(image => !sameBytes(this.accepted.get(this.key(image)), image.imageData))
      stats.required = dirty.length
      stats.skipped = frame.length - dirty.length

      const pace = async () => {
        const began = this.now()
        while (!signal?.aborted && this.now() < this.pacer.dueAt(this.lastStart)) {
          await this.sleep(this.pacer.dueAt(this.lastStart) - this.now())
        }
        stats.waitMs += this.now() - began
      }
      const sendOne = async (image: TileImage) => {
        if (signal?.aborted) return
        this.lastStart = this.now()
        const call: CallSample = { id: image.containerID, startMs: this.lastStart - began,
          endMs: 0, accepted: false, error: '' }
        inFlight++
        stats.maxInFlight = Math.max(stats.maxInFlight, inFlight)
        stats.attempted++
        stats.bytes += image.imageData.length
        try {
          const result = await this.send(image)
          call.accepted = result === 'success'
          if (!call.accepted) call.error = String(result)
        } catch (error) { call.error = String((error as Error)?.message ?? error) }
        finally {
          inFlight--
          call.endMs = this.now() - began
          stats.calls.push(call)
          if (call.accepted) {
            this.accepted.set(this.key(image), image.imageData)
            stats.accepted++
            this.pacer.deliver(1, this.now())
          } else {
            this.accepted.delete(this.key(image))
            stats.refused++
            this.pacer.refuse(this.now())
          }
        }
      }

      if (mode === 'serial') {
        for (const image of dirty) {
          if (signal?.aborted) break
          await pace()
          await sendOne(image)
        }
      } else if (dirty.length && !signal?.aborted) {
        // A bounded burst, not an unbounded Promise queue. The next frame cannot
        // start until EVERY request resolves, including failures and cancellation.
        await pace()
        await Promise.all(dirty.map(sendOne))
      }
      stats.cancelled = signal?.aborted ?? false
      stats.complete = !stats.cancelled && dirty.length > 0 && stats.accepted === dirty.length
      if (stats.calls.length > 1) {
        const ends = stats.calls.map(call => call.endMs)
        stats.settlementSpreadMs = Math.max(...ends) - Math.min(...ends)
      }
      return stats
    } finally {
      stats.elapsedMs = this.now() - began
      this.busy = false
    }
  }

  private key(image: TileImage) { return `${image.containerID}:${image.containerName}` }
}
