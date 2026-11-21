// The hidden render window: develops photos on the GPU for previews, thumbnails, export and print, with the same
// engine the Develop view uses.

import { DevelopGL, renderTiled } from '../develop/gl'
import { prepare, type OutputSpace } from '../../../shared/develop/pipeline'
import { sanitize } from '../../../shared/develop/settings'
import { unpackLut } from '../../../shared/develop/lut'
import type { RenderJob, RenderResult } from '../../../shared/develop/render'

declare global {
  interface Window {
    glimmrRender: { onJob(cb: (job: RenderJob) => void): void; done(id: number, result: RenderResult): void; ready(): void }
  }
}

let eng: DevelopGL | null = null
const engine = (): DevelopGL => (eng ??= new DevelopGL(new OffscreenCanvas(16, 16)))

async function run(job: RenderJob): Promise<RenderResult> {
  const e = engine()
  const s = sanitize(job.settings, job.source.kind)
  const lut = job.lut ? unpackLut(job.lut) : null
  e.setLut(lut, job.lutKey ?? '')
  e.setLutRange(lut)
  const info = { kind: job.source.kind, fullWidth: job.source.fullWidth, camera: job.source.camera, autoMul: job.source.autoMul }
  const out: OutputSpace = job.output ?? 'srgb'
  if (job.full) {
    // Grid from the whole picture (the editing copy), then the full image in tiles.
    e.setSource(job.proxy, job.source.width, job.source.height)
    e.computeGrid(prepare(s, info, job.source.width / job.source.fullWidth, out))
    const p = prepare(s, info, job.full.width / job.source.fullWidth, out)
    const data = renderTiled(e, p, job.full, { float: !!job.float })
    return { width: job.full.width, height: job.full.height, data, float: !!job.float, wb: p.wb }
  }
  e.setSource(job.proxy, job.source.width, job.source.height)
  const p = prepare(s, info, job.source.width / job.source.fullWidth, out)
  const t = e.render(p, { float: !!job.float })
  return { width: t.w, height: t.h, data: e.read(t, !!job.float), float: !!job.float, wb: p.wb }
}

window.glimmrRender.onJob(async (job) => {
  try {
    window.glimmrRender.done(job.id, await run(job))
  } catch (err) {
    window.glimmrRender.done(job.id, { error: (err as Error).message } as RenderResult)
  }
})
window.glimmrRender.ready()
