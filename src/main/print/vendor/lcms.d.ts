// Types for the vendored lcms-wasm build (Little CMS 2.16 compiled to WebAssembly, MIT): only what Glimmr uses.
export interface Lcms {
  cmsOpenProfileFromMem(data: Uint8Array, size: number): number
  cmsCloseProfile(profile: number): void
  cmsCreate_sRGBProfile(): number
  cmsCreateLab4Profile(whitePoint?: number[] | null): number
  cmsGetProfileInfoASCII(profile: number, info: number, lang: string, country: string): string
  cmsGetColorSpace(profile: number): number
  cmsFormatterForColorspaceOfProfile(profile: number, bytes: number, isFloat: number): number
  cmsCreateTransform(input: number, inFormat: number, output: number, outFormat: number, intent: number, flags: number): number
  cmsCreateProofingTransform(input: number, inFormat: number, output: number, outFormat: number, proofing: number, intent: number, proofingIntent: number, flags: number): number
  cmsDeleteTransform(transform: number): void
  cmsDoTransform(transform: number, input: Uint8Array | Uint16Array | Float32Array, pixels: number): Uint8Array | Uint16Array | Float32Array
}
export function instantiate(options?: { wasmBinary?: ArrayBuffer | Uint8Array; locateFile?: (name: string) => string }): Promise<Lcms>
export const TYPE_RGB_8: number
export const TYPE_RGB_16: number
export const TYPE_CMYK_8: number
export const cmsInfoDescription: number
export const cmsFLAGS_BLACKPOINTCOMPENSATION: number
export const cmsFLAGS_SOFTPROOFING: number
export const cmsFLAGS_GAMUTCHECK: number
export const cmsFLAGS_NOCACHE: number
export const INTENT_PERCEPTUAL: number
export const INTENT_RELATIVE_COLORIMETRIC: number
export const INTENT_SATURATION: number
export const INTENT_ABSOLUTE_COLORIMETRIC: number
