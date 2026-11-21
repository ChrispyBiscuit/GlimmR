// The editing copy in the renderer: fetched from glimmr://develop/<id> (header + 16-bit pixels, see
// src/main/develop/source.ts), plus white balance helpers for the eyedropper.

import { cameraTempTint, type CameraColor, type Vec3 } from '../../../shared/develop/color'
import { relativeFromMul } from '../../../shared/develop/pipeline'
import type { SourceKind } from '../../../shared/develop/settings'

export interface EditSource {
  kind: SourceKind
  width: number
  height: number
  fullWidth: number
  camera?: CameraColor
  autoMul?: Vec3
  data: Uint16Array
}

export async function loadSource(id: number, rev: number): Promise<EditSource> {
  const res = await fetch(`glimmr://develop/${id}?v=${rev}`)
  if (!res.ok) throw new Error(await res.text())
  const buf = new Uint8Array(await res.arrayBuffer())
  if (new TextDecoder().decode(buf.subarray(0, 5)) !== 'GLDS1') throw new Error('The editing copy is damaged.')
  const n = new DataView(buf.buffer, buf.byteOffset + 5, 4).getUint32(0, true)
  const head = JSON.parse(new TextDecoder().decode(buf.subarray(9, 9 + n))) as Omit<EditSource, 'data'>
  // Copy so the pixels start on an even byte.
  const px = buf.slice(9 + n)
  return { ...head, data: new Uint16Array(px.buffer, px.byteOffset, px.byteLength / 2) }
}

/** White balance that makes the area around a pixel neutral (the eyedropper). */
export function neutralAt(src: EditSource, x: number, y: number): { temp: number; tint: number } {
  const acc = [0, 0, 0]
  let n = 0
  for (let dy = -3; dy <= 3; dy++)
    for (let dx = -3; dx <= 3; dx++) {
      const px = Math.min(src.width - 1, Math.max(0, Math.round(x) + dx))
      const py = Math.min(src.height - 1, Math.max(0, Math.round(y) + dy))
      const i = (py * src.width + px) * 3
      for (let k = 0; k < 3; k++) {
        const v = src.data[i + k] / 65535
        acc[k] += src.kind === 'raw' ? v : v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
      }
      n++
    }
  const mul: Vec3 = [acc[1] / Math.max(acc[0], 1e-6), 1, acc[1] / Math.max(acc[2], 1e-6)]
  if (src.kind === 'raw' && src.camera) return cameraTempTint(src.camera, mul)
  return relativeFromMul(mul)
}
