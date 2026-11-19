# Printing: research

How the photo apps people print from handle it, what Glimmr's platform can and can't do, and what that means for
the design. Feeds [PRINT_PRD.md](PRINT_PRD.md).

## 1. What the leading apps offer

| Capability | Lightroom Classic | Capture One | Photoshop | Qimage Ultimate |
|---|---|---|---|---|
| Layouts | Single image / contact sheet grid, picture package, custom package | Built-in and user templates; rows, columns, margins, spacing | One image per print | Auto-arrange, mixed sizes nested on a sheet, posters |
| Fit / fill, rotate to fit | Zoom to fill, rotate to fit, repeat one photo per page | Fit or fill per cell | Scale, position | Yes |
| Borders, strokes, margins | Margins, cell spacing, cell size, photo border, inner stroke | Margins, spacing | Border, background, bleed | Yes |
| Text | Identity plate, captions (filename, title, EXIF), page numbers, page info, crop marks | Captions, watermark (text or image) | Description, labels, crop and registration marks | Captions, frames |
| Resolution | Per-job print resolution (default 240 ppi) | Resolution setting | Uses image resolution | Smart interpolation to printer's native resolution |
| Print sharpening | Low / Standard / High for matte or glossy, based on output resolution | Sharpening setting | None built in | Deep Focus Sharpening (adaptive) |
| Colour management | Managed by printer, or a printer profile with Perceptual or Relative intent; turn driver colour off to avoid converting twice | ICC profile per print | Photoshop or printer manages; intent; black point compensation; Match Print Colors; Gamut Warning; Show Paper White | Full ICC with soft proof and gamut highlight |
| Making prints match the screen | Print Adjustment (brightness, contrast) | Soft proofing tool | Soft proof | Soft proof |
| 16-bit output | Yes (macOS) | — | Yes | Yes |
| Output | Printer or JPEG file | Printer, PDF | Printer | Printer, file |
| Templates / presets | Templates and saved print collections | User templates | Print presets | Saved layouts |

Common threads: everyone separates **layout** (paper, margins, cells, borders, text) from **image** settings
(resolution, sharpening, adjustment) and **colour** (who converts, which profile and intent). The advanced apps add
soft proofing with a gamut warning, and print adjustments to fix the classic "prints come out dark" problem.

## 2. What Glimmr's platform can do

**Electron printing** (`webContents.print`, `printToPDF`, `getPrintersAsync`):

- Can set: printer (system name), silent printing or the system dialog, copies, collate, duplex (simplex, short
  edge or long edge), colour or greyscale, landscape, custom page size, margins (including none), DPI, page
  ranges, and print backgrounds.
- `getPrintersAsync` lists printers with display name, description, status, default flag and driver options
  (CUPS options on macOS and Linux).
- Limits:
  - Driver-specific settings (paper type, print quality, the driver's own colour management) are only reachable
    through the system dialog.
  - macOS honours only one page range.
  - Electron doesn't report which paper sizes a printer supports, so Glimmr offers standard sizes plus custom.
- `printToPDF` makes vector PDFs, so text stays sharp, with an exact page size.

**Colour engine.** sharp (libvips) can apply an output ICC profile, but its source (`src/pipeline.cc`) always uses
perceptual intent, with no rendering-intent or black point compensation option. **lcms-wasm** (Little CMS 2.16 as
WebAssembly, MIT) exposes:

- `cmsCreateTransform` with any intent, plus the `BLACKPOINTCOMPENSATION` flag
- `cmsCreateProofingTransform` with `SOFTPROOFING` and `GAMUTCHECK`
- `cmsDoTransform` on 8- and 16-bit buffers

That covers relative colorimetric, perceptual, saturation and absolute intents, black point compensation, soft
proofing and gamut warning. Pixel data is copied into the WebAssembly heap for each call, so large prints are
transformed in strips.

**ICC profiles live in the operating system:**

- macOS: `/Library/ColorSync/Profiles`, `~/Library/ColorSync/Profiles`, `/System/Library/ColorSync/Profiles` and
  `/Library/Printers/*`
- Windows: `%WINDIR%\System32\spool\drivers\color`
- Linux: `/usr/share/color/icc`, `~/.local/share/icc`, `/var/lib/colord/icc`

A profile's header gives its device class (printer = `prtr`, display = `mntr`) and colour space. Its `desc` or
`mluc` tag gives a readable name.

**Display calibration** needs a hardware colorimeter (Calibrite, Datacolor) and its software. An app can't
calibrate a screen. What it can do:

- show the display's colour space
- print a reference chart to compare against the screen
- offer print adjustments
- soft proof against the paper profile

## 3. Implications for Glimmr

1. **One layout engine, three outputs.**
   - A pure geometry module (inches) drives the live preview.
   - For the printer and PDF, an HTML page of exact physical size is printed by a hidden window. Photos are
     pre-rendered at print resolution and text stays vector.
   - For JPEG/TIFF files, pages are composited at print resolution.
2. **Image pipeline in the main process.** Source, then the photo's non-destructive edit, then crop to the cell,
   resample to print size, print adjustment, print sharpening, then colour conversion.
3. **Two colour paths, as in Lightroom and Photoshop.**
   - **Printer manages colours:** Glimmr sends sRGB and the driver converts. This is the default and always safe.
   - **Glimmr manages colours:** Glimmr converts to the paper's ICC profile with the chosen intent and black point
     compensation. The printer's own colour management must then be off, so Glimmr opens the system dialog to do
     that, and says so. For files, the converted profile is embedded, which is what print labs and printer
     utilities expect.
4. **Soft proof and gamut warning** in the preview, through Little CMS.
5. **Calibration is honest.** A printable test chart, print adjustments, the display's colour space, and a manager
   for paper profiles. Screen calibration itself is left to hardware.

Sources: [Adobe: Print photos](https://helpx.adobe.com/lightroom/help/printing-photos-basic-workflow.html),
[Adobe: Print job options](https://helpx.adobe.com/uk/lightroom-classic/desktop/print-photos/print-job-options-settings.html),
[Capture One: printing](https://support.captureone.com/hc/en-us/sections/360000703758-Printing-Images),
[Qimage Ultimate features](https://www.ddisoftware.com/qimage-u/features.htm),
[Photoshop print colour handling (Red River)](https://www.redrivercatalog.com/profiles/how-to-use-inkjet-printer-profiles-photoshop-cc-mac-hp.html),
[Adobe: colour management for print](https://helpx.adobe.com/in/photoshop-elements/desktop/kb/color-management-settings-best-print.html),
[Electron getPrintersAsync](https://ayakael.net/mirrors/electron/commit/8f51d3e1bf09cd14b624bd02c6f16d3c3fbe5c92),
[Electron print pageSize](https://ayakael.net/mirrors/electron/commit/928175bdfebbc5532966b16c9ae88a443dded4af),
[sharp ICC intent (issue)](https://github-redirect.dependabot.com/lovell/sharp/issues/4045),
[lcms-wasm](https://github.com/mattdesl/lcms-wasm).
