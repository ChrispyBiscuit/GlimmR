# GlimmR: Product Research

Research done before writing the PRD. The question was how existing photo organizers and asset browsers work,
what users like and dislike about them, and what an "Artlist-like" browsing feel means for a personal photo
library that is **not** an editor.

## 1. Products surveyed

| Product | Model | What it does well | Where it falls short for our user |
|---|---|---|---|
| **Adobe Lightroom Classic** (Library module) | Catalog (SQLite) referencing files in place | Library Filter bar with three modes: **Text** (any indexed field: filename, caption, keywords, EXIF, IPTC), **Attribute** (flag, rating, color label, edit status), **Metadata** (up to 8 drill-down columns). Smart Collections are saved rule sets. Ratings, flags, color labels, hierarchical keywords. | Bound to an editor and a subscription. Filter bar and Smart Collection rules do not expose the same fields (users ask for long edge and megapixels in filters). Ratings live in the catalog unless "Save metadata to file" is used. |
| **Photo Mechanic (Plus)** | Browser + optional catalog | Extremely fast culling because it shows the **embedded JPEG preview** in RAW files instead of rendering them (often cited as 2–3x faster than Lightroom for culling). Strong batch captioning/IPTC. "Edit Photo with…" menu with **multiple configured editors**, per-file-type default editor, ⌘E shortcut, drag-and-drop to any open editor. | Dated UI, little "joy" in browsing, no rediscovery features. |
| **digiKam** (free, open source) | Catalog (SQLite/MySQL) over "collections" (root folders) | Hierarchical tags that act as virtual albums; labels (rating, color, pick flag); search by tags, labels, dates/calendar, timeline histogram, map, similarity, faces; Advanced Search for technical criteria. Reads XMP sidecars from other apps when a collection is added. Separate DBs for core, thumbnails, similarity, faces. | Dense, complex UI; slow to learn. |
| **Eagle** | Library folder it manages | Designer-friendly, beautiful grid. Tags, folders, **smart folders** that update automatically, filter by **dominant color**, size, shape, dimensions, rating. One-time price. | Copies files into its own library (not reference-in-place); aimed at design references rather than photo archives. |
| **Excire Foto / Excire Search** | Catalog, AI | AI keywording and natural-language/content search, writes keywords to XMP so other apps can use them. | Paid AI focus; organization UI secondary. |
| **Mylio Photos** | Local-first, multi-device | Local-first library across devices, faces, calendar view. | Subscription for premium features; sync-centric. |
| **ACDSee Photo Studio** | Catalog + editor | All-in-one DAM with categories, ratings, color labels. | Editor bundled in; heavy UI. |
| **Adobe Bridge** | File browser | Free, metadata panels. | "Open With" mostly limited to Photoshop / OS default; no real catalog. |
| **Apple Photos / Google Photos** | Managed library | The "rewarding" part: **Memories**, **Rediscover this day / On this day**, map/Places view (map on one side, photos on the other), fast timeline scrubber. Google found nostalgia is the main reason people open the app. | Managed, opaque libraries; weak technical metadata search; no "open in Capture One". |

## 2. What "Artlist-like" means

Artlist (and Artgrid/Filmsupply) are stock media browsers. The traits worth borrowing:

- **One big search box first.** Natural-language search ("search how you think"), forgiving of typos and of not
  knowing how things are tagged.
- **Visual-first results**: a dense, edge-to-edge grid of large previews on a dark canvas, with hover previews and
  quick actions on each tile. Detail opens on top without losing the result set.
- **Facets beside the grid**: category/duration/resolution/orientation style filters. Filmsupply adds
  **include and exclude** filters and **saved filters** reusable later.
- **Sort chips** (Staff picks / Newest / Top) right above results, and a live result count.
- **Contextual suggestions** in the detail view (Artlist suggests matching SFX on a clip). For photos: "more from
  this day", "same camera/lens", "same keywords".
- Reviewers liked the elegant, simple UI but found a homepage of trending content less useful when users already
  know what they want. Lesson: the home view should rediscover, but search must always be one keystroke away.

## 3. Patterns that recur across the good tools

1. **Reference in place, never own the files.** Lightroom, digiKam and Photo Mechanic catalog files where they
   are. Users keep their folder structure, and other tools can still reach the files.
2. **Separate catalog from originals, and back up both.** Lightroom's guidance: the catalog holds ratings,
   keywords, collections; originals are separate files; protect both independently, automate it, and **test the
   restore**. Keep the catalog on a fast local disk; a fast disk is not a backup.
3. **XMP is the interchange format.** Ratings, labels and keywords only travel between Lightroom and Capture One
   through XMP sidecars (`photo.cr3` ↔ `photo.xmp`, same base name). Adjustments never travel. Writing XMP
   automatically costs I/O, so it should be an option, not forced.
4. **Speed comes from embedded previews.** Never decode RAW for browsing; pull the embedded JPEG.
5. **Three-tier filtering**: free text over all metadata, attribute toggles (rating/flag/label), and drill-down
   metadata columns with counts. Saved as smart collections.
6. **Keyboard-driven culling**: 0–5 for stars, P/X for pick/reject, 6–9 for color labels, auto-advance.
7. **External editor hand-off**: multiple configured editors, per-type defaults, a shortcut, "Open with" submenu,
   reveal in Finder/Explorer.
8. **Rediscovery makes it rewarding**: on this day, memories, map, random highlights.

## 4. Gaps GlimmR can fill

- A **calm, modern, Artlist-style browser** for a personal archive that does not try to be an editor.
- **Every metadata field searchable and sortable**, including fields the user did not know existed (Lightroom's
  filter-bar gap).
- **Backup and restore built in and tested**, covering the catalog and, optionally, the originals.
- **Editor-agnostic**: one keystroke to Lightroom, Capture One, Photoshop, Affinity, DxO, darktable, GIMP or
  anything else.

## Sources

- Artlist AI search: <https://artlist.io/blog/august-whats-new-in-artlist/>, <https://www.cined.com/artlist-ai-powered-stock-footage-search-launched/>
- Artlist footage + SFX pairing: <https://artlist.io/blog/how-to-find-the-perfect-footage-and-sfx-combination/>
- Filmsupply include/exclude and saved filters: <https://wpengine.fm.co/filmsupply/?p=2738>
- Stock filter conventions: <https://knowledgebase.elblearning.com/filtering-stock-assets>
- Artlist UI review: <https://videohighlight.com/v/wF9TBP4h7jM>
- Lightroom Classic finding photos: <https://helpx.adobe.com/lightroom/help/finding-photos-catalog.html>
- Lightroom filter-bar vs smart collection gap: <https://community.adobe.com/t5/lightroom-classic-ideas/p-unify-metadata-filtering-across-lightroom-classic/idi-p/15631365>
- Lightroom 13.2 filters: <https://jkost.com/blog/2024/02/find-your-photos-faster-in-lightroom-classic.html>
- Photo Mechanic vs Lightroom culling: <https://imagen-ai.com/post/photo-mechanic-vs-lightroom-culling/>
- Photo Mechanic external editors: <https://docs.camerabits.com/support/solutions/articles/48001077633>
- Bridge external editors: <https://community.adobe.com/t5/bridge-discussions/adding-external-editors/m-p/9748554>
- digiKam features and database: <https://digikam.org/about/features>, <https://docs.digikam.org/en/getting_started/database_intro.html>
- Eagle: <https://www.hackdesign.org/toolkit/eagle/>, <https://thesweetbits.com/tools/eagle/>
- Organizer roundups: <https://www.photoworkout.com/best-software-organize-photos-windows/>, <https://alternativeto.net/software/excire-search>
- XMP between Lightroom and Capture One: <https://support.captureone.com/hc/en-us/community/posts/360014554958-Syncing-Rating-between-Lightroom-and-Capture-One>, <https://www.fastrawviewer.com/comment/reply/485/3511>, <https://www.fast.io/resources/embedded-metadata-vs-sidecar-files-xmp.md>
- Google Photos rediscovery and map: <https://techcrunch.com/2015/08/20/google-photos-introduces-rediscover-this-day-to-help-you-reminisce/>, <https://ipsnews.net/business/?p=32422>
- Catalog backup practices: <https://www.photoworkout.com/?p=9106>, <https://support.crashplan.com/hc/en-us/articles/8794463182861-Back-up-and-restore-Adobe-Lightroom>, <https://shop.zimaspace.com/blogs/nas-server-setup/separate-lightroom-catalogs-raw-files-backups>

Note: many sources are vendor blogs, affiliate roundups or forum posts; claims were used for direction, not as
benchmarks.
