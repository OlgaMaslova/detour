/**
 * The member-recommendation signal — one badge, every surface.
 *
 * How many Detourists stand behind a place: those who wrote a recommendation,
 * plus those who went on one and loved it. The two states are mutually
 * exclusive per member, so the merged figure still counts people rather than
 * actions. Cards and map previews only know recommendation counts; the place
 * page adds its corroboration count to the same signal.
 *
 * Self-contained on purpose: no venue type, and every figure is a clamped
 * integer. One exception, and it is the only one: the merged standing names
 * visible been-and-loved members, and a member-supplied name is the one string
 * here that did not come from this file — so it goes through escapeText below.
 */

/**
 * Member-supplied text, safe for an attribute or a text node. Deliberately local
 * rather than imported: this module renders on every surface and must not
 * acquire a dependency to state a count.
 */
function escapeText(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The Detour mark itself, as a single-colour silhouette — the speech bubble
 * from the logo, which is already the shape of somebody saying something about
 * a place. A heart would say "liked"; this says "recommended", which is the
 * only way anything gets onto Detour.
 *
 * Geometry is the brand mark's bubble path translated to its own origin, so it
 * stays in step with the logo in index.html and brandMark(). One colour rather
 * than the logo's four: it has to tint per variant (ink on the orange plate,
 * accent on a card), which `currentColor` gives for free.
 */
const DETOUR_MARK = `<svg class="signal-mark" viewBox="0 0 42 39" aria-hidden="true" focusable="false"><path fill="currentColor" d="M0 0h42v26H28L21 39l-7-13H0z"/></svg>`;

/**
 * `plate` — the place page's hero statement: large figure, full phrase.
 * `inline` — the card and preview pill: mark, figure, one noun.
 */
/**
 * The Wanna go mark: a bookmark, and no figure beside it.
 *
 * A bookmark because that is exactly what a save is — a place put aside to come
 * back to. Not a tick, which is Been & loved and claims presence; not a bubble,
 * which claims somebody said something; and not a heart, which would score.
 *
 * THE ABSENCE OF A FIGURE IS THE POINT. Every other cell in this stamp is a
 * number and a mark, and this one must never become that: a visible tally of
 * saves is a popularity ranking, which is the thing Detour exists in opposition
 * to. It is also not a count in disguise — it says one binary fact about the
 * reader and nothing about anybody else, because nobody else's saves exist as
 * far as any surface is concerned. See docs/wanna-go-spec.md.
 *
 * Drawn on the same 42×39 field as the others so all three sit on one baseline.
 */
const SAVED_MARK = `<svg class="signal-mark signal-mark-saved" viewBox="0 0 42 39" aria-hidden="true" focusable="false"><path fill="currentColor" d="M10 0h22v38L21 27 10 38z"/></svg>`;

export type SignalVariant = 'plate' | 'inline';

/**
 * Wording when no aggregate count is on file.
 *
 * This used to read "Member recommended", which stated the one thing a zero
 * count cannot support. It was written for an "unknown count" case, but in
 * production zero meant *nobody*, so a leftover catalogue row with no
 * recommender behind it was badged as recommended. Visibility is now derived
 * from the caller's scoped signal (see `visibleToCaller` in data.ts and
 * `allVenues` in main.ts), so a place with no visible recommender is not
 * rendered at all and this branch should be unreachable. It stays as a neutral
 * fallback rather than a claim: if it ever renders again, it must not assert
 * something nobody the caller can see actually said.
 */
const NO_COUNT_LABEL = 'On Detour';

function clampCount(count: number | undefined): number {
  return typeof count === 'number' && Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
}

/**
 * What the figure is counting, in the reader's own terms.
 *
 * Being able to see a recommendation and being in someone's circle are two
 * different things, and this phrase is where the difference is either stated or
 * lost. Visibility has two clauses — the invitation graph, or the founding tier —
 * and each gets its own words:
 *
 *   reached through the graph     "in your circle"
 *   reached as a founding member  "founding member"
 *   the reader themself           "you"
 *
 * There is deliberately no fallback that reaches for "circle" when the reason is
 * unknown. A founding member's place is visible to every member and is in nobody's
 * circle in particular; labelling it "1 Detourist in your circle" asserts a
 * relationship that does not exist, which is exactly what happened when this
 * function was handed a single "visible to you" number and had only that one word
 * to spend. If a count arrives with no reason attached it is described as visible
 * and nothing more.
 *
 *   you alone                    Recommended by you
 *   one founder, nobody you know Recommended by 1 founding member
 *   your inviter, who is founding Recommended by 1 Detourist in your circle
 *   you and a founder            Recommended by you and 1 founding member
 *   mixed, some hidden           Recommended by 6 Detourists
 *
 * That last line is the whole of it when anyone is hidden: the count, and no
 * accounting of which part of it the reader may see.
 */
export interface SignalCounts {
  /** Every distinct member who recommended this place, in any circle. */
  total: number;
  /** Reached through the invitation graph, the reader included if they are one. */
  circle: number;
  /** Reached only through the founding tier. In nobody's circle. */
  founders: number;
  /** Whether the reader is one of the recommenders. */
  own: boolean;
}

function plural(n: number, word: string): string {
  return n === 1 ? `1 ${word}` : `${n} ${word}s`;
}

function joinClauses(parts: string[]): string {
  if (parts.length < 2) return parts[0] || '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function signalSentence({ total, circle, founders, own }: SignalCounts): string {
  if (total < 1) return NO_COUNT_LABEL;
  const visible = circle + founders;
  const circleOthers = Math.max(0, circle - (own ? 1 : 0));
  const everyoneVisible = visible >= total;

  // Nothing about the reason survived to here — an older backend, or a surface
  // that only knows the visible total. Say what is certain and claim nothing.
  if (visible < 1) return `Recommended by ${plural(total, 'Detourist')}`;

  const parts: string[] = [];
  if (own) parts.push('you');
  if (circleOthers > 0) {
    // Which noun depends on what precedes this clause. After "you" they are
    // others; opening the sentence they are Detourists; after a total that
    // already said "Detourists" they are a bare figure.
    parts.push(
      own
        ? `${plural(circleOthers, 'other')} in your circle`
        : everyoneVisible
          ? `${plural(circleOthers, 'Detourist')} in your circle`
          : `${circleOthers} in your circle`
    );
  }
  if (founders > 0) parts.push(plural(founders, 'founding member'));

  // Some of the recommenders are outside the reader's reach. The figure alone is
  // the whole of what they need: a breakdown of the visible slice ("2 Detourists,
  // including 1 founding member") spends two lines telling them which fraction of
  // a number they already read they are allowed to account for, which is a fact
  // about our permission model rather than about the place. Where everything IS
  // visible the clauses stay — there the phrase names people, not a remainder.
  if (!everyoneVisible) return `Recommended by ${plural(total, 'Detourist')}`;
  return `Recommended by ${joinClauses(parts)}`;
}

/**
 * The badge: figure first, then the mark. No noun — the mark is the word, which
 * is the whole point of having a mark, and it keeps the badge the same width in
 * every language.
 *
 * Nothing here is self-describing on screen, so the full phrase always rides
 * along as the accessible name; a bare "2" must never be what a screen reader
 * announces. The two variants differ only in scale, so there is one template.
 */
export function detouristSignalBadge(
  counts: Partial<SignalCounts>,
  variant: SignalVariant = 'inline',
  endorsement: EndorsementSignal = {},
  /**
   * Whether this reader has this place on their wishlist. Their own row and
   * nobody else's — passed only by the place page, because a card carries one
   * person's voice and anything personal to the viewer belongs on the page.
   */
  saved = false
): string {
  const recommended = clampCount(counts.total);
  const recommendedCircle = Math.min(clampCount(counts.circle), recommended);
  const recommendedFounders = Math.min(
    clampCount(counts.founders),
    recommended - recommendedCircle
  );
  const endorsed = clampCount(endorsement.total);
  const endorsedCircle = Math.min(clampCount(endorsement.circle), endorsed);
  const endorsedFounders = Math.min(
    clampCount(endorsement.founders),
    endorsed - endorsedCircle
  );
  // A member cannot occupy both states on one place: writing a recommendation
  // removes their Been & loved mark in the same transaction. This is therefore
  // a distinct-person total, not two activity counts added together.
  const n = recommended + endorsed;
  const circle = recommendedCircle + endorsedCircle;
  const founders = recommendedFounders + endorsedFounders;
  const own = counts.own === true || endorsement.own === true;
  // No figure, ever. See SAVED_MARK.
  const savedCell = saved
    ? `<span class="signal-divider" aria-hidden="true"></span>${SAVED_MARK}`
    : '';
  const savedPhrase = saved ? 'On your wishlist' : '';

  // No count on file: the mark alone, with the wording carried in the label.
  if (n < 1) {
    const bare = savedPhrase ? `${NO_COUNT_LABEL}. ${savedPhrase}` : NO_COUNT_LABEL;
    return `<p class="signal-badge signal-badge-${variant} signal-badge-bare" aria-label="${bare}">${DETOUR_MARK}${savedCell}</p>`;
  }

  const visibleEndorsers = (endorsement.names ?? []).map(escapeText);
  const said = signalSentence({ total: n, circle, founders, own });
  const attributed = visibleEndorsers.length
    ? `${said} — ${joinClauses(visibleEndorsers)}`
    : said;
  const tooltipPhrase = [attributed, savedPhrase].filter(Boolean).join('. ');
  const tooltip = `<span class="signal-tooltip" role="tooltip" aria-hidden="true">${tooltipPhrase}</span>`;

  // One figure: how many distinct Detourists stand behind this place, whether
  // they wrote a note or went on one and loved it. The stored recommendation
  // count and publication threshold remain recommendation-only; this sum exists
  // only in presentation.
  return `<p class="signal-badge signal-badge-${variant}" aria-label="${tooltipPhrase}" tabindex="0">
    <strong class="signal-count">${n}</strong>
    ${DETOUR_MARK}
    ${savedCell}
    ${tooltip}
  </p>`;
}

/* ---------- been & loved ---------- */

/**
 * Members who went somewhere on somebody's note and would send you there too.
 *
 * Two claims, both stated — *I went, and I would send you* — and both are load
 * bearing. "Been" alone takes no position, and silence is Detour's only
 * disagreement mechanism: a marker that meant merely "I was here" would leave a
 * member who went and disliked the place with no honest move, and would make the
 * absence of a mark unreadable in both directions. "Loved" alone does not assert
 * presence, and firsthand experience is the entire value of the signal.
 *
 * It is never a rating: no counterpart, no score, and nothing is ordered by it.
 * In the place-page stamp it joins the recommendation figure as one count of
 * distinct members who stand behind the place. The stored counts remain
 * separate because only written recommendations can publish a place.
 *
 * The ampersand belongs in the compact positions, where it scans in caps beside
 * `3 RECOMMEND`. Wherever the line is a sentence, the words are spelled out:
 * `2 BEEN AND LOVED` is not grammatical as a count, so in tight space the phrase
 * is a label with the figure appended rather than a sentence with the figure in
 * front.
 */
export interface EndorsementCounts {
  /** Every mark on the place, from every circle. */
  total: number;
  /** Endorsers reached through the invitation graph, the reader included. */
  circle: number;
  /** Endorsers reached only through the founding tier. In nobody's circle. */
  founders: number;
  /** Whether the reader is one of them. */
  own: boolean;
}

/** The button, wherever a member can press it. */
export const ENDORSE_LABEL = 'Been here, and loved it';

/**
 * What a surface knows about a place's marks: the counts, and the endorsers this
 * caller may see, already scoped by the server. Both are simply absent on
 * surfaces that hold only the figure — a card knows the count, the place page
 * knows the names.
 */
export interface EndorsementSignal extends Partial<EndorsementCounts> {
  /**
   * The endorsers this caller may see, the reader excluded — `own` already
   * accounts for them and the sentence already says "you". Naming them a second
   * time reads as "You have been and loved it — You".
   */
  names?: string[];
}

/**
 * Prose, for the place page. The figure is global; the clauses after it describe
 * only who the reader can see, in the reader's own terms — and, exactly as with
 * the recommendation sentence, "in your circle" is said only when the graph
 * matched and never when the founding tier did.
 *
 *   you alone                     You have been and loved it
 *   one, in your circle           1 Detourist has been and loved it · 1 in your circle
 *   six, two of them yours        6 have been and loved it · 2 in your circle
 *   six, none you can see         6 have been and loved it
 */
export function endorsementSentence({ total, circle, founders, own }: EndorsementCounts): string {
  const n = clampCount(total);
  if (n < 1) return '';
  const circleCount = Math.min(clampCount(circle), n);
  const founderCount = Math.min(clampCount(founders), n - circleCount);
  if (own && n === 1) return 'You have been and loved it';

  const headline =
    n === 1 ? '1 Detourist has been and loved it' : `${n} have been and loved it`;

  const parts: string[] = [];
  if (own) parts.push('you');
  const circleOthers = Math.max(0, circleCount - (own ? 1 : 0));
  if (circleOthers > 0) parts.push(`${circleOthers} in your circle`);
  if (founderCount > 0) parts.push(plural(founderCount, 'founding member'));
  if (!parts.length) return headline;
  return `${headline} · ${joinClauses(parts)}`;
}

/** Plain-text form for aria-labels that already describe a larger control. */
export function detouristSignalText(counts: Partial<SignalCounts>): string {
  const n = clampCount(counts.total);
  const circle = Math.min(clampCount(counts.circle), n);
  return signalSentence({
    total: n,
    circle,
    founders: Math.min(clampCount(counts.founders), n - circle),
    own: counts.own === true,
  });
}
