# Frontend design conventions

Current visual and route decisions for the Detour frontend (`src/main.ts`,
`src/community/`, and `src/styles.css`). Last revised 2026-08-01. When a
decision here changes, update this file in the same change.

**There is no "Detourist List".** The name was dropped from all user-facing copy
on 2026-08-01; no UI string, meta description, or API error message may
reintroduce it. Say "member recommendations", "the list", or just describe a
place as live. "Detourist" survives only as the member noun ("Recommended by 3
Detourists") and in internal identifiers (`detouristCount`, `detouristList`).

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

## Breadcrumbs: ownership, not journey

**One rule: a page has exactly one canonical trail — where the thing lives,
never how the reader navigated to it.** The browser's back button owns the
journey; *How it got here* on a place page owns the origin story. A crumb that
changed with the door somebody came through would be a second, contradictory
answer to "where am I".

| Page | Trail |
| --- | --- |
| City page, everybody's lens | `EXPLORE / SPAIN / MADRID` |
| City page, the member's own lens | `WANNA GO / NEW YORK` — one page, and the crumb names the reading on screen |
| A place on the wishlist | `WANNA GO / NEW YORK / ZIMMI'S` — the city is the parent even when the place arrived on a guide |
| A guide about one city | `WANNA GO / NEW YORK / BEST RESTAURANTS NYC`; a multi-city guide sits one level up, at `WANNA GO / {guide}` |
| A place on neither list | `EXPLORE / ZIMMI'S` — no Wanna Go path exists for it |
| A place they have been to | `BEEN & LOVED / NEW YORK / KATZ'S` |

Two consequences:

- **A guide never appears inside a place's crumb.** It is a lens over places,
  not a container of them.
- **Marking *Been* moves the root with the place**, because the root names the
  list the place is actually in.
- **The eyebrow above a place title is gone.** It said "My detours", which the
  crumb now says one line above and better; that slot belongs to status chips —
  standing the crumb cannot state, like *Not on Detour* on an imported place.

One renderer, `crumbTrailMarkup` in `src/place.ts`: the last step is never a
link and always carries `aria-current`, and a step whose page does not exist is
dropped rather than linked to nothing.

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
- Privacy is expressed structurally on this page: member search is a names-only
  typeahead;
  recommendation cards show place and truthful publication state, with a direct
  discovery action when the published venue is available in the catalogue.
  Additional distinct member recommendations appear only as an aggregate count
  of other members who seconded the place; there is no threshold or progress
  framing. Incoming shares show only the private note and place. Other members'
  status, email, identities, and recommendation prose are never rendered here,
  and neither is the endorsement graph. The *invitation* graph is a separate
  thing with its own surface — see My Circle below.
- Verification copy names two distinct paths without conflating account email
  confirmation with trust: Olga curates founding members, while later members
  need two active endorsements from verified members. Verified members also see
  their active outgoing allowance out of three.
- A meaningful recommendation from a verified member creates or updates a
  matching entry and publishes the place immediately. The
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

## The new-member flow (`?view=welcome`)

- **One question per screen, and the screen is the page.** No member nav, no feed
  beneath it, nothing to scroll to: the masthead carries the wordmark alone (it
  links home, which is the only way out of the one step that has no "later" of
  its own). The page fills the viewport; the question card is sized to its
  content, so two fields never get a full-height box drawn around them.
- **The shared vocabulary, not a new one.** Panel on `--tape-surface`, 3px
  `--tape-chrome` border, `8px 8px 0 var(--tape-rust)` hard offset (5px under
  640px, where a full-width card's shadow would cross the viewport edge), mono
  letterspaced kicker and labels, and the existing ink/white sticker buttons for
  the actions. Both answers to a step sit on one wrapping row rather than
  stacking the secondary one below the fold.
- **Steps:** invitation card (on the account route) → the place → "got another?"
  → the feed. Copy names the member's own words as the point ("Where do you keep
  going back to?"), and the saved screen says the card is in the feed rather than
  promising review.
- **The account is not one of the steps.** Email, password, invitation code,
  pseudo and home city are one card, because one `members` create needs all five
  — asking for them over two screens only meant neither form could be submitted
  without the other's answers. The card creates the account and signs the member
  in; this route starts at the first place.
- **Typed values live in module state, not the DOM.** Signing in swaps the
  catalogue and re-renders the whole app, so a value read only at submit time
  would be wiped mid-sentence.
- **Focus moves once per step**, to the step's own `<h1>` — `autofocus` does not
  fire on injected markup, and re-focusing on every render fights the cursor.

## My Circle

- **A second member-only nav item, beside Explore.** `?view=circle` renders its
  own page: Explore is the whole directory, My Circle is the people it came
  through. Both links appear together in every masthead (`memberNavLinks` in
  `src/main.ts`) and in the account nav, and neither exists for a signed-out
  visitor — a direct `?view=circle` link replaces itself with home. The page
  never waits on the catalogue: it is member data, not place data.
- **The drawing is the default view; the list is the alternative.** A
  Rings/List toggle sits in a slim toolbar under the title, next to a single
  "Invite someone" button (leading to the existing Invitations tab; the
  remaining-invitations count is its hover title, not visible text). The page
  carries no explanatory copy — in the rings view every explanation is
  spoken on hover over a node, one glance long: relationship + home + count
  ("olgaboss invited Tomás from Madrid · 2 places"); the list view has no
  hovers because its rows already print everything, including the fuller
  geography (cities of published places) and the latest place. Hovers are
  instant and never cover the drawing: a single shared `.circle-tip` element
  anchors beside the hovered element (right, flipping left near the edge) —
  native `title` tooltips (with their ~1s OS delay) are not used anywhere on
  this page. Zero places renders as "no places yet".
- **Members have one name: the pseudo.** Signup asks only for a pseudo; the
  server mirrors it into the schema's required `display_name` so older reads
  and superuser-created accounts keep working. Every member-facing surface —
  cards, circle, directory, share stamps — names people by pseudo
  (display_name is only a fallback for pre-consolidation accounts).
- **Rings**: the member at the centre, inviter (top, gold stroke) and invitees
  on the inner ring, one hop out on the outer ring fanned around the inner
  node that connects them. Contribution is the node state: hollow ring = no
  places yet; amber disc sized by place count with the numeral printed
  inside = publishing member — who contributes reads at a glance, no hover
  needed. Solid spokes are the member's own invitations; dashed accent
  spokes are second-degree provenance, and a two-line legend in the corner
  ("invited" / "one hop") says so. Spokes attach by the payload's positional
  `connector_ref` (`inviter` / `invited:<n>`), never by name or id.
  Positions are deterministic trigonometry; past 40 people the drawing bows
  out to a note pointing at the list. The Founding 50 is a satellite ring
  off to the side (numeral, never "fifty"): exactly 50 seat-dots, filled as
  taken — hovering a taken seat names the member, in seating order — and
  the centre reads as scarcity ("43 left"), never as a tally of empties. No
  spoke to the member, because it is not relational. On narrow screens the
  SVG keeps a 700px floor and scrolls sideways in its own box.
- **List**: relational rows only (the Founding 50 lives on the satellite),
  grouped by tiny accent labels (`Your inviter`, `You invited · n`,
  `One hop out · n`) with a single divider between groups and none between
  rows — spacing separates them. Each row stacks two left-aligned lines:
  name (with inline "· invited by X" on second-degree rows) and geography in
  small mono ("MADRID · 3 PLACES" / "5 CITIES · 8 PLACES" / "NO PLACES
  YET"). The right edge carries one thing: the place count. Empty groups are
  skipped. No photos or inline links — a row's one action is opening its
  person's places panel, where the member's actual recommendations live.
- **Clicking a person opens their places in a fixed right rail.** Nodes,
  taken founding seats, and list rows all open the same panel: a tall
  column (min(400px, 94vw), sized to hold the landing's exact three-across
  card) pinned to the viewport's right edge, top to bottom. Above phone
  width there is no dim; `#app:has(.circle-panel)` pads the app column right
  so the page shifts left to clear the panel — nothing sits underneath, the
  graph stays usable beside it, and clicking another person swaps the
  panel. On ≤640px it becomes an overlaid bottom sheet with a dimmed
  backdrop (swipe-down on its header dismisses; backdrop tap closes).
  Header: relationship kicker, name, home + place count; body: one 340px
  card per place through the shared `groupedRecommendationCardMarkup`
  renderer at the landing's three-across proportions (10.5rem cover, 21px
  title). Close button and Escape close, returning focus to the person it
  opened from. Data comes from `/api/detour/circle/places`
  addressed by positional reference; a member who keeps recommendations
  private renders as one quiet line ("Founding 50" caption's hover explains
  that founding members' recommendations are visible to every member).
- **The server decides what is visible.** All of it comes from
  `/api/detour/circle`, which projects only name, city, and place count, and
  only for the caller's own two edges plus the founding circle. The frontend
  never reads the members collection to rebuild the graph, and no row carries an
  email, pseudo, status, membership marker, or id.

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
