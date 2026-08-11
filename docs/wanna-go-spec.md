# Wanna go — specification

*Drafted 2026-08-02. The private one: somewhere a member intends to go, seen by
nobody else, ever.*

> **Shipped**, except the prompt hook. `pb_migrations/1786492800_place_saves.js`,
> `pb_hooks/place_saves.js`, `pb_hooks/place_saves.pb.js`, `src/saved.ts`, the
> place-page action, the **Wanna go** tab in My detours, and the one-tap action
> on a received private share. Where this document describes schema or routes it
> describes what exists — **do not write a second migration against
> `community_place_saves`.**
>
> **The prompt hook is not built.** `prompted_at` is in the schema and nothing
> reads it; whoever builds *been yet?* will also need a decline count, which was
> deliberately left out rather than shipped unread. Two other departures from the
> text below, both recorded where they happen: the control disappears once a
> place is saved rather than showing a pressed state, and `source: "triage"` is
> set by the landing's triage card, which now exists.

---

## The word

**Wanna go.** Member-facing, on the tab and the button. Deliberately the most
casual phrase in the product, because it is the only state that is nobody's
business but the member's — it makes no claim, addresses no audience, and should
not sound like it is being filed.

In code it is `saved`, which is stable and boring. The collection is
`community_place_saves`.

## What it is for

Two jobs, and it is worth being clear that only one of them is for the member.

1. **Their own list.** The places they mean to get to. Somewhere to put a place
   they read about at a moment when they cannot act on it. This is the job the
   member cares about.
2. **A hook for a later question.** *You saved this three weeks ago — been yet?*
   arrives at the point where the member finally has something to say, which is
   the only moment worth asking them.

That second job is the reason it earns a place in the ladder at all. On its own,
saving does nothing for anybody else.

## Fully private means fully private

This is the whole design constraint and everything below follows from it.

- **No counts.** Not on the card, not on the place page, not aggregated, not to
  superusers in any member-visible surface. A visible save tally is a popularity
  ranking, which is the thing this product exists in opposition to.
- **No notification.** The recommender is never told that somebody saved their
  place. This is a real cost — saving produces no feedback for the giver, unlike
  *Been & loved* — and it is accepted, because the alternative turns a private
  bookmark into a public signal by the back door.
- **No projection.** Saves never appear in `/api/detour/circle`, in the place
  page payload, in a card, or in any response computed for another member. The
  circle projection returns per-person published-place counts today; those stay
  recommendations-only.
- **No client-side reachability.** A member may list and delete only their own
  rows, and creates go through the route. There is no route by which one member's saves can be counted
  or named by another, and no admin surface that displays them per-place where a
  member could see it.

The test to apply to any future change: *could a member learn anything at all
about another member's saves, including that they exist?* If yes, it is not this
feature any more.

## Position in the ladder

```
(none) → Wanna go → Been & loved → Recommended
```

- Saving a place a member has already been to or recommended is meaningless;
  a *new* save only ever runs forward, and the route refuses one on a place they
  have already answered for.
- **One state per place is a display rule, not a storage rule.** A member who
  saved a place and has since marked it, or written about it, keeps the save
  row — the Wanna go tab simply stops listing it, because the tab shows the
  highest rung they have reached.
- **Marking Been & loved takes it off the tab**, and withdrawing the mark puts it
  back, exactly where they left it. Writing a recommendation does the same, and
  deleting the note restores it.
- **Only an explicit Remove deletes.** That is the member saying so, which is the
  one thing that should destroy a row here.

Deleting the row on the way up the ladder was the earlier design and it was
wrong: it looked tidier and quietly destroyed something. A mis-tapped Been &
loved would take a member's own bookmark with it and leave nothing to restore.
The intention was never anybody's to discharge but theirs.

## Rules

- **Only verified members**, same gate as the rest.
- **Only published places.** A member cannot save what they cannot see.
- **Own places cannot be saved.** You do not intend to visit a place you wrote
  about.
- **Toggleable**, with no confirmation. It is private and reversible; a
  confirmation dialogue on a bookmark is an insult.
- **No cap.** Unlike *Been & loved*, saving costs nobody anything, so nothing
  needs rate-limiting.

## Data

**`community_place_saves`**

| Field | Type | Notes |
| --- | --- | --- |
| `member` | relation → `members` | Required, cascade delete. |
| `entry` | relation → `community_place_entries` | Required, cascade delete. The entry, matching how recommendations and endorsements attach. |
| `source` | select | How it got here: `place_page`, `triage`, `share`, `feed`. `share` is set when a member converts something from their Private shares inbox — including the place a future invitation carries. Feeds the prompt copy and tells you which surface actually produces intent. |
| `prompted_at` | date | When "been yet?" was last asked about this one, so it is not asked twice in a week. |
| `created` | autodate | |

- **Unique index on (`member`, `entry`)** — the guard against a double tap.
- **Index on (`member`, `created`)** for the tab, newest first, matching the
  endorsements collection. Deliberately **no index on `entry`
  alone**: nothing should ever be counting saves per place, and not building the
  index that would make it cheap is a small structural discouragement.
- API rules: `member = @request.auth.id` for list, view and delete. **Create and
  update are `null`**, matching `community_place_endorsements` — the rules above
  (not your own place, published only, verified only) can then only be satisfied
  through the route, and a direct collection write cannot skip them. An open
  create rule would make every rule in this document advisory.

Per the migration rules: new file with a later timestamp, typed field
constructors, existence-guarded collection and index creation, safe to re-run.

## API

**`POST /api/detour/places/{place}/save`** — toggles. `{place}` resolves either
a venue id or an entry id, as `.../endorsement` already does: cards, the map
preview and the place page do not all hold the same one, and a save offered on a
card must be callable with what that card has. Verified members only. Refuses
the caller's own place and an unpublished entry. Returns only the caller's new
state; there is no count to return.

**`GET /api/detour/places/saved`** — the caller's own list, for the tab.

No read path exists for anyone else's saves, and none should be added.

## Where it appears

- **Place page:** a quiet action, not a primary button. It competes with *Been &
  loved*, which is the one worth encouraging.
- **Triage card:** as *Wanna go*, one of the four answers.
- **My detours → Wanna go:** the member's own list, newest first.
- **Not on cards**, and not as a count or an event anywhere. The card carries
  one person's voice; anything aggregate or personal-to-the-viewer belongs on
  the place page. Same rule that keeps *Been & loved* off cards.

## The city page (`?d=<city>`, `&lens=yours`)

**One city page, and geography is the only hierarchy.** "What members recommend
here" and "what I hold here" are two readings of the same place in the world, so
they share one route, one layout and one map, and the switch between them is a
chip — never a second page. `?dest=<city>`, the wishlist board's old route,
resolves to `?d=<city>&lens=yours`.

The member's own lens holds **everything they have in that city** — places kept
off a guide, places saved one at a time, and places already been to. The last of
those is why it is not simply the wishlist: a city you have half-eaten your way
through showed only the half you had not.

- **A list against a map, tied by the hover.** A row and its pin light each
  other and the caption under the map names whichever is lit. There were numbers
  once, on both; eight orange plates down a column read as a ranking, which is
  the thing this product will not do, so the pin is a dot and the tie is stated
  only when somebody is looking for it.
- **The map takes the larger share of the width**, on a wider column than the
  rest of the app reads at, and stays sticky while the list scrolls. It grew
  across rather than down: a city is a shape, and a taller map only pushes the
  list it belongs to off the screen.
- **Cards or map, and cards lead.** A segmented switch at the end of the filter
  bar. Cards take the full width and are **the app's own recommendation card** —
  `groupedRecommendationCardMarkup`, the same renderer the feed and Explore use,
  per the rule in AGENTS.md; the city page adds no card of its own. The map
  reading is the list-and-map split, where a row is compact enough to sit
  eight-deep beside it. Same places, same filters, same order; only how much of
  each is shown changes. It is a preference, not a filter, so it survives a
  change of city.
- **The page keeps the app's column.** The masthead and the footer rule define
  that width; the map takes its extra room from the split, never from running
  past them.
- **A row is a picture, a name, its quarter, its kind, and one cut line of why**
  — and the whole row is the link. No controls: a city list is scanned, not
  operated, and every act about a place lives on that place's own page. The
  quote is cut to one line on purpose; the whole of it is a click away, beside
  everything else anybody said.
- **The quoted note is the newest one the reader can see**, and their own when
  they wrote one — the same newest-first order the cards sort by, with ties
  broken on the recommendation id so the answer never flickers. It used to be
  whichever note the payload happened to list first, which is an order nothing
  promises.
- **A member's name over their own sentence is a byline, never "via".** They are
  its author, not the route it travelled; *via* belongs to the provenance chip
  (`Feed · via @marta`), where the question is which door a place came through.
- **Three filters, and two of them are menus.** In the open: *To try / Been*, a
  segmented pair with no "all" — every place is one or the other, and a planner
  arrives wanting the first. In menus at the far end: **Source** (a line per
  guide that put places here, plus the feed and their own hand) on the member's
  lens, **Occasion** on everybody's, and **Area** on both. A filter row six
  plates wide read as the page's content rather than its controls.
- **Everything re-scopes together.** The map fits what the filters leave, so
  "Chelsea, still to try" zooms to Chelsea. Switching lens clears them all —
  "from Eater" means nothing among everybody's picks.
- **The line under the city name** leads with what is still to try, and says
  *all from <guide>* when every place came off one piece — the common shape, and
  the interesting fact about it.
- **Counts on every chip**, taken from the whole city rather than from what the
  other chips have left, so a chip says what pressing it would give you.
- **Filters are module state, never the route.** They are how a member is reading
  the city right now, not where they are: in the URL they would make Back step
  through chip presses, and would make a private list linkable. **The lens is the
  exception** — it decides what the page holds and what its own crumb says, so it
  rides in the URL and survives a reload.
- **Wanna go is offered from the row** on everybody's lens, where a stranger's
  pick is the thing a member might want; on their own lens every row is already
  theirs, so the mark would be a column of one word.
- **No removal here.** A member tidies their own list on My detours and nowhere
  else.
- **Guides are named at the foot as sources**, with what each holds in this city
  (`4 places · 2 to try`) — never as containers, and never as a step in a
  place's crumb.

## The prompt hook

The follow-up is the reason this state exists in the ladder.

- Fires no earlier than **three weeks** after saving. Sooner reads as
  surveillance; a place saved on Tuesday and asked about on Thursday tells the
  member their bookmarks are being watched.
- Only for a place in a city the member is plausibly in — their home city, or
  somewhere they have since added a place. Asking a Berliner whether they made
  it to Barcelona yet is a question about their holiday plans, which is not
  Detour's business.
- Copy: *"You saved {place} a while back. Been yet?"* with the two answers that
  cost nothing — **Been & loved it** and **Not yet** — and the heavier *write
  your own* beneath.
- **Not yet** sets `prompted_at` and the place is not raised again for a month.
  Twice-declined, it stops being asked about at all.
- Counts against the same one-thing-to-answer slot as everything else. It never
  stacks with a prompt or an ask.

## Private shares are not saves

The existing decision stands: a private share **lands in an inbox and does not
join the recipient's list**. It is somebody else's intention for them, not their
own, and quietly filing it as *Wanna go* would put words in their mouth and
inflate a list they did not build.

The inbox offers *Wanna go* as a one-tap action. That is the member choosing,
and it is the only way a share becomes a save. `source: "share"` records where it
came from.

## Open

- **Does a saved list need pruning?** A list that only grows becomes a graveyard,
  and a graveyard is a worse landing than an empty tab. Options: age out the
  prompt only, or offer a "still want to go?" tidy after a year. Leaning towards
  never deleting anything on the member's behalf, and letting the tab sort
  newest-first so the dead weight sinks.
- **Does `source` risk being over-read?** It is operationally useful and it is
  data about a member's behaviour. It stays private with everything else here,
  but it should not grow into a profile.
