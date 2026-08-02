# Ask your circle — design

*Drafted 2026-08-02. Not built. This is the argument and the shape, so the
decisions behind it survive the gap before it gets written.*

---

## The finding this exists to serve

The survey said the same thing three ways: people recommend places **when they
are asked**, out loud, and the recommendation evaporates. Nobody volunteers an
artifact. "No, but I tell people" was the modal answer.

Detour currently has no way for anyone to ask anyone anything. Every surface
that produces content — the add form, the onboarding question, the return
prompts — assumes spontaneous giving, which is the one behaviour the research
says does not happen. The system-generated prompt is a synthetic substitute for
a person asking; useful, but a stand-in.

So the gap is not a smaller contribution rung. It is the absence of demand.

## What it changes about contributing

Writing a place today is a broadcast into silence — the reason *Been & loved*
was built first. Answering an ask is doing a specific favour for a person
who wanted it, with a name attached. That is a different act psychologically and
a different act structurally: the audience exists before the content does.

It also fixes the blank page. The add form stops being "say something" and
becomes "Olga is in Barcelona on Friday and wants one dinner" — city and
occasion prefilled, the member supplying only the part nobody else can write.

## The loop

```
empty search  ─┐
thin city      ├─→  ask posted  ─→  routed to members who might know
standalone    ─┘                         │
                                         ▼
   asker notified  ←─  card publishes  ←─ answering IS the add form,
                        as normal          prefilled with city + occasion
```

An answer is **an ordinary recommendation carrying a reference to the ask**, not
a message in a thread. The card goes to the feed and the place page like any
other. If answers live in the ask instead, the best content ends up in a chat
product sitting beside a catalogue, reachable only by whoever was in that
conversation.

## Entry points

1. **Empty search.** A member searches a city Detour cannot answer for. The
   zero-result state offers the ask. The existing note that "empty searches are
   the roadmap" stays true, and gains a second job: the failure becomes a supply
   event instead of only a log line.
2. **A city with thin coverage.** Not zero results, but few — the ask sits below
   what there is.
3. **Standalone.** "Barcelona, next weekend, one dinner." The most important of
   the three, because it does not require a failed search to happen first. Most
   asks in life start with a plan, not with a search that disappointed someone.

## Who gets asked

**Not only members from that city.** People travel, people used to live places,
people have eaten somewhere once and remember it exactly. A resident is the best
answer and not the only one, and a routing rule that only asks residents will,
at Detour's size, usually find nobody — which is the failure mode below.

Route in widening rings, and stop at the first ring with anybody in it:

1. **Knows it firsthand.** Home city matches, or they have published a place
   there. `GET /api/detour/circle` already returns per-person home city and the
   cities of their places, so this ring needs no new projection and leaks
   nothing new.
2. **Knows the country or the region.** The same signals matched wider — someone
   with places in Madrid and Bilbao is worth asking about Barcelona. Note that
   this is derived server-side from the cities already known; there is no
   country on the circle projection.
3. **The whole circle.** Everyone in the graph. Somebody's sister lived there.
   A member who cannot help simply does not answer, and a question they cannot
   answer costs them one glance.
4. **The founding tier**, honestly labelled, if the graph produced nobody. Per
   the existing rule: every visibility decision must be expressible as a
   sentence about why this person is seeing this.

The rings are about **who to notify first**, not about who is allowed to answer.
Anyone who can see the ask can answer it.

## The guard: do not offer an ask nobody will answer

An ask that gets no answer is worse than no ask. It teaches the asker that the
place is empty and makes them feel foolish for having tried — the same failure
as a feed promising news it does not have.

So the offer is conditional on there being somebody plausible in rings 1–3. When
there is not, say so plainly and offer the only honest thing: to tell them if
that city ever fills in. That is a real promise Detour can keep, and it doubles
as the demand signal for where to recruit next.

## Delivery

**Email is the channel.** In-app notification reaches people who are already
here, which is the group that needs no reaching. A member who has not opened
Detour in a week is exactly who an ask needs to arrive in front of, and email is
the only thing that gets there. This matches how the first-place notice already
works.

The email is one question, the asker's name, and one button that opens the
prefilled form. Not a digest, not a summary of the week — a single favour
someone asked for, which is a thing people answer.

Rules that keep it a favour rather than a mailing:

- One ask email per member per day, at most. Batch anything beyond that.
- Cap asks per member per week, so the mechanic cannot be worn out by one
  enthusiastic member.
- An ask expires — see below — and no reminders are sent after it does.
- A member who has answered nothing in three asks drops to ring 3 and stops
  being notified first.

## Asks need a deadline

"Barcelona sometime" is a wish. "Barcelona, Friday, dinner for four" is a
favour with an expiry, and favours with expiries get done. Ask composition
should push for city, when, and what for — the same three things anyone gives a
friend in a text.

An expired ask closes. Answers after the date are still welcome and still
publish, but the asker is not chased and the ask stops being routed.

## Metric

**Asks per week is the health metric.** Places added is the output; asks are the
input. A week with no asks predicts a week with no places, and it does so early
enough to act on.

Secondary: answer rate per ask, and time-to-first-answer. An answer rate below
about half means the routing is asking the wrong people, and an ask that sits
unanswered for its whole window should be treated as a failure of the guard
above, not of the member.

## Where this lands: My detours, not the feed

The feed is the wrong home screen for a product at this supply. A feed promises
something new every visit; a few places a week cannot keep that promise, and
every visit where it fails teaches the member not to come back. The two surfaces
that never fail are the member's own record — never empty once they have written
one thing — and a question, which does not depend on supply at all.

So the landing is **My detours** — the panel that already exists — and its
tabs are the contribution ladder made visible rather than unrelated lists.
Specified in `docs/landing-spec.md`:

| State | What it is | Who sees it |
| --- | --- | --- |
| **Wanna go** | Somewhere they intend to go | Fully private. Never a public count — a visible tally is a popularity ranking, which is the thing this product is against. Specified in `docs/wanna-go-spec.md`. |
| **Been & loved** | Somewhere they went on someone else's recommendation, and would send you too | Public, scoped. Specified in `docs/been-and-loved-spec.md`. |
| **Recommended** | Somewhere they wrote about | Public, scoped as ever. |

Wanna go → been & loved → recommended is a lifecycle, and showing a member where
they are on it is what makes climbing feel natural rather than demanded. Saved
also earns its keep as a prompt hook: *you saved this three weeks ago — been
yet?* arrives at the moment they finally have something to say.

Above the list sits one thing to answer, by the precedence in the landing spec:
an ask, else a triage card, else a "been yet?" follow-up, else the week's
prompt, else nothing. The feed moves below, where its emptiness is a fact about
this week rather than a verdict on the product.

This also lines up with what a member most often actually wants, which is not
discovery — Google wins that until coverage is real. It is somewhere to put what
they would have said out loud, and something to send when a friend asks. My
Places serves both; the feed serves neither.

## Open questions

- Does an ask show the asker's own places for that city, if they have any? It
  makes the ask warmer and risks anchoring the answers.
- Can an ask be public to the founding tier by default, or only on escalation?
- Does answering an ask with a place already on Detour count as *Been & loved*,
  a second recommendation, or both? The existing collision path probably answers
  this, but it should be decided rather than inherited.
- What does the asker see while waiting? An empty state here has the same
  problem as everywhere else in the product.
- Ring 2 claims above that it needs no new projection. That is true of ring 1
  only: `/api/detour/circle` carries home city and the cities of a member's
  places, not their country. Widening to a region either derives it server-side
  from those cities or needs a projection that does not exist yet.
