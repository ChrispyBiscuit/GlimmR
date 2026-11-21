# Import, culling, duplicates, RAW+JPEG and folders: research

How the leading photo apps import from memory cards, cull, find duplicates, keep RAW files tied to their JPEGs and
edits, and manage folders, and what that means for Glimmr. Feeds [IMPORT_PRD.md](IMPORT_PRD.md).

**About the sources.** The vendor documentation sites (helpx.adobe.com, support.captureone.com, docs.camerabits.com,
docs.digikam.org, support.apple.com) couldn't be opened directly from the research environment. Claims come from
search-result extracts of those pages, from user forums (marked *forum*), and for Immich and dupeGuru from reading
their source code. Anything no source supported is marked *unverified*.

## 1. Importing from a memory card

| | Lightroom Classic | Capture One | Photo Mechanic | Apple Photos | digiKam |
|---|---|---|---|---|---|
| Modes | Copy as DNG, Copy, Move, Add (in place) | Copy to catalog/session or add in place | Ingest (copy) | Copy into library | Download from camera/card |
| Destination | Subfolder, organised by date (8 patterns, e.g. `YYYY/MM-DD`) or one folder | Chosen folder, tokens | Path with variables | Library | Sub-albums from EXIF date |
| Rename | Templates, e.g. Custom Name - Sequence | Tokens (Image Name, Date…) | Variables, `{seqn}` start number | No | Yes, after download |
| Second copy | "Make a Second Copy To" | Backup location | Secondary destination | No | No |
| Skip already imported | "Don't Import Suspected Duplicates" | "Exclude Duplicates" | Incremental ingest (history kept per computer, crash-safe) | "Already Imported" row | — |
| Several cards at once | No | No | Yes, optionally merged | No | No |
| Cull before copying | No | Cull view at import (v16+) | "Ingest From Selection" | No | Select items to download |
| Delete from card | No | No | "Erase source after ingest" (*unverified*, third-party PDF only) | "Delete items after import" | Separate Delete command; "Download & Delete" |
| Eject when done | *unverified* | *unverified* | "Unmount source disks after ingest" | Manual | Manual |
| Detect card | "Show import dialog when a memory card is detected" | *unverified* | Manual | Opens on connect | Manual |
| Verify copies (checksums) | *unverified* | *unverified* | *unverified* | *unverified* | *unverified* |

Sources: Lightroom import options (helpx.adobe.com/lightroom-classic/desktop/import-photos/photo-video-import-options.html);
duplicate criteria (community.adobe.com, *forum* quoting Adobe); Capture One import (support.captureone.com/hc/en-us/articles/360002492617);
Photo Mechanic ingest (docs.camerabits.com/support/solutions/articles/48000207409, 48000341501, 48001205803);
Apple Photos import (support.apple.com/guide/photos/pht6c803201/mac); digiKam (docs.digikam.org/en/import_tools/camera_import.html).

**Lightroom's duplicate rule is narrow**: original filename + EXIF capture time + file size must all match. Files
renamed at import, DNG conversions and tethered captures slip through (*forum*). Apple's "Already Imported" only
recognises identical files (*forum*). Checksums are only documented in dedicated offload tools (e.g. ProGrade Ingest
Pro), not in any photo library app.

**Nobody formats cards.** None of these apps offers it, and camera makers (e.g. Sony's help guide) say to format in
the camera. **Deleting from the card is always a separate, deliberate step**, and the docs (digiKam, Apple community
guides) advise checking the copy first.

**Card layout (DCF).** `DCIM/` holds folders `100XXXXX`–`999XXXXX`, files `ABCD0001.EXT`. Files sharing a number are
a "file group" (RAW + JPEG). Cameras start a new folder after 9999 files, and numbering can restart when a card is
formatted, so **file names repeat across folders and cards** (Wikipedia: Design rule for Camera File system;
Canon support). Video sometimes sits outside DCIM (e.g. Sony `PRIVATE/`) (*unverified*).

**Detecting a card.** macOS: Disk Arbitration "disk appeared" can fire before the volume is mounted, so check the
mount path. Windows: `WM_DEVICECHANGE`/`DBT_DEVICEARRIVAL`; some USB readers report no drive letter (*forum*).
Electron has no volume-mounted event (*unverified*), so polling mounted volumes for a `DCIM` folder is the
dependable cross-platform route.

## 2. Culling

- **Lightroom Classic:** `P` pick, `X` reject, `U` unflag, `0–5` stars, Auto Advance (Caps Lock, *forum*), Compare
  (`C`, two photos) and Survey (`N`, many). "Delete Rejected Photos" offers *Remove* (catalog only) or *Delete from
  Disk*, which uses the Trash, though users report permanent deletion on volumes without one (*forum*). New
  Assisted Culling scores subject and eye focus, eyes open, and auto-stacks similar shots; users find closed-eye
  detection unreliable (*forum*).
- **Photo Mechanic:** contact sheet with tag (`T`), eight colour classes and stars; auto-advance; cull on the card
  before ingest, or after. Ratings carry to Lightroom through XMP.
- **FastRawViewer:** shows the real raw data with raw histogram and focus peaking; rejects are moved to a
  `_Rejected` subfolder instead of deleted.
- **Capture One:** Cull view (v16+), Face Focus (16.2+), zoom to 100%; deleting from Cull is a user feature request
  (*unverified*).
- **AI culling:** Narrative Select (face close-ups with eye and focus indicators, scenes ranked), AfterShoot (Selected,
  Duplicates, Blurry, Closed Eyes; strictness sliders), FilterPixel, Excire (scene grouping, sharpness, eyes, smiles).
  All present these as suggestions.

## 3. Duplicates

| App | What it finds | Method | Keeper | Merge |
|---|---|---|---|---|
| Apple Photos | Exact copies and near-identical (different size, format, metadata) | Not documented | "Highest quality" (pixel size, then metadata count, *forum*) | Combines metadata; others to Recently Deleted |
| Lightroom Classic (2025 Duplicates view) | Same image data, any name/metadata | Not documented | Original on top of stack; Set as Original | Remove Duplicates |
| Lightroom (web) | Exact, similar, and RAW+JPEG pairs as a separate filter | Not documented | Keep this / Keep selected | Highest rating, pick, union of keywords and albums |
| digiKam | Similar, with a similarity range in % | Haar-wavelet fingerprints | Reference image rule (e.g. older or larger) | Manual |
| dupeGuru | Exact, or similar picture blocks (15×15 colour grid, "hardness") | Content / blocks / EXIF time | Reference = largest file, re-prioritise rules; reference can't be deleted | To Recycle Bin |
| Immich | Exact on upload (SHA-1); near-duplicates | CLIP cosine distance ≤ **0.01** by default (similarity ≥ 0.99) | Largest file, then most EXIF fields | Favourite, highest rating, joined descriptions, union of albums and tags, GPS if agreed; others to trash |
| PhotoPrism | Exact skipped at index; stacks by same name, place & time, unique ID | Hash, metadata | — | Stacks |
| Gemini 2 / PhotoSweeper / Excire | Exact; "similar" ≈ shots ~2 s apart (Gemini); slider from identical to bursts | Size + params; bitmap/histogram/time | Smart selection; Excire can reject the non-RAW copy | To Trash; similar never auto-selected (Gemini) |

Sources: support.apple.com/en-us/102260; helpx.adobe.com/lightroom-classic/desktop/organize-photos-in-lightroom-classic/find-and-manage-duplicate-photos.html;
helpx.adobe.com/lightroom/web/share-your-work/review-and-download/duplicate-detection.html;
docs.digikam.org/en/maintenance_tools/maintenance_duplicates.html; github.com/arsenetar/dupeguru (source);
github.com/immich-app/immich (source: `duplicate.service.ts`, `dtos/config.dto.ts`, `utils/duplicate.ts`);
docs.photoprism.app/user-guide/organize/stacks; macpaw.com/support/gemini; excire.com tutorials.

**Techniques.** A file hash only catches byte-identical files; changing a keyword changes it. A hash of the decoded
pixels catches copies that differ only in metadata. Perceptual hashes (aHash, dHash, pHash; wavelet in digiKam) catch
resizes and re-encodes, with Hamming cutoffs around 5–8 of 64 bits that need tuning. Image embeddings catch
different formats and edits; Immich uses cosine ≥ 0.99, and papers warn thresholds don't transfer between models
(Glimmr uses ViT-B/16, Immich ViT-B/32).

**False positives everyone hits:** bursts (same second, same camera, near-identical), exposure brackets, edited
exports (keep the original capture time), black-and-white versions, screenshots (cluster together in CLIP space),
and the keeper chosen by file size picking the wrong copy (digiKam bug).

## 4. RAW + camera JPEG, and derived files

**Camera pairs.** Everyone pairs on *same folder + same base name + different extension*:

- Lightroom Classic: one photo with the JPEG as a sidecar unless "Treat JPEG files next to raw files as separate
  photos" is on; metadata comes from the raw; deleting removes both (*forum*).
- Apple Photos: one photo, JPEG shown, "Use RAW as Original" switches (support.apple.com).
- Photo Mechanic: combined thumbnail; ratings, tags and deletes apply to both; `Ctrl/⌘ J` unpairs (third-party).
- darktable: automatic group with a group leader; `Ctrl G` / `Ctrl Shift G` (docs.darktable.org).
- digiKam: Group Selected Files by Filename; deleting a grouped JPEG once also deleted the raw (mailing list).
- Capture One: no stacking of RAW with JPEG; a naming "Pairing" option keeps names in step when renaming.
- PhotoPrism: same-name files always stacked; optional place & time, unique ID and sequential-name stacking.

**Derived files.**

- Lightroom "Edit in Photoshop" makes `IMG_1234-Edit.tif/.psd`, optionally stacked with the original; raw files
  always get a copy (helpx.adobe.com).
- Capture One "Edit With" makes a TIFF/PSD next to the original; "Open With" sends the original.
- iPhone edits: `IMG_E0001` with an `IMG_0001.AAE` sidecar (*forum*).
- **Lineage metadata**:
  - XMP `xmpMM:DerivedFrom` (`stRef:documentID`) and `xmpMM:OriginalDocumentID` link to the source. Camera
    Raw/Photoshop write them, plus `xmpMM:History` "converted from image/x-canon-cr2" (sample files).
  - `xmpMM:PreservedFileName` is written by Lightroom export with All Metadata (*forum*).
  - `crs:RawFileName` is written by Lightroom/Bridge, but stripped by Photoshop 2020 on save (*forum*).
  - EXIF `ImageUniqueID` is often absent.
  - Capture time + camera + exposure usually survive export.

**Getting back to the RAW.** Lightroom shows edits stacked with the original and has Show in Explorer/Finder.
**Lightroom Classic can't open a loose file**: it only edits photos in its catalog, so the handoff from a browser like
Photo Mechanic is "import this folder into Lightroom" (*forum*).

**Sidecars that travel with a photo**:

- `.xmp`, in Lightroom style `IMG.xmp` or darktable/digiKam style `IMG.CR3.xmp`. Raw and JPEG collide on `IMG.xmp`.
- Apple `.AAE`.
- Capture One `CaptureOne/Settings*/IMG.CR3.cos` (edits) and `.comask` (masks).
- darktable `IMG_01.CR3.xmp` for duplicates.

**Pitfalls.**

- **Names repeat:** counters roll over, two bodies both shoot `IMG_1234`, and the same stem appears years apart in
  different folders.
- **Lineage gets stripped** by many tools.
- **Partial deletes** leave orphans.
- **Deleting a RAW must take its sidecars but never its edits.**

## 5. Folder management

- **Lightroom Classic (Folders panel)**:
  - Dragging photos onto a folder moves them on disk ("You cannot copy photos in Lightroom Classic").
  - Folders can be added, moved by dragging, renamed and deleted, and the changes are applied on disk; "Add Parent
    Folder" is also available (helpx.adobe.com: photos.html, create-folders.html).
  - *Remove* takes a folder out of the catalog without touching the disk.
  - A missing folder shows a "?". *Find Missing Folder* relinks all its photos, including subfolders.
  - *Synchronize Folder* imports new files, removes missing ones (losing their edits) and rereads metadata.
  - A disk move can't be undone with Ctrl Z (*forum*). XMP sidecars move with their raw (*forum*).
- **Capture One:**
  - Move by dragging in the Folders tool.
  - Rename is greyed out for catalog folders; the workaround is to rename on disk, then *Locate*.
  - Removing a folder doesn't delete it on disk (support.captureone.com).
- **digiKam:**
  - Albums are disk folders. Dropping photos on an album asks *Move* or *Copy*; albums move by dragging.
  - *Delete Album* goes to digiKam's own trash (docs.digikam.org/en/left_sidebar/albums_view.html).
- **Photo Mechanic:**
  - Dragging moves; holding Option (Mac) or Shift (Windows) copies.
  - The Copy/Move tool (`Ctrl/⌘ Y`) has a "Move Photos" checkbox (docs.camerabits.com).
- **Bridge:** Ctrl-drag (Windows) or Option-drag (Mac) copies; dragging to another volume copies by default
  (helpx.adobe.com/bridge).

**Pitfalls**:

- Modifier keys mean different things in different apps, and for same-volume versus cross-volume drops.
- Name conflicts need a clear choice (skip, keep both with a suffix, or replace). Bridge just errors (*forum*).
- Users expect undo, but no app offers it for disk moves.
- A "sync" that drops missing files silently loses ratings and edits.

## 6. What this means for Glimmr

1. **Import copies files into a library folder**:
   - The destination is a folder Glimmr already catalogs, named by a date template.
   - Optional second copy and rename.
   - Every copy is verified with a checksum before anything on the card can be deleted. No photo app does this, and
     it's what makes the copy trustworthy. Glimmr leaves the card alone: the user manages deletions.
2. **Skip what's already imported by content, not name.** Use the file hash, falling back to capture time + camera
   + size. Remember imported cards like Photo Mechanic's incremental ingest.
3. **Cull either on the card or after import**, in a dedicated full-screen cull view:
   - Pick/reject/stars, auto-advance and compare.
   - Burst groups from capture time + CLIP similarity.
   - A 100% loupe.
   - "Delete rejects" sends files to the system trash, and refuses when a volume has no trash unless the user
     confirms permanent deletion.
4. **Duplicates in three tiers**:
   - *exact* (file or pixel hash)
   - *same shot, different format* (camera, capture time to the subsecond, matching picture): RAW+JPEG,
     HEIC+JPEG, resized copies
   - *similar* (CLIP, review only)

   Pairs that came from the camera together are shown as a pair, not as duplicates. Merging keeps the best file and
   combines ratings, keywords and albums. Nothing is deleted without review, and everything goes to the trash.
5. **Model photos as stacks:**
   - *Capture siblings* (RAW + camera JPEG + sidecars) act as one photo with the RAW as primary.
   - *Derived versions* (edits, exports) link back to their RAW through XMP lineage, then capture fingerprint, then
     names.

   Every JPEG offers "Open RAW in…" and "Show RAW". Lightroom Classic is handed the folder for import, since it
   can't open loose files.
6. **Folder operations work on disk, and carry sidecars and pairs along.** Names never clash. Deletes go to the
   system trash. The catalog updates in place, so ratings, albums and edits survive.
