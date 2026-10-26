# Glimmr: UI Design

This document replaces the first Ant Design UI. The renderer is now **shadcn/ui (Radix) + Tailwind CSS v4**, chosen
because its components live in the repository as source and the look can be fully custom. It follows the practices used by current agent UI standards:

- [anthropics/skills `frontend-design`](https://github.com/anthropics/skills/tree/main/skills/frontend-design): plan a token
  system first, ground choices in the subject, avoid templated defaults, review screenshots.
- [vercel-labs/web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines): accessibility, focus,
  motion, typography and content rules, used as the review checklist.
- [shadcn/ui agent skill](https://github.com/shadcn-ui/ui/tree/main/skills/shadcn): compose existing primitives, use
  semantic tokens, never hand-roll what a component already does.
- [UI/UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill): pre-delivery checklist for contrast,
  hit targets, states and responsiveness.

## Why the first UI failed

| Problem | Where | Why it matters |
|---|---|---|
| Square-cropped 3:2 tiles | Grid, Rediscover | Portraits lose heads and panoramas lose their point. A photo library must show the whole photo. |
| An enterprise form for filters | 290 px panel always open with accordions | It takes a fifth of the screen from photos and looks like an admin dashboard. |
| Templated defaults | Near-black canvas with one gold accent, ALL-CAPS section labels, stat tiles under a big number, middle-dot meta strings, ✦ emoji logo | These are the commonest tells of generated UI and say nothing about photography. |
| No time structure | Grid | People remember photos by when. There were no date headers and no way to jump through years. |
| Unlabelled icon toggles, no visible focus, `div` click targets | Toolbar, tiles | These fail the accessibility and keyboard rules. |
| Settings crammed into a modal | Settings | Backup and restore deserve a full, calm page. |

## Subject, audience, job

- **Subject:** a person's own photographs, often years of trips, family and practice.
- **Audience:** enthusiasts and working photographers who also use Lightroom or Capture One.
- **Primary job:** find a photo fast, then enjoy looking at it.

Two references drive the design. One is the **light table and contact sheet**: neutral grey surroundings so colour is judged
correctly, photos laid out edge to edge, and marks made with a china marker. The other is the **photo book**: time as the
spine, with dates and places set large in an expanded face.

## Tokens

### Color

Neutral greys with zero hue, because tinted backgrounds shift how photo colours are perceived (the same reason
Lightroom and Capture One use neutral grey). Colour belongs to the photos. UI colour is reserved for marks.

| Name | Dark | Light | Use |
|---|---|---|---|
| Canvas | `#232323` | `#EBEBEB` | Behind photos (about 14% grey, neutral) |
| Panel | `#1B1B1B` | `#F7F7F7` | Sidebar, toolbars |
| Raised | `#2E2E2E` | `#FFFFFF` | Popovers, menus, dialogs |
| Line | `#3A3A3A` | `#D6D6D6` | Hairlines between regions |
| Ink | `#EDEDED` | `#1A1A1A` | Text, primary buttons, selection ring |
| Ink muted | `#9C9C9C` | `#666666` | Secondary text |
| Marker | `#F2C744` | `#B8860B` | Star ratings only (china-marker yellow) |
| Pick / Reject | `#4CC38A` / `#E5534B` | same | Flags only |

There's no brand accent colour. Primary actions are ink-on-canvas (light button, dark text). Selection is an ink ring,
the way a loupe or china marker circles a frame on a contact sheet.

### Type

The wordmark sets the voice and everything else is tuned to it.

- **Akira Expanded** is used for the **Glimmr wordmark only**, always in caps. It's a commercial font
  (Typologic), so it isn't bundled. The app uses it when it's installed on the system or when a licensed file is
  placed in `src/renderer/public/fonts/` (see the README there). Until then, the wordmark falls back to Archivo
  at 125% width and weight 900, which keeps the same wide, heavy silhouette.
- **Archivo** (variable, with width and weight axes, OFL) is used for everything else. Its width axis lets one family
  echo Akira's proportions:
  - **Display** (125% width, weight 600) for time and place: month headers ("October 2023"), Rediscover chapters,
    and the date in the viewer. This is the one bold place after the logo.
  - **UI** (100% width, weights 400–600, 13 px base) for all functional text, with tabular figures for counts and
    exposure data.
- Scale (px): 11 / 12 / 13 (UI base) / 17 (wordmark) / 19 (section display) / 26 (chapter display).
  Sentence case everywhere except the wordmark.

Pairing a super-wide display face with a neutral grotesk is a classic combination. Using one variable family at two
widths, rather than two unrelated faces, keeps the system tight. The serif from the first plan was dropped: it
argued with Akira's geometry.

### Layout

```
┌──────────────┬───────────────────────────────────────────────────────────┐
│ GlimmR       │ [⌕ Search photos…                              Ctrl K ] ⚙ │
│              │ Date ▾  Rating ▾  Camera ▾  Lens ▾  Keywords ▾  More ▾  │ ← Artlist-style filter bar
│ Rediscover   │ [ISO 1600–12800 ×] [X-T5 ×]   1,204 photos   Sort ▾  ▭▭ │
│ Photos       ├───────────────────────────────────────────────────────┬───┤
│ Picks        │ October 2023                       Iceland, aurora   │ 26│
│ Recent       │ ▆▆▆▆▆▆▆▆ ▆▆▆▆ ▆▆▆▆▆▆▆▆▆▆ ▆▆▆▆▆▆   (justified row)      │ 25│ ← year
│              │ ▆▆▆▆ ▆▆▆▆▆▆▆▆▆▆ ▆▆▆▆▆▆ ▆▆▆▆▆▆▆                       │ 24│   scrubber
│ Albums     + │ May 2019                                    Lisbon   │ 23│
│ Smart albums │ ▆▆▆▆▆▆ ▆▆▆▆▆▆▆▆▆ ▆▆▆▆ ▆▆▆▆▆▆▆▆                       │ 21│
│ Folders      │                                                       │ 19│
│ Keywords     │            [ 5 selected  ★ ⚑ ● ⌗ Add to album  Edit ] │   │
└──────────────┴───────────────────────────────────────────────────────┴───┘
```

- **Justified rows** keep every photo's real aspect ratio, with 4 px gutters and rows about 220 px tall (adjustable).
- **Month sections** with an expanded-Archivo header and a photo count.
- **Year scrubber** on the right edge to jump through time, like Google Photos.
- **Filter bar** of dropdown buttons, each a searchable checklist with counts (cmdk). Active filters become removable chips.
  The search box and filters share one query, so the chips always reflect the box.
- **Viewer:** full-bleed photo on canvas grey, chrome that fades after 2 s idle, and an info sheet grouped into File, Capture,
  Exposure, Location, Description and All fields.
- **Settings** is a full page with sections: Library, Editors, Backup, Appearance and Search help.
- **Rediscover** is laid out like a photo book: for each year, one large photo next to a cluster of smaller ones,
  dated in expanded Archivo. Library stats are a single sentence, not tiles.

- **Window chrome** is the app's own top bar (48 px, panel colour). On Windows and Linux the native minimize,
  maximize and close buttons stay as an overlay, recoloured to the theme and to the always-dark viewer, so
  Snap Layouts and accessibility keep working. On macOS the traffic lights sit inset in the sidebar.

Text is left-aligned throughout. Numbers use tabular figures.

## Principles

1. **Photos are the interface.** Chrome is quiet, grey and recedes. No decorative gradients, cards or shadows on the canvas.
2. **Time is the spine.** Dates are always visible, and jumping across years is one gesture.
3. **One bold voice.** Akira for the name, expanded Archivo for time and place, and nothing else shouts.
4. **Marks, not decoration.** Colour only means something: rating, pick, reject or label.
5. **Keyboard first, accessible always.** Visible `:focus-visible` rings, labelled icon buttons, real buttons,
   `prefers-reduced-motion` respected, hit targets of at least 28 px in dense UI.

## Review against the brief

- *Is the palette a generated default?* No. Neutral grey is a functional requirement for judging photo colour, and
  the near-black and single-accent template is gone.
- *Is the type default?* No. The wordmark is Akira Expanded by request. Archivo was chosen because its width
  axis can match it, and it has tabular figures for camera data.
- *Are there template tells?* No all-caps eyebrows, no stat tiles, no middle-dot meta strings, no arrows appended to links,
  no cards on the canvas.
- *What changed after review?* I first planned an amber accent for primary buttons. It was dropped for ink-on-grey,
  because an accent colour would compete with the photos and repeat the old UI's gold.
