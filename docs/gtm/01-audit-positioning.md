# Detour prospective-user audit and evidence-led positioning

**Audit scope/date:** Live public app at <https://detour-app.supernaut.to>, audited 2026-07-18.

**Viewports:** Desktop at 1440×1000 and mobile at 390×844.

**Method:** Public, anonymous testing only. The audit followed landing, search, city discovery, map selection, place proof, membership entry, invitation entry, and responsive behavior. Observations below describe only what an unauthenticated visitor could see. Authenticated-member behavior—including invite allocation, private introductions, personal notes, identity handling, and private sharing—is out of scope; no private data was accessed or observed.

## Executive read

### What a new visitor understands in under a minute

Detour is a city-by-city collection of recognized restaurants presented through maps and concise proof. The landing page asks **“Where is your next detour?”** and immediately offers Madrid, Paris, and San Francisco, each with a visible selection count. Opening a city reveals a map, a full list, recognition labels, and links back to official sources. A visitor can therefore understand that Detour is intentionally narrower than a general restaurant map and more geographic than a guide directory.

The visitor is also told that Detour has a private member layer: three independent member recommendations can publish a place, while introductions, notes, and identities remain private. What is not clear in the same first minute is what members receive beyond the public catalogue, how someone obtains an invitation, or how much member judgment is represented in any public listing.

### Diagnosis

The strongest public product truth is **a small, map-led shortlist backed by current, traceable recognition**. The experience already supplies unusually concrete credibility: named sources, recognition levels and years, official-guide links, full addresses, city-specific counts, and a disclosure that the complete selection is shown.

The messaging currently asks the visitor to infer the practical benefit. “Exceptional tables” and “recognition” establish standards, but they do not fully answer the acquisition question: *Why should I use this instead of Google Maps, a Michelin directory, or a current best-restaurants article?* The member mechanism adds distinction, yet its anonymous presentation emphasizes privacy and access mechanics before explaining the payoff of membership.

### Primary opportunity

Lead with Detour as **the credible, manageable shortlist for choosing an exceptional table in a city**, then explain the proof system and private community standard. This positioning is supportable by the public experience and differentiates Detour without pretending to offer omniscient criticism, universal personal review, bookings, availability, or visible personal recommendations on every listing.

This memo recommends product and message directions, not app-code changes as an in-scope deliverable.

## Walkthrough evidence

### 1. Entry and landing

The hero language is **“Where is your next detour?”** followed by:

> “A collection of exceptional tables, chosen for the recognition they hold now — from named guides and from Detour’s own members.”

Three destination cards set immediate scope:

- **Madrid — 43**
- **Paris — 29**
- **San Francisco — 25**

The page states **“Every destination below carries current, published recognition”** and explains the community publication threshold: three member recommendations publish a place.

**Positive trust signal:** The exact city counts, current-recognition claim, named-guide framing, and three-member threshold suggest a bounded selection with an explicit standard—not an unfiltered database or a single anonymous editor’s list.

**Value and activation ambiguity:** A visitor can tell *how entries qualify* more quickly than *what Detour helps them do*. “Exceptional tables” is attractive but broad. The page does not yet make the comparison case explicit: less noise than a generic map, more source range than one guide, and more traceability than a listicle. The community prompt also describes publication mechanics before clarifying the member benefit or route to an invitation.

### 2. City discovery

The city pages use clear, selection-led headlines:

- **“Madrid’s exceptional tables, selected.” — 43**
- **“Paris’s exceptional tables, selected.” — 29**
- **“San Francisco’s exceptional tables, selected.” — 25**

Across the city experience, the public controls included a city selector, **Refine**, **Show nearby**, maps, and disclosure that the visitor was seeing the full selection. On mobile, compact **Search / destination / Refine / Show nearby** controls remained above the map. In Paris, the filter drawer used progressive disclosure for recognition (**All / 3 Stars / 2 Stars**), category, and source/Michelin rather than placing every choice on the initial surface.

The catalogues demonstrate that “selected” has real city-specific depth and that Detour is not merely repeating one identical template:

- **Madrid:** The 43-place selection includes Guía Repsol as well as Michelin. Some restaurants carry multi-source recognition; DiverXO is a visible example.
- **Paris:** The list showed 29 Michelin two- and three-star tables, a deliberately high-threshold set rather than a broad restaurant directory.
- **San Francisco:** The 25-place list included Michelin 3-, 2-, and 1-star restaurants and Bib Gourmand entries, plus **Tony’s Pizza Napoletana — No. 3, 50 Top Pizza USA 2025**.

**What this proves:** Detour has enough selection depth to support exploration while remaining bounded. The source range can expand beyond Michelin where credible city-relevant recognition exists. The map, nearby control, filters, and full-selection disclosure make the catalogue usable as a geographic decision surface rather than only a prestige list.

**What remains interpretive:** “Edited” or “curated” can fairly describe the bounded selection, but the public evidence does not establish that Detour personally reviewed every restaurant. Messaging should attribute the standard to current published recognition and the stated member threshold, not imply universal first-hand criticism.

### 3. Search and place detail

Typing **Benu** into the landing search led to San Francisco with Benu selected. The selected-place panel provided:

- a map popup;
- **“Why it’s here”**;
- **3 Stars, Michelin Guide 2026**;
- the full address, **22 Hawthorne St., San Francisco, CA 94105, USA**; and
- an **Official guide** link.

In Paris, selecting **Alléno Paris au Pavillon Ledoyen** showed **3 Stars, Michelin Guide 2026**, its street address, and an **Official guide** link.

This is a coherent public route from **map → reason for inclusion → named proof → source**. It supports both discovery and verification: a visitor can locate the restaurant, understand its qualification, and leave Detour for the primary guide record.

The route is thinner at the choice-making stage. On the initial city/list map, there was no visible editorial context such as occasion, cuisine, neighborhood framing, or a concise “why go” beyond recognition. As publicly observed, there was also no visible share, save, or reservation control at either city or selected-place level. These are not claims that such capabilities do not exist privately; they are anonymous-visitor findings. The practical consequence is that public Detour is strongest at trustworthy shortlist formation and weaker at helping a visitor discriminate among several equally recognized options or carry a choice into the next action.

### 4. Membership and community

Selecting **Members** led to a **“PRIVATE MEMBER AREA”** headed **“Your Detour, one thing at a time.”** The page offered **Sign in** and **Use an invitation** tabs. The invitation form required name, email, password, password confirmation, and invitation code, with the copy **“Join with your personal invitation.”**

On the home page, **“Recommend the first one”** redirected an anonymous user to sign-in. The footer explained that introductions, personal notes, and identities stay private, and that three independent recommendations publish a place.

This establishes an intentional model: membership is exclusive, private contributions are not converted into a public popularity feed, and publication requires corroboration rather than one person’s vote. That can be positioned as a quality standard, not a mass-review system.

The anonymous experience does not explain enough about the payoff of joining or how a non-member can gain an invitation. The visitor sees the credential form and the privacy rules, but not a concrete public preview of the member utility. Public testing cannot audit signed-in invite allocation, private sharing, the content of member notes, or how recommendations are reviewed and surfaced. No public share affordance was observed on public city or selected-place screens.

### 5. Responsive and visual experience

Desktop views presented distinctive editorial city surfaces, with the map and selected-place detail above the complete list. This gives the cities a sense of place and makes geographic exploration feel primary rather than decorative.

At 390px, destination cards and maps rendered without horizontal overflow. The compact controls kept the core path available above the map. When a place was selected, however, its details created a long scroll before the visitor returned to the list. As a lived visitor tradeoff, mobile preserves proof and map context but makes rapid comparison among multiple places slower than on desktop.

## Strengths and friction, prioritized

| Priority | Type | Audit evidence (fact) | Implication (interpretation) |
|---|---|---|---|
| P0 | Strength | Each city has a visible, finite count: Madrid 43, Paris 29, San Francisco 25; city pages disclose the full selection. | Detour can credibly promise a manageable shortlist rather than comprehensive coverage. |
| P0 | Strength | Benu and Alléno panels show recognition level, Michelin Guide 2026, address, and an Official guide link. | Traceability is a defensible trust advantage over unattributed or stale discovery content. |
| P0 | Friction | The landing language explains recognition and member qualification more clearly than the practical choice benefit. | Acquisition messaging must translate the proof system into “choose from less noise with confidence.” |
| P0 | Friction | The public member entry shows invitation mechanics but not a concrete member payoff or path to obtain an invite. | Exclusivity may register as a locked door before it registers as a valuable community. Validate comprehension before making membership the lead message. |
| P1 | Strength | Madrid includes Guía Repsol and Michelin with multi-source examples such as DiverXO; San Francisco includes Michelin categories and 50 Top Pizza USA 2025. | Detour can differentiate from single-guide browsing while remaining recognition-led. |
| P1 | Strength | Search for Benu resolves to a selected place on the San Francisco map; city controls include Refine and Show nearby. | The product connects a known-place lookup and open-ended city discovery in one geographic model. |
| P1 | Friction | Public city/list and selected-place views showed no visible occasion, cuisine, neighborhood, or “why go” context beyond recognition. | Recognition gets a visitor to a credible set, but may not be enough to choose among peers. This is a research question before it is a product prescription. |
| P1 | Friction | No public save, share, reservation, or availability control was visible. | Do not position Detour as a planning workflow, booking product, or collaborative sharing tool based on the anonymous experience. |
| P2 | Strength | Three independent member recommendations are required to publish a place; identities, notes, and introductions stay private. | Community can be framed as a corroborated private standard rather than a popularity contest. |
| P2 | Friction | Selected-place details create a long mobile scroll before the full list. | Mobile favors depth of proof over fast side-by-side comparison; test whether visitors accept that tradeoff. |

## Recommended positioning statement

**For travellers and local diners who want a smaller, credible shortlist of exceptional tables city by city, Detour turns current recognition from named guides—and a private, corroborated member signal—into a map-led selection with traceable source links, so choosing where to go starts with proof instead of noise.**

This statement answers four essential questions:

- **Who it is for:** Travellers and local diners making a city-level restaurant choice.
- **What it does:** Produces a bounded, map-led shortlist of exceptional tables.
- **Why it is credible:** Listings cite current recognition, named sources, years, and official-guide links; member publication requires three recommendations.
- **Why it is better for this job:** Google Maps is broad and undifferentiated; Michelin browsing is centered on one guide and a directory flow; generic listicles can be stale or difficult to trace. Detour combines a smaller set, geography, multiple credible sources where available, and direct proof links.

The honest constraint should remain visible: Detour is **recognition-led curation**, not omniscient restaurant criticism. The public audit does not support a claim that every restaurant was personally reviewed, that every listing contains member recommendations, or that Detour knows the “best” choice for every diner.

## Messaging architecture

### Pillar 1: A city shortlist, not an endless directory

**Core promise:** Start with a finite selection of recognized tables worth considering in the city.

**Evidence:** Madrid, Paris, and San Francisco display exact totals of 43, 29, and 25. Each city page describes its tables as “selected” and discloses the full selection.

**Ready-to-use copy:**

- “The exceptional tables to consider—43 in Madrid, 29 in Paris, 25 in San Francisco.”
- “A complete city shortlist, edited down before you start searching.”
- “Less scrolling. A smaller set with a visible standard.”

### Pillar 2: Recognition you can trace

**Core promise:** See why a place qualifies and follow the evidence to its source.

**Evidence:** Benu and Alléno show “Why it’s here,” Michelin Guide 2026 recognition, an address, and an Official guide link. Madrid adds Guía Repsol; San Francisco includes 50 Top Pizza USA 2025 alongside Michelin recognition.

**Ready-to-use copy:**

- “Every selection begins with current, published recognition.”
- “See the distinction, the year, and the official source.”
- “Named guides. Current proof. No mystery about why a table is here.”

### Pillar 3: The map turns prestige into a place choice

**Core promise:** Explore a credible set by where you are and where you are going.

**Evidence:** City pages center a map, retain Search / destination / Refine / Show nearby controls on mobile, and connect search results such as Benu directly to a selected map place and proof panel.

**Ready-to-use copy:**

- “Find an exceptional table in the part of the city that fits your day.”
- “A shortlist you can see geographically—not another ranked page to decode.”
- “Search a name, explore nearby, or scan the whole city selection.”

### Pillar 4: A private standard, not a popularity contest

**Core promise:** Member signals are private and corroborated before they affect the public collection.

**Evidence:** The public copy says introductions, personal notes, and identities stay private, and three independent recommendations are required to publish a place. The member area is explicitly private and invitation-based.

**Ready-to-use copy:**

- “Three independent recommendations—not a public vote—can add a place.”
- “Private notes and identities. A public selection only after corroboration.”
- “Community judgment without ratings noise.”

### Messaging constraints

- Do **not** say every selection is personally reviewed or visited by Detour.
- Do **not** claim bookings, availability, reservation handling, saving, or sharing from the public experience.
- Do **not** promise insider tips, private notes, or member recommendations on every listing.
- Do **not** imply that every city uses multiple sources; cite the sources actually present in that city.
- Do cite current recognition, named-guide attribution, the recognition year where shown, official-guide links, exact city counts, and the three-recommendation publication rule.

## Recommended primary message

**Detour is the map of exceptional tables already narrowed to a credible, traceable city shortlist.**

This is distinct enough to acquire against broad maps, supportable by the current public product, and flexible across cities and source mixes.

### Candidate hero and subhead

**Hero:** **Where is your next exceptional table?**

**Subhead:** **Explore a smaller city shortlist built from current recognition, mapped for the choice in front of you, with official sources you can trace.**

The existing line **“Where is your next detour?”** has brand character and can remain as a campaign or supporting line. For acquisition, the candidate above makes the category and user outcome explicit sooner.

### Do not lead with

- **Invitation-only membership:** The anonymous payoff and access route are not yet clear enough to carry first-touch acquisition.
- **“The best restaurants”:** It overstates what a recognition-led selection can prove and invites subjective ranking expectations.
- **Member recommendations:** They are an important standard, but the audit did not show personal recommendations on every public listing.
- **Michelin alone:** Paris is Michelin-specific in this audit, but Madrid and San Francisco demonstrate a broader source proposition.
- **Bookings or trip planning:** No public booking, availability, save, or share workflow was observed.

## Next evidence to gather before wider GTM

Limit the next research round to questions that can change positioning or funnel emphasis:

1. **Membership conversion comprehension:** After viewing the landing and member-entry pages, can prospective users state what they would gain by joining, and is that benefit strong enough to submit or seek an invitation?
2. **Invite-access comprehension:** Do non-members understand whether invitations come from existing members, Detour, or another process—and what action, if any, they can take next?
3. **Proof as an exploration trigger:** Does seeing current recognition, year, named source, and an Official guide link increase confidence enough to open more places or choose Detour over a generic map/listicle?
4. **Shortlist value:** Are exact city counts and “full selection” disclosure understood as useful editing, or as insufficient coverage? Test this separately with travellers and local diners.
5. **Choice sufficiency:** Do map position and recognition details provide enough context to choose among several candidates, or do visitors need occasion, cuisine, neighborhood, price, or a concise “why go” before acting?
6. **Community framing:** Does “three independent recommendations” plus private identities/notes communicate a higher standard, or does it create uncertainty about who members are and how public places were selected?

## Audit-evidence appendix

- **Public URL:** <https://detour-app.supernaut.to>
- **Audit date:** 2026-07-18
- **Viewports:** Desktop 1440×1000; mobile 390×844
- **Routes/actions tested:** Landing page; Madrid, Paris, and San Francisco destination cards and city pages; city selector; Refine; Show nearby; Paris recognition/category/source filter drawer; full city lists; landing search for “Benu”; Benu selected-place map popup and detail; Alléno Paris au Pavillon Ledoyen selected-place detail; Members; Sign in; Use an invitation; “Recommend the first one”; footer community/privacy copy; desktop and mobile scrolling/rendering.
- **Known boundary:** Anonymous public testing only. No account was created and no invitation was used. Authenticated invite allocation, member recommendations, private notes, introductions, identities, private sharing, and any other signed-in capability were not observed and are not evaluated here.
