# Develop (photo editing), styles and LUTs: research

What it would take to add Lightroom/Capture One-style editing to Glimmr, what can be built on, and how styles, presets
and LUTs from other apps can carry over. Feeds [DEVELOP_PRD.md](DEVELOP_PRD.md).

**About the sources.** Gathered with web searches in November 2026. Adobe's and Capture One's own documentation
couldn't be opened directly, so several points rest on community answers (marked *forum*). Anything unconfirmed is
marked *unverified*.

## 1. The landscape

| App | What it is | Relevance to Glimmr |
|---|---|---|
| Lightroom Classic / Camera Raw | The reference raw developer: global sliders, masks (incl. AI subject/sky), healing, presets and profiles | Feature target; preset/profile formats to read |
| Capture One | Raw developer known for colour; layers, styles, ICC-based looks | Feature target; .costyle and ICC looks to read |
| Affinity by Canva | Photo, vector and layout editor, free since October 2025 (closed source); AI tools need a Canva subscription | Hand-off target only |
| ArtCraft: PhotoCraft and LightCraft | Open-source (MIT OR Apache-2.0) Rust rebuilds of Photoshop and Lightroom, released October 2026, built largely with AI | Licence-compatible, but early alpha, and the press questions its "clean room" claim. Watch, don't depend on |
| Photon Studio | Small free Photoshop alternative (October 2026) | Not relevant |
| darktable, RawTherapee | Mature open-source raw developers | GPL-3: their code can't go into Apache-2.0 Glimmr, but they could run as separate programs |

Sources:

- [PetaPixel on ArtCraft](https://petapixel.com/2026/10/07/someone-rebuilt-free-open-source-versions-of-photoshop-premiere-and-lightroom-using-ai/)
- [LightCraft README](https://raw.githubusercontent.com/storytold/lightcraft/main/README.md)
- [Phoronix](https://www.phoronix.com/news/Photocraft-Filmcraft-AI)
- [PetaPixel on Affinity](https://petapixel.com/2025/10/30/all-new-all-in-one-affinity-app-for-creative-pros-is-available-now-for-free)
- [Ubergizmo on Photon Studio](https://www.ubergizmo.com/2026/10/photon-studio-meet-the-free-photoshop-rival-with-local-ai-and-no-subscriptions/)

**Building equivalent tools is fine; copying isn't.** Exposure, curves, HSL and healing are standard image
processing. Glimmr must not copy Adobe's or Capture One's code, interface, branding or camera profiles.

## 2. Building blocks and licences

Glimmr is Apache-2.0, so everything it ships must be compatible.

| Need | Candidate | Licence | Notes |
|---|---|---|---|
| Raw decoding and demosaicing | LibRaw | LGPL-2.1 or CDDL-1.0 (user's choice); DCB/FBDD parts BSD-3 | CDDL allows static linking in closed or permissive apps ([Debian copyright](https://sources.debian.org/src/libraw/0.21.5b-1/COPYRIGHT)). Compiles to WebAssembly |
| Camera colour | LibRaw's matrices, DNG-embedded matrices | as above | Adobe's DCP camera profiles can't be redistributed. darktable/RawTherapee profiles are GPL |
| Colour management | Little CMS 2.16 (already in Glimmr) | MIT | ICC looks, soft proof |
| Lens corrections | lensfun | LGPL library, CC-BY-SA database | Database attribution required |
| AI masks | Segment Anything 1 / 2 | Apache-2.0 | SAM 3 uses Meta's custom licence (royalty-free, with conditions) ([Roboflow](https://roboflow.com/model-licenses/segment-anything-2)) |
| Object removal | LaMa inpainting | Apache-2.0 | ~200 MB model |
| Model runtime | ONNX Runtime (already in Glimmr) | MIT | Runs the CLIP smart-tag model today |
| GPU | WebGL2 (float textures) in Electron; WebGPU where available | — | Real-time preview |

**Glimmr has already:**

- A non-destructive edit model (crop, rotation).
- Worker-thread decoders.
- sharp/libvips, Little CMS and ONNX Runtime.
- A print and export renderer.

**What it lacks** is a real raw developer: RAW files are shown from their embedded camera JPEG.

## 3. Styles, presets and LUTs

| Format | Contents | Carries over |
|---|---|---|
| **.cube** (Adobe/Resolve Cube) / **.3dl** | A fixed 1D or 3D colour lookup | **Exactly** |
| **Lightroom creative profile** (.xmp) | A profile with an embedded 3D LUT in undocumented `crs:Table_*` data. This is how LUTs reach Lightroom: Lightroom can't load a .cube itself (*forum*) | **Exactly**, once the table is decoded. The DNG SDK contains a 3D LUT class for enhanced profiles, but the encoding isn't documented ([Adobe Community](https://community.adobe.com/feature-requests-564/p-document-the-format-of-rgb-luts-in-enhanced-profiles-666490)) |
| **Lightroom preset** (.xmp; legacy .lrtemplate) | Slider values, plus at most the *name* of a profile. "Presets cannot contain embedded LUTs" (*forum*, [Adobe Community](https://community.adobe.com/t5/camera-raw-discussions/importing-cube-file-in-camera-raw-then-convert-to-xmp-files-for-lightroom/m-p/15167065)) | **Approximately**: each engine's sliders use different maths |
| **Capture One style** (.costyle) | Text (XML) list of adjustment settings | **Approximately**. Key names to verify against real files (*unverified*) |
| **Capture One ICC "film" looks** | Capture One doesn't load .cube; LUTs are converted to ICC profiles plus a style by third-party tools ([Capture One community](https://support.captureone.com/hc/en-us/community/posts/15345250639773-LUT-support), [fylm.ai](https://fylm.ai/convert-a-cube-lut-to-capture-one-icc-profile-and-style/), [3D LUT Creator](https://alexonraw.com/3d-lut-creator-now-supports-capture-one-style-and-preset-files/)) | **Exactly** through Little CMS |

**Pitfalls:**

- **Most LUTs online are made for video** (Rec.709 or camera log), and Camera Raw rejects some Rec.709 variants
  (*forum*). Glimmr needs a "this LUT expects…" input setting.
- **Presets assume Adobe's base look** (Adobe Color profile). Even perfect slider mapping won't reproduce a
  Lightroom result exactly.

## 4. Effort and risk

- **Hardest:**
  - Colour science, i.e. a pleasing default look across hundreds of cameras.
  - Speed on 45–100 MP files.
  - Noise reduction.
  - AI mask quality.
  - Differences between GPUs on Windows and macOS.
- **Moderate:** the slider set, masks, healing, styles, LUTs.
- **Comparison:** darktable and RawTherapee took over a decade to reach today's quality; Adobe has decades of work
  behind Camera Raw. A good everyday editor is realistic. Lightroom parity on day one isn't.
- **Alternative:** run darktable-cli or rawtherapee-cli as separate programs to develop RAWs (GPL respected). Mature
  quality fast, but no Glimmr editing interface.
