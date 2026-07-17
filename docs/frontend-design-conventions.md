# Frontend design conventions

Current visual and route decisions for the Detour frontend (`src/main.ts`,
`src/community.ts`, and `src/styles.css`). Last revised 2026-07-18. When a
decision here changes, update this file in the same change.

## Layout and surfaces

- **One continuous discovery surface.** Content lives in a centered `#app`
  column (max-width 1240px) with `--surface` background. Wide-screen gutters
  use a very light violet-tinted neutral wash, not a mint field. Do not add an
  outline or shadow around the app column.
- **Square layout blocks.** `--radius` is `0px`: heroes, city chooser, account
  page regions, map panel, detail panel, filter tray layout, and catalogue
  disclosure use right-angle corners. Buttons, inputs, chips, and small cards
  use `--radius-sm` (8px). Status tags may use 4px and progress tracks may be
  pills. Do not use 10px or larger layout rounding.
- **Full-bleed mastheads and discovery bar.** Heroes and the discovery bar
  bleed across the `#app` padding with `margin: 0 calc(-1 * var(--gutter))`.
  `--gutter` is the shared horizontal inset token.
- **Dedicated account route.** Membership is never expanded above discovery.
  `?view=members` renders only the account masthead, membership workflows, and
  account footer. If opened from a city, its `city` query parameter is retained
  (for example `?city=madrid&view=members`) so the return link restores that
  city. A direct account deep link without `city` returns to the city chooser.
  Browser back/forward must continue to work through these transitions.

## Color: quiet luxe

The palette is restrained: violet and oxblood carry the editorial identity;
mint is a quiet eucalyptus accent used in small areas. Large mint planes are
not part of the system.

- `--violet`: brand/hero stock (`#6e5493`).
- `--oxblood`: editorial accent (`#86231e`).
- `--ink`: plum-black text and solid controls (`oklch(0.235 0.028 318)`).
- `--surface`: cool near-white (`oklch(0.995 0.004 305)`).
- `--canvas`: cool tinted neutral (`oklch(0.975 0.008 305)`).
- `--mint`: quiet eucalyptus accent (`oklch(0.755 0.052 158)`).
- `--mint-soft`: low-chroma eucalyptus tint (`oklch(0.955 0.016 158)`).
- `--location`: dedicated user-location green
  (`oklch(0.54 0.105 165)`); JavaScript reads this token rather than carrying a
  hard-coded color.

Mint is appropriate for the small brand tag, guide-rank accents, pin signals,
filter counts, and hard-offset action shadows. Use `--canvas` or
`--violet-soft` for broad quiet surfaces. City-detail heroes keep only a slim
0.4rem oxblood baseboard inside their bottom edge; hero copy must never cross
that seam. Decorative hero mint blocks are not used.

## Buttons: the sticker system

All standalone action controls use the same sticker language: minimum 44px
height, `--radius-sm`, `0.82rem/700` type, a 1px solid ink border, and a hard
mint offset shadow (`3px 3px 0 var(--mint)`). Hover moves the control 1.5px
into the shadow and reduces the shadow to 1.5px; active moves 3px and removes
it. Transform feedback is disabled under `prefers-reduced-motion`.

- **Ink sticker:** ink background with white text for primary actions, including
  Members on discovery, full-selection disclosure, form submits, tray Done,
  and empty-state reset.
- **White sticker:** white background with ink text for secondary actions,
  including All cities, Refine, Show nearby, invitation creation, sign-out,
  and tray Clear.
- **Engaged navigation:** Members is an anchor, not an expander. On the account
  route it carries `aria-current="page"` and swaps to the white sticker variant
  so its current-page state is visible as well as announced.
- **Disabled:** neutral canvas fill, muted text/border, gray hard offset, no
  hover/active movement, and no opacity-only state.

The city `<select>` is intentionally not a sticker: it has a plain ink border,
no offset shadow, and never translates. Tabs, filter choices, removable chips,
and map controls are contextual controls rather than standalone sticker
buttons.

## Membership/account page

- The account masthead uses ink with a slim violet rule and a small eucalyptus
  Detour tag. It includes both an explicit “Back to … discovery” link and the
  engaged Members navigation item.
- Signed-out sign-in/invitation tabs and all signed-in invite, visit,
  verification, and recommendation workflows remain on this route. The page
  must never render a map, city chooser, discovery controls, or catalogue below
  them.
- The member area is a continuous ledger, not a bordered/shadowed card attached
  to a hero. Broad member support surfaces use `--canvas`, while success,
  warning, and error colors remain semantically separate from brand accents.

## Map pins

- Pins are color-only: rank 3 = quiet eucalyptus, rank 2 = oxblood, rank 1 =
  violet, and community selections = white center with a violet ring.
- Venue labels (venue name plus recognition meaning) are visible on hover,
  keyboard focus, and selection. The inner 48px `.map-pin` remains the actual
  keyboard button with `aria-pressed` and an explicit accessible label.
- User location uses `--location` with a `--surface` outline.
- Unranked guide picks (`.pin-ranked`) still share oxblood with rank-2 pins and
  are distinguished by pearl size.
