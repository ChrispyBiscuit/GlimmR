// Messages between the main process and the hidden render window.

import type { CameraColor, Vec3 } from './color'
import type { OutputSpace } from './pipeline'
import type { DevelopSettings, SourceKind } from './settings'

export interface RenderJob {
  id: number
  settings: DevelopSettings
  source: { kind: SourceKind; width: number; height: number; fullWidth: number; camera?: CameraColor; autoMul?: Vec3 }
  /** The editing copy (16-bit RGB): rendered directly, or used for the local brightness grid of a full render. */
  proxy: Uint16Array
  /** Full-resolution pixels, for export and print (rendered in tiles). */
  full?: { data: Uint16Array; width: number; height: number }
  lut?: Uint8Array | null
  lutKey?: string
  output?: OutputSpace
  /** Float output (linear 0–1, encoded) for 16-bit files, instead of 8-bit. */
  float?: boolean
}

export interface RenderResult {
  width: number
  height: number
  /** RGBA, rows top to bottom. */
  data: Uint8Array | Float32Array
  float: boolean
  /** The white balance used (kelvin/tint for raw). */
  wb: { temp: number; tint: number }
  error?: string
}
