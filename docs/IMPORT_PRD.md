# Import, culling, duplicates, RAW+JPEG and folders: product requirements

| | |
|---|---|
| Features | Import from memory cards and folders, a cull workflow, duplicate finding (including the same photo in different formats), RAW + JPEG pairs and edited versions kept together, and folder management in the sidebar |
| Platforms | Windows and macOS (Linux where it comes free) |
| Research | [IMPORT_RESEARCH.md](IMPORT_RESEARCH.md) |
| Replaces | Main PRD items LIB-8 (RAW+JPEG stacking), LIB-9 (duplicates), VIEW-8 (compare), and open question 1 (card ingest) |

## 1. Goal

Plug in a card, see what's new, cull, and keep only what's worth keeping, without ever risking a photo. Afterwards the
library stays clean:

- no duplicates
- every RAW sits with its camera JPEG and its edited versions, so it can be re-edited at any time
- folders can be reorganised from the sidebar as easily as in Explorer or Finder

## 2. Principles

1. **Nothing is lost.**
   - Copies are verified with a checksum, and cards are never written to: the user manages the card.
   - Deletes go to the system trash. If a volume has no trash, Glimmr says so and asks before deleting permanently.
   - Glimmr never formats cards.
2. **Content, not names.** File names repeat across cards, folders and cameras, so identity comes from content
   hashes and capture data. Names are only a hint.
3. **One photo, many files.** A RAW, its camera JPEG and its sidecars are one photo. Edited versions link back to it.
   Every operation (rate, move, delete) treats them as a unit unless the user splits them.
4. **Suggest, don't decide.**
   - Duplicate groups, bursts and similar photos are suggestions.
   - Only byte-identical copies can be merged in one click.
   - Nothing is pre-selected for deletion except true duplicates and explicit rejects.
5. **The catalog follows the files.** Moving or renaming in Glimmr updates the catalog in place, so ratings,
   keywords, albums and edits survive. Changes made outside Glimmr are picked up and relinked, never silently
   dropped.
6. **Keyboard first.** Culling and duplicate review work without a mouse, with Lightroom's keys.

## 3. Import

### 3.1 Sources

| ID | Requirement | Pri |
|---|---|---|
| IM-1 | **Detect cards.** Watch mounted volumes, polling every 2 s: drive letters on Windows, `/Volumes` on macOS, `/media` and `/run/media` on Linux. A volume with a `DCIM` folder (or any supported photos at its top levels) is a card. A toast offers *Import*. Setting: "Open Import when a card is inserted" (off / ask / open). | P0 |
| IM-2 | **Import from any folder or drive** (File → Import…, or drop a folder on the Import window), not just cards. | P0 |
| IM-3 | **Several cards in one import** (two-slot cameras, several bodies), shown together and copied to one destination. | P1 |
| IM-4 | The card's photos are read in place: thumbnails come from the embedded previews, so a card with 2,000 RAW files shows in seconds. | P0 |

### 3.2 The Import window

| ID | Requirement | Pri |
|---|---|---|
| IM-5 | Full-window view of the card, grouped by day taken, with the counts *new*, *already in library* and *selected*. RAW + JPEG pairs show as one item. | P0 |
| IM-6 | **Already imported** items are dimmed and unselected by default. The match is by content: the same size and capture time plus a hash of the start and end of the file, confirmed by a full hash before skipping. File names are never used. | P0 |
| IM-7 | **Select what to import:** All new (default), Picks only, All but rejects, or a manual selection (`Ctrl/⌘ A`, shift/ctrl-click, by day). | P0 |
| IM-8 | **Cull on the card before importing** with the cull view (§4). Flags and ratings made here are applied to the imported photos and written to them. | P0 |
| IM-9 | **Destination:** a folder in the library (default: the last used), plus a subfolder template. The default template is `{YYYY}/{YYYY-MM-DD}`, with an optional event name, e.g. `2026/2026-11-21 Lisbon`. Templates can use: year, month, day, event name, camera model, card name. A live preview shows the resulting paths. | P0 |
| IM-10 | **Rename** (off by default). Template tokens: original name, date, time, camera, event, sequence number with a start number. `IMG_1234.CR3` and its `.JPG` always get the same new name. | P1 |
| IM-11 | **Second copy** to another folder or drive (backup), verified the same way. | P1 |
| IM-12 | **Videos** on the card can be copied along (on by default), even though Glimmr doesn't catalog video yet. | P1 |
| IM-13 | Apply on import: keywords, a creator/copyright line, and an album. | P2 |
| IM-14 | Presets for the destination, template, rename, second copy and options. | P1 |

### 3.3 Copying safely

| ID | Requirement | Pri |
|---|---|---|
| IM-15 | Copy with progress (files, MB, time left), in the background. The library stays usable, and the import can be cancelled. | P0 |
| IM-16 | **Verified copy:** hash the source while reading it (SHA-256). Write to `name.glimmr-part`, flush to disk, read it back and compare, then rename into place and keep the original modified time. A mismatch is retried once, then reported. | P0 |
| IM-17 | **Never overwrite.** If a file with the same name exists at the destination with the same content, it's skipped as already imported. With different content, the new file gets a suffix (`IMG_1234-1.CR3`, with its JPEG and sidecars renamed to match). | P0 |
| IM-18 | Sidecars come along: `.xmp` (both `IMG.xmp` and `IMG.CR3.xmp`), `.THM`, `.AAE`. | P0 |
| IM-19 | **Crash-safe history.** Each copied file is recorded as it completes, so an interrupted import resumes without duplicates, as Photo Mechanic's incremental ingest does. | P0 |
| IM-20 | Imported files are added to the catalog as they arrive, with pairs, culling marks and import keywords. They appear in a *Last import* view in the sidebar. | P0 |

### 3.4 Finishing

| ID | Requirement | Pri |
|---|---|---|
| IM-21 | Summary: imported, skipped as already imported, failed (with reasons), and where the files went. | P0 |
| IM-22 | **Eject card** button, plus an option to eject automatically when an import succeeds. | P1 |
| IM-23 | **Glimmr never deletes, changes or formats anything on a card.** Cards are read-only to Glimmr; the user manages the card (normally by formatting it in the camera). | P0 |

## 4. Culling

| ID | Requirement | Pri |
|---|---|---|
| CU-1 | **Cull view**: a full-window loupe with a filmstrip, opened on any set (a card in Import, the last import, a folder, a search, a selection). Shortcut `Ctrl/⌘ Shift C` / toolbar *Cull*. | P0 |
| CU-2 | Keys: `P` pick, `X` reject, `U` unflag, `0–5` stars, `6–9` colour labels, `←/→` move. Auto-advance is on by default in the cull view (`Caps Lock` toggles it), and `Shift` with a key advances once. | P0 |
| CU-3 | **Zoom:** `Z` or `Space` toggles 100% at the spot under the pointer (or the centre). The zoom position is kept from photo to photo, to check focus on the same subject across a burst. | P0 |
| CU-4 | **Compare** (`C`): two photos side by side with synced zoom and pan; the pick moves on to the next candidate. **Survey** (`N`): up to 9 photos fitted on screen, `X` removes one from view. | P1 |
| CU-5 | **Bursts:** consecutive photos from one camera less than 2 s apart and visually alike (CLIP similarity ≥ 0.9) are grouped. The filmstrip shows the group, and the cull view can step group by group, opening Compare on a group. | P1 |
| CU-6 | **Sharpness hint:** a focus score (edge variance in the central area of the preview, and the camera's focus point when the maker notes give it). Shown as a small meter, with *Sort by sharpness* within a burst. A hint only, never automatic. | P2 |
| CU-7 | Counter: *Picked 112 · Rejected 340 · Unflagged 1,204*, and filters for each. | P0 |
| CU-8 | **Delete rejects** (`Ctrl/⌘ Backspace`): a review screen shows the rejected photos (RAW, JPEG and sidecars counted), then moves them to the system trash. On a card in Import, rejects are simply not imported and stay on the card (IM-23). | P0 |
| CU-9 | Culling marks apply to both files of a RAW + JPEG pair (§6), and are written to XMP if the user's XMP setting is on. | P0 |
| CU-10 | Undo (`Ctrl/⌘ Z`) for marks, and for the last trash where the OS lets Glimmr restore it. Otherwise the confirmation says it is in the system trash. | P1 |

## 5. Duplicates

### 5.1 What's detected

| Tier | Meaning | How | Default action |
|---|---|---|---|
| **Exact** | The same file | Same size, then same SHA-256 | Keep one, trash the rest (one click) |
| **Same picture** | Same pixels, different metadata or name (re-tagged, renamed) | Same pixel hash (a hash of the decoded, upright, 8-bit preview) | Keep one, merge metadata |
| **Same shot, other format** | One exposure saved twice: RAW vs a JPEG copy in another folder, HEIC vs JPEG, resized or re-encoded copies | All of: same camera (make, model, serial if known); same capture time (to the subsecond when present); same exposure settings; aspect ratio within 1%; visually alike (dHash distance ≤ 10 of 64 and CLIP ≥ 0.95) | Review: keep the best, or *stack as versions* |
| **Similar** | Bursts, brackets, retakes | CLIP similarity ≥ 0.93 (adjustable 0.85–0.99), within a time window (default: same day) unless widened | Review only, nothing selected |

Camera RAW + JPEG pairs in the same folder are not duplicates. They are paired automatically (§6) and never appear
here.

### 5.2 Requirements

| ID | Requirement | Pri |
|---|---|---|
| DU-1 | **Fingerprints at scan time:** file size, a quick hash (first and last 64 KB), a 64-bit dHash and pixel hash from the preview, capture subseconds and the body serial. The full SHA-256 is computed only when sizes and quick hashes collide, so a 300,000-photo library isn't read twice. | P0 |
| DU-2 | **Duplicates** view in the sidebar (under the library), with a tier filter and a count badge. Groups are listed by size. | P0 |
| DU-3 | A group shows its photos side by side with what differs highlighted: format, pixel size, file size, folder, date modified, rating, keywords, albums and edits. | P0 |
| DU-4 | **Keeper suggestion** (a star on one photo), in order: RAW over other formats, most pixels, has edits/rating/keywords, oldest capture or import, largest file. The user can pick another with a click or `1–9`. | P0 |
| DU-5 | **Merge** keeps the keeper and gives it: the highest rating, a pick if any copy had one, colour label if missing, the union of keywords and albums, title, caption and GPS if missing. The other files (with sidecars) go to the trash. | P0 |
| DU-6 | Actions per group: *Merge*, *Stack as versions* (§6), *Not duplicates* (remembered, never shown again), *Skip*. Bulk: *Merge all exact duplicates*. | P0 |
| DU-7 | A merge log keeps what was merged into what, so Undo can restore the catalog records while the files are still in the trash. | P1 |
| DU-8 | Import skips exact duplicates already in the library (IM-6). Adding a folder flags duplicates it brings in, as a toast with a link to the view. | P0 |
| DU-9 | Search: `is:duplicate`, `dup:exact`, `dup:format`, `dup:similar`. | P1 |

## 6. RAW + JPEG pairs and edited versions

### 6.1 Model

- **Capture pair**: the files of one exposure, i.e. a RAW, the camera's JPEG/HEIF and their sidecars. They are
  **one photo** in the catalog: the files are linked by a database record, not merged or renamed.
  - The **RAW is the main file**: it's what editing, "Open RAW in…" and the photo's identity refer to.
  - The **camera JPEG is what's displayed**: thumbnails, the grid, the viewer and slideshows. A pair whose JPEG is
    missing falls back to the RAW's embedded preview.
- **Versions**: edited or exported files made from a photo (`IMG_1234-Edit.tif`, an export in another folder, a
  Photoshop PSD). They are separate photos linked to their source and shown as a **stack**: the original on top,
  versions behind it with a count badge.

### 6.2 Matching (strongest first)

| Signal | Used for |
|---|---|
| Same folder + same base name + different extension, with the capture time agreeing within 2 s when both have one | Capture pair (automatic) |
| XMP lineage: `xmpMM:DerivedFrom`/`OriginalDocumentID` matches the source's `DocumentID`, or `History` "converted from image/x-…raw" | Version (automatic) |
| `xmpMM:PreservedFileName` or `crs:RawFileName` names the RAW, and the capture data agrees | Version (automatic) |
| Capture fingerprint: camera + serial + capture time (+ subseconds) + exposure, with `ImageUniqueID` when present | Version (automatic when unique, otherwise suggested) |
| Name patterns: `-Edit`, `-Edit-2`, `_edited`, `IMG_E1234`, ` (2)`, `-2` near the RAW | Suggested only |

Links are stored in Glimmr's catalog, never written into the user's files. Every inferred link can be confirmed or
broken.

### 6.3 Requirements

| ID | Requirement | Pri |
|---|---|---|
| ST-1 | Capture pairs show as one tile with a **RAW+JPEG** badge, displaying the camera JPEG. The info panel lists both files with the RAW as the main file. A toggle in the viewer shows the RAW's own preview for comparison. | P0 |
| ST-2 | Ratings, flags, labels, keywords, albums and culling apply to the whole pair. Setting: "Mark RAW and JPEG separately". | P0 |
| ST-3 | Moving, renaming and deleting a pair moves, renames or deletes every file in it, with sidecars. *Delete JPEG only* / *Delete RAW only* is in the context menu. | P0 |
| ST-4 | **Unpair** and **Pair selected** in the context menu. | P1 |
| ST-5 | Versions are detected at scan time with the signals above. The stack badge shows the count, and the viewer has a **Versions** strip (original, camera JPEG, each edit). | P1 |
| ST-6 | From any JPEG/TIFF/PSD with a known RAW: **Open RAW in [editor]**, **Show RAW in Explorer/Finder**, **Go to original**. This is the "re-edit any time" path. | P0 |
| ST-7 | Editor handoff opens the RAW, not the JPEG, when the editor's rule is for RAW (per-type editor rules already exist). For Lightroom Classic, which only edits photos in its catalog, Glimmr hands it the RAW so Lightroom offers its import (*to verify on Windows and macOS*). | P1 |
| ST-8 | **Stack as versions** from the Duplicates view, and *Add to stack* / *Remove from stack* by hand. | P1 |
| ST-9 | Search and filters: `is:pair`, `has:raw`, `has:versions`, `is:version`. The grid can show stacks collapsed (default) or expanded. | P1 |
| ST-10 | Deleting a RAW never deletes its versions. It asks whether to keep the versions (they become stand-alone photos) or trash them too. | P0 |

## 7. Folder management

| ID | Requirement | Pri |
|---|---|---|
| FO-1 | **Drag photos onto a folder** in the sidebar to move them there on disk. Hold `Alt` (Windows) / `Option` (macOS) to copy instead. The pointer shows which one will happen, and a drop on another drive copies unless `Shift` is held. | P0 |
| FO-2 | **Drag a folder onto another folder** to move it, with everything inside. Dropping a folder onto its own subfolder isn't allowed. | P0 |
| FO-3 | Context menu: **New Folder**, **Rename** (also `F2`, inline), **Move to…**, **Show in Explorer/Finder**, **Delete…**, **Rescan**, and, on top-level library folders, **Remove from library** (catalog only, files untouched). | P0 |
| FO-4 | **Delete folder** moves it to the system trash after a confirmation with counts ("Move "2024-08 Lisbon" and its 412 photos (836 files) to the Recycle Bin?"). | P0 |
| FO-5 | **Moves keep the catalog.** Photos keep their ids, ratings, keywords, albums, edits and previews; only their paths change. Pairs, sidecars (`.xmp`, `.AAE`, `CaptureOne/Settings*/…cos`) and versions in the same folder move together. | P0 |
| FO-6 | **Name conflicts:** a dialog lists the clashes with *Skip*, *Keep both* (adds `-1`) or *Replace* (the existing file goes to the trash first), plus "Do this for all". | P0 |
| FO-7 | **Cross-drive moves** use the verified copy (IM-16), then trash the source, with progress and cancel. | P0 |
| FO-8 | **Undo** (`Ctrl/⌘ Z`) for the last move, rename or new folder, from an operation log, for 10 minutes or until the files change. Deletes can't be undone in-app; the dialog says where they went. | P1 |
| FO-9 | **Missing folders** (renamed or moved outside Glimmr, or a disconnected drive) are shown greyed with a warning. **Locate…** relinks the folder and all its subfolders, matching photos by relative path, then size and capture time. Missing photos are never dropped automatically. | P1 |
| FO-10 | Dropping files or folders from Explorer/Finder onto a sidebar folder copies them in (move with the platform modifier) and catalogs them. | P1 |
| FO-11 | Drag photos onto an **album** to add them (no file change), so drops in the sidebar are consistent. | P1 |

## 8. Data model

New and changed tables (catalog version 4):

- `photos` gains `quick_hash`, `sha256` (when computed), `pixel_hash`, `dhash`, `subsec`, `serial`, `doc_id` and
  `derived_from` (XMP IDs), and `primary_of` (the pair this file belongs to, for non-primary files).
- `photo_files`: every file of a photo (role `primary`, `jpeg`, `sidecar`), so pairs and sidecars move and delete
  together.
- `photo_links`: `(from, to, kind 'version' | 'not-duplicate', source 'xmp' | 'capture' | 'name' | 'user')`.
- `imports` and `import_files`: source volume, hash, destination and state per file, for resume and "already
  imported".
- `ops_log`: moves, renames and merges, for undo.

## 9. Non-goals

- Deleting from, writing to or formatting cards (IM-23).
- Cataloguing video (videos can be copied during import).
- Converting to DNG on import.
- AI closed-eye or face detection. Bursts and the sharpness hint are the culling aids for now.
- Writing lineage into the user's files. Links live in the catalog.
- Tethered shooting.

## 10. Acceptance

- **Import:** a 2,000-file card (CR3+JPG pairs, two DCIM folders with repeated numbers) imports with every file
  verified. Pulling the card mid-import and re-importing copies only the rest. The *already imported* count is right
  after files are renamed in the library. A card file corrupted after hashing is caught.
- **Cull:** with auto-advance, 1,000 photos can be culled without leaving the keyboard. *Delete rejects* moves exactly
  the rejected pairs and their sidecars to the trash.
- **Duplicates:** in a test library of copies (renamed, re-tagged, resized, HEIC vs JPEG, RAW with a JPEG copy
  elsewhere, bursts, brackets, edited exports), every copy is found in the right tier, and bursts, brackets and
  edits are not reported as exact or same-shot duplicates. Merge keeps the union of keywords and albums.
- **Pairs and versions:** pairs collapse to one tile and are rated and deleted together. A Lightroom `-Edit.tif` and
  an exported JPEG link to their RAW, and *Open RAW in…* opens the RAW.
- **Folders:** moving, renaming and deleting folders and photos (same drive and across drives) keeps every rating,
  album and edit, moves sidecars, handles conflicts, and Undo restores a move.
- Unit tests for templates, conflict naming, pairing and duplicate rules. End-to-end tests drive the app with a fake
  card (a folder volume with `DCIM`).

## 11. Delivery

| Phase | Contents |
|---|---|
| **1** | Import (IM P0s), cull view with delete rejects (CU P0s), RAW + JPEG pairs (ST-1–3, ST-6, ST-10), folder management (FO P0s), exact and same-picture duplicates |
| **2** | Same-shot and similar duplicates with merge, versions and stacks, compare and survey, bursts, second copy, rename templates, eject, undo, missing-folder relink |
| **3** | Sharpness hints, import presets and metadata on import, several cards at once |

## 12. Status

Phase 1 is built:

- **Import:** IM-1, IM-2, IM-4–9, IM-12, IM-15–21, IM-23.
- **Cull view:** CU-1–3, CU-7–9.
- **Duplicates:** exact and same-picture tiers. DU-1–6 and DU-8, except the toast on adding a folder; the sidebar
  shows a count instead.
- **Pairs:** ST-1–3, ST-6, ST-10. ST-10 is trivially met, since versions come in phase 2.
- **Folders:** FO-1–7, FO-10 (drops from the photo grid only), FO-11.

Verified with unit tests and end-to-end runs of the built app:

- a fake card detected under `/media`, culled, imported, card unchanged
- folder drag and drop, rename, delete
- the Duplicates view and merge
- the library cull with Delete Rejects

On a card, 100% zoom shows full resolution for camera JPEGs and a 2048 px preview for RAW and HEIC files.

Still to do in later phases: same-shot and similar duplicates, versions and stacks, compare and survey, bursts, second
copy, rename templates, eject, undo, missing-folder relink, Unpair/Pair (ST-4).

## 13. Decisions

1. **Pairs:** the RAW is the main file; the camera JPEG is what's displayed. The two are linked in the catalog like
   a database relation, so the RAW can always be found and re-edited from the JPEG.
2. **Cards:** Glimmr never deletes from a card. The user manages deletions.
3. **Culling on the card:** rejects aren't imported and stay on the card.

## 14. Open questions

1. Similar-photo threshold: CLIP ViT-B/16 values above are starting points. They will be tuned on a labelled test
   set of bursts, brackets and re-exports before release.
