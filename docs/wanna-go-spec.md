# Wanna go — specification

*Drafted 2026-08-02. The private one: somewhere a member intends to go, seen by
nobody else, ever.*

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
  the transition only runs forward.
- **Marking Been & loved clears the save**, in the same write. The intention has
  been discharged and the member should not have to tidy up after themselves.
- **Writing a recommendation clears it too**, for the same reason.
- Removing a save is removal, not a transition backwards.

Exactly one state per member per place, as with the other two.

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
| `waitlist` | relation → `community_waitlist_entries` | Required, cascade delete. The entry, matching how recommendations and endorsements attach. |
| `source` | select | How it got here: `place_page`, `triage`, `share`, `feed`. `share` is set when a member converts something from their Private shares inbox — including the place a future invitation carries. Feeds the prompt copy and tells you which surface actually produces intent. |
| `prompted_at` | date | When "been yet?" was last asked about this one, so it is not asked twice in a week. |
| `created` | autodate | |

- **Unique index on (`member`, `waitlist`)** — the guard against a double tap.
- **Index on (`member`, `created`)** for the tab, newest first, matching the
  endorsements collection. Deliberately **no index on `waitlist`
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
