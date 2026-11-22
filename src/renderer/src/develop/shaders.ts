// GLSL for the develop pipeline. Every function mirrors its counterpart in src/shared/develop/pipeline.ts and
// color.ts; keep them in step (tests compare the GPU result with the CPU reference).

export const VERT = `#version 300 es
in vec2 pos;
out vec2 uv;
void main() {
  uv = pos * 0.5 + 0.5;
  gl_Position = vec4(pos, 0.0, 1.0);
}`

const COMMON = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler3D;
in vec2 uv;
out vec4 frag;
const float GREY = 0.18;
const vec3 LUMA = vec3(0.2627, 0.678, 0.0593);
float luma(vec3 c) { return dot(c, LUMA); }
float sstep(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
float srgbEncode(float x) { return x <= 0.0031308 ? 12.92 * x : 1.055 * pow(max(x, 0.0), 1.0 / 2.4) - 0.055; }
float srgbDecode(float v) { return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4); }
vec3 srgbEncode3(vec3 c) { return vec3(srgbEncode(c.r), srgbEncode(c.g), srgbEncode(c.b)); }
vec3 srgbDecode3(vec3 c) { return vec3(srgbDecode(c.r), srgbDecode(c.g), srgbDecode(c.b)); }
// Oklab via Rec.2020 → LMS (matrices passed in, as computed in color.ts).
uniform mat3 uToLms;
uniform mat3 uFromLms;
uniform mat3 uLmsToLab;
uniform mat3 uLabToLms;
vec3 cbrt3(vec3 v) { return sign(v) * pow(abs(v), vec3(1.0 / 3.0)); }
vec3 toOklab(vec3 c) { return uLmsToLab * cbrt3(uToLms * c); }
vec3 fromOklab(vec3 lab) { vec3 l = uLabToLms * lab; return uFromLms * (l * l * l); }
`

/** Pass 1: source → linear Rec.2020 scene value (white balance, camera colour, exposure); alpha = log brightness. */
export const SCENE = `${COMMON}
uniform sampler2D uSrc;
uniform bool uDecodeSrgb;
uniform vec3 uPreMul;
uniform float uClip;
uniform mat3 uInput;
uniform float uExposure;
void main() {
  vec3 c = texture(uSrc, uv).rgb;
  vec3 x = uDecodeSrgb ? srgbDecode3(c) : c;
  x = min(x * uPreMul, vec3(uClip));
  vec3 r = (uInput * x) * uExposure;
  frag = vec4(r, log2(max(luma(r), 1e-5) / GREY));
}`

/** Pass 2: the local brightness grid: block averages of log brightness. */
export const GRID = `${COMMON}
uniform sampler2D uScene;
uniform ivec2 uSize;
uniform int uCell;
void main() {
  ivec2 g = ivec2(gl_FragCoord.xy);
  float acc = 0.0;
  float n = 0.0;
  for (int j = 0; j < 96; j++) {
    if (j >= uCell) break;
    int y = g.y * uCell + j;
    if (y >= uSize.y) break;
    for (int i = 0; i < 96; i++) {
      if (i >= uCell) break;
      int x = g.x * uCell + i;
      if (x >= uSize.x) break;
      acc += texelFetch(uScene, ivec2(x, y), 0).a;
      n += 1.0;
    }
  }
  frag = vec4(n > 0.0 ? acc / n : 0.0, 0.0, 0.0, 1.0);
}`

/** Separable Gaussian (radius 3σ, clamped edges), one direction per pass. */
export const BLUR = `${COMMON}
uniform sampler2D uTex;
uniform vec2 uDir;
uniform float uSigma;
void main() {
  ivec2 size = textureSize(uTex, 0);
  ivec2 p = ivec2(gl_FragCoord.xy);
  int r = max(1, int(ceil(uSigma * 3.0)));
  vec4 acc = vec4(0.0);
  float sum = 0.0;
  for (int i = -64; i <= 64; i++) {
    if (i < -r) continue;
    if (i > r) break;
    float w = exp(-float(i * i) / (2.0 * uSigma * uSigma));
    ivec2 q = clamp(p + ivec2(uDir) * i, ivec2(0), size - 1);
    acc += texelFetch(uTex, q, 0) * w;
    sum += w;
  }
  frag = acc / sum;
}`

/** Pass 3: scene → display-referred (tone, tone map, curves, colour, LUTs). */
export const DISPLAY = `${COMMON}
uniform sampler2D uScene;
uniform sampler2D uGrid;
uniform vec4 uGridMap; // grid uv = (pixel + offset) / fullSize: xy offset, zw full size
uniform float uShadows;
uniform float uHighlights;
uniform float uContrast;
uniform float uWhite;
uniform float uBlacks;
uniform float uToneSlope;
uniform float uToneOffset;
uniform bool uCurveOn;
uniform sampler2D uCurve;
uniform float uVibrance;
uniform float uSaturation;
uniform float uHue[8];
uniform float uSat[8];
uniform float uLum[8];
uniform bool uBw;
uniform float uBwMix[8];
uniform float uHueCenters[8];
uniform bool uColorOn;
// LUT
uniform int uLutMode; // 0 none, 1 display, 2 log (replaces the tone map)
uniform int uLutSpace;
uniform float uLutAmount;
uniform mat3 uToLut;
uniform mat3 uFromLut;
uniform highp sampler3D uLut3;
uniform int uLutSize;
uniform vec3 uLutMin;
uniform vec3 uLutMax;
uniform sampler2D uShaper;
uniform int uShaperSize;
uniform vec2 uShaperRange;
// Layers: per-pixel sums (local1: exposure, contrast, highlights, shadows; local2: temp, tint, saturation).
uniform bool uLocalOn;
uniform sampler2D uLocal1;
uniform sampler2D uLocal2;
vec4 L1 = vec4(0.0);
vec4 L2 = vec4(0.0);

vec3 toneScene(vec3 c, float local) {
  float b = 0.75 * log2(max(luma(c), 1e-6) / GREY) + 0.25 * local;
  float ws = 1.0 - sstep(-4.0, 0.0, b);
  float wh = sstep(-0.5, 2.0, b);
  float g = exp2((uShadows + L1.a) * 1.6 * ws + (uHighlights + L1.b) * 1.6 * wh);
  vec3 x = c * g;
  float l = log2(max(luma(x), 1e-6) / GREY);
  return x * exp2(l * (uContrast + L1.g));
}

float toneCurve(float Y) {
  float st = log2(max(Y, 1e-10) / GREY);
  st = st > 0.0 ? st * uWhite : st * uBlacks;
  return 1.0 / (1.0 + exp(-uToneSlope * (st - uToneOffset)));
}

vec3 toneMap(vec3 c) {
  vec3 x = max(c, vec3(0.0));
  float Y = luma(x);
  float Yd = toneCurve(Y);
  float k = Y > 1e-10 ? Yd / Y : 0.0;
  vec3 d = x * k;
  float m = max(d.r, max(d.g, d.b));
  if (m > 1.0) {
    float yd = min(Yd, 1.0);
    float t = m - yd > 1e-6 ? (1.0 - yd) / (m - yd) : 0.0;
    d = vec3(yd) + (d - vec3(yd)) * t;
  }
  return clamp(d, 0.0, 1.0);
}

float curveAt(int k, float x) {
  // Same as sampleCurve: linear between table entries.
  float f = clamp(x, 0.0, 1.0) * 1023.0;
  return texture(uCurve, vec2((f + 0.5) / 1024.0, 0.5))[k];
}

vec3 curveStage(vec3 c) {
  if (!uCurveOn) return c;
  vec3 e = srgbEncode3(c);
  return srgbDecode3(vec3(curveAt(0, e.r), curveAt(1, e.g), curveAt(2, e.b)));
}

void bandWeights(float hueDeg, out float w[8]) {
  for (int i = 0; i < 8; i++) w[i] = 0.0;
  float h = mod(mod(hueDeg, 360.0) + 360.0, 360.0);
  if (h < uHueCenters[0]) h += 360.0;
  for (int i = 0; i < 8; i++) {
    float a = uHueCenters[i];
    float b = i == 7 ? uHueCenters[0] + 360.0 : uHueCenters[i + 1];
    if (h >= a && h < b) {
      float t = (h - a) / (b - a);
      float s = t * t * (3.0 - 2.0 * t);
      w[i] = 1.0 - s;
      w[(i + 1) % 8] = s;
      break;
    }
  }
}

vec3 colorStage(vec3 c) {
  if (!uColorOn) return c;
  vec3 lab = toOklab(c);
  float L = lab.x;
  float C = length(lab.yz);
  float h = degrees(atan(lab.z, lab.y));
  float w[8];
  bandWeights(h, w);
  float sh = 0.0, ss = 0.0, sl = 0.0, sb = 0.0;
  for (int i = 0; i < 8; i++) { sh += uHue[i] * w[i]; ss += uSat[i] * w[i]; sl += uLum[i] * w[i]; sb += uBwMix[i] * w[i]; }
  float cw = min(1.0, C / 0.08);
  h += sh * 30.0;
  C *= max(0.0, 1.0 + ss);
  L += sl * 0.2 * cw;
  float hn = (mod(mod(h, 360.0) + 360.0, 360.0) - 50.0) / 25.0;
  float skin = exp(-(hn * hn));
  C *= 1.0 + uVibrance * (1.0 - sstep(0.0, 0.22, C)) * (1.0 - 0.5 * skin);
  C *= max(0.0, 1.0 + uSaturation) * max(0.0, 1.0 + L2.b);
  if (uBw) { L += sb * 0.25 * cw; C = 0.0; }
  float hr = radians(h);
  return clamp(fromOklab(vec3(L, C * cos(hr), C * sin(hr))), 0.0, 1.0);
}

float encodeFor(int s, float x) {
  if (s == 0) return srgbEncode(clamp(x, 0.0, 1.0));
  if (s == 1) return pow(clamp(x, 0.0, 1.0), 1.0 / 2.4);
  if (s == 2) return x >= 0.01125 ? (420.0 + log(((x + 0.01) / (0.18 + 0.01))) / log(10.0) * 261.5) / 1023.0 : (x * (171.2102946929 - 95.0)) / 0.01125 / 1023.0 + 95.0 / 1023.0;
  if (s == 3) return x > 0.010591 ? 0.24719 * log(5.555556 * x + 0.052272) / log(10.0) + 0.385537 : 5.367655 * x + 0.092809;
  if (s == 4) return x < 0.01 ? 5.6 * x + 0.125 : 0.241514 * log(x + 0.00873) / log(10.0) + 0.598206;
  return x >= 0.00089 ? 0.344676 * log(0.555556 * x + 0.009468) / log(10.0) + 0.790453 : 8.735631 * x + 0.092864;
}
float decodeFrom(int s, float v) { return s == 0 ? srgbDecode(clamp(v, 0.0, 1.0)) : pow(clamp(v, 0.0, 1.0), 2.4); }

vec3 at3(int r, int g, int b) { return texelFetch(uLut3, ivec3(r, g, b), 0).rgb; }

vec3 applyLut(vec3 c) {
  if (uShaperSize > 0) {
    vec3 o;
    for (int k = 0; k < 3; k++) {
      float f = clamp((c[k] - uShaperRange.x) / (uShaperRange.y - uShaperRange.x), 0.0, 1.0) * float(uShaperSize - 1);
      int i = int(floor(f));
      int j = min(uShaperSize - 1, i + 1);
      float t = f - float(i);
      o[k] = mix(texelFetch(uShaper, ivec2(i, 0), 0)[k], texelFetch(uShaper, ivec2(j, 0), 0)[k], t);
    }
    c = o;
  }
  if (uLutSize == 0) return c;
  float N1 = float(uLutSize - 1);
  vec3 f = clamp((c - uLutMin) / (uLutMax - uLutMin), 0.0, 1.0) * N1;
  ivec3 i = min(ivec3(floor(f)), ivec3(uLutSize - 2));
  vec3 d = f - vec3(i);
  float fr = d.r, fg = d.g, fb = d.b;
  int r0 = i.r, g0 = i.g, b0 = i.b;
  vec3 c000 = at3(r0, g0, b0);
  vec3 c111 = at3(r0 + 1, g0 + 1, b0 + 1);
  if (fr > fg) {
    if (fg > fb) return c000 * (1.0 - fr) + at3(r0 + 1, g0, b0) * (fr - fg) + at3(r0 + 1, g0 + 1, b0) * (fg - fb) + c111 * fb;
    if (fr > fb) return c000 * (1.0 - fr) + at3(r0 + 1, g0, b0) * (fr - fb) + at3(r0 + 1, g0, b0 + 1) * (fb - fg) + c111 * fg;
    return c000 * (1.0 - fb) + at3(r0, g0, b0 + 1) * (fb - fr) + at3(r0 + 1, g0, b0 + 1) * (fr - fg) + c111 * fg;
  }
  if (fb > fg) return c000 * (1.0 - fb) + at3(r0, g0, b0 + 1) * (fb - fg) + at3(r0, g0 + 1, b0 + 1) * (fg - fr) + c111 * fr;
  if (fb > fr) return c000 * (1.0 - fg) + at3(r0, g0 + 1, b0) * (fg - fb) + at3(r0, g0 + 1, b0 + 1) * (fb - fr) + c111 * fr;
  return c000 * (1.0 - fg) + at3(r0, g0 + 1, b0) * (fg - fr) + at3(r0 + 1, g0 + 1, b0) * (fr - fb) + c111 * fb;
}

vec3 lutStage(vec3 c) {
  vec3 g = uToLut * c;
  vec3 e = vec3(encodeFor(uLutSpace, g.r), encodeFor(uLutSpace, g.g), encodeFor(uLutSpace, g.b));
  vec3 o = applyLut(e);
  return clamp(uFromLut * vec3(decodeFrom(uLutSpace, o.r), decodeFrom(uLutSpace, o.g), decodeFrom(uLutSpace, o.b)), 0.0, 1.0);
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(uScene, p, 0);
  if (uLocalOn) {
    L1 = texelFetch(uLocal1, p, 0);
    L2 = texelFetch(uLocal2, p, 0);
  }
  vec2 g = (vec2(p) + 0.5 + uGridMap.xy) / uGridMap.zw;
  float local = texture(uGrid, g).r;
  vec3 t = toneScene(s.rgb, local);
  vec3 d = toneMap(t);
  if (uLutMode == 2) d = clamp(d + (lutStage(t) - d) * uLutAmount, 0.0, 1.0);
  d = curveStage(d);
  d = colorStage(d);
  if (uLutMode == 1) d = clamp(d + (lutStage(d) - d) * uLutAmount, 0.0, 1.0);
  frag = vec4(d, 1.0);
}`

/** Display value → Oklab (for the detail passes). */
export const TO_LAB = `${COMMON}
uniform sampler2D uTex;
void main() { frag = vec4(toOklab(texelFetch(uTex, ivec2(gl_FragCoord.xy), 0).rgb), 1.0); }`

/** Final pass: detail (noise reduction, sharpening), output colour space and encoding, clipping overlay. */
export const OUTPUT = `${COMMON}
uniform bool uDetail;
uniform sampler2D uDisp;
uniform sampler2D uLab;
uniform sampler2D uLumNr;
uniform sampler2D uSharp;
uniform sampler2D uColNr;
uniform float uSharpen;
uniform float uLimit;
uniform float uMasking;
uniform float uLumNrAmt;
uniform float uColorNrAmt;
uniform mat3 uOutput;
uniform bool uEncode;
uniform bool uClipping;
uniform ivec2 uOffset;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy) + uOffset;
  vec3 c;
  if (uDetail) {
    vec3 lab = texelFetch(uLab, p, 0).rgb;
    float L = lab.x;
    float l = L;
    if (uLumNrAmt > 0.0) {
      float Lnr = texelFetch(uLumNr, p, 0).r;
      float q = (L - Lnr) / 0.04;
      l = L + (Lnr - L) * uLumNrAmt * exp(-(q * q));
    }
    if (uSharpen > 0.0) {
      float Ls = texelFetch(uSharp, p, 0).r;
      float diff = clamp(L - Ls, -uLimit, uLimit);
      float mask = uMasking > 0.0 ? sstep(uMasking * 0.5, uMasking, abs(L - Ls)) : 1.0;
      l += diff * uSharpen * mask;
    }
    vec2 ab = lab.yz;
    if (uColorNrAmt > 0.0) ab += (texelFetch(uColNr, p, 0).yz - ab) * uColorNrAmt;
    c = clamp(fromOklab(vec3(l, ab)), 0.0, 1.0);
  } else c = texelFetch(uDisp, p, 0).rgb;
  vec3 o = clamp(uOutput * c, 0.0, 1.0);
  if (uClipping) {
    vec3 pre = uOutput * c;
    if (max(pre.r, max(pre.g, pre.b)) >= 0.999) o = vec3(1.0, 0.1, 0.1);
    else if (min(pre.r, min(pre.g, pre.b)) <= 0.001 && max(pre.r, max(pre.g, pre.b)) <= 0.004) o = vec3(0.1, 0.35, 1.0);
  }
  frag = vec4(uEncode ? srgbEncode3(o) : o, 1.0);
}`

/** Draws a rendered image to the screen: zoom, pan, and an optional before/after split. */
export const PRESENT = `${COMMON}
uniform sampler2D uImage;
uniform sampler2D uBefore;
uniform bool uSplit;
uniform float uSplitAt;
uniform vec4 uView; // image rect on screen in uv units: x, y, width, height
uniform vec3 uBg;
uniform bool uOverlay;
uniform sampler2D uMaskTex;
void main() {
  vec2 q = (uv - uView.xy) / uView.zw;
  if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) { frag = vec4(uBg, 1.0); return; }
  q.y = 1.0 - q.y;
  vec3 c = uSplit && uv.x < uSplitAt ? texture(uBefore, q).rgb : texture(uImage, q).rgb;
  if (uOverlay) c = mix(c, vec3(1.0, 0.18, 0.18), 0.6 * clamp(texture(uMaskTex, q).r, 0.0, 1.0));
  frag = vec4(c, 1.0);
}`

// ---- layers ----

/** Brush dabs: one instanced quad per dab, placed in this source (a tile or the whole picture). */
export const VERT_DAB = `#version 300 es
in vec2 pos;
in vec2 center; // fractions of the whole picture's width and height
uniform vec4 uMap; // xy: this source's offset in the whole picture (pixels), zw: whole picture size
uniform vec2 uSrcSize;
uniform float uRadius; // fraction of the long edge
out vec2 offs;
void main() {
  offs = pos;
  float L = max(uMap.z, uMap.w);
  vec2 px = center * uMap.zw - uMap.xy + pos * uRadius * L;
  gl_Position = vec4(px / uSrcSize * 2.0 - 1.0, 0.0, 1.0);
}`

export const DAB = `${COMMON}
in vec2 offs;
uniform float uFeather;
uniform float uDensity;
void main() {
  float a = uDensity * (1.0 - sstep(1.0 - uFeather, 1.0001, length(offs)));
  frag = vec4(a, a, a, a);
}`

/** Linear and radial gradients, over the whole source (blended with MAX). */
export const GRADIENT = `${COMMON}
uniform vec4 uMap;
uniform int uKind; // 1 linear, 2 radial
uniform vec4 uA; // linear: x0 y0 x1 y1; radial: cx cy rx ry
uniform vec3 uB; // radial: angle, feather, invert
void main() {
  vec2 n = (gl_FragCoord.xy + uMap.xy) / uMap.zw;
  float L = max(uMap.z, uMap.w);
  vec2 asp = uMap.zw / L;
  float a = 0.0;
  if (uKind == 1) {
    vec2 d = (uA.zw - uA.xy) * asp;
    float len2 = dot(d, d);
    if (len2 > 1e-12) a = 1.0 - sstep(0.0, 1.0, dot((n - uA.xy) * asp, d) / len2);
  } else {
    vec2 p = (n - uA.xy) * asp;
    float c = cos(uB.x), s = sin(uB.x);
    vec2 q = vec2((p.x * c + p.y * s) / uA.z, (-p.x * s + p.y * c) / uA.w);
    a = 1.0 - sstep(1.0 - uB.y, 1.0001, length(q));
    if (uB.z > 0.5) a = 1.0 - a;
  }
  frag = vec4(a, a, a, a);
}`

/** A layer's mask (after range, invert and opacity) times its adjustments, added into the parameter textures. */
export const LAYER_ACC = `${COMMON}
uniform sampler2D uMask;
uniform sampler2D uScene;
uniform int uWhich; // 1: local1, 2: local2, 3: the mask itself (for the overlay)
uniform float uOpacity;
uniform bool uInvert;
uniform bool uRangeOn;
uniform vec3 uRange; // lo, hi, feather
uniform vec4 uAdj1; // exposure, contrast, highlights, shadows
uniform vec4 uAdj2; // temp, tint, saturation, 0
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float m = texelFetch(uMask, p, 0).r;
  if (uRangeOn) {
    float lum = srgbEncode(clamp(luma(texelFetch(uScene, p, 0).rgb), 0.0, 1.0));
    float f = max(1e-4, uRange.z);
    m *= sstep(uRange.x - f, uRange.x, lum) * (1.0 - sstep(uRange.y, uRange.y + f, lum));
  }
  if (uInvert) m = 1.0 - m;
  m *= uOpacity;
  frag = uWhich == 1 ? uAdj1 * m : uWhich == 2 ? uAdj2 * m : vec4(m, m, m, 1.0);
}`

/** Layers' exposure and white balance on the scene (and its log brightness, for the grid). */
export const LOCAL_SCENE = `${COMMON}
uniform sampler2D uScene;
uniform sampler2D uLocal1;
uniform sampler2D uLocal2;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 c = texelFetch(uScene, p, 0).rgb;
  vec4 l1 = texelFetch(uLocal1, p, 0);
  vec4 l2 = texelFetch(uLocal2, p, 0);
  vec3 m = vec3(exp2(0.3 * l2.r + 0.15 * l2.g), exp2(-0.3 * l2.g), exp2(-0.3 * l2.r + 0.15 * l2.g));
  m /= luma(m);
  vec3 r = c * exp2(l1.r) * m;
  frag = vec4(r, log2(max(luma(r), 1e-5) / GREY));
}`

