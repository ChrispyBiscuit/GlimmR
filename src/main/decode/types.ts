// What a decoder hands back: pixels (8-bit, interleaved, upright) with their ICC profile, or an encoded image sharp
// reads itself (a PNG or JPEG).

export type Decoded =
  | {
      data: Uint8Array
      width: number
      height: number
      channels: 1 | 2 | 3 | 4
      icc?: Uint8Array
      encoded?: undefined
    }
  | {
      encoded: Uint8Array
      /** Only a small embedded preview was available. */ thumbnailOnly?: boolean
      data?: undefined
      width?: undefined
      height?: undefined
      channels?: undefined
      icc?: undefined
    }
