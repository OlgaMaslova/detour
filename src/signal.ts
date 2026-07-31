/**
 * The member-recommendation signal — one badge, every surface.
 *
 * How many Detourists put a place on the list is the single reason anything is
 * on Detour, so it is stated the same way wherever it appears: a mark, a
 * figure, and at most two words. Cards, the map preview and the place page all
 * render this, so the count can never read one way in a list and another way on
 * the page it links to.
 *
 * Self-contained on purpose: no escaping helpers, no venue type. Every string
 * here is a literal or a clamped integer, so there is nothing to escape.
 */

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
 *   mixed, some hidden           Recommended by 6 Detourists, including you,
 *                                2 in your circle and 1 founding member
 */
interface SignalCounts {
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

  const clauses = joinClauses(parts);
  if (everyoneVisible) return `Recommended by ${clauses}`;
  return `Recommended by ${plural(total, 'Detourist')}, including ${clauses}`;
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
  variant: SignalVariant = 'inline'
): string {
  const n = clampCount(counts.total);
  const circle = Math.min(clampCount(counts.circle), n);
  const founders = Math.min(clampCount(counts.founders), n - circle);
  const own = counts.own === true;

  // No count on file: the mark alone, with the wording carried in the label.
  if (n < 1) {
    return `<p class="signal-badge signal-badge-${variant} signal-badge-bare" aria-label="${NO_COUNT_LABEL}">${DETOUR_MARK}</p>`;
  }

  const tooltipPhrase = signalSentence({ total: n, circle, founders, own });
  const tooltip = `<span class="signal-tooltip" role="tooltip" aria-hidden="true">${tooltipPhrase}</span>`;

  // One figure in the box: the total. The badge is a stamp the size of two
  // characters and a mark — a second figure inside it either crowds the plate or
  // shrinks to an unreadable pair of digits, and on a card it reads as two badges
  // pushed together. The circle figure is carried by the accessible name and the
  // tooltip instead, which is where the sentence can afford to be a sentence.
  return `<p class="signal-badge signal-badge-${variant}" aria-label="${tooltipPhrase}" tabindex="0">
    <strong class="signal-count">${n}</strong>
    ${DETOUR_MARK}
    ${tooltip}
  </p>`;
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
