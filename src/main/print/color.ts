// Colour management for printing with Little CMS (WebAssembly): conversion to a printer/paper profile with any
// rendering intent and black point compensation, soft proofing, and a gamut warning. sharp can't do these: its
// ICC conversions are always perceptual with no proofing.

import fs from 'node:fs'
import {
  cmsFLAGS_BLACKPOINTCOMPENSATION,
  cmsFLAGS_NOCACHE,
  INTENT_ABSOLUTE_COLORIMETRIC,
  INTENT_PERCEPTUAL,
  INTENT_RELATIVE_COLORIMETRIC,
  INTENT_SATURATION,
  instantiate,
  TYPE_CMYK_8,
  TYPE_RGB_8,
  type Lcms
} from './vendor/lcms.js'
import type { Intent } from '../../shared/print'

let engine: Promise<Lcms> | null = null
let wasmSource: () => Uint8Array = () => {
  throw new Error('The colour engine isn’t set up')
}

/** Where to load the WebAssembly from (the bundled asset in the app, the vendored file in tests). */
export function setWasmSource(load: () => Uint8Array): void {
  wasmSource = load
  engine = null
}

export function lcms(): Promise<Lcms> {
  engine ??= instantiate({ wasmBinary: wasmSource() })
  engine.catch(() => (engine = null))
  return engine
}

const INTENTS: Record<Intent, number> = {
  perceptual: INTENT_PERCEPTUAL,
  relative: INTENT_RELATIVE_COLORIMETRIC,
  saturation: INTENT_SATURATION,
  absolute: INTENT_ABSOLUTE_COLORIMETRIC
}

const SIG_RGB = 0x52474220
const SIG_CMYK = 0x434d594b

interface Opened {
  handle: number
  space: 'RGB' | 'CMYK'
}

const opened = new Map<string, Opened>()

async function open(file: string): Promise<Opened> {
  const hit = opened.get(file)
  if (hit) return hit
  const cms = await lcms()
  const data = new Uint8Array(await fs.promises.readFile(file))
  const handle = cms.cmsOpenProfileFromMem(data, data.byteLength)
  if (!handle) throw new Error('That colour profile couldn’t be read.')
  const sig = cms.cmsGetColorSpace(handle)
  if (sig !== SIG_RGB && sig !== SIG_CMYK) {
    cms.cmsCloseProfile(handle)
    throw new Error('Only RGB and CMYK printer profiles are supported.')
  }
  const p: Opened = { handle, space: sig === SIG_RGB ? 'RGB' : 'CMYK' }
  opened.set(file, p)
  return p
}

let srgbHandle = 0
async function srgb(): Promise<number> {
  if (!srgbHandle) srgbHandle = (await lcms()).cmsCreate_sRGBProfile()
  return srgbHandle
}

/** Runs a transform over a pixel buffer in strips, so big prints don't need a huge WebAssembly heap. */
async function run(transform: number, src: Uint8Array, inCh: number, outCh: number): Promise<Uint8Array> {
  const cms = await lcms()
  const pixels = src.length / inCh
  const out = new Uint8Array(pixels * outCh)
  const strip = 1 << 20
  for (let p = 0; p < pixels; p += strip) {
    const n = Math.min(strip, pixels - p)
    out.set(cms.cmsDoTransform(transform, src.subarray(p * inCh, (p + n) * inCh), n) as Uint8Array, p * outCh)
  }
  return out
}

async function transform(from: number, fromFmt: number, to: number, toFmt: number, intent: Intent, bpc: boolean): Promise<number> {
  const cms = await lcms()
  const t = cms.cmsCreateTransform(from, fromFmt, to, toFmt, INTENTS[intent], (bpc && intent !== 'absolute' ? cmsFLAGS_BLACKPOINTCOMPENSATION : 0) | cmsFLAGS_NOCACHE)
  if (!t) throw new Error('Glimmr couldn’t build a colour transform for that profile.')
  return t
}

export interface ProfileInfo {
  description: string
  space: 'RGB' | 'CMYK'
}

export async function profileInfo(file: string): Promise<ProfileInfo> {
  const p = await open(file)
  const cms = await lcms()
  return { description: cms.cmsGetProfileInfoASCII(p.handle, 0, 'en', 'US').trim(), space: p.space }
}

/** Converts sRGB pixels (RGB, 8-bit) to a printer profile's device values. Returns RGB or CMYK bytes. */
export async function toProfile(rgb: Uint8Array, profile: string, intent: Intent, bpc: boolean): Promise<{ data: Uint8Array; channels: 3 | 4 }> {
  const p = await open(profile)
  const fmt = p.space === 'RGB' ? TYPE_RGB_8 : TYPE_CMYK_8
  const t = await transform(await srgb(), TYPE_RGB_8, p.handle, fmt, intent, bpc)
  try {
    return { data: await run(t, rgb, 3, p.space === 'RGB' ? 3 : 4), channels: p.space === 'RGB' ? 3 : 4 }
  } finally {
    ;(await lcms()).cmsDeleteTransform(t)
  }
}

/**
 * Soft proof: how sRGB pixels will look printed with this profile and intent, back in sRGB for the screen. With a
 * gamut warning, colours the profile can't reach (they shift by more than a few levels on a colorimetric round
 * trip) are painted in the warning colour.
 */
export async function softProof(rgb: Uint8Array, profile: string, intent: Intent, bpc: boolean, gamutWarning: [number, number, number] | null): Promise<Uint8Array> {
  const p = await open(profile)
  const fmt = p.space === 'RGB' ? TYPE_RGB_8 : TYPE_CMYK_8
  const ch = p.space === 'RGB' ? 3 : 4
  const s = await srgb()
  const cms = await lcms()
  const fwd = await transform(s, TYPE_RGB_8, p.handle, fmt, intent, bpc)
  // Back to the screen colorimetrically, so the proof shows the print's actual colours.
  const back = await transform(p.handle, fmt, s, TYPE_RGB_8, 'relative', false)
  const backBpc = gamutWarning && bpc ? await transform(p.handle, fmt, s, TYPE_RGB_8, 'relative', true) : back
  try {
    const proof = await run(back, await run(fwd, rgb, 3, ch), ch, 3)
    if (gamutWarning) {
      // With black point compensation as chosen, so deep shadows (which BPC maps into range) aren't flagged.
      const fwdC = await transform(s, TYPE_RGB_8, p.handle, fmt, 'relative', bpc)
      try {
        const trip = await run(backBpc, await run(fwdC, rgb, 3, ch), ch, 3)
        for (let i = 0; i < rgb.length; i += 3) {
          const d = Math.max(Math.abs(rgb[i] - trip[i]), Math.abs(rgb[i + 1] - trip[i + 1]), Math.abs(rgb[i + 2] - trip[i + 2]))
          if (d > GAMUT_TOLERANCE) proof.set(gamutWarning, i)
        }
      } finally {
        cms.cmsDeleteTransform(fwdC)
      }
    }
    return proof
  } finally {
    cms.cmsDeleteTransform(fwd)
    cms.cmsDeleteTransform(back)
    if (backBpc !== back) cms.cmsDeleteTransform(backBpc)
  }
}

/** A colour that moves more than this (0–255) on a colorimetric round trip is out of the profile's gamut. */
export const GAMUT_TOLERANCE = 12
