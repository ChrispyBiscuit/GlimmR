# Develop: photo editing, styles and LUTs, product requirements

| | |
|---|---|
| Feature | Non-destructive raw and image editing (global adjustments, masks, retouching), styles and LUTs compatible with Lightroom and Capture One looks, feeding export and print |
| Platforms | Windows and macOS (Linux where it comes free) |
| Research | [DEVELOP_RESEARCH.md](DEVELOP_RESEARCH.md) |
| Branch | `claude/develop-module`, kept separate until it proves itself (see §3) |

## 1. Goal

Edit photos inside Glimmr well enough that most never need another app, so one application covers import, culling,
organising, editing and printing. The RAW always stays the original, and every edit can be undone or reset.

**This is:** a raw developer in the spirit of Lightroom's Develop module and Capture One. **It isn't:** a Photoshop
replacement. Layers, compositing, painting and text stay with external editors through the existing *Open in Editor*
hand-off.

## 2. Principles

1. **Non-destructive, always.**
   - Edits are instructions stored in the catalog; pixels in the original are never changed.
   - Every setting can be reset, every step undone.
   - The existing crop and rotation become part of the same edit.
2. **The RAW is the master.**
   - A RAW + JPEG pair develops from the RAW.
   - Once a photo has develop settings, the developed image is what's shown in the grid, viewer and print, instead of
     the camera JPEG.
3. **One pipeline.** The interactive preview, thumbnails, export and print run the same processing, so what you see
   is what you get.
4. **Fast.** Sliders respond within a frame at screen resolution. Full resolution renders in the background.
5. **Honest compatibility.** LUTs, and looks built on LUTs or ICC profiles, match exactly. Presets and styles from
   other apps match approximately, and Glimmr says which settings it couldn't apply.
6. **Our own look.** Glimmr ships its own default rendering and camera colour. It never uses Adobe's or Capture One's
   profiles, code or interface.

## 3. Trying it safely: branch, flag and rollback

| ID | Requirement |
|---|---|
| BR-1 | All develop work happens on the branch `claude/develop-module`. The released branch keeps receiving fixes, and the develop branch merges them in regularly. |
| BR-2 | **No releases from the develop branch.** Commits there never contain `[release]`. Every push still produces Windows and macOS installers as build artifacts, for trying it out. |
| BR-3 | **Feature flag.** Even after merging, Develop stays behind Settings → Labs → "Develop (preview)", off by default, until it's ready. Turning it off hides the module; photos show as before. |
| BR-4 | **Additive catalog changes only.** Develop settings live in a new `develop` column and a `styles` table. Existing columns and meanings don't change, so an older Glimmr can open a catalog an experimental build has touched; it simply ignores the develop settings. |
| BR-5 | **Rollback.** If it doesn't work out: don't merge the branch (nothing to undo), or turn off the flag. A catalog used by a test build keeps working with released builds (BR-4). |
| BR-6 | Develop settings are never written into the user's files or Lightroom/Capture One sidecars. An optional Glimmr XMP namespace for backups can come later. |

## 4. Pipeline

| ID | Requirement | Pri |
|---|---|---|
| PL-1 | **Raw decoding** with LibRaw (CDDL), compiled to WebAssembly and run on the existing decoder worker threads: demosaic (AHD/DCB/AMaZE where licence-compatible), highlight reconstruction, camera matrix to a linear wide-gamut working space (linear Rec.2020, 32-bit float). | P0 |
| PL-2 | **Non-raw inputs** (JPEG, HEIC, TIFF, PSD…) enter the same pipeline: decoded, converted from their ICC profile to the working space, linearised. | P0 |
| PL-3 | **GPU processing.** Each adjustment is a shader stage on float textures (WebGL2, with WebGPU where available). The preview renders at screen size; zooming renders the visible region at full resolution. | P0 |
| PL-4 | **Order of operations**, fixed and documented: raw → white balance → exposure → camera colour → lens corrections → tone (highlights/shadows/whites/blacks, contrast) → curves → colour (HSL, colour grading) → presence (texture, clarity, dehaze) → masks (local adjustments) → **creative look (style LUT)** → detail (sharpen, noise) → effects (vignette, grain) → crop and geometry → output transform to the display or file profile. | P0 |
| PL-5 | **Same result everywhere.** Thumbnails and previews are rendered by the pipeline. Export and print render full resolution in tiles through the same shaders, in a hidden window like printing does today. | P0 |
| PL-6 | **Default look.** Glimmr's own camera rendering: a filmic tone curve with gentle highlight roll-off, tuned on ColorChecker shots from major cameras. Per-camera tweaks are data, not code. | P0 |
| PL-7 | **CPU fallback.** When WebGL2 float textures aren't available, a slower path renders, so editing still works. | P1 |
| PL-8 | Rendered previews are cached and keyed by the develop settings, so browsing edited photos is as fast as now. | P0 |

## 5. Global adjustments

| ID | Requirement | Pri |
|---|---|---|
| DV-1 | **White balance:** as shot, auto, presets (daylight, cloudy, shade, tungsten, fluorescent, flash), temperature and tint, eyedropper. RAW uses real Kelvin; other files use relative values. | P0 |
| DV-2 | **Tone:** exposure (±5 EV), contrast, highlights, shadows, whites, blacks; Auto tone. | P0 |
| DV-3 | **Tone curve:** parametric (highlights, lights, darks, shadows) and point curves for RGB and each channel. | P0 |
| DV-4 | **Colour:** vibrance and saturation; HSL per 8 hue bands (hue, saturation, luminance) with an on-image targeted tool; black and white mix. | P0 |
| DV-5 | **Colour grading:** shadows, midtones and highlights wheels, blending, balance. | P1 |
| DV-6 | **Presence:** texture, clarity, dehaze. | P1 |
| DV-7 | **Detail:** sharpening (amount, radius, detail, masking). Noise reduction: luminance and colour (classical), AI denoise in phase 3. | P0 classical, P2 AI |
| DV-8 | **Lens:** profile corrections (distortion, vignetting, chromatic aberration) from lensfun, plus manual distortion and vignetting. | P1 |
| DV-9 | **Geometry:** existing crop/straighten, plus perspective (vertical, horizontal, rotate, aspect) and Upright-style auto levelling. | P1 |
| DV-10 | **Effects:** post-crop vignette, grain (amount, size, roughness). | P1 |
| DV-11 | Histogram (existing) reflects the developed image live, with clipping overlays (`J`). | P0 |

## 6. Local adjustments (masks)

| ID | Requirement | Pri |
|---|---|---|
| MK-1 | Brush (size, feather, flow, auto-mask), linear gradient, radial gradient. | Phase 2 |
| MK-2 | Range masks: colour and luminance, refining any mask. | Phase 2 |
| MK-3 | **AI masks:** subject, sky, background, people, from Segment Anything 2 (Apache-2.0) through ONNX Runtime, downloaded on first use like the smart-tag model. | Phase 2 |
| MK-4 | Each mask carries its own set of the global adjustments. Masks can be added to, subtracted, intersected and inverted. | Phase 2 |

## 7. Retouching

| ID | Requirement | Pri |
|---|---|---|
| RT-1 | Spot heal and clone, with circles and brushed strokes; visualise spots. | Phase 3 |
| RT-2 | **Remove:** brush over an object and it's filled by LaMa inpainting (Apache-2.0), on-device. | Phase 3 |
| RT-3 | Red-eye. | Phase 3 |

## 8. Styles and LUTs

Glimmr **styles** are saved develop settings, optionally with a LUT. They're the one place all looks meet, whether made
in Glimmr or imported from other apps.

### 8.1 LUTs

| ID | Requirement | Pri |
|---|---|---|
| LUT-1 | Apply **.cube** (Adobe/Resolve Cube: 1D and 3D, sizes 2–65) and **.3dl** LUTs as the creative look stage (PL-4), with tetrahedral interpolation on the GPU. | P0 |
| LUT-2 | **Amount** slider (0–200%, blending the LUT with the image before it). | P0 |
| LUT-3 | **"This LUT expects":** sRGB (default for photo LUTs), Rec.709 (video), and common camera log curves (S-Log3, C-Log2/3, F-Log, V-Log, LogC) with their gamuts. Glimmr converts into and out of that space around the LUT, so video LUTs don't look broken on photos. | P0 |
| LUT-4 | **LUT library:** a LUTs folder managed by Glimmr; add files or folders (copied in), rename, remove, favourites; LUT packs shown as folders. | P0 |
| LUT-5 | **Live previews:** the style browser shows the current photo with each LUT and style applied, as thumbnails; hovering shows it large. | P0 |

### 8.2 Glimmr styles

| ID | Requirement | Pri |
|---|---|---|
| STY-1 | **Create a style** from a photo's settings, choosing which groups to include (e.g. tone and colour, not white balance or crop). A LUT is included by value, so a style is self-contained. | P0 |
| STY-2 | **Apply** a style to one or many photos; **stack** styles (later ones override the groups they include); **amount** for the whole style. | P0 |
| STY-3 | Copy and paste settings (`Ctrl/⌘ Shift C / V`, choosing groups), Sync settings across a selection, *Previous* (apply the last photo's settings). | P0 |
| STY-4 | Style file format **.glimmrstyle**: JSON with a version, the included settings and an optional LUT (base64), so styles can be shared and backed up. | P0 |
| STY-5 | Styles apply at **import** too (IM-13): choose a style in the import window. | P1 |

### 8.3 Compatibility with Lightroom and Capture One

| ID | Requirement | Match | Pri |
|---|---|---|---|
| CMP-1 | Import **.cube / .3dl** LUTs. | Exact | P0 |
| CMP-2 | Import **Lightroom creative profiles** (.xmp with an embedded 3D LUT): decode the `crs:Table_*` data into a LUT. Verified against a set of real profile packs; a profile that can't be decoded is reported, never guessed. | Exact | P1 |
| CMP-3 | Import **Lightroom presets** (.xmp, and legacy .lrtemplate): map each `crs:` setting to Glimmr's (e.g. `Exposure2012`, `Contrast2012`, `Highlights2012`, `Shadows2012`, `Whites2012`, `Blacks2012`, `Temperature`/`Tint`, `ToneCurvePV2012*`, `HueAdjustment*`/`SaturationAdjustment*`/`LuminanceAdjustment*`, `ColorGrade*`, `Clarity2012`, `Texture`, `Dehaze`, `Vibrance`, `Saturation`, `Sharpness`, `LuminanceSmoothing`, `PostCropVignette*`, `Grain*`). A preset naming a profile Glimmr has imported (CMP-2) uses it. | Approximate | P1 |
| CMP-4 | Import **Capture One styles** (.costyle): map their settings (exposure, contrast, brightness, saturation, high dynamic range, levels, curves, colour balance, colour editor, clarity, structure, vignetting, grain; key names to be confirmed on real files). | Approximate | P1 |
| CMP-5 | Import **Capture One ICC looks** (the ICC part of LUT-based C1 styles) through Little CMS. | Exact | P1 |
| CMP-6 | Every import shows a **compatibility report**: applied exactly, applied approximately, not supported (e.g. masks inside presets, Adobe camera profiles, AI settings). The imported style remembers it. | — | P0 for what's built |
| CMP-7 | **Export** any style or photo look as **.cube** (33³ or 65³; global colour and tone only, since LUTs can't hold sharpening, masks or vignettes), for use in Capture One (via ICC conversion), Lightroom (via Camera Raw profile creation), Resolve and Premiere. | — | P1 |
| CMP-8 | Import whole preset and LUT folders (packs) at once, keeping their folder structure. | — | P1 |

## 9. Editing workflow

| ID | Requirement | Pri |
|---|---|---|
| WF-1 | **Develop view:** opens from the viewer or grid (`D`); filmstrip; panels for Basic, Curve, Colour, Detail, Lens, Geometry, Effects, Styles. Panels collapse; Basic is open first. | P0 |
| WF-2 | **Before/after:** `\` toggles; split view side by side or with a draggable divider. | P0 |
| WF-3 | **History:** every change listed, click to go back; `Ctrl/⌘ Z / Shift Z`. History is kept per photo in the catalog. | P0 |
| WF-4 | **Reset:** per slider (double-click), per panel, all. | P0 |
| WF-5 | **Versions:** virtual copies (several edits of one RAW, stacked with it). | P1 |
| WF-6 | **Edited badge** in the grid; `is:developed` and `style:"name"` searches. | P0 |
| WF-7 | **Export:** JPEG, TIFF (8/16-bit), PNG, with size, quality, sharpening for screen, colour space (sRGB, Display P3, Adobe RGB), metadata options, naming; presets. Print uses the developed image. | P0 |
| WF-8 | Editing in an external editor still opens the original RAW. A *developed* TIFF can be sent instead, and comes back as a version. | P1 |

## 10. Non-goals

- Layers, compositing, painting, text (external editors).
- Pixel-identical results to Lightroom or Capture One.
- Writing develop settings into Lightroom/Capture One sidecars, or reading their full catalogs.
- Using Adobe or Capture One camera profiles or code.
- DNG conversion, tethering, video.

## 11. Acceptance

- **Speed:** on a 2020-era laptop with integrated graphics, sliders on a 24 MP RAW update the screen-size preview
  in under 50 ms. A 45 MP export renders in under 5 s.
- **Colour:** ColorChecker shots from at least 12 cameras (Canon, Nikon, Sony, Fujifilm, OM, Panasonic, Leica,
  iPhone) render with average ΔE2000 under 3 against reference values in the default look's neutral mode.
- **LUTs:** applying a .cube matches a reference implementation (OpenColorIO or ffmpeg lut3d) within 1/255 on test
  images, for 17³, 33³ and 65³ cubes, and for the log and Rec.709 input options.
- **Imports:** a test set of Lightroom creative profiles decodes to LUTs that match Lightroom's output (rendered in
  Lightroom for reference) within 2/255. Presets and C1 styles import with a correct compatibility report.
- **Safety:**
  - Originals' checksums don't change through any edit or export.
  - Catalogs opened by a test build still open and work in the released build (BR-4).
  - Turning off the flag restores today's display.
- Unit tests for every adjustment stage against reference images. End-to-end tests drive the develop view, styles,
  LUT import and export.

## 12. Delivery

| Phase | Contents |
|---|---|
| **1. Develop basics** | Pipeline (PL-1–6, PL-8); white balance, tone, curves, HSL, vibrance/saturation, sharpening and classical noise reduction (DV-1–4, DV-7, DV-11); styles and LUTs core (LUT-1–5, STY-1–4, CMP-1, CMP-6); develop view, before/after, history, reset, badge, export (WF-1–4, WF-6, WF-7); feature flag (BR-3) |
| **1.5 Compatibility** | Lightroom creative profiles, presets, Capture One styles and ICC looks, packs, .cube export (CMP-2–5, CMP-7–8); colour grading, presence, lens, geometry, effects (DV-5, DV-6, DV-8–10) |
| **2. Masks** | MK-1–4 |
| **3. Retouching and AI** | RT-1–3, AI noise reduction, virtual copies (WF-5), editor round trip (WF-8) |

Phase 1 is roughly two to three times the size of the import and culling phase. Each phase is usable on its own, and
each is judged before the next starts.

## 13. Risks

| Risk | Mitigation |
|---|---|
| The default look doesn't please people used to Lightroom or Capture One | Tune on ColorChecker and real-world sets early; ship neutral and "vivid" base looks; LUT styles let people bring their look |
| GPU differences (drivers, float texture support) | WebGL2 baseline, CPU fallback (PL-7), test matrix on Intel/AMD/NVIDIA/Apple GPUs |
| Large files are slow | Screen-size preview first, tiled full-resolution rendering, cached results |
| LibRaw WebAssembly speed | Run on worker threads, cache the demosaiced image per photo while editing, consider a native build later |
| Undocumented formats change (Lightroom profile tables, .costyle) | Verified test sets; reports instead of guesses; parsers isolated |
| AI model sizes (SAM 2, LaMa) | Download on first use, as smart tags do |

## 14. Open questions

1. **Default look:** start from a neutral, accurate rendering, or a punchier one closer to camera JPEGs? Proposed:
   neutral default, with "Camera-like" as a built-in style.
2. **Develop settings in backups:** catalog only (as now), or also optional Glimmr XMP sidecars? Proposed: catalog
   and Glimmr's backups only for phase 1.
3. **darktable-cli as an interim raw engine:** worth offering as an option for users who have darktable installed?
   Proposed: no. It splits the pipeline (PL-5).
