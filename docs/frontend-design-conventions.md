# Frontend design conventions

Current visual-design decisions for the Detour frontend (`src/styles.css`).
Last revised 2026-07-17. When a decision here changes, update this file in the
same change that alters the CSS.

## Layout and surfaces

- **One continuous surface, no boxes.** Content lives in a centered `#app`
  column (max-width 1240px) with `--surface` (near-white) background. The
  page body behind it carries a light mint wash
  (`color-mix(in oklch, var(--mint-soft) 55%, var(--surface))`) so wide
  screens get soft colored gutters. There are **no hairline borders or
  box-shadows separating these surfaces** — the earlier `1px` outline around
  the app column was deliberately removed because it read as a nested box.
- **Square layout blocks.** `--radius` is `0px`: hero, city-chooser sheet,
  community panel, map panel, and detail panel all have right-angle corners.
  Buttons, chips, and small cards keep `--radius-sm` (8px). Do not reintroduce
  large-radius rounding on layout containers.
- **Hero is flush and square.** The hero starts at the very top of the page
  (no top margin) with square corners on every page, sitting directly against
  whatever follows it (city-chooser sheet, discovery bar).

## Color

- Hero background is `var(--violet)` (`#6e5493`) via the token — never
  hard-code the hex. City-detail heroes use their own dark background with a
  **slim oxblood baseboard strip** (`.hero::before`, max ~1.25rem tall) at the
  bottom. The strip must stay inside the hero's bottom padding: **hero text
  must never straddle a color seam.**
- Core tokens: `--violet` (brand/hero), `--mint` (accents, shadows, brand
  tag), `--oxblood` (editorial accent), `--ink` (text/solid controls),
  `--surface` / `--mint-soft` (backgrounds).

## Buttons: the sticker system

All standalone action controls share one "sticker" language: 44px min-height,
`--radius-sm` corners, `0.82rem/700` type, `1px` solid border, and a **hard
mint offset shadow** (`4px 4px 0 var(--mint)`). Hover nudges the button into
its shadow (`translate(2px, 2px)`, shadow `2px 2px 0`); active flattens it
(`translate(4px, 4px)`, shadow `0 0 0`). All translate effects are disabled
under `prefers-reduced-motion`.

Two variants:

- **Ink sticker** (solid `--ink`, white text) — primary actions: `Members`
  (`.community-toggle`), `Show full selection` (`.selection-toggle`).
- **White sticker** (white, ink border/text) — secondary toolbar controls:
  `Refine` (`.refine-btn`), `Show nearby` (`.nearby-btn`), `All cities`
  (`.all-cities-control`).

Active/engaged states swap between the variants (e.g. an active `Refine`
becomes ink; an expanded `Show full selection` inverts to white). Disabled
buttons keep a muted gray shadow and no hover motion. The city `<select>` is
intentionally **not** a sticker — a dropdown that translates on hover feels
broken; it keeps a plain ink-border treatment.

New buttons should join this system rather than introduce a new style.

## Map pins

- Pins are **color-only** — no numerals or glyphs on the pin face. Rank is
  encoded by accent color and slight pearl size: rank 3 = mint, rank 2 =
  oxblood, rank 1 = violet, community selections = white center with a violet
  ring.
- The award meaning still reaches users via the pin's hover/selection label
  (venue name + e.g. "2-level guide recognition") — keep that label when
  changing pin markup.
- Known caveat: unranked guide picks (`.pin-ranked`) share the oxblood accent
  with rank-2 pins and are distinguished only by size.
