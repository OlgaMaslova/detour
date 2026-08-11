# The signed-in landing — specification

*Drafted 2026-08-02. What a member sees when they open Detour, and why it is not
the feed.*

> **Shipped.** `renderLanding` in `src/main.ts`, `landingPanel` in
> `src/community/index.ts`, the triage card in `pb_hooks/landing_triage.js`,
> `pb_hooks/landing_triage.pb.js` and `src/triage.ts`, the *been yet?* follow-up
> in `pb_hooks/landing_followup.js`, `pb_hooks/landing_followup.pb.js` and
> `src/follow-up.ts`, and the answer-slot precedence in
> `/api/detour/community/me`. The feed moved to `?view=feed` and no longer asks
> the member for anything. `AGENTS.md` has been amended as this document requires.
>
> **Two things below are not built.** The answer slot has three of its four
> entries — a triage card, the follow-up, and the week's prompt; **an ask** has
> nothing to send one yet, and it is the only entry still missing. And **Explore
> has not folded into Feed**: that merge is its own piece of work, so the nav
> reads My detours · Feed · Explore · My Circle rather than the three items under
> *Navigation, after this*.
>
> One departure in the follow-up, recorded where it happens: the card **quotes the
> note that put the place on the member's list**, which the copy below does not
> ask for. Three weeks is long enough that a name alone does not always identify
> the place, and the note has to be fetched anyway to check the member can see one.

---

## The decision

**My detours is the signed-in landing.** The feed moves to second place.

My detours already exists (`src/community/index.ts`, `detoursPanel`) with the tabs
**Recommendations · Been & loved · Private shares**. This promotes it from a
panel inside the member area to the thing an invitation and a return visit both
land on, and adds one tab.

**`AGENTS.md` needs amending alongside this.** Its new-member-flow section says
the welcome route ends at "the feed", and that the onboarding place step is what
"puts the member's own card in the feed they land on". Both sentences describe
the old landing. The rationale survives — the point was always that they arrive
somewhere their own card is already waiting, which My detours does more directly
than the feed ever did.

## Why not the feed

A feed makes a promise every time it loads: *there is something new here*. At a
few places a week that promise fails on most visits, and each failure teaches
the member not to come back. The surface most likely to be empty is the worst
possible thing to open on.

Two surfaces never fail that way:

- **The member's own record.** Never empty once they have done one thing.
- **A question.** Does not depend on supply at all.

Which is also what a member most often actually wants. Discovery is not it —
Google wins that until coverage is real. What they want is somewhere to put what
they would have said out loud, and something to send when a friend asks. My
detours serves both. The feed serves neither.

## Structure

```
┌─────────────────────────────────────┐
│  ONE THING TO ANSWER                │   ← at most one card, dismissible
├─────────────────────────────────────┤
│  See what’s new in the community    │
│                          See Feed → │   ← only once Recommendations has cards
├─────────────────────────────────────┤
│  RECOMMENDATIONS · BEEN & LOVED ·   │ ← tabs, as shipped plus one
│  WANNA GO · PRIVATE SHARES          │
│                                     │
│  [ cards ]                          │   ← their own, empty on day one
├─────────────────────────────────────┤
│  FROM THE COMMUNITY                 │   ← instead of the compact row on day one
│  [ card ] [ card ] [ card ]         │   ← other people's, three, newest
│                        See all →    │   ← to the feed
└─────────────────────────────────────┘
```

Nothing else. No stats, no streaks, no comparison to other members.

Once the member has a card in Recommendations, the full day-one community band
is replaced by a compact row between the answer slot and tabs: **See what’s new
in the community · See Feed →**. The two treatments are mutually exclusive. A
member with no recommendation cards sees the full **From the community** band
instead; while that state is loading or unavailable, neither treatment appears.

## From the community

*Added 2026-08-03. `communityStripMarkup` in `src/network.ts`, mounted by
`renderLanding`.*

When the member has no recommendations of their own, three places from the
circle appear under the member's lists, newest first, with a **See all** link to
the feed. The whole band disappears once they have made a recommendation.

**Why this does not contradict "why not the feed".** The argument above is about
what a screen *promises*, not about whether other people's places may appear on
it. A feed promises something new on every load and breaks that promise on most
visits. A band of three at the bottom of a screen that is already about the
member promises nothing — it is either there or it is not, and nobody arrived
for it.

**Why it is needed.** "A member's own record is never empty once they have done
one thing" is exactly false on the one visit that decides whether there is a
second: the first landing after signing up is four empty tabs and a form. The
answer slot covers the *ask* and this covers the *read*. A member who has
nothing to look at leaves, and the only content that is reliably there on day
one is other people's.

Rules, all of which are the difference between this and a second feed:

- **Only while Recommendations is empty.** This is a day-one scaffold. Once the
  member has a card in Recommendations, their record is no longer empty and the
  band is absent. The client uses the same private entry list that renders that
  tab and waits for it to load successfully before deciding it is empty.

- **Three, and no "show more".** It is a window on the feed; the link is what
  the rest of the feed is for.
- **Never the member's own places.** A place they recommended is already in
  Recommendations above; showing their own sentence back to them under
  somebody else's heading is a lie about whose it is.
- **Silent when it has nothing.** No spinner, no error box, no "no places yet"
  heading — the section is simply absent while either the member's own
  recommendations or the feed load, when either request fails, and when there
  is nothing but the member's own. An empty band under an empty screen is the
  second broken promise on one page.
- **Honours the founding-circle filter.** A member who switched *Founders'
  places* off in the feed does not get them here, so **See all** always leads to
  a feed containing at least these three.
- **No badges and no counts**, including the feed's 24-hour "new" stamp. This
  band shows places. The moment it shows a figure it is the statistic the rest
  of this document rules out.

It does not replace the triage card, which asks; this only offers something to
read.

## The answer slot

One card, in this order of precedence, and the first that applies wins:

1. **An ask**, if somebody in their circle asked a question they might answer.
2. **A triage card** — see below — if they have no places of their own.
3. **A "been yet?" follow-up**, if they saved something at least three weeks ago
   in a city they are plausibly in (`docs/wanna-go-spec.md`).
4. **This week's prompt**, from the ladder already built
   (`pb_hooks/place_prompts.js`, `members.place_prompt_step`).
5. **Nothing.** If none applies, the screen starts with their places. Silence
   is better than a manufactured task; an invented prompt is the same broken
   promise as an empty feed, one layer up.

Never a stack. One thing, or none.

## Tabs, not cities

Grouped by state: **Recommendations**, **Been & loved**, **Wanna go**,
**Private shares** — the three shipped tabs with Wanna go inserted before the
inbox, so the member's own three states sit together and what other people sent
them sits last.

The alternative — grouping by city with state as a chip — was considered and
set aside for now. Recorded here because it will come up again, and because it
carries one thing this version does not: a city grouping is *sendable*. "My
Annecy" is the artifact a member reaches for when a friend asks, and it has no
natural home in a state-grouped list. When Send-this gets built, revisit.

Order matches the ladder, most committed first. Recommendations opens by
default; a member with none opens on whichever tab has anything.

## The triage card

**The problem.** A member who has added nothing opens their own record and finds
it blank. Asking them to produce something from nothing is exactly the demand
the research says does not exist — people recommend when asked, about something.

**The card.** A real place from their city, someone else's note, shown in full.
The question is *Know this place?* — about the place, not about what another
member achieved. That distinction is what keeps it from reading as social
pressure, which matters especially while the other name is nearly always the
founder's.

Four answers:

| Answer | Cost | Result |
| --- | --- | --- |
| **Been & loved it** | one tap | Public mark; emails the recommender |
| **Wanna go** | one tap | Private; lands in their Wanna go tab |
| **I'd recommend it myself** | opens the form | The ordinary recommendation path, prefilled |
| **Don't know it** | one tap | Next card; nothing recorded about them |

The two one-tap answers sit together; "I'd recommend it myself" is styled as the
heavier action beneath them. Three visually equivalent buttons where one
ambushes the member with a text field is a small betrayal they only fall for
once.

**Don't know it is not a failure.** It advances the card and tells you the place
is unknown outside its recommender — which is worth knowing, and is the only
honest answer available to someone who has never heard of it.

**Cap: three cards per session, then it stops.** This is the real risk in the
mechanic. *Been & loved* is public and it emails somebody; a member triaging
twenty places in ninety seconds produces noise indistinguishable from signal, on
the one surface where trust is the whole product. Three is enough to fill a
screen and too few to become a game.

**Which card.** The most recently published place in their home city that they
have no state on **and whose fronting note they can see**. Recency is the wedge,
and "no state on" means the same card is never shown twice.

That third condition is not optional. `place_endorsements` refuses an
endorsement where the caller cannot see a note — *"That place is not on your
list."* — so a card chosen only by city and recency will sometimes offer a
**Been & loved it** button that 400s on tap. The selection query and the route's
visibility clause have to be the same clause.

**When their city has nothing** — or has nothing with a visible note, which at
this size is the likelier case — do not show a card from a city they have no
connection to. That is noise with a name on it. Fall back to the plain prompt.

A card framed as *"Nothing in {city} yet — here is what the list looks like
elsewhere"* is tempting and should not offer the three answers: a member cannot
honestly say they have been somewhere chosen for them at random, and the
endorsement route would refuse it anyway. If it is shown at all it is an
illustration, with no buttons on it.

## Empty states

Per tab, and each says what to do rather than describing the absence:

- **Recommendations, empty:** the by-heart question, inline, with the form.
- **Been & loved, empty:** *"Nothing yet. When you go somewhere off this list,
  say so — the person who wrote it hears about it."* Names the payoff, which is
  the point of the feature.
- **Wanna go, empty:** *"Nothing here yet. Nobody but you ever sees this
  list."* States the privacy at the moment it is relevant.

The whole screen is only empty for a member who has done nothing and whose city
has nothing — and that member gets the prompt in the answer slot, so the screen
is never blank.

**A future invitation should carry a place**, chosen by the inviter, so day one
is not blank. It lands in **Private shares**, not Wanna go — a share is somebody
else's intention for them, and filing it as their own would put words in their
mouth and inflate a list they did not build. That is the decision already
recorded for private shares and it holds here. One tap from the inbox makes it
Wanna go, and that tap is the member choosing.

It does not help anyone already invited, which is why the triage card is the
general answer and this is an improvement on top.

## Navigation, after this

**My detours · Feed · My Circle**

Explore folds into Feed as a city filter plus a map toggle. They answer different
questions — Feed is *what is new*, Explore is *what is in X* — and at this supply
both fail separately: nothing is new, and any one city is thin. One filterable
list is honest about being small instead of being empty twice.

## What this screen must never do

- **Invent activity.** No "3 new places this week" when there were none.
- **Compare members.** No leaderboards, no counts of what others have added.
- **Stack asks.** One thing to answer, or none.
- **Gate the tabs.** A member with nothing still sees all four, with empty
  states that explain what would put something there.

## Open

- Does the answer slot persist across a session, or reappear on every load until
  dismissed? Leaning: once per session, dismissal remembered for its own
  interval per the prompt ladder.
- Does an ask the member *sent* appear here while it waits, or only in a
  notification? It is not a thing to answer, so it does not belong in the slot —
  but it needs somewhere.
- Does the Private shares tab keep its unseen-count badge once this is the
  landing rather than a panel? A badge on a landing tab is a different kind of
  pressure than a badge on a panel somebody navigated to.
