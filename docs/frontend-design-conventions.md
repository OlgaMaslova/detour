# Frontend design conventions

Current visual and route decisions for the Detour frontend (`src/main.ts`,
`src/community.ts`, and `src/styles.css`). Last revised 2026-07-19. When a
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
that seam. Decorative hero mint blocks are not used. One sanctioned mint
plane: the Madrid chooser card uses a solid `--mint` background with ink text.

City chooser cards are fully clickable: the entire `.city-choice-content`
block is the anchor (no separate "Explore …" action link). Card links carry
no underline, keep their per-city colors across visited/hover, and show an
inset `currentColor` focus outline so keyboard focus is visible on both light
and dark cards. Cities without a bespoke per-city rule render ink-on-card.

## Signed-in network home

- The signed-in welcome is the network home's single emphatic color plane: a
  violet field, eucalyptus identity label, white copy, and oxblood base seam.
  The invitation landing keeps its separate existing treatment.
- Recommendations and private shares are distinct ledger planes rather than one
  white stack. Recommendations use an oxblood-tinted surface and provenance
  cues; shares use an eucalyptus-tinted surface, with violet received and
  oxblood sent column labels.
- Feed entries remain compact 8px-radius cards with a top provenance rule and a
  hard palette-colored offset shadow. Recommendation, received, sent, and new
  states are differentiated by both words and form/color; broad soft shadows
  and decorative side stripes are not used.
- Place-name controls retain underlines, gain a 44px target, and use eucalyptus
  hover/active feedback plus the shared violet focus ring. Section counts use
  tabular numerals and visible palette blocks rather than floating text.
- These treatments are scoped to `.network-home` and its feed components so the
  account, invitation, and contextual destination-search areas retain their
  established visual hierarchy and behavior.

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

## Public founding-member requests

- The signed-out network homepage leads with the member-network proposition and
  a compact live sample from the anonymous public-recommendations endpoint. The
  sample renders only complete real-member recommendations (place, city, note,
  and pseudo), never fills missing content, and activates a place only through a
  safe published-catalogue match. Loading, empty, and unavailable states leave
  the invitation request and member sign-in paths fully usable.
- The founding-member request follows the live sample. City search remains
  available afterward as a quiet destination utility, never as the homepage's
  main proposition or a complete-directory promise. The membership plane gives
  clearly separated paths to request an invite or continue with an invitation
  already received; the request form is not a replacement for the dedicated
  account route.
- The public request asks for name, email, city, and a short note about what the
  visitor would bring to Detour. Only email is required. The form retains typed
  values through ordinary homepage rerenders and failed submissions, disables
  while pending, and reports validation, duplicate, and connection errors
  inline with focus moved to the field or message that needs attention.
- A successful request is described only as received for personal follow-up by
  the Detour team. It never promises immediate access or membership. The member
  sign-in/join-with-code action remains available beside the confirmation.
- Public request styling stays within the existing violet membership plane:
  white labeled fields, the shared ink-and-mint sticker action, square editorial
  structure, and semantic error/success treatment distinct from brand accents.

## Membership/account page

- The account masthead uses ink with a slim violet rule and a small eucalyptus
  Detour tag. It includes both an explicit “Back to … discovery” link and the
  engaged Members navigation item.
- Signed-out sign-in/invitation tabs and all signed-in invitation,
  waiting-list recommendation, private-share, settings, and eligible member
  contribution workflows remain on this route. Legacy visit-evidence and
  editorial-submission forms are not part of the member interface. The page
  must never render a map, city chooser, discovery controls, or catalogue below
  it.
- The member area is a continuous ledger, not a bordered/shadowed card attached
  to a hero. Invitations, the member's recommendation history, private
  shares, eligible contribution intake/history, and account settings remain
  separated by the existing tabs. Broad support surfaces use `--canvas`, while
  success, warning, and error colors remain semantically separate from brand
  accents.
- Privacy is expressed structurally: member search is a names-only typeahead;
  recommendation cards show place and truthful publication state, with a direct
  discovery action when the published venue is available in the catalogue.
  Additional distinct member recommendations appear only as an aggregate count
  of other members who seconded the place; there is no threshold or progress
  framing. Incoming shares show only the private note and place. Other members'
  status, email, identities, recommendation prose, and the endorsement graph are
  never rendered.
- Verification copy names two distinct paths without conflating account email
  confirmation with trust: Olga curates founding members, while later members
  need two active endorsements from verified members. Verified members also see
  their active outgoing allowance out of three.
- A meaningful recommendation from a verified member creates or updates a
  matching entry and publishes the place immediately on the Detourist List. The
  UI refreshes both the member history and public catalogue, highlights the
  recommendation card, and lets the member open that specific published place
  in discovery. Additional distinct member recommendations are social proof
  only and are never required for publication. A rare unpublished card must say
  whether it has no recommendation note or has a saved recommendation that is
  not live yet, without inventing a cause; its edit and private-share workflows
  remain available.
- **Member contributions are a separate review lane.** Only a signed-in member
  whose community status is `verified` sees the “Places I love” prompt, tab,
  and form. The form sends only place name, city, country, optional address,
  optional category, selected occasions, and a meaningful private recommendation
  note; it never sends member, source, status, normalization, or curator fields.
  The member's own contribution history loads independently from recommendations,
  shares, and invitations so a contribution-list error becomes an account notice
  without breaking those workflows.
- Contribution confirmation and `in_review` records must say plainly that the
  place is visible only in the contributor's account and is not public before
  approval. The history is filtered to the signed-in contributor, shows review
  status in both words and semantic color, and never renders recommendation or
  curator notes. After successful intake, refresh the history and focus the new
  in-review record. Approved details may be public; rejected details remain
  non-public.

## San Francisco occasion discovery

- San Francisco alone adds the shared contribution occasion taxonomy as a
  horizontal, multi-select browsing layer between the destination controls and
  the map. Multiple choices use AND semantics; “All occasions” clears only the
  occasion choices and keeps guide-backed places without tags discoverable.
- Occasion choices compose with recognition, source, and category filters and
  appear in the same active-filter/removal system. Cards and selected-place
  details show only occasion values present in public catalogue data.
- Approved member contributions load as an optional public lane using only
  place name, city, country, address, category, occasions, and status. A missing
  or failing collection must not break the guide/editorial catalogue. Private
  member identity, recommendation notes, curator notes, and non-approved rows
  never enter discovery data.
- The exact visible provenance label for that lane is “Recommended by a local
  member.” Guide awards, editorial local picks, Detour community selections,
  and local-member recommendations remain separate in cards, popups, details,
  filters, and accessible names.
- Approved contributions without coordinates remain in the full selection and
  do not create map pins. Exact name-and-city matches may add local-member
  provenance and occasions to an existing mapped place without replacing its
  guide or editorial attribution.

## Map pins

- Pins are color-only: rank 3 = quiet eucalyptus, rank 2 = oxblood, rank 1 =
  violet, and community selections = white center with a violet ring.
- Venue labels (venue name plus recognition meaning) are visible on hover,
  keyboard focus, and selection. The inner 48px `.map-pin` remains the actual
  keyboard button with `aria-pressed` and an explicit accessible label.
- User location uses `--location` with a `--surface` outline.
- Unranked guide picks (`.pin-ranked`) still share oxblood with rank-2 pins and
  are distinguished by pearl size.
