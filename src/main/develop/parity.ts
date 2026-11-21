// Test hook: renders a file with the GPU (render window) and the CPU reference, and reports how far apart they are.

import { decodeSource, toFloat } from './source'
import type { RenderService } from './renderService'
import { prepare, renderReference } from '../../shared/develop/pipeline'
import { sanitize } from '../../shared/develop/settings'

export async function developParity(r: RenderService, file: string, ext: string, settings: unknown): Promise<{ kind: string; width: number; height: number; mean: number; max: number; over2: number; gpuMs: number; sample: number[][] }> {
  const src = await decodeSource({ path: file, ext, companion: null }, 640)
  const s = sanitize(settings, src.kind)
  const t0 = Date.now()
  const gpu = await r.render({ settings: s, source: { kind: src.kind, width: src.width, height: src.height, fullWidth: src.fullWidth, camera: src.camera, autoMul: src.autoMul }, proxy: src.data })
  const gpuMs = Date.now() - t0
  const cpu = renderReference(prepare(s, { kind: src.kind, fullWidth: src.fullWidth, camera: src.camera, autoMul: src.autoMul }, src.width / src.fullWidth), toFloat(src))
  let sum = 0
  let max = 0
  let over2 = 0
  const n = src.width * src.height
  for (let i = 0; i < n; i++)
    for (let k = 0; k < 3; k++) {
      const d = Math.abs((gpu.data[i * 4 + k] as number) - Math.round(cpu.data[i * 3 + k] * 255))
      sum += d
      if (d > max) max = d
      if (d > 2) over2++
    }
  const at = (i: number): number[] => [gpu.data[i * 4], gpu.data[i * 4 + 1], gpu.data[i * 4 + 2], ...[0, 1, 2].map((k) => Math.round(cpu.data[i * 3 + k] * 255))]
  return { kind: src.kind, width: src.width, height: src.height, mean: sum / (n * 3), max, over2: over2 / (n * 3), gpuMs, sample: [at(0), at(Math.floor(n / 2) + Math.floor(src.width / 3)), at(n - 1)] }
}
