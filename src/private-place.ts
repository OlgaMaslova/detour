/**
 * An imported place, shown on the place page — not on a page of its own.
 *
 * THIS MODULE RENDERS NOTHING. It used to hold a second place page, and that was
 * the wrong answer: two page templates for the same kind of object drift, and a
 * member should not be able to tell from the layout that this place arrived by a
 * different door. So `placePageMarkup` renders both, and everything here is the
 * adapter that lets it — an `ImportedPlace` shaped into the `Venue` that page
 * takes, plus the handful of chrome flags that differ.
 *
 * WHAT THE SHARED PAGE DOES ON ITS OWN, given this input:
 *
 *   the hero        falls back to the place's `imageUrl`, which is the
 *                   publication's photograph, hotlinked
 *   the notes       nobody has written any, so the notes section says so
 *   Recommend       offered, because `isMember` is true — the ordinary form, and
 *                   the only way this place ever becomes a real one
 *   afterHero       the provenance band: where it came from, and who can see it
 *
 * WHAT IS TURNED OFF, and why each one:
 *
 *   the signal      it counts Detourists behind a place. There are none and
 *                   there cannot be until somebody recommends it, so the bare
 *                   mark reports an absence that was never a possibility — and
 *                   the band beneath already says as much in words
 *   canEndorse      Been & loved is corroboration of a note. There is none.
 *   canSave         it is already on their wishlist; that is what it is
 *   canShare        sending somebody a place nobody has stood behind is exactly
 *                   what the publication rule exists to prevent
 *   copy link       the address resolves for one member, so a copied link is a
 *                   400 for whoever it is pasted to
 *
 * Removal is deliberately not offered here either. Wanna go's rule is that a
 * member tidies their own list on My detours and nowhere else, and an imported
 * place is on that list.
 */

import type { Venue } from './data';
import { importedCoverHref } from './guides';
import type { ImportedPlace } from './guides';

/**
 * An imported place as the catalogue's own shape.
 *
 * Every figure is left at zero and every list empty, which is not a placeholder:
 * it is the truth about a place nobody has recommended, and it is what makes the
 * shared page render its own empty states rather than inventing furniture.
 *
 * `id` is the imported row's id. Nothing published shares that namespace, and
 * the page uses it only for the controls this chrome switches off — but it does
 * mean an imported place must never be handed to a save or endorsement route,
 * which is what `canSave` and `canEndorse` being false is for.
 */
export function importedPlaceAsVenue(place: ImportedPlace): Venue {
  const located = Number.isFinite(place.lat) && Number.isFinite(place.lng)
    && (place.lat !== 0 || place.lng !== 0);
  return {
    id: place.id,
    name: place.name,
    city: place.city,
    country: place.country,
    category: '',
    // The neighbourhood the piece gave. The page prints it beside the category,
    // which is where it belongs and is often the only locating fact these carry.
    neighborhood: place.area,
    address: place.address,
    // Null rather than 0 when the geocoder has not answered: the page reads null
    // as "no verified coordinate" and says the position is being refined, which
    // is exactly the state an unlocated import is in. A 0/0 would plot the
    // Atlantic.
    lat: located ? place.lat : null,
    lng: located ? place.lng : null,
    approxLocation: false,
    // The publication's photograph, hotlinked. It reaches the hero through the
    // same field a catalogue cover would, so the page needs no branch for it.
    // A hero, so a wider size than a card asks for.
    imageUrl: importedCoverHref(place.image_url, 1200) || undefined,
    published: false,
    visibleToCaller: true,
    detouristCount: 0,
    detouristTotal: 0,
    circleCount: 0,
    founderCount: 0,
    foundingRecommended: false,
    endorsementTotal: 0,
    endorsements: [],
    endorsedByCaller: false,
  };
}

/**
 * The stamp over the hero: this place is yours alone, and Detour does not have
 * it.
 *
 * Two structural facts, and they used to be a muted sentence under the title
 * that nobody read — which is the wrong instrument. A page says what kind of
 * document it is through its form, so this is a rubber stamp across the corner
 * of the cover: rotated, hard-bordered, unmissable, and read before any of the
 * words around it.
 *
 * Both facts in one mark, in order of what a member needs first. *Not on Detour*
 * is the one that changes what they can do with the place — nobody has stood
 * behind it, so there is nothing to trust and nothing to send on. *Your list
 * only* is the reassurance underneath it.
 *
 * `aria-label` carries the whole thing as a sentence, because the visual joke of
 * a stamp is not available to a screen reader and two shouted fragments are not
 * a substitute for one clear statement.
 */
export function importedPlaceStampMarkup(esc: (value: string) => string): string {
  return `<p class="place-import-stamp" role="note" aria-label="${esc(
    'Not on Detour. This place is on your list only — nobody has recommended it.'
  )}">
    <strong aria-hidden="true">Not on Detour</strong>
    <span aria-hidden="true">your list only</span>
  </p>`;
}

/**
 * The line under the hero that says where this place came from and who can see
 * it — the one thing the shared page has no field for, because no catalogue
 * place needs it.
 *
 * Returned as markup and handed to the page template's `afterHero` slot, so
 * `place.ts` stays a template for published places and gains no branch for a
 * case only this module has. It used to be injected into the rendered DOM
 * instead, anchored on a class that page does not have — the whole band silently
 * never appeared, and nothing threw. A slot the template renders cannot miss.
 */
export function importedPlaceProvenanceMarkup(
  place: ImportedPlace,
  source: { label: string; listTitles: string[] },
  esc: (value: string) => string
): string {
  // The publication is the attribution; the list title is only where the member
  // filed it. Credit the first and mention the second, never the other way
  // round — "NYC trip, October" did not write this sentence.
  const credit = place.source_url
    ? `<a href="${esc(place.source_url)}" target="_blank" rel="noopener noreferrer">${esc(
        source.label
      )}</a>`
    : esc(source.label);
  const filedUnder = source.listTitles.length
    ? ` · on ${source.listTitles.map((title) => `“${esc(title)}”`).join(' and ')}`
    : '';
  // NO "Only you can see this. Nobody on Detour has recommended it." — it was
  // here, and it was two structural facts (private; not in the catalogue)
  // carried by a muted sentence nobody reads. Those facts belong to the page's
  // form, not its copy; the treatment that states them is chosen in styles.css
  // and this band is only the attribution.
  return `<div class="private-place-provenance-band">
    ${
      place.excerpt
        ? // The publication's own words, in the block a member's note would take
          // on any other place page — attributed to them, and to nobody here.
          `<blockquote class="private-place-excerpt"><p>${esc(
            place.excerpt
          )}</p><footer>${credit}${filedUnder}</footer></blockquote>`
        : `<p class="private-place-from">From ${credit}${filedUnder}.</p>`
    }
  </div>`;
}
