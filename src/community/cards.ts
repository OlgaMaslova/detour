/**
 * ONE CARD BUILDER, FOR EVERY TAB — see placeCardMarkup below. The member-area
 * lists and the destination boards all render places through the same shared
 * card the feed uses, and this module is the single doorway to it.
 */
import {
  groupedRecommendationCardMarkup,
  networkPlaceNotes,
  recommendationColumnCount,
} from '../network';
import type { DiscoveryRecommendation } from '../network';
import { store } from './store';
import type { Venue } from '../data';

/**
 * ONE CARD BUILDER, FOR EVERY TAB.
 *
 * Recommendations, Been & loved and Wanna go are three lists of places, and a
 * place has to look the same on all of them — and the same as it does in the
 * feed, on a destination list and in Explore. There used to be two builders here
 * and it showed: one assembled a card out of the member's own ledger rows, which
 * carry no photo, while the other read the circle feed, which does. Same place,
 * two different cards, depending on which tab you were standing on.
 *
 * So every card is built the same way: find what the feed holds for this place
 * and hand it to `groupedRecommendationCardMarkup` — the one renderer `AGENTS.md`
 * allows — which then picks the fronting note, the byline and the cover exactly
 * as it does everywhere else. The place's photograph comes from a member's
 * recommendation rather than from the venue row, which is why a card built
 * without the feed had no picture on it while the place page had one.
 *
 * The fallback is for a place the feed has nothing visible on: an entry that has
 * not published, or a place saved from a private share whose recommender is
 * outside this member's circle. It names nobody and says what the card is.
 */
export function placeCardMarkup(place: {
  name: string;
  /**
   * The city, and the city alone.
   *
   * NOT A COMPOSED LOCATION LINE. This is what `notesForPlace` matches on, so
   * anything folded in here — a quarter, a street — is a city the feed has never
   * heard of, and the place stops finding the notes written about it. An
   * imported row's quarter goes in `area`, which is display only.
   */
  city: string;
  country: string;
  /** The quarter, for a card that has no other locating fact — see below. */
  area?: string;
  fallback?: Partial<DiscoveryRecommendation>;
  emptyNote: string;
  /** An imported place's own private page, when it has one. */
  fallbackHref?: string;
  /** An imported place's hotlinked cover, used only if nothing better exists. */
  fallbackCoverHref?: string;
  /**
   * The publication to credit the fallback note to.
   *
   * DELIBERATELY NOT PASSED ON THE NOTES BRANCH. If a member has written about
   * this place, the words in the card are theirs and the byline is theirs — a
   * publication's name over a member's sentence would be a misattribution, and
   * the one that matters most.
   */
  fallbackByline?: string;
  /** Where the provenance chip leads — the guide this place came in on. */
  fallbackBylineHref?: string;
  /** Which door it came through, for the chip's own treatment. */
  fallbackBylineKind?: 'guide' | 'feed' | 'manual';
}): string {
  const options = {
    fallbackHref: place.fallbackHref,
    fallbackCoverHref: place.fallbackCoverHref,
  };
  // A place with visible notes is a catalogue place: it links to its own page and
  // wears a photograph somebody on Detour took, so the imported fallbacks are
  // handed over but will lose to both.
  const notes = notesForPlace(place.name, place.city);
  // THE QUARTER IS NOT CARRIED ONTO THIS BRANCH. Once a member's note fronts the
  // card, this is the feed's card for that place and has to read as the same one
  // — down to the line under the title, which the feed states as the city. The
  // area is what an imported row offers a card that has nothing else to locate
  // it by, and a note is something else.
  if (notes.length) return groupedRecommendationCardMarkup(notes, store.landingPlaceResolver, options);
  return groupedRecommendationCardMarkup(
    [
      {
        venue_name: place.name,
        city: place.city,
        country: place.country,
        note: '',
        ...(place.fallback || {}),
      },
    ],
    store.landingPlaceResolver,
    {
      ...options,
      area: place.area,
      emptyNote: place.emptyNote,
      byline: place.fallbackByline,
      bylineHref: place.fallbackBylineHref,
      bylineKind: place.fallbackBylineKind,
    }
  );
}

/**
 * Every visible note on one place, matched the way the place page matches them.
 *
 * By normalised name and city, because the circle feed does not carry a venue id
 * — see `projectRecommendation` in pb_hooks/main.pb.js. The normalisation has to
 * be the same one main.ts uses to resolve a place, or a card and its own place
 * page disagree about which rows belong to it.
 */
export function notesForPlace(name: string, city: string): DiscoveryRecommendation[] {
  const wantedName = normalizePlaceText(name);
  const wantedCity = normalizePlaceText(city);
  if (!wantedName) return [];
  return networkPlaceNotes().filter((item) => {
    const note = item.note?.trim();
    const recommender = item.recommender_pseudo?.trim().replace(/^@+/, '');
    if (!note || (!item.is_own && !recommender)) return false;
    if (normalizePlaceText(item.venue_name || '') !== wantedName) return false;
    const itemCity = normalizePlaceText(item.city || '');
    return !itemCity || !wantedCity || itemCity === wantedCity;
  });
}

/** The same normalisation `normalizePlacePart` applies in main.ts. */
function normalizePlaceText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\u2019'`\u00b4]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[\u2010-\u2015]/g, ' ')
    .replace(/[.,/#!$%^*;:{}=\-_~()\[\]"?<>\\|+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
/**
 * A grid of places, in the same cards the feed runs.
 *
 * Been & loved and Wanna go are lists of places, not of notes: neither rung has
 * the member write anything. They still belong in cards — a member's own screen
 * should not show a place in a different shape from every other surface in the
 * app — so they go through the shared renderer with a line saying what the card
 * is where a quote would otherwise sit.
 *
 * Private shares are the exception and stay a deck: a share is a message from a
 * named person with a reply thread on it, which is a correspondence rather than
 * a place, and the cassette deck already models it.
 */
export function placeCardGrid(
  items: {
    venue?: Venue;
    name?: string;
    city?: string;
    country?: string;
    /** The quarter, display only — see `placeCardMarkup`. */
    area?: string;
    emptyNote: string;
    footer?: string;
    fallback?: Partial<DiscoveryRecommendation>;
    /** All four only ever set for imported places — see placeCardMarkup. */
    fallbackHref?: string;
    fallbackCoverHref?: string;
    fallbackByline?: string;
    fallbackBylineHref?: string;
    fallbackBylineKind?: 'guide' | 'feed' | 'manual';
    /** A state on the row around the card — dimming a skipped place, and no more. */
    rowClass?: string;
  }[]
): string {
  if (!items.length) return '';
  const columns = recommendationColumnCount();
  return `<ul class="community-queue-cards network-entry-list network-recommendation-grid network-recommendation-grid-${columns}">
    ${items
      .map(
        (item) => `<li class="community-queue-row${item.rowClass ? ` ${item.rowClass}` : ''}">
          ${placeCardMarkup({
            name: item.venue?.name || item.name || 'A place',
            city: item.venue?.city || item.city || '',
            country: item.venue?.country || item.country || '',
            area: item.area,
            emptyNote: item.emptyNote,
            fallback: item.fallback,
            fallbackHref: item.fallbackHref,
            fallbackCoverHref: item.fallbackCoverHref,
            fallbackByline: item.fallbackByline,
            fallbackBylineHref: item.fallbackBylineHref,
            fallbackBylineKind: item.fallbackBylineKind,
          })}
          ${item.footer || ''}
        </li>`
      )
      .join('')}
  </ul>`;
}
