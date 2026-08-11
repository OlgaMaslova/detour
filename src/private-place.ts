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
 *   the notes       nobody has written any, so What people say says so — under
 *                   the publication's own line, which this module supplies
 *   Recommend       offered, because `isMember` is true — the ordinary form, and
 *                   the only way this place ever becomes a real one
 *   origin          how it got here: the piece, its publisher, when it was kept
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
import {
  guideAuthorLabel,
  guideHref,
  guides,
  importedCoverHref,
  importedPlaceSourceLabel,
} from './guides';
import type { Guide, ImportedPlace } from './guides';
import type { PlaceGuideVoice, PlaceOrigin } from './place';

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

// NO "NOT ON DETOUR / YOUR LIST ONLY" STAMP. It was a rotated rubber stamp above
// the title, carrying two structural facts — this place is not in the catalogue,
// and it is yours alone — because the muted sentence that carried them before
// went unread. Both facts now have plainer homes: How it got here says the place
// came off somebody else's list, and What people say says, in the space where the
// recommendations would be, that nobody on Detour has recommended it. A shouted
// mark over the top of two sentences that already say it is one statement too
// many, and it was the loudest thing on the page.

/**
 * Where this place came from, as the shared page's own `origin` field.
 *
 * IT ANSWERS FOR BOTH DOORS NOW, which is why it takes an `ImportedPlace` and
 * nothing about which page is asking. A place a member kept off a list is the
 * same fact whether Detour has a published record of it or not — before, only
 * the private page said so, and the moment somebody recommended the place the
 * member was redirected to a catalogue page where every trace of where they got
 * it had vanished.
 *
 * Typed data rather than the markup this used to return. Two callers rendering
 * the same band by hand is how one fact acquires two spellings.
 *
 * The publication is the attribution; the member's name for the list is only
 * where they filed it — "NYC trip, October" wrote nothing, so it is not the
 * credit. The title links to the guide's own page inside Detour rather than out
 * to the article: the reader is one of that list's places, and the rest of them
 * is the useful thing to offer. The article itself is a click away in the quote
 * below, where the words that came out of it are.
 */
export function importedPlaceOrigin(
  place: ImportedPlace,
  shortDate: (value: string | undefined) => string
): PlaceOrigin {
  const list = owningGuides(place)[0];
  return {
    // The piece's own headline, falling back to the member's name for it — which
    // is the headline until they rename it — and then to a phrase that at least
    // says a list was involved.
    title: list?.source_title.trim() || list?.title.trim() || 'a guide you kept',
    publisher: list ? guideAuthorLabel(list) : importedPlaceSourceLabel(place),
    href: list ? guideHref(list.id) : '',
    importedOn: shortDate(place.created),
  };
}

/**
 * The publication's sentence about this place, if the piece carried one.
 *
 * A list at most: the excerpt is stored on the imported row, so a place kept off
 * two lists still has the one sentence, and the row's own `source_url` is where
 * it was read from.
 */
export function importedPlaceVoices(place: ImportedPlace): PlaceGuideVoice[] {
  if (!place.excerpt.trim()) return [];
  const list = owningGuides(place)[0];
  return [
    {
      publisher: list ? guideAuthorLabel(list) : importedPlaceSourceLabel(place),
      guideTitle: list?.source_title.trim() || list?.title.trim() || '',
      excerpt: place.excerpt,
      // The place's own link before the list's: a good guide deep-links each
      // entry, and the entry is what this quote came from.
      sourceHref: place.source_url || list?.source_url || '',
    },
  ];
}

/** Every list this place sits on that the member still holds, newest first. */
function owningGuides(place: ImportedPlace): Guide[] {
  return guides().filter((list) => place.guides.includes(list.id));
}
