# Printing: product requirements

| | |
|---|---|
| Feature | Print workspace: printers, paper, layouts, borders and cropping, colour management and calibration, output to printer, PDF and files |
| Platforms | Windows and macOS (Linux works through CUPS) |
| Research | [PRINT_RESEARCH.md](PRINT_RESEARCH.md) |

## 1. Goal

Print any photos from Glimmr as well as Lightroom Classic or Capture One would, without leaving the app:

- one photo or many per page, contact sheets and picture packages
- exact borders and cropping
- colour that matches the screen
- output to a printer, a PDF, or print-ready JPEG/TIFF files for a lab

## 2. Principles

1. **One workspace, live preview.** Everything is decided in one full-window print workspace with an accurate page
   preview. The preview uses the same layout maths and image pipeline as the output.
2. **Physical units.** Paper, margins, cells and borders are in inches or millimetres (the user's choice), never
   pixels.
3. **Honest colour.** Two colour paths, clearly labelled. Never convert twice. Calibration features say what they
   can and can't do.
4. **Non-destructive.** Printing never changes originals. Photos print with their crop and rotation. Per-print
   cropping (fill and reposition) belongs to the print job only.
5. **Repeatable.** Every setting can be saved as a named preset.

## 3. Entry points

| ID | Requirement | Pri |
|---|---|---|
| PR-E1 | `Ctrl/⌘ P` prints the selection, or the focused photo, from the grid. | P0 |
| PR-E2 | `Ctrl/⌘ P` prints the current photo from the viewer, and the viewer has a Print button. | P0 |
| PR-E3 | Right-click → Print… on photos in the grid. | P0 |
| PR-E4 | Settings → Printing manages printers, colour profiles, calibration and presets. | P0 |

## 4. Printer and paper

| ID | Requirement | Pri |
|---|---|---|
| PR-P1 | Choose any installed printer (default preselected), with status and description. Refresh the list. | P0 |
| PR-P2 | Paper sizes: Letter, Legal, Tabloid, Super B (13×19), 4×6, 5×7, 8×10, 11×14, 12×18, A6–A2, and custom width × height. | P0 |
| PR-P3 | Orientation: automatic (matches the photo for one photo per page), portrait or landscape. | P0 |
| PR-P4 | Margins: top, bottom, left, right, with "same on all sides". Borderless (0) for printers that support it. | P0 |
| PR-P5 | Copies, collate, two-sided (off, long edge, short edge), colour or greyscale, page range. | P0 |
| PR-P6 | "Printer settings…" opens the system dialog for driver options (paper type, quality). | P0 |
| PR-P7 | Units: inches, mm or cm everywhere. | P1 |
| PR-P8 | Open the operating system's printer settings to add or manage printers. | P1 |

## 5. Layout

| ID | Requirement | Pri |
|---|---|---|
| PR-L1 | **Single photo:** one photo per page. | P0 |
| PR-L2 | **Grid / contact sheet:** rows × columns, horizontal and vertical spacing. | P0 |
| PR-L3 | **Print sizes / picture packages:** any mix of sizes per photo (passport, wallets, 3×4, 3.5×5, 4×5, 4×6, 5×7, 8×10, metric, custom), e.g. one 5×7 + four wallets. Packed onto as few sheets as possible with guillotine packing, so sheets can be cut apart with straight cuts. Photos share sheets or get their own. Ready-made templates. | P0 |
| PR-L4 | **Fit or fill:** fit shows the whole photo; fill crops to fill the cell. | P0 |
| PR-L5 | **Reposition the crop** of a filled photo by dragging it in the preview, and zoom it in. This is stored with the print job only. | P0 |
| PR-L6 | **Rotate to fit:** turn photos to best fill their cell. | P0 |
| PR-L7 | **Repeat one photo per page** (fill the page with copies). | P1 |
| PR-L8 | Page preview with page navigation and photo count. Live as settings change. | P0 |

## 6. Borders and marks

| ID | Requirement | Pri |
|---|---|---|
| PR-B1 | Photo border: an inset from the cell edge (white mat). | P0 |
| PR-B2 | Stroke: width and colour around each photo. | P0 |
| PR-B3 | Page background colour (white by default; black for gallery sheets). | P1 |
| PR-B4 | Crop (cut) marks at photo corners, for trimming. | P0 |

## 7. Text

| ID | Requirement | Pri |
|---|---|---|
| PR-T1 | Caption under each photo: any of title, file name, date taken, exposure (shutter, aperture, ISO, focal), caption, rating, or custom text. Size and colour. | P0 |
| PR-T2 | Header and footer text, with page numbers ("Page 2 of 5"). | P0 |
| PR-T3 | Identity plate / watermark: text, corner or centre, size, opacity. | P1 |

## 8. Image quality

| ID | Requirement | Pri |
|---|---|---|
| PR-Q1 | Print resolution: 180, 240, 300, 360, 600 or 720 ppi. Photos are resampled with Lanczos to the exact cell size. | P0 |
| PR-Q2 | Print sharpening: off, low, standard or high, for matte or glossy media, scaled to the print resolution. | P0 |
| PR-Q3 | Print adjustment: brightness and contrast that apply only to prints, to match bright screens. | P0 |
| PR-Q4 | Photos print with their non-destructive crop and rotation, from the full-resolution original (RAW: the largest embedded image). | P0 |
| PR-Q5 | 16-bit TIFF output. Deferred: the pipeline and colour engine run at 8 bits, so 16-bit files would add bytes, not tones. | P2 |
| PR-Q6 | Low-resolution warning when a photo would print below 150 ppi at its size. | P0 |

## 9. Colour management and calibration

| ID | Requirement | Pri |
|---|---|---|
| PR-C1 | **Printer manages colours** (default): photos are sent as sRGB. | P0 |
| PR-C2 | **Glimmr manages colours:** choose the paper/printer ICC profile and an intent (perceptual, relative colorimetric, saturation, absolute), with black point compensation. Pixels are converted with Little CMS. When printing, the system dialog opens and the user is told to turn the printer's colour management off. | P0 |
| PR-C3 | **Soft proof** in the preview: simulate the selected profile and intent. | P0 |
| PR-C4 | **Gamut warning:** highlight colours the profile can't reproduce, in a chosen colour. | P0 |
| PR-C5 | **Profile manager:** list installed printer profiles (system folders and Glimmr's own) with name, class, colour space and location. Add a profile (copied into Glimmr), remove added ones. | P0 |
| PR-C6 | **Calibration chart:** a printable test page with grey step wedge, RGB and CMY patches, skin tones, smooth gradients, a fine-line resolution target and registration marks. Print it to check the printer, paper and profile against the screen. | P0 |
| PR-C7 | Show the display's colour space and explain that screen calibration needs a hardware colorimeter. | P1 |
| PR-C8 | Profiles embedded in files (sRGB by default, or the converted profile). | P0 |

## 10. Output

| ID | Requirement | Pri |
|---|---|---|
| PR-O1 | **Printer:** silent print with the chosen settings, or through the system dialog. | P0 |
| PR-O2 | **PDF:** vector page (text stays sharp), exact paper size. | P0 |
| PR-O3 | **JPEG or TIFF files:** one file per page at the print resolution, with an embedded profile. For labs and printer utilities. | P0 |
| PR-O4 | Progress while rendering, then a confirmation or a clear error. | P0 |

## 11. Presets

| ID | Requirement | Pri |
|---|---|---|
| PR-S1 | Save the current settings as a named preset; apply, rename or delete presets. | P0 |
| PR-S2 | Glimmr remembers the last-used settings. | P0 |
| PR-S3 | Built-in presets: "Single 8×10 on Letter", "Contact sheet 5×6", "4×6 borderless", "Two 5×7 on Letter", "A4 with white border". | P1 |

## 12. Non-goals

- Hardware screen calibration (needs a colorimeter and its software).
- Driver-level control of paper type and quality outside the system dialog. Electron doesn't expose them.
- Print queue management. Jobs go to the operating system's queue.
- Building ICC profiles (needs a spectrophotometer).

## 13. Acceptance

- Layout maths is unit-tested: page fit, margins, grid cells, packing, fit/fill crops, rotate to fit.
- The image pipeline is tested: output size equals cell size × ppi, the crop matches the cell's shape, sharpening
  and adjustment run, and the ICC transform changes in-gamut colours only slightly.
- End to end through a real CUPS printer: a job reaches the queue and produces a page of the right size. PDF
  output has the right page size. File output has the right pixel size and profile.

## 14. Status (1.0.7)

Built as specified, except PR-Q5 (16-bit TIFF), which is deferred. Verified:

- unit tests for layout, rendering, colour and every output
- an end-to-end run of the packaged app printing through a real CUPS printer (job queued, Letter page, correct
  content), plus PDF, JPEG and calibration-chart output
