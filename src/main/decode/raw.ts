// Raw development source: LibRaw (CDDL, compiled to WebAssembly) demosaics a raw file to 16-bit linear camera RGB,
// with no white balance applied, plus the camera's colour data, so the develop pipeline does white balance and colour
// itself (see src/shared/develop/pipeline.ts).

import fs from 'node:fs'
import path from 'node:path'
import type { CameraColor, Mat3, Vec3 } from '../../shared/develop/color'

export interface RawSource {
  data: Uint16Array
  width: number
  height: number
  camera: CameraColor
  /** Full (not half) size, for scaling effects. */
  fullWidth: number
}

interface LibRawInstance {
  open(data: Uint8Array, settings: Record<string, unknown>): void
  metadata(full: boolean): Record<string, any>
  imageData(): { width: number; height: number; colors: number; bits: number; data: Uint16Array }
  delete?: () => void
}

let mod: Promise<{ LibRaw: new () => LibRawInstance }> | undefined

function libraw(): Promise<{ LibRaw: new () => LibRawInstance }> {
  return (mod ??= (async () => {
    const dir = path.dirname(require.resolve('libraw-wasm/package.json'))
    const factory = (await import('libraw-wasm/dist/libraw.js' as string)).default as (o: object) => Promise<{ LibRaw: new () => LibRawInstance }>
    return factory({ wasmBinary: fs.readFileSync(path.join(dir, 'dist', 'libraw.wasm')) })
  })())
}

const m3 = (rows: number[][]): Mat3 => [rows[0][0], rows[0][1], rows[0][2], rows[1][0], rows[1][1], rows[1][2], rows[2][0], rows[2][1], rows[2][2]]

/**
 * Develops a raw file to linear camera RGB. `half` uses LibRaw's half-size mode (no demosaicing, 4× faster), which is
 * plenty for an editing preview when the raw is at least twice the preview size.
 */
export async function decodeRawSource(buf: Uint8Array, opts: { half?: boolean } = {}): Promise<RawSource> {
  const M = await libraw()
  const lr = new M.LibRaw()
  try {
    lr.open(buf, {
      outputBps: 16,
      outputColor: 0, // camera RGB: the pipeline applies the colour matrix
      gamm: [1, 1], // linear
      noAutoBright: true,
      userMul: [1, 1, 1, 1], // no white balance: the pipeline applies it
      highlight: 0, // clip; the pipeline keeps clipped highlights neutral
      userQual: 3, // AHD demosaic
      halfSize: !!opts.half
    })
    const meta = lr.metadata(true)
    const cd = meta.color_data ?? {}
    const img = lr.imageData()
    if (!img?.data?.length || img.colors !== 3) throw new Error('LibRaw couldn’t develop this file.')
    const camXyz = Array.isArray(cd.cam_xyz) ? m3(cd.cam_xyz) : null
    const rgbCam = Array.isArray(cd.rgb_cam) ? m3(cd.rgb_cam) : null
    if (!camXyz || !rgbCam || camXyz.every((v) => v === 0)) throw new Error('This camera’s colour data isn’t known to LibRaw.')
    const mul = (Array.isArray(cd.cam_mul) && cd.cam_mul[0] > 0 ? cd.cam_mul : cd.pre_mul) as number[]
    const asShot: Vec3 = [mul[0] / mul[1], 1, mul[2] / mul[1]]
    const fullWidth = opts.half ? img.width * 2 : img.width
    return { data: img.data, width: img.width, height: img.height, camera: { camXyz, rgbCam, asShot }, fullWidth }
  } finally {
    lr.delete?.()
  }
}
