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
 * from the member signal (see isPubliclyVisible in main.ts), so a zero-count
 * place is not rendered at all and this branch should be unreachable on a public
 * surface. It stays as a neutral fallback rather than a claim: if it ever renders
 * again, it must not assert something no member said.
 */
const NO_COUNT_LABEL = 'On Detour';

function clampCount(count: number | undefined): number {
  return typeof count === 'number' && Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
}

/**
 * The phrase a screen reader should hear, and the one the plate shows. Kept to
 * two words after the figure so the badge stays a label, not a sentence.
 */
function signalPhrase(count: number): string {
  if (count < 1) return NO_COUNT_LABEL;
  return count === 1 ? '1 Detourist recommends' : `${count} Detourists recommend`;
}

function signalTooltipPhrase(count: number): string {
  return count === 1 ? 'Recommended by 1 Detourist' : `Recommended by ${count} Detourists`;
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
export function detouristSignalBadge(count: number | undefined, variant: SignalVariant = 'inline'): string {
  const n = clampCount(count);
  const phrase = signalPhrase(n);

  // No count on file: the mark alone, with the wording carried in the label.
  if (n < 1) {
    return `<p class="signal-badge signal-badge-${variant} signal-badge-bare" aria-label="${NO_COUNT_LABEL}">${DETOUR_MARK}</p>`;
  }

  const tooltipPhrase = signalTooltipPhrase(n);
  const tooltip = `<span class="signal-tooltip" role="tooltip" aria-hidden="true">${tooltipPhrase}</span>`;

  return `<p class="signal-badge signal-badge-${variant}" aria-label="${tooltipPhrase}" tabindex="0">
    <strong class="signal-count">${n}</strong>
    ${DETOUR_MARK}
    ${tooltip}
  </p>`;
}

/** Plain-text form for aria-labels that already describe a larger control. */
export function detouristSignalText(count: number | undefined): string {
  return signalPhrase(clampCount(count));
}
