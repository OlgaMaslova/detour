# Guides — specification

*Drafted 2026-08-10. A member is reading somebody else's list of restaurants and
wants to keep it. Privately, grouped, and without any of it becoming a
recommendation.*

> **Shipped.** `pb_migrations/1786838400_guides.js`, `pb_hooks/guides.js`,
> `pb_hooks/guides.pb.js`, `src/guides.ts`, `src/private-place.ts`, the Wanna go
> planning space, the city page at `?d=<slug>` (`&lens=yours` for the member's
> own reading — `?dest=` resolves to it), the guide page at `?guide=<id>`, and
> the private place page at `?mine=<id>`. Where this document
> describes schema or routes it describes what exists.
>
> **Skipping is built** (2026-08-11), and narrowly: `skipped` is a boolean on the
> member's own imported row, not a status column. The ladder stays three
> collections with their own rules — a status column would be a second source of
> truth for the same fact. It is safe as a negative signal precisely because it
> is private: nobody else can see it, nothing computed for another member reads
> it, and it says "not on my list" rather than anything about the place. See
> *The guide page* below.
>
> **Not built, and deliberately.** Destination
> records, so renaming and merging ("NYC trip in May") — a destination is a
> derived string today. Path routes (`/wanna-go/:destination`) — this app is
> query-param routed end to end, including the preview Worker. One Place table —
> imported places and catalogue saves are still two stores presented as one card.

---

## The problem

Somebody reads *The 38 Best Restaurants in New York City* on Eater. They are
going to New York in October. There is no version of Detour where those
thirty-eight places belong in the catalogue — nobody has stood behind any of
them, and the catalogue's entire claim is that somebody did. But there is
obviously something the member wants, and it is not "type them in one at a
time."

So: paste the link, keep what is on it, privately.

## What it is not

**It is not the return of the guide catalogue.** Detour's baseline migration
deliberately swept away an external-guide catalogue — Michelin, Guía Repsol, 50
Top Pizza, the World's 100 Best Coffee Shops — because a place is public here for
exactly one reason: a member recommended it. Imported places sit in two
collections of their own and touch neither `venues` nor
`community_place_entries`. Nothing about them is public, ranked, counted, or
computed for anybody else.

**It is not a recommendation.** No note, no author, no signal, no feed entry, no
notification to anyone. A member who has actually been somewhere they imported
writes an ordinary recommendation, through the ordinary form.

**It does not import a ranking.** `position` is in the source data and is
deliberately not read. A list here is a set of places the member might want, not
a chart — storing "number 3 of 38" would import the exact thing the product
exists in opposition to.

**It hotlinks photographs, and never copies them.** The publication's own
photograph is pointed at from their servers and credited to the list it came
from; nothing is fetched, stored or re-served, which is the difference between
linking to a photograph and reproducing one. A publisher who blocks that costs
the card its cover and nothing else. It is never promoted onto a
`venues.image_url` — Detour's covers are separately resolved and verified, and a
private row must not put somebody else's photograph on a public catalogue page.

Photographs are requested at a width, not at full size. Eater serves theirs at
around 3.7MB; their CDN is the WordPress/Photon one, which resizes from a `w`
parameter and returns the same image at 58KB. The hint is applied at render
time, and **only** to URLs already carrying Photon's own parameters — an
unrecognised CDN may sign its URLs, where an extra parameter would trade a heavy
image for no image.

## The model

Three nouns, and only one of them is a container.

| | |
|---|---|
| **Place** | every card, whichever door it came through. Carries its own provenance. |
| **Destination** | a city. **Derived, never declared** — it appears because it holds a place and vanishes when it holds none. No record, so no renaming yet. |
| **Guide** | an imported compilation. A **source, not a container**: a read-only mirror of the piece, owning no state but the import itself. |

Imported places land on **Wanna go**, which is the planning space. That is the
right rung for three reasons: it is the private one, it makes no claim, and it is
the only rung where somebody else's opinion may put something on a member's list
— the other two are things the member asserts themselves.

```
(none) → Wanna go → Been & loved → Recommended
           ↑
     guides drop places here, grouped by destination
```

## Wanna go, laid out

Filter chips, then one section per destination, inline:

```
Your private planning space. Nobody else sees this.
[ALL · 12] [NEW YORK · 9] [LISBON · 3] [Source: all ▾]      [ + Add ]

NEW YORK                    9 places · 2 guides      Open map
─────────────────────────────────────────────────────────────
Guides here  [ Eater NY  6 places ] [ Pizza crawl  1 place ]

[ card ]  [ card ]  [ card ]
+ 6 more in New York — show all
```

- **Destinations are sections, not pages.** "Where am I going?" wants a glance
  per city; the destination's own page (`?dest=<slug>`) is where the map is, one
  click away under *Open map*. A map per section would be four Leaflet instances
  on one tab.
- **Capped at three per section while every city is on screen**, uncapped once
  one is chosen — the two views answer different questions.
- **Both doors, one grouping.** An imported place and a place the member pressed
  Wanna go on are the same kind of thing standing in the same city, so they share
  a grid. Which door it came through is a property of the place, not a reason to
  file it elsewhere.
- **Guides are named per destination, never indexed alone.** *Guides here* says
  which pieces fed this city and links to each. There is no guides index: that
  would make them containers again.
- **A place whose city is unknown groups under "Unplaced"** rather than being
  dropped — it is on the wishlist, and a member who cannot find it would
  reasonably conclude the import lost it.

## Provenance

Every card carries a typed chip, because "Eater NY" alone does not say whether a
publication chose the place or a member did.

| Chip | Means | Treatment |
|---|---|---|
| `GUIDE · Eater NY` | a publication chose it | accent, **links to the guide** |
| `FEED · via @marta` | read on a member's note | plain, named, never the accent |
| `ADDED BY YOU` | the member's own hand | dashed — nobody else asserted anything |

The chip is also the only way into a guide, now that nothing indexes them at the
top level.

## One destination per guide-city

Publications file by borough. Eater's New York guide gives Astoria, the Bronx and
Jackson Heights alongside New York, and taking each at face value turned one
guide into **four destinations**. A destination is city-level, so the city the
member confirmed on the review screen wins and the borough goes to `area`, which
is what the card already prints beside the name.

That fixed geocoding too: `7415 Roosevelt Ave, New York` matches where
`7415 Roosevelt Ave, Jackson Heights` returned nothing. The measured import went
from 11 of 12 located to 8 of 8.

## The flow

1. **Open.** One button on Wanna go — **Add a guide from a link** — opens a modal.
2. **Paste.** The field is the modal's first state.
3. **Read.** `POST /api/detour/lists/read` fetches the page and reports what it
   found. **It writes nothing** — the member can paste, look, and walk away
   having changed nothing.
4. **Review.** The modal's second state. The places come back checked, except any
   the member already holds. They can rename the list, correct the city, and
   uncheck whatever they do not want.
5. **Keep.** `POST /api/detour/lists` writes only the places left checked, and
   the modal closes itself onto the tab where the list has just landed.

Step 4 is the feature. Thirty-eight places arriving unasked is the failure this
design exists to avoid, and a "keep 35" button that silently means "keep 35, two
of which do nothing" is a count that lies.

**It is a modal, and both states live in it.** Inline on the tab, a read pushed
the member's own wishlist off the screen on every paste and left a half-finished
review sitting in the middle of their list with no obvious way to be rid of it.
Two states rather than two dialogues because the twenty seconds a long page takes
to read happen between them, and a member who has waited that long must not have
the answer appear somewhere other than where they were looking.

Escape and the backdrop both close it, which is safe precisely because reading
and keeping are separate calls: nothing has been written. The dialogue is
recreated on each render and re-opened from the bind step, the same shape the
delete-recommendation dialogue uses.

**Ticking a checkbox does not re-render.** The rest of the module redraws
everything on every state change, which is right for a form with four fields and
wrong for a list of thirty-eight — a redraw per tick throws away the scroll
position, so a member unchecking what they do not want would be sent back to the
top after each one. The draft is updated and the count on the submit button is
patched in place. The sheet scrolls, not the list inside it, and the button bar
sticks to its foot so it is reachable without scrolling to the end first.

**A link that cannot be read changes nothing.** The route answers 200 with
`resolved: false` and a sentence. No part of this feature may ever be made to
depend on a page having been readable.

## Reading the page

Three readers, in order, and the order is the design:

| | | |
|---|---|---|
| `json_ld` | the page's own `ItemList` | exact, free |
| `structured` | headings with an address or a neighbourhood | exact, free |
| `model` | OpenAI over the page's text | costs, can invent |

Publications that care about being indexed ship JSON-LD, and Eater's map pages
do. The model runs only when both free readers come back empty, which is what
keeps "or similar" working without putting a paid call and a hallucination risk
on the common path. `community_imported_lists.read_by` records which one fired,
so it is possible to tell whether the fallback is carrying sites it should not
have to.

**The two free readers cooperate rather than compete.** JSON-LD is authoritative
about *which* places are on a list and says almost nothing about where they are —
Eater's ItemList carries thirty-eight names and not one address. The page body
has every address and no reliable way to tell a place's heading from a section
heading. So the facts are extracted once, keyed by heading, and both readers use
them: JSON-LD to fill its gaps, the structural reader as its only source of
places at all.

**Addresses come from the section's own maps link.** A "get directions" href's
`query` is written by the publication's CMS out of the fields it holds, in the
order `Name, Street, City, Region Postcode`. That is better than any heuristic
over the prose, and it is where the per-place city comes from too.

**The model reader may only use the text it was given.** No web search, no
browsing on. Its one available check against invention is that each returned
name appears in the supplied text; a name that does not is dropped. This does
not catch a real venue attributed to the wrong list, and nothing here could.

### Sizes, and why they are what they are

Sized against the real page rather than guessed. Eater's thirty-eight-place map
page is **2.5MB** of markup with its last heading past the two-million mark, and
its sections are roughly **50KB** apart. A smaller body cap does not fail loudly:
it returns the first six places and calls that the list.

## Cities, and boroughs

**One city per list**, guessed from the page and confirmed by the member on the
review screen. It is the one piece of work asked of them, and it is asked because
it is the only thing that decides whether a place already on Detour is recognised
as the same place.

Publications file by borough. Eater gives *Astoria* and *Bronx* where the
catalogue files everything under *New York*. So both the catalogue match and the
geocoder take the list's city as a fallback, and the geocoder's claimed-city
guard accepts either — including Nominatim's `suburb` and `borough` fields.
Without that, a member importing a New York list would be told Detour has none of
it while half of it was already there, and every borough-filed place would be
left unlocatable.

## Matching the catalogue

Each place is matched by normalized name and city — the same `normalizePlacePart`
the catalogue itself compares by, so an imported "Café Mütter" finds a
recommended "cafe mutter".

- **A match opens the real place page**, where the notes are.
- **A miss gets a place page of its own** at `?mine=<id>` — **the same page**,
  not a second one shaped like it. `placePageMarkup` renders both; an
  `ImportedPlace` is adapted into the `Venue` that page takes (see
  `src/private-place.ts`, which renders nothing and is only that adapter), with
  every count left at zero and no notes, so the page shows its own empty states
  rather than inventing furniture. Been & loved, Wanna go, share and Copy link
  are switched off through the chrome — the first three write against a
  published place, and the last has no address to hand anybody.

  **Two sentences say what kind of page this is, and there is no stamp.** There
  was one — *NOT ON DETOUR / your list only*, rotated and hard-bordered above the
  title — carrying the two structural facts a muted line had failed to carry
  before it. Both facts have plainer homes now: *How it got here* names the piece
  the place came off, and *What people say* says, in the space the
  recommendations would occupy, that nobody on Detour has recommended it. A
  shouted mark on top of two sentences that already say it was the loudest thing
  on the page and the least informative.

  **So is the Detourist signal** (`showSignal: false`): it counts people standing behind a
  place, and on this one there are none and cannot be until somebody recommends
  it, so the bare mark states an absence that was never a possibility — beside a
  band that already says so in words. That band is *How it got here*, and it is
  the place page's own `origin` field rather than markup this feature hands over:
  a published place the member also holds off a list has the identical thing to
  say, so both kinds of page render one band from one fact. Recommend is
  offered, and opens the ordinary form with the name and city filled in.
  Removal is not offered here: Wanna go's rule is that a member tidies their own
  list on My detours and nowhere else.
- **Matching is re-checked on every read.** A place nobody had recommended in
  August may have been recommended by October, and the moment it is, the member's
  private row should open the real page. That re-check is the one thing this
  feature does that pays off over time, so it happens on the read rather than
  waiting for a sweep. A private page whose place has since been recommended
  redirects to the real one.

## What kind of place it is

An imported row had a name, a quarter and a sentence, and no answer to the
question a member scans a city list for: *what is this?*

- **Read from the page's structured data, never inferred from its prose.** The
  schema.org `@type` the importer already tests against — `Bakery`,
  `CafeOrCoffeeShop`, `BarOrPub`, `Winery`, `Brewery`, `IceCreamShop`,
  `Restaurant` — maps one-to-one onto the catalogue's closed category set, and
  `servesCuisine` gives `ethnic_cuisine` plus the publication's own word for it.
- **The cuisine word is what a row prints.** "Georgian" tells a planner what
  "Ethnic cuisine" does not, so both are stored: `category` for filtering,
  `cuisine` for reading.
- **A specific type beats a cuisine.** A Georgian bakery is a bakery; a Georgian
  restaurant is `ethnic_cuisine`.
- **A page with no structured data gets nothing.** The heading scraper reads
  prose, and a category inferred from the word "croissant" would be Detour
  asserting something nobody asserted, about a place nobody has stood behind.
- **A matched catalogue place keeps its own category.** A member chose that one.
  The publisher's answer is a display fallback and is never promoted onto a
  `venues` row — the same rule `image_url` runs on.
- Server-side the value is checked against the closed set on write; anything
  else is dropped rather than stored (`pb_hooks/guides.pb.js`,
  `pb_migrations/1787097600_imported_place_category.js`, which must run after
  the `ethnic_cuisine` migration).

## The guide page (`?guide=<id>`)

**The city page's shell, with the guide's own facts in it.** Same crumb, same
status segments, same Area menu, same Cards/Map switch, same card — learn the
shell once and every collection reads with it. What differs, and nothing more:

- **A `GUIDE · IMPORTED FROM <host>` chip above the title.** These words are
  somebody else's, and everything below reads differently once a member knows
  it, so it is said first.
- **`by <publication> · N places · N to try · N skipped`** under the title, the
  publication linked to the piece.
- **`Original ↗` and `Remove`** where the city page's *Add here* sits. Remove
  opens the same dialogue the wishlist tab would — one wording for one act.
- **No Source menu.** The page *is* the source; a filter with one answer is
  furniture.
- **A Skipped segment**, offered only once something has been skipped.

### Skipping a place

A member who pastes a list of thirty-eight means eleven of them. **Remove**
deletes the row, so the page stopped matching the piece they had read and the
next import of the same link handed the other twenty-seven straight back.

- **`skipped` is a flag on the member's own imported row**
  (`pb_migrations/1786924800_guide_place_skipped.js`), toggled by
  `PATCH /api/detour/guides/places/{place}/skip`. The body states the state it
  wants rather than toggling, so a double tap cannot land on the opposite answer.
- **The guide page still shows it** — dimmed, under *Skipped*, with an undo in
  the same spot the *Skip* was.
- **Everywhere else it is gone**: not on the wishlist, not on the city page, not
  in a count, not a pin. `allImportedPlaces` filters it out, so nothing
  downstream has to remember.
- Nobody else can see any of it, like the rest of this feature.

## Locating is lazy

Coordinates are filled in when a private page is first opened, for that one
place, not at import. Thirty-eight geocoder lookups inside the import request
would exceed both the request and OpenStreetMap's own rate policy, and most
imported places are never opened.

The attempt is stamped either way, so an address that does not geocode is retried
weekly rather than on every open — the same bound, and the same reason, as
`venues.web_discovery_at`.

## The schema, and the three decisions in it

**Two collections, not one.** The list is a thing the member holds: a name they
can change, an origin, and a heading their places sit under. Repeating that on
every row would mean rewriting thirty-eight records to rename it.

**One row per place per member**, unique on `(member, normalized_name,
normalized_city)`. Import an Eater list and a Condé Nast list that both name
Tatiana and there is one Tatiana, shown under both headings. The alternative puts
the same restaurant on the same wishlist twice and makes the list look like it is
counting something.

**`lists` is a non-cascading, non-required multi-relation.** Non-cascading so
removing one list does not take a place another list still names — the route
unlinks instead. Not required because an empty `lists` is a legitimate state: it
is a place the member kept when they removed the list it arrived on.

`ownLists` returns those separately as `unlisted`, and the tab shows them under
**Not from a list**. Two things follow and are easy to get wrong: a place grouped
only by list would vanish from the app while still existing, and `ownLists` must
not bail early on a member with zero lists — they may still hold kept places.

`onRecordDelete` on `members` in `imported_lists.pb.js` deletes a departing
member's places before their lists. It was load bearing while `lists` was
required (the cascade failed outright with "part of a required reference"); it
now guarantees ordering rather than preventing a failure, and is what would fail
loudly if `lists` were ever made required again.

## The list's own page

`?list=<id>` — one list, its map, then the same cards the tab shows. Reached from
the list's heading on Wanna go.

**The map leads.** A published list is a shape on a city — the thing a member is
actually planning around — and a column of names is not that. Pins are fitted to
the list's own bounds rather than a city's, because these places are wherever the
piece sent them.

**A pin is a link, not a selection.** `mountMap` (the destination map) drives
`state.selectedId` and a detail panel that only exists on that view; this page
has neither. Clicking a pin opens that place: its catalogue page if somebody has
recommended it, its own page if not.

**Removal is not offered here.** Same rule as the private place page: a member
tidies their list on My detours and nowhere else. A list page is for planning.

### Locating, and why it is batched

Lazy per-place geocoding is right for a place page and useless for a map — it
plots four pins out of thirty-eight, and a map that incomplete is worse than
none. So opening the list locates a bounded batch server-side (8), and an hourly
cron sweep works through the rest. OpenStreetMap asks for one lookup a second and
this is somebody else's free service: a loop over a hundred addresses inside one
page load would abuse it and time the request out.

Measured on the real thing: 12 imported places went to 7 pins on the first open
(2.2s) and 11 by the second.

**Two absences, never conflated.** A place the geocoder has not reached yet will
get a pin; one whose address it could not match never will — it is stamped and
not retried for a week, and some published addresses simply have no match
(*Nepali Bhanchha Ghar, 7415 Roosevelt Ave* is a real one). `locate_tried` on the
payload is what tells them apart, so the page says "3 more still being placed"
and "1 could not be placed from the address this list gave" rather than promising
pins that are never coming.

## Removing a list

**It asks, and Wanna go's no-confirmation rule does not carry over.** That rule —
"a confirmation dialogue on a bookmark is an insult" — is about one bookmark.
This is up to a hundred places in one tap, it is not undoable, and *Remove guide*
honestly reads two ways. Both readings are things a member might mean, so both
are offered:

| | |
|---|---|
| **Remove guide and places** | the guide goes, and every place it was the last to name |
| **Keep the places** | the list goes, its places stay on Wanna go under no heading |
| **Cancel** | nothing happens |

`?places=keep` on `DELETE /api/detour/lists/{list}` is the second. **A place
another list still names survives either answer**, and the dialogue counts those
out of the number it quotes rather than into it, so the figures cannot look like
they disagree. When nothing would be lost, the middle option is not offered at
all and the copy says so.

## Fully private, and the test to apply

The same constraint Wanna go carries, because these places sit on the same tab.

- **No counts.** Not per place, not aggregated, not anywhere a member could see.
- **No projection.** Nothing in either collection is ever computed for another
  member.
- **No notification.** The recommender of a place that matched is never told.
- **Client reachability is own-rows-only** on both collections, and creates and
  updates go through the routes.

The test to apply to any future change: *could a member learn anything at all
about another member's imports, including that they exist?* If yes, it is not
this feature any more.

## Routes

| | |
|---|---|
| `POST /api/detour/lists/read` | read a pasted link, report what is on it, **write nothing** |
| `POST /api/detour/lists` | keep the checked places under a named list |
| `GET /api/detour/lists` | the caller's own lists with their places, re-matched |
| `GET /api/detour/lists/places/{place}` | one private place, located on the way out |
| `DELETE /api/detour/lists/{list}` | remove a list; `?places=keep` spares its places, shared ones survive either way |
| `DELETE /api/detour/lists/places/{place}` | remove one place from every list |

## Known limits

- **A list spanning several cities gets one city.** The member sets it, and each
  place keeps whatever city the page gave it, so the damage is limited to
  matching — but a "best of the Bay Area" list will match against one city only.
- **The excerpt is the publication's copy**, shown as a quotation attributed to
  the list. It is the least load-bearing thing extracted here and is allowed to
  be empty.
- **A member can correct the list's city on the review screen but not each
  place's.** Adding thirty-eight city fields to that screen would defeat what the
  screen is for.
