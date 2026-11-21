// The develop pipeline on the GPU (WebGL2): the same stages and parameters as the CPU reference in
// src/shared/develop/pipeline.ts. Used live by the Develop view and, in a hidden window, for previews, export and
// print (rendering big images in tiles).

import { LAB_TO_LMS, LMS_TO_LAB, LMS_TO_REC2020, REC2020_TO_LMS, type Mat3 } from '../../../shared/develop/color'
import { CURVE_SIZE } from '../../../shared/develop/curves'
import type { Lut } from '../../../shared/develop/lut'
import { GRID_CELLS, HUE_CENTERS, TONE_SLOPE, type Params } from '../../../shared/develop/pipeline'
import { BLUR, DISPLAY, GRID, OUTPUT, PRESENT, SCENE, TO_LAB, VERT } from './shaders'

type GL = WebGL2RenderingContext

export interface Target {
  tex: WebGLTexture
  fb: WebGLFramebuffer
  w: number
  h: number
}

const TONE_OFFSET = Math.log(1 / 0.18 - 1) / TONE_SLOPE

/** WebGL wants column-major matrices; ours are row-major. */
const colMajor = (m: Mat3): Float32Array => new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]])

export class DevelopGL {
  readonly gl: GL
  private progs = new Map<string, WebGLProgram>()
  private quad: WebGLBuffer
  private src: WebGLTexture | null = null
  private srcW = 0
  private srcH = 0
  private targets = new Map<string, Target>()
  private curveTex: WebGLTexture
  private lut3: WebGLTexture
  private shaper: WebGLTexture
  private lutInfo: { size: number; shaper: number; key: string } = { size: 0, shaper: 0, key: '' }
  /** The local brightness grid, blurred: computed from the whole image (or the editing copy) and reused by tiles. */
  private grid: Target | null = null

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true }) as GL | null
    if (!gl) throw new Error('WebGL2 isn’t available.')
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('This graphics card can’t render to float textures.')
    gl.getExtension('OES_texture_float_linear')
    this.gl = gl
    this.quad = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    this.curveTex = this.makeTex()
    this.lut3 = gl.createTexture()!
    this.shaper = this.makeTex()
  }

  get maxTexture(): number {
    return this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) as number
  }

  private makeTex(filter: number = this.gl.LINEAR): WebGLTexture {
    const gl = this.gl
    const t = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return t
  }

  private target(name: string, w: number, h: number, format: 'f16' | 'r16' | 'u8' = 'f16'): Target {
    const gl = this.gl
    const cur = this.targets.get(name)
    if (cur && cur.w === w && cur.h === h) return cur
    if (cur) {
      gl.deleteTexture(cur.tex)
      gl.deleteFramebuffer(cur.fb)
    }
    const tex = this.makeTex()
    if (format === 'u8') gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    else if (format === 'r16') gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, w, h, 0, gl.RED, gl.HALF_FLOAT, null)
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)
    const fb = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    const t = { tex, fb, w, h }
    this.targets.set(name, t)
    return t
  }

  private prog(name: string, src: string): WebGLProgram {
    const hit = this.progs.get(name)
    if (hit) return hit
    const gl = this.gl
    const sh = (type: number, s: string): WebGLShader => {
      const o = gl.createShader(type)!
      gl.shaderSource(o, s)
      gl.compileShader(o)
      if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(`${name} shader: ${gl.getShaderInfoLog(o)}`)
      return o
    }
    const p = gl.createProgram()!
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT))
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, src))
    gl.bindAttribLocation(p, 0, 'pos')
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`${name} program: ${gl.getProgramInfoLog(p)}`)
    this.progs.set(name, p)
    return p
  }

  /** Runs a pass into a target (or the screen), with uniforms and textures. */
  private pass(name: string, src: string, to: Target | null, set: (u: (n: string) => WebGLUniformLocation | null, p: WebGLProgram) => void, textures: [string, WebGLTexture, number?][] = []): void {
    const gl = this.gl
    const p = this.prog(name, src)
    gl.useProgram(p)
    gl.bindFramebuffer(gl.FRAMEBUFFER, to?.fb ?? null)
    if (to) gl.viewport(0, 0, to.w, to.h)
    else gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
    const u = (n: string): WebGLUniformLocation | null => gl.getUniformLocation(p, n)
    textures.forEach(([n, t, target], i) => {
      gl.activeTexture(gl.TEXTURE0 + i)
      gl.bindTexture(target ?? gl.TEXTURE_2D, t)
      gl.uniform1i(u(n), i)
    })
    gl.uniformMatrix3fv(u('uToLms'), false, colMajor(REC2020_TO_LMS))
    gl.uniformMatrix3fv(u('uFromLms'), false, colMajor(LMS_TO_REC2020))
    gl.uniformMatrix3fv(u('uLmsToLab'), false, colMajor(LMS_TO_LAB))
    gl.uniformMatrix3fv(u('uLabToLms'), false, colMajor(LAB_TO_LMS))
    set(u, p)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  /** Uploads source pixels (16-bit RGB, rows top to bottom) as the source texture. */
  setSource(data: Uint16Array, w: number, h: number): void {
    const gl = this.gl
    const f = new Float32Array(w * h * 3)
    for (let i = 0; i < f.length; i++) f[i] = data[i] / 65535
    if (!this.src) this.src = this.makeTex(gl.NEAREST)
    gl.bindTexture(gl.TEXTURE_2D, this.src)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB16F, w, h, 0, gl.RGB, gl.FLOAT, f)
    this.srcW = w
    this.srcH = h
  }

  get sourceSize(): { w: number; h: number } {
    return { w: this.srcW, h: this.srcH }
  }

  /** Uploads a LUT (once per LUT). */
  setLut(lut: Lut | null, key: string): void {
    const gl = this.gl
    if (!lut) {
      this.lutInfo = { size: 0, shaper: 0, key: '' }
      return
    }
    if (this.lutInfo.key === key) return
    gl.bindTexture(gl.TEXTURE_3D, this.lut3)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    const n = Math.max(1, lut.size)
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB32F, n, n, n, 0, gl.RGB, gl.FLOAT, lut.size ? lut.data : new Float32Array(3))
    if (lut.shaper) {
      gl.bindTexture(gl.TEXTURE_2D, this.shaper)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, lut.shaper.size, 1, 0, gl.RGB, gl.FLOAT, lut.shaper.data)
    }
    this.lutInfo = { size: lut.size, shaper: lut.shaper?.size ?? 0, key }
  }

  private lutRange: { min: number[]; max: number[]; shaper: [number, number] } = { min: [0, 0, 0], max: [1, 1, 1], shaper: [0, 1] }

  setLutRange(lut: Lut | null): void {
    if (lut) this.lutRange = { min: lut.domainMin, max: lut.domainMax, shaper: lut.shaper ? [lut.shaper.min, lut.shaper.max] : [0, 1] }
  }

  /** Scene pass over a source texture region into `scene`. */
  private scenePass(p: Params, to: Target): void {
    const gl = this.gl
    this.pass('scene', SCENE, to, (u) => {
      gl.uniform1i(u('uDecodeSrgb'), p.decodeSrgb ? 1 : 0)
      gl.uniform3fv(u('uPreMul'), p.preMul)
      gl.uniform1f(u('uClip'), Number.isFinite(p.clip) ? p.clip : 1e9)
      gl.uniformMatrix3fv(u('uInput'), false, colMajor(p.inputMatrix))
      gl.uniform1f(u('uExposure'), p.exposure)
    }, [['uSrc', this.src!]])
  }

  /**
   * Computes the local brightness grid from the current source, which must be the whole picture (the editing copy
   * will do: the grid is coarse). Tiles of a big render reuse it.
   */
  computeGrid(p: Params, sceneDone = false): void {
    const gl = this.gl
    const scene = this.target('scene', this.srcW, this.srcH)
    if (!sceneDone) this.scenePass(p, scene)
    const cell = Math.max(1, Math.ceil(Math.max(this.srcW, this.srcH) / GRID_CELLS))
    const gw = Math.ceil(this.srcW / cell)
    const gh = Math.ceil(this.srcH / cell)
    const g = this.target('grid', gw, gh, 'r16')
    this.pass('grid', GRID, g, (u) => {
      gl.uniform2i(u('uSize'), this.srcW, this.srcH)
      gl.uniform1i(u('uCell'), cell)
    }, [['uScene', scene.tex]])
    const t = this.target('gridT', gw, gh, 'r16')
    this.blur(g, t, [1, 0], 2)
    const b = this.target('gridB', gw, gh, 'r16')
    this.blur(t, b, [0, 1], 2)
    this.grid = b
  }

  private blur(from: Target, to: Target, dir: [number, number], sigma: number): void {
    this.pass('blur', BLUR, to, (u) => {
      this.gl.uniform2f(u('uDir'), dir[0], dir[1])
      this.gl.uniform1f(u('uSigma'), sigma)
    }, [['uTex', from.tex]])
  }

  private blur2(from: Target, name: string, sigma: number): Target {
    const t = this.target(`${name}T`, from.w, from.h)
    this.blur(from, t, [1, 0], sigma)
    const o = this.target(name, from.w, from.h)
    this.blur(t, o, [0, 1], sigma)
    return o
  }

  /**
   * Renders the current source with these parameters into the 'out' target (RGBA8 encoded, or float linear).
   * `gridMap` places this source inside the whole picture for the local brightness grid (for tiles).
   */
  render(p: Params, opts: { encode?: boolean; clipping?: boolean; float?: boolean; gridMap?: [number, number, number, number]; crop?: [number, number, number, number] } = {}): Target {
    const gl = this.gl
    if (!this.src) throw new Error('No source')
    const scene = this.target('scene', this.srcW, this.srcH)
    this.scenePass(p, scene)
    // The grid depends on exposure and white balance, so it's recomputed, except for tiles (gridMap), which share the
    // grid computed from the whole picture.
    if (!opts.gridMap) this.computeGrid(p, true)
    else if (!this.grid) throw new Error('Compute the grid from the whole picture before rendering tiles.')
    // Curve table.
    if (p.curve) {
      gl.bindTexture(gl.TEXTURE_2D, this.curveTex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, CURVE_SIZE, 1, 0, gl.RGBA, gl.FLOAT, p.curve)
    }
    const disp = this.target('disp', this.srcW, this.srcH)
    const gm = opts.gridMap ?? [0, 0, this.srcW, this.srcH]
    const touched = p.vibrance || p.saturation || p.bw || p.hue.some(Boolean) || p.sat.some(Boolean) || p.lum.some(Boolean)
    const lutMode = p.lut && (this.lutInfo.size || this.lutInfo.shaper) ? (p.lut.log ? 2 : 1) : 0
    this.pass(
      'display',
      DISPLAY,
      disp,
      (u) => {
        gl.uniform4f(u('uGridMap'), gm[0], gm[1], gm[2], gm[3])
        gl.uniform1f(u('uShadows'), p.shadows)
        gl.uniform1f(u('uHighlights'), p.highlights)
        gl.uniform1f(u('uContrast'), p.contrast)
        gl.uniform1f(u('uWhite'), p.white)
        gl.uniform1f(u('uBlacks'), p.blacks)
        gl.uniform1f(u('uToneSlope'), TONE_SLOPE)
        gl.uniform1f(u('uToneOffset'), TONE_OFFSET)
        gl.uniform1i(u('uCurveOn'), p.curve ? 1 : 0)
        gl.uniform1f(u('uVibrance'), p.vibrance)
        gl.uniform1f(u('uSaturation'), p.saturation)
        gl.uniform1fv(u('uHue'), p.hue)
        gl.uniform1fv(u('uSat'), p.sat)
        gl.uniform1fv(u('uLum'), p.lum)
        gl.uniform1i(u('uBw'), p.bw ? 1 : 0)
        gl.uniform1fv(u('uBwMix'), p.bwMix)
        gl.uniform1fv(u('uHueCenters'), HUE_CENTERS)
        gl.uniform1i(u('uColorOn'), touched ? 1 : 0)
        gl.uniform1i(u('uLutMode'), lutMode)
        if (p.lut) {
          gl.uniform1i(u('uLutSpace'), p.lut.space)
          gl.uniform1f(u('uLutAmount'), p.lut.amount)
          gl.uniformMatrix3fv(u('uToLut'), false, colMajor(p.lut.toLut))
          gl.uniformMatrix3fv(u('uFromLut'), false, colMajor(p.lut.fromLut))
        }
        gl.uniform1i(u('uLutSize'), this.lutInfo.size)
        gl.uniform3fv(u('uLutMin'), this.lutRange.min)
        gl.uniform3fv(u('uLutMax'), this.lutRange.max)
        gl.uniform1i(u('uShaperSize'), this.lutInfo.shaper)
        gl.uniform2fv(u('uShaperRange'), this.lutRange.shaper)
      },
      [
        ['uScene', scene.tex],
        ['uGrid', this.grid!.tex],
        ['uCurve', this.curveTex],
        ['uLut3', this.lut3, gl.TEXTURE_3D],
        ['uShaper', this.shaper]
      ]
    )
    const d = p.detail
    const detail = !!(d.sharpen || d.lumNr || d.colorNr)
    let lab = disp
    let lumNr = disp
    let sharp = disp
    let colNr = disp
    if (detail) {
      lab = this.target('lab', this.srcW, this.srcH)
      this.pass('lab', TO_LAB, lab, () => {}, [['uTex', disp.tex]])
      if (d.lumNr) lumNr = this.blur2(lab, 'lumNr', d.lumSigma)
      if (d.sharpen) sharp = this.blur2(lab, 'sharp', d.sharpenSigma)
      if (d.colorNr) colNr = this.blur2(lab, 'colNr', d.colorSigma)
    }
    const crop = opts.crop ?? [0, 0, this.srcW, this.srcH]
    const out = this.target(opts.float ? 'outF' : 'out', crop[2], crop[3], opts.float ? 'f16' : 'u8')
    this.pass(
      'output',
      OUTPUT,
      out,
      (u) => {
        gl.uniform1i(u('uDetail'), detail ? 1 : 0)
        gl.uniform1f(u('uSharpen'), d.sharpen)
        gl.uniform1f(u('uLimit'), d.limit)
        gl.uniform1f(u('uMasking'), d.masking)
        gl.uniform1f(u('uLumNrAmt'), d.lumNr)
        gl.uniform1f(u('uColorNrAmt'), d.colorNr)
        gl.uniformMatrix3fv(u('uOutput'), false, colMajor(p.outputMatrix))
        gl.uniform1i(u('uEncode'), opts.encode === false ? 0 : 1)
        gl.uniform1i(u('uClipping'), opts.clipping ? 1 : 0)
        gl.uniform2i(u('uOffset'), crop[0], crop[1])
      },
      [
        ['uDisp', disp.tex],
        ['uLab', lab.tex],
        ['uLumNr', lumNr.tex],
        ['uSharp', sharp.tex],
        ['uColNr', colNr.tex]
      ]
    )
    return out
  }

  /** Keeps a rendered image for the before/after view. */
  keep(t: Target, name: string): Target {
    const k = this.target(name, t.w, t.h, 'u8')
    const gl = this.gl
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.fb)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, k.fb)
    gl.blitFramebuffer(0, 0, t.w, t.h, 0, 0, t.w, t.h, gl.COLOR_BUFFER_BIT, gl.NEAREST)
    return k
  }

  /** Draws a rendered image to the canvas at a place (in canvas uv units, y up), with an optional split. */
  present(img: Target, view: [number, number, number, number], opts: { before?: Target | null; splitAt?: number; bg?: [number, number, number] } = {}): void {
    const gl = this.gl
    this.pass('present', PRESENT, null, (u) => {
      gl.uniform4f(u('uView'), view[0], view[1], view[2], view[3])
      gl.uniform1i(u('uSplit'), opts.before ? 1 : 0)
      gl.uniform1f(u('uSplitAt'), opts.splitAt ?? 0.5)
      gl.uniform3fv(u('uBg'), opts.bg ?? [0.07, 0.07, 0.07])
    }, [
      ['uImage', img.tex],
      ['uBefore', (opts.before ?? img).tex]
    ])
  }

  /** Reads a target back: 8-bit RGBA, or float RGBA for float targets. Rows come out top to bottom of the image. */
  read(t: Target, float = false): Uint8Array | Float32Array {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb)
    if (float) {
      const out = new Float32Array(t.w * t.h * 4)
      gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.FLOAT, out)
      return out
    }
    const out = new Uint8Array(t.w * t.h * 4)
    gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.UNSIGNED_BYTE, out)
    return out
  }

  /** One pixel of an 8-bit target (x, y in image pixels from the top left), as 0–1 RGB. */
  pixel(t: Target, x: number, y: number): [number, number, number] {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb)
    const out = new Uint8Array(4)
    gl.readPixels(Math.min(t.w - 1, Math.max(0, Math.floor(x))), Math.min(t.h - 1, Math.max(0, Math.floor(y))), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out)
    return [out[0] / 255, out[1] / 255, out[2] / 255]
  }

  /** Forgets the grid (after the source or exposure-affecting settings change). */
  resetGrid(): void {
    this.grid = null
  }

  dispose(): void {
    const gl = this.gl
    for (const t of this.targets.values()) {
      gl.deleteTexture(t.tex)
      gl.deleteFramebuffer(t.fb)
    }
    this.targets.clear()
    if (this.src) gl.deleteTexture(this.src)
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}

/**
 * Renders a big image in tiles (keeping GPU memory bounded): each tile is uploaded with a margin wide enough for the
 * blurs, rendered with the grid computed from the whole picture, and its interior read back.
 */
export function renderTiled(
  eng: DevelopGL,
  p: Params,
  full: { data: Uint16Array; width: number; height: number },
  opts: { float: boolean; tile?: number }
): Uint8Array | Float32Array {
  const T = opts.tile ?? 2048
  const sig = Math.max(p.detail.sharpenSigma, p.detail.lumSigma, p.detail.colorSigma)
  const M = Math.ceil(sig * 3) + 2
  const { width: W, height: H } = full
  const out = opts.float ? new Float32Array(W * H * 4) : new Uint8Array(W * H * 4)
  for (let ty = 0; ty < H; ty += T)
    for (let tx = 0; tx < W; tx += T) {
      const x0 = Math.max(0, tx - M)
      const y0 = Math.max(0, ty - M)
      const x1 = Math.min(W, tx + T + M)
      const y1 = Math.min(H, ty + T + M)
      const w = x1 - x0
      const h = y1 - y0
      const region = new Uint16Array(w * h * 3)
      for (let y = 0; y < h; y++) region.set(full.data.subarray(((y0 + y) * W + x0) * 3, ((y0 + y) * W + x0 + w) * 3), y * w * 3)
      eng.setSource(region, w, h)
      const iw = Math.min(T, W - tx)
      const ih = Math.min(T, H - ty)
      const t = eng.render(p, { float: opts.float, encode: true, gridMap: [x0, y0, W, H], crop: [tx - x0, ty - y0, iw, ih] })
      const px = eng.read(t, opts.float)
      for (let y = 0; y < ih; y++) out.set(px.subarray(y * iw * 4, (y + 1) * iw * 4), ((ty + y) * W + tx) * 4)
    }
  return out
}
