# Been & loved — specification

*Drafted 2026-08-02. The one-tap rung: a member who has been somewhere someone
else recommended, and would send you there too.*

> **Shipped.** `pb_migrations/1786406400_place_endorsements.js`,
> `pb_hooks/place_endorsements.pb.js`, `pb_hooks/place_endorsements.js`, and the
> **Been & loved** tab in My detours (`src/community/endorsements.ts`). This document is the
> reasoning behind it, kept because the reasoning is what a future change needs
> and the code does not carry it. Where it describes schema or routes, it
> describes what exists — **do not write a second migration against
> `community_place_endorsements`.**

---

## The words

**Been & loved.** Two claims, both stated, neither left to inference: *I went,
and I would send you.*

- Button, on the place page: **Been here, and loved it**
- In prose, on the place page: *"6 have been and loved it · 2 in your circle"*,
  with those two named
- My detours tab: **Been & loved**

The ampersand belongs in the label positions — the tab, a chip — where it scans
in caps. The words are spelled out wherever the line is a sentence, because
`2 BEEN AND LOVED` is not grammatical as a count.

It does not appear on cards at all; see *Where it appears*.

### Why both words

**"Been" alone states a fact and takes no position.** Silence is Detour's
disagreement mechanism — there are no ratings and no downvotes, and a place
nobody seconds is judged by the absence. That only works if the public marker
means approval. If it means literally *I have been here*, a member who went and
disliked the place has no honest move: pressing reads as support, not pressing
is indistinguishable from never having gone, and the signal becomes unreadable
in both directions.

**"Loved" alone does not assert presence.** Somebody can love a note, a photo,
or the idea of a place. The entire value of this signal is a second person with
firsthand experience; a marker that might only mean "nice write-up" is worth
much less, and at Detour's size it cannot afford to be ambiguous.

Together they are unfakeable in the way that matters: nobody presses *Been here,
and loved it* without having gone.

### Rejected

- **Backed**, **Seconded**, **Vouched** — the internal vocabulary. Reads like
  paperwork next to notes written the way Detour's are. Keep `second` in the
  code paths that already use it (`place_intent: "second"`); it is not the
  member-facing name for this.
- **Would go back** — elegant, and presence is entailed rather than stated. Lost
  to explicitness, which is the right trade at this size.
- **Swear by**, **Regular** — both assert repeated visits, which excludes the
  person who went twice, loved it, and would send you.

### Naming in code

The member-facing phrase may change; the schema should not have to. The
collection and route below are called **endorsement**, which is neutral,
accurate, and will survive a copy revision.

## Rules

- **One per member per place.**
- **No taking it back from the place page.** That page offers no undo: once
  pressed, the hero shows the mark and no control. A pressed button that reads
  *You have been and loved it* offers a settled fact as though it were still a
  decision, and the stamp already says the mark stands. **Removal lives on the
  member's own list** — My detours → Been & loved, where each place is a card
  with a Remove on it. That is the surface this paragraph used to call "My
  places", and it arrived with the signed-in landing
  (`docs/landing-spec.md`): taking a mark back is an ordinary operation on your
  own row, not a control loitering on a public page. The route always toggled, so
  this was a surface rather than a mechanism.
- **Never on your own place.** A member who has written a recommendation for a
  place cannot mark it; their note already is the endorsement.
- **Positive only.** There is no counterpart. Nothing to press to disagree.
- **Never gates visibility.** It does not publish a place, does not contribute
  to `signal_count`, and does not change who can see anything. It is
  corroboration of a place that is already there.
- **One presentation signal.** On the place page, Recommended and Been & loved
  render as one distinct-member total with one recommendation mark. The number
  is derived by adding the two disjoint states; it is never written back to
  `signal_count` and never affects publication or ordering. The tooltip states
  the combined standing once rather than repeating both signals.
- **Always attributed.** The name travels with it wherever it is shown to
  someone who may see it. There are no anonymous signals in Detour.
- **Only verified members** — the same gate as recommending
  (`requireVerifiedMember`).
- **Only on a published place.** Marking an unpublished entry would be
  corroborating something the caller cannot see.
- **Only where the caller can see a note.** There must be a fronting
  recommendation visible to them — this is corroboration *of somebody's note*,
  so with no visible note there is nothing to corroborate. The route refuses
  with *"That place is not on your list."* Any surface offering the button must
  respect this, or it hands the member a button that 400s.

## One state per place, moving forward

A member stands in exactly one relation to a place:

```
(none) → Wanna go → Been & loved → Recommended
```

- **Wanna go** is intention. Fully private — see `docs/wanna-go-spec.md`.
- **Been & loved** is this feature. Public, scoped.
- **Recommended** is a written note, and supersedes it — writing about a place
  you had marked replaces the mark, because the note says more and says it in
  your own words. This is also what enforces "never on your own": the state
  cannot be both at once.

Going backwards is withdrawal, not a transition. Withdrawing a recommendation
does not restore a mark that preceded it.

**Watch the count on the write path.** When a member who has marked a place then
writes a recommendation for it, the mark is removed in the same transaction as
the recommendation is created. Otherwise the place shows one person twice — once
under `BEEN & LOVED`, once under `RECOMMEND` — which is exactly the inflation a
small catalogue cannot survive.

## Visibility and display

The rule already settled for every opinion in the product: **global count,
scoped names.**

- The count is every mark on the place, from every circle.
- The names are only the members this caller may see, by the same clause as any
  other opinion — their graph, or the founding tier.
- Every read carries **which clause matched**, so the copy says "in your circle"
  only when the graph matched and never when the founding tier did. This is the
  bug behind the existing tooltip issue; it must not be reintroduced here.
- A caller who can see the place but none of its endorsers sees the global count
  and no names. That leaks nothing: the count is a global fact about the place,
  like its address.

On the place page the two lines sit together and must not blur:

```
3 recommend                          ← authorship: wrote a note, name attached
Marc and Anna have been, and loved it ← corroboration: went on one, would return
```

Authorship is named on the card. Corroboration is named here, and only here.

## The notification is the point

**It emails the recommender whose note was acted on.** Not the place's other
participants — the person who wrote the note this member went on.

This is the reason to build it before anything else. Contribution currently
produces silence: a member writes a place and nothing ever happens. One tap from
someone else turns that into a named person saying *I went, and you were right*
— the only feedback loop in the product that costs the giver nothing.

The email names the member, the place, and quotes the note they went on. It is
the recommender's own sentence coming back to them with somebody's agreement
attached.

Constraints, matching `first_place_notice.pb.js`:

- One email per endorsement. Withdrawing and re-marking does not send again —
  claim `notified_at` on the row before sending, as the first-place notice does
  with `members.inviter_introduced_at`.
- Internal members and `.invalid` fixtures excluded on both sides.
- Batch when a place collects several at once; nobody needs four emails in an
  hour.

## Data

As built. The `community_` prefix follows the collections already in use.

**`community_place_endorsements`**

| Field | Type | Notes |
| --- | --- | --- |
| `member` | relation → `members` | Required, cascade delete. |
| `waitlist` | relation → `community_waitlist_entries` | Required, cascade delete. The entry, not the venue, so it matches how recommendations attach. |
| `recommendation` | relation → `community_recommendations` | The note they went on — the fronting one at the time. Nullable: that note may later be withdrawn while this stands. |
| `notified_at` | date | Claimed before the email sends, so it can never send twice. |
| `created` | autodate | |

- **Unique index on (`member`, `waitlist`)** — the concurrency guard, in the
  same spirit as the invite-request index. The explicit lookup in the hook turns
  an ordinary double-tap into a friendly no-op; the index is what makes a racing
  double-tap safe.
- **Index on (`member`, `created`)** for the tab, on `waitlist` for the count,
  and a partial index on `notified_at = ''` for the pending-notice sweep.
- API rules: list, view and delete are `member = @request.auth.id`; **create
  and update are `null`**, so the "not your own place / published only /
  visible note only" checks can only be satisfied through the route. An open
  create rule would let a direct collection write skip every one of them. **Reads for anyone else go through a server
  projection only** — never a client-side list or filter, exactly as the
  `members` collection is handled today. A client that could query this
  collection directly could enumerate who has been where, which is the graph by
  another route.

## API

**`POST /api/detour/places/{place}/endorsement`** — creates or withdraws
(toggles). `{place}` resolves either a venue id or an entry id, because cards,
the map preview and the place page do not all hold the same one. Verified members only. Refuses the caller's own place and an
unpublished entry. Returns the caller's new state and the place's global count.

The withdrawal half has no caller today — nothing in the interface presses it —
and it is kept deliberately, because it is what My places will use. It is also
what lets a mis-tap be undone by hand until then.

**Reading** needs no new route. The place-page and card projections gain two
values: the global count, and the scoped names with the clause that matched.
Both derive from the visibility computation already performed for notes, so the
cost is a join rather than a second pass.

## Where it appears

- **Place page**, under the notes: the button when the caller may press it, the
  names when there are any.
- **Not on cards.** Neither the button nor the count. `AGENTS.md` already fixes
  what a card is: one place, one representative note, one byline, with the place
  page owning the complete list. Corroboration is aggregate, and aggregate
  belongs where the notes are.

  Two practical reasons on top of the principle. A count that is almost always
  zero broadcasts the thinness on every row — the same mistake as *no new places
  in 24 hours*. And the number means little without the names: `· 2` is a tally,
  *"Marc and Anna have been, and loved it"* is the product, and only the place
  page has room for the second. Revisit when a place routinely has several, and
  then as names rather than a number.
- **My detours → Been & loved**, on the signed-in landing. One card per place,
  carrying the note the member went on and naming whoever wrote it, with a
  Remove glued underneath. This is where removal lives; see the rule above.
- **Nowhere in the feed as an event.** "Anna has been somewhere" is not news,
  and a feed at this supply cannot afford filler that looks like activity.

## What it must never become

- **A rating.** No counterpart, no score, no ordering of places by it.
- **A gate.** Nothing becomes visible, published, or promoted because of it.
- **A leak.** Global count, scoped names, and the matched clause decides the
  wording. It must never let a caller learn that a member they cannot see
  exists.
- **A substitute for writing.** It is the bottom rung, and the prompt ladder
  should keep asking — someone who has marked three places in a city is exactly
  the person to ask for one of their own.

## Open

- Does the mark survive the withdrawal of the note it went on? Written as yes
  above — it is a mark on the place, and `recommendation` is provenance — but
  the alternative is defensible and should be chosen deliberately.
- Should the member be able to add a line? That is Dishes, a separate rung.
  Resist folding it in; the value here is that it costs nothing.
