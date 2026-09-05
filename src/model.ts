export const WIDTH = 576
export const HEIGHT = 288
export const TILE_WIDTH = 288
export const TILE_HEIGHT = 144
export const TILES = [
  { id: 10, name: 'tile0', x: 0, y: 0 },
  { id: 11, name: 'tile1', x: 288, y: 0 },
  { id: 12, name: 'tile2', x: 0, y: 144 },
  { id: 13, name: 'tile3', x: 288, y: 144 },
] as const

export type Scene = 'ribbons' | 'orbits' | 'comet'
export type Detail = 2 | 4 | 8
export type SendMode = 'serial' | 'parallel'
export interface Settings { scene: Scene; detail: Detail; mode: SendMode; speed: number; markers: boolean }
export const DEFAULTS: Settings = { scene: 'ribbons', detail: 4, mode: 'serial', speed: 0.75, markers: false }
export const SCENES: { id: Scene; label: string }[] = [
  { id: 'ribbons', label: 'Ribbons' }, { id: 'orbits', label: 'Orbits' }, { id: 'comet', label: 'Comet' },
]

export interface TileImage { containerID: number; containerName: string; imageData: Uint8Array }
export interface CallSample { id: number; startMs: number; endMs: number; accepted: boolean; error: string }
export interface FrameSample {
  mode: SendMode; required: number; skipped: number; attempted: number; accepted: number; refused: number
  complete: boolean; cancelled: boolean; bytes: number; elapsedMs: number; waitMs: number
  maxInFlight: number; settlementSpreadMs: number; calls: CallSample[]
}
export interface RenderSample extends FrameSample {
  frame: number; scene: Scene; detail: Detail; renderMs: number; encodeMs: number; totalMs: number
  startedAtMs: number; endedAtMs: number; runId: number
  context: 'live' | 'compare' | 'check'
}
export interface Comparison {
  mode: SendMode; detail: Detail; pass: number; completed: number; planned: number
  calls: number; refused: number; elapsedMs: number; acceptedFps: number; valid: boolean
}
export interface SectorCheck { at: string; mode: SendMode; detail: Detail; frame: number; result: 'match' | 'mismatch' }

export function sameBytes(a: Uint8Array | undefined, b: Uint8Array) {
  if (!a || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
