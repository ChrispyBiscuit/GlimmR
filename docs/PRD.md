# GlimmR: Product Requirements Document

| | |
|---|---|
| Product | GlimmR, a desktop photo library for Windows and macOS |
| Status | v1.0 (MVP) scope defined; P0 items are built in this repository |
| Front end | React + shadcn/ui (Radix) + Tailwind CSS v4 in Electron. The first build used Ant Design; see [DESIGN.md](DESIGN.md) |
| Research | [RESEARCH.md](RESEARCH.md) |

## 1. Summary

GlimmR stores, sorts, organizes, searches and shows a personal photo collection. It feels like browsing Artlist:
one big search box, a dark edge-to-edge grid of large previews, facets beside the grid, and a detail view that
opens over the results. It is **not** a photo editor. When a photo needs editing, GlimmR hands it to Lightroom,
Capture One or any editor the user chooses in one keystroke.

## 2. Problem

People with years of photos (tens to hundreds of thousands of JPEG, HEIC and RAW files across folders and
drives) either:

- live inside an editor's catalog (Lightroom Classic) that is subscription-bound and editor-shaped, with uneven
  metadata filtering; or
- use consumer apps (Apple/Google Photos) that are pleasant but opaque, weak on technical metadata, and do not
  hand files to pro editors; or
- use powerful but dense DAMs (digiKam, ACDSee) that are hard to enjoy.

No tool combines **calm, rewarding browsing**, **search and sort by any metadata field**, **editor-agnostic
hand-off**, and **built-in, tested backup and restore**.

## 3. Goals and non-goals

### Goals
1. Find any photo in seconds using any metadata: date, camera, lens, exposure, GPS, keywords, ratings, filename,
   folder, or any raw EXIF/IPTC/XMP field.
2. Make sifting through photos fast and pleasant: large previews, keyboard culling, smooth scrolling.
3. Organize without moving files: ratings, pick/reject flags, color labels, keywords, albums, smart albums.
4. Open any photo (or selection) in the user's editor of choice.
5. Back up and restore the library catalog, and optionally the originals, with verification.
6. Run on Windows 10/11 and macOS 12+.

### Non-goals (v1)
- Editing pixels, develop settings, or non-destructive adjustments.
- Cloud sync, sharing, accounts, telemetry.
- Mobile apps.
- Managing files by copying them into a proprietary library (GlimmR references files in place).

## 4. Users

| Persona | Need |
|---|---|
| **Enthusiast photographer** (primary) | 50k–300k RAW+JPEG files, edits in Lightroom or Capture One, wants a fast browser and a catalog that is not tied to the editor. |
| **Family archivist** | Decades of scans and phone photos; wants "on this day", albums, and peace of mind about backups. |
| **Working pro** | Needs fast culling (ratings/flags), technical search ("ISO > 3200 with the 85mm"), and quick hand-off to an editor. |

## 5. Principles

1. **Reference in place.** Never move, rename or modify originals unless the user explicitly asks.
2. **Search is always one keystroke away** (`Ctrl/Cmd+K` or `/`).
3. **Everything is metadata, and all metadata is searchable and sortable.**
4. **Previews, not decoding.** Browse RAW via embedded JPEG previews; never block the UI on decoding.
5. **Your data is portable.** Catalog is plain SQLite; ratings/labels/keywords can be written to XMP sidecars that
   Lightroom and Capture One read.
6. **A backup you have not restored is not a backup.** Restores are first-class and verified.

## 6. Experience overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ GlimmR  [ 🔍 Search photos, e.g.  sunset camera:"X-T5" iso:>1600        ] ⚙   │
├───────────┬──────────────────────────────────────────────────────────────────┤
│ Rediscover│ [Filters ▾] chips: rating ≥ 4 ✕  lens: 23mm ✕     12,408 photos  │
│ All photos│ Sort: Date taken ▾ ↓   Size: ─●──   Group by: Month ▾             │
│ Picks     ├──────────────┬───────────────────────────────────────────────────┤
│ Recent    │ FILTERS      │ ▓▓▓▓ ▓▓▓▓▓▓ ▓▓▓▓ ▓▓▓▓▓▓▓ ▓▓▓▓                     │
│ ─ Albums  │ Date ▸       │ ▓▓▓▓ ▓▓▓▓▓▓ ▓▓▓▓ ▓▓▓▓▓▓▓ ▓▓▓▓   (virtualized grid,│
│ ─ Smart   │ Camera ▸ (12)│ ▓▓▓▓ ▓▓▓▓▓▓ ▓▓▓▓ ▓▓▓▓▓▓▓ ▓▓▓▓    hover = info +   │
│ ─ Keywords│ Lens ▸       │                                  quick actions)  │
│ ─ Folders │ Rating ★★★★  │                                                  │
│           │ ISO ─●───●─  │                                                  │
└───────────┴──────────────┴───────────────────────────────────────────────────┘
```

- **Left navigation**: Rediscover, All photos, Picks, Recently added, Albums, Smart albums, Keywords tree, Folders
  tree, Library settings.
- **Top**: the search box with tokenized field syntax and autocomplete.
- **Filter panel**: collapsible facets with live counts, include/exclude per value.
- **Grid**: virtualized thumbnail grid, adjustable size, optional grouping by day/month/year.
- **Viewer (loupe)**: full-window photo over the grid, filmstrip, info panel, keyboard culling.

## 7. Functional requirements

Priority: **P0** = v1.0 MVP (built now), **P1** = v1.1, **P2** = later.

### 7.1 Library and import

| ID | Requirement | P |
|---|---|---|
| LIB-1 | User adds one or more **library folders** (any local, external or network path). GlimmR scans them recursively and catalogs files in place. | P0 |
| LIB-2 | Supported: JPEG, PNG, WebP, GIF, TIFF, HEIC/HEIF, AVIF, BMP and RAW (CR2, CR3, NEF, NRW, ARW, SR2, RAF, ORF, RW2, PEF, DNG, SRW, 3FR, IIQ, ERF, X3F). | P0 |
| LIB-3 | Scan is incremental: unchanged files (same size + mtime) are skipped; changed files re-read; missing files are marked **offline**, not deleted from the catalog. | P0 |
| LIB-4 | Scan runs in the background with a progress indicator and can be cancelled; the UI stays usable. | P0 |
| LIB-5 | Thumbnails (≈400 px) and large previews (≈2048 px) are generated into a cache. RAW uses the largest embedded JPEG preview. | P0 |
| LIB-6 | Watch library folders for changes and rescan automatically. | P1 |
| LIB-7 | Relink: when a drive letter/mount point changes, user remaps a library folder root and all photos reconnect. | P0 |
| LIB-8 | RAW+JPEG pairs can be stacked as one item. | P1 |
| LIB-9 | Duplicate detection (content hash, then perceptual hash). | P2 |
| LIB-10 | Video files cataloged and playable. | P2 |

### 7.2 Metadata

| ID | Requirement | P |
|---|---|---|
| META-1 | Read EXIF, IPTC, XMP (embedded and `.xmp` sidecar), ICC and GPS from every file. | P0 |
| META-2 | **All** fields are stored as key/value rows, so any field is searchable and sortable even if GlimmR has no UI for it. | P0 |
| META-3 | Common fields are normalized: date taken, camera make/model, lens, focal length, aperture, shutter, ISO, exposure compensation, flash, width/height, orientation, GPS lat/lon/alt, title, caption, creator, copyright, keywords, embedded rating and label. | P0 |
| META-4 | Ratings, labels and keywords already embedded or in sidecars (e.g. from Lightroom/Capture One) are imported on first scan. | P0 |
| META-5 | User-editable in GlimmR (catalog only, originals untouched): rating 0–5, flag (pick/reject/none), color label (red, yellow, green, blue, purple), keywords, title, caption. Batch edit for a selection. | P0 |
| META-6 | Optional **write to XMP sidecar** (rating, label, keywords, title, caption) for interoperability, per photo, per selection, or automatically. Existing sidecar content is merged, not replaced. | P0 (manual) / P1 (automatic) |
| META-7 | Info panel shows every metadata field, grouped (File, Camera, Exposure, Location, IPTC/XMP, All fields) with a field filter. Click a value to search for it. | P0 |

### 7.3 Search, filter and sort

| ID | Requirement | P |
|---|---|---|
| SRCH-1 | Single search box. Free text matches across filename, folder, keywords, title, caption, camera, lens and every metadata value (full-text index, prefix matching). | P0 |
| SRCH-2 | Field syntax: `field:value` (contains), `field:"quoted value"`, `field:>N`, `>=`, `<`, `<=`, `field:a..b` (range), `-term` / `-field:value` (exclude), `has:gps`, `has:keywords`, `is:offline`. | P0 |
| SRCH-3 | Built-in fields: `camera`, `make`, `lens`, `iso`, `f`/`aperture`, `shutter`, `focal`, `rating`, `flag` (pick/reject/none), `label`, `keyword`/`tag`, `album`, `folder`, `file`/`name`, `ext`/`type` (raw/jpeg/heic/…), `orientation` (landscape/portrait/square), `date` (`2023`, `2023-05`, `2023-05-14`, ranges), `year`, `month`, `width`, `height`, `mp` (megapixels), `title`, `caption`, `creator`. | P0 |
| SRCH-4 | **Any raw metadata key** works as a field: `ExposureProgram:Manual`, `Artist:jane`, `LensSerialNumber:123`. | P0 |
| SRCH-5 | Autocomplete in the search box: field names, then known values for that field with counts. | P0 |
| SRCH-6 | Filter panel facets with counts: Date (year → month), Camera, Lens, Keywords, File type, Rating, Flag, Color label, Orientation; range sliders for ISO, focal length, aperture. Each value can be **included or excluded**. Facets and the search box produce the same query (one source of truth, shown as chips). | P0 |
| SRCH-7 | Sort by date taken, date added, filename, file size, rating, camera, lens, ISO, aperture, shutter, focal length, dimensions, **or any raw metadata key**; ascending/descending. | P0 |
| SRCH-8 | **Smart albums**: save the current query + sort as a named smart album that updates automatically. | P0 |
| SRCH-9 | Search results return in < 150 ms for 100k photos for typical queries. | P0 |
| SRCH-10 | Natural-language / visual similarity search ("dog on a beach") using a local on-device image embedding model. | P2 |
| SRCH-11 | Color search by dominant color. | P1 |
| SRCH-12 | Map view (GPS photos on a map; draw to filter). | P1 |
| SRCH-13 | Face detection and people. | P2 |

### 7.4 Browsing and viewing

| ID | Requirement | P |
|---|---|---|
| VIEW-1 | Virtualized grid that scrolls smoothly through 100k+ items; thumbnail size slider. | P0 |
| VIEW-2 | Tile hover shows filename, date, camera/exposure summary, rating, label; quick actions: rate, pick, open in editor. | P0 |
| VIEW-3 | Selection: click, Ctrl/Cmd-click, Shift-click range, Ctrl/Cmd+A; batch actions bar for the selection. | P0 |
| VIEW-4 | Loupe viewer: full window, ← → navigation, filmstrip, fit / 100% zoom with pan, info panel toggle (`I`). | P0 |
| VIEW-5 | Keyboard culling everywhere: `0–5` rating, `P` pick, `X` reject, `U` unflag, `6–9` color labels, `Caps Lock`-style **auto-advance** toggle. | P0 |
| VIEW-6 | Slideshow (`S`) for the current results. | P0 |
| VIEW-7 | Group grid by day/month/year with sticky headers. | P1 |
| VIEW-8 | Compare view (2–4 photos side by side). | P1 |
| VIEW-9 | Related strip in the loupe: same day, same keyword, same lens (Artlist-style suggestions). | P1 |

### 7.5 Rediscover (the rewarding part)

| ID | Requirement | P |
|---|---|---|
| REDIS-1 | **Rediscover** home: "On this day" (same month/day in previous years), "Highlights" (random top-rated), "Recently added", library stats (photos, years, cameras, most-used lens). | P0 |
| REDIS-2 | "Shuffle" button: a fresh random set from the library. | P0 |
| REDIS-3 | Auto memories ("Weekend in Lisbon, May 2019") built from date + GPS clusters. | P2 |

### 7.6 Organization

| ID | Requirement | P |
|---|---|---|
| ORG-1 | Albums (manual collections); a photo can be in many albums. Add via selection, drag onto album, or context menu. | P0 |
| ORG-2 | Keywords are hierarchical using `>` or `|` (e.g. `Places>Portugal>Lisbon`); the keyword tree shows counts. | P0 |
| ORG-3 | Folders tree mirrors disk structure under each library root with counts. | P0 |
| ORG-4 | Rename / delete albums, smart albums and keywords. | P0 |
| ORG-5 | Move/rename files on disk from inside GlimmR. | P2 |

### 7.7 Open in external editor

| ID | Requirement | P |
|---|---|---|
| EDIT-1 | Auto-detect installed editors on Windows and macOS: Lightroom Classic, Lightroom, Capture One, Photoshop, Affinity Photo (1/2), DxO PhotoLab, darktable, GIMP, Luminar, ON1, Pixelmator Pro, Preview/Photos (OS default). | P0 |
| EDIT-2 | User adds any editor by picking its executable/app bundle, with optional extra arguments. | P0 |
| EDIT-3 | Default editor overall and **per file type** (e.g. RAW → Capture One, JPEG → Photoshop). | P0 |
| EDIT-4 | `Ctrl/Cmd+E` opens the selection in the default editor; "Open with ▸" submenu lists all editors; "Reveal in Explorer/Finder"; "Open with system default". | P0 |
| EDIT-5 | When an edited file changes on disk, GlimmR refreshes its preview and metadata. | P1 |
| EDIT-6 | Drag photos from the grid into another app. | P1 |

### 7.8 Backup and restore

| ID | Requirement | P |
|---|---|---|
| BAK-1 | **Catalog backup**: a single `.glimmr-backup` folder containing a consistent snapshot of the database (SQLite online backup, safe while running), settings, and a manifest (version, date, photo count, library roots, SHA-256 of each file). | P0 |
| BAK-2 | **Automatic catalog backups** on a schedule (on quit / daily / weekly) to a chosen folder, with retention (keep last N). | P0 |
| BAK-3 | Integrity check before and after backup (`PRAGMA integrity_check`, checksum verify). | P0 |
| BAK-4 | **Originals backup** (optional): incremental mirror of every cataloged original into the backup destination, preserving relative paths per library root; skips files already copied with same size+mtime; verifies with checksums. | P0 |
| BAK-5 | **Restore wizard**: pick a backup, see its manifest, verify checksums, choose how to remap each library root (keep, new path, or use the originals copy inside the backup), then restore. The current catalog is saved as a safety backup first. | P0 |
| BAK-6 | **Export to XMP** for the whole library as a portable, tool-independent backup of ratings/labels/keywords. | P0 |
| BAK-7 | Backup history list with "Verify" and "Restore" actions. | P0 |
| BAK-8 | Cloud destinations (S3, Backblaze) and encryption. | P2 |

### 7.9 Settings

| ID | Requirement | P |
|---|---|---|
| SET-1 | Library folders (add, remove, rescan, relink). | P0 |
| SET-2 | Editors (detected list, add custom, defaults per type). | P0 |
| SET-3 | Backup (destination, schedule, retention, include originals). | P0 |
| SET-4 | Appearance: dark (default) / light / system. | P0 |
| SET-5 | Metadata: write XMP sidecars automatically (off by default). | P1 |

## 8. Non-functional requirements

| Area | Requirement |
|---|---|
| Performance | 100k photos: launch to usable grid < 2 s; search < 150 ms; grid scroll 60 fps; first scan ≥ 10 photos/s per core for JPEG with thumbnails; RAW via embedded previews only. |
| Scale | Tested to 250k photos and 20 library roots. |
| Safety | Originals are read-only to GlimmR except explicit XMP sidecar writes. Catalog writes are transactional (WAL). |
| Privacy | Fully offline. No telemetry, no accounts. |
| Portability | Catalog is a documented SQLite file; backups are plain folders with JSON manifest. |
| Platforms | Windows 10/11 (x64, arm64) installer (NSIS); macOS 12+ universal DMG, signed and notarized. |
| Accessibility | Keyboard navigable; visible focus; Ant Design ARIA patterns; text contrast ≥ 4.5:1. |
| Localization | Strings centralized; English v1. |

## 9. Architecture

```
Electron main process (Node)
 ├─ Catalog (SQLite via node:sqlite, WAL, FTS5)
 │   photos · metadata(key,value,num) · keywords · photo_keywords · albums · album_photos
 │   smart_albums · roots · settings · photos_fts
 ├─ Scanner (walk → stat → exifr metadata → sidecar XMP → sharp previews)
 ├─ Query engine (search syntax → parameterized SQL; facets; sort by any key)
 ├─ Editors (detect per OS, launch with file paths)
 ├─ Backup/Restore (SQLite backup API, manifest + SHA-256, originals mirror, remap)
 └─ glimmr:// protocol (thumbnails, previews, originals for the renderer)
        ▲  IPC (contextBridge, typed API)
        ▼
Renderer: React + Ant Design (dark theme) + react-virtuoso grid
```

Key decisions:
- **node:sqlite** (built into Electron's Node) instead of a native SQLite addon: no per-platform rebuilds.
- **exifr** (pure JS) for EXIF/IPTC/XMP/ICC/GPS; **sharp** for previews (prebuilt for Win/macOS).
- RAW previews: largest embedded JPEG found in the file; if none, fall back to the small EXIF thumbnail.
- Formats Chromium cannot render (HEIC, TIFF, RAW) are always viewed through generated JPEG previews.

## 10. Success metrics

- Time to find a known photo with a metadata query: median < 10 s (usability test).
- ≥ 80% of test users successfully restore a backup on first attempt.
- Crash-free sessions ≥ 99.5%.
- Weekly "Rediscover" opens per active user ≥ 2 (local, opt-in counter shown to the user only).

## 11. Release plan

| Release | Scope |
|---|---|
| **v1.0 (MVP)** | All P0 items. |
| v1.1 | Folder watching, RAW+JPEG stacking, map view, color search, compare, related strip, auto-XMP, grouping. |
| v2.0 | On-device semantic search, faces, memories, duplicates, video, cloud backup targets. |

## 12. Risks

| Risk | Mitigation |
|---|---|
| RAW formats without a usable embedded preview | Fall back to EXIF thumbnail; P2: optional LibRaw decode. |
| HEIC decode not available in every sharp build | Use embedded HEIC thumbnail via exifr; on macOS fall back to `sips`. |
| Network drives slow scanning | Incremental scans; offline state; cancellable jobs. |
| Writing XMP clobbers another app's sidecar | Merge only GlimmR-owned fields; opt-in only. |
| Large catalogs and FTS index size | Index only text-like values; numeric fields in a typed column. |

## 13. Open questions

1. Should GlimmR also offer an import-from-card flow that copies into dated folders (Photo Mechanic "ingest")? Proposed P1.
2. Should albums be exportable as folders of copies/symlinks for sharing? Proposed P2.
