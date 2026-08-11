/**
 * Wanna go and the destination boards: the wishlist grouped into the cities it
 * is about, the guide import dialogue, and the one row shape (BoardPlace) the
 * city and guide pages plot, number and list.
 */
import type { Venue } from '../data';
import { citySlug } from '../slugs';
import {
  allImportedPlaces,
  cancelImport,
  closeImportDialog,
  destinationBoardHref,
  ensureGuides,
  guideAuthorLabel,
  guideHref,
  guides,
  guidesLoaded,
  importDialogOpen,
  importDraft,
  importFailure,
  importKeeping,
  importReading,
  importedCoverHref,
  importedPlaceSourceLabel,
  importedVenueIds,
  keepImportDraft,
  openImportDialog,
  privatePlaceHref,
  readListLink,
  removeGuide,
  removeImportedPlace,
  removingImported,
  setAllDraftPlaces,
  setDraftCity,
  setDraftTitle,
  toggleDraftPlace,
} from '../guides';
import type { Guide, ImportDraft, ImportedPlace } from '../guides';
import {
  isSavedPlace,
  savePlaceFailure,
  savedPlaces,
  savedPlacesLoaded,
  savingPlace,
  toggleSavedPlace,
} from '../saved';
import { esc, onCommunityReset, pseudoLabel, store } from './store';
import { notesForPlace, placeCardGrid } from './cards';
import { CATEGORY_OPTIONS } from './place-form';

/**
 * The list a member has asked to remove, held while they answer for its places.
 *
 * Wanna go's own Remove takes no confirmation and should not — it is one
 * bookmark. This is up to a hundred places in one tap and is not undoable, and
 * "Remove guide" honestly reads two ways: drop the whole thing, or drop the
 * heading and keep what was under it. Both are things a member might mean, so
 * both are offered rather than one being guessed at.
 */
let pendingGuideRemoval: { id: string; title: string; total: number; shared: number } | null = null;
/**
 * Removing a list: what happens to the places that came in on it.
 *
 * Three outs rather than two, because "Remove guide" is genuinely ambiguous and
 * the destructive reading is the one a mis-tap would take. Places another list
 * still names are counted out of both answers — they survive either way, and
 * saying so stops the numbers looking like they disagree.
 */
export function removeGuideDialogMarkup(): string {
  const pending = pendingGuideRemoval;
  if (!pending) return '';
  const exclusive = Math.max(0, pending.total - pending.shared);
  const busy = removingImported(pending.id);
  return `<dialog class="community-confirm-dialog" data-guide-remove-dialog aria-labelledby="remove-guide-title" aria-describedby="remove-guide-description">
    <div class="community-confirm-sheet">
      <p class="community-confirm-kicker">Remove a guide</p>
      <h2 id="remove-guide-title" tabindex="-1">Remove “${esc(pending.title)}”?</h2>
      <p id="remove-guide-description">${
        exclusive
          ? `${exclusive} place${exclusive === 1 ? '' : 's'} came in with this guide. You can drop them too, or keep them on your wishlist without the heading.`
          : 'Nothing came in with this guide that is not also on another one, so nothing will be lost.'
      }${
        pending.shared
          ? ` ${pending.shared} ${pending.shared === 1 ? 'is' : 'are'} also on another guide and will be kept either way.`
          : ''
      }</p>
      <div class="community-confirm-actions">
        <button class="secondary-button" type="button" data-guide-remove-cancel ${busy ? 'disabled' : ''}>Cancel</button>
        ${
          exclusive
            ? `<button class="secondary-button" type="button" data-guide-remove-keep ${busy ? 'disabled' : ''}>Keep the places</button>`
            : ''
        }
        <button class="community-danger" type="button" data-guide-remove-confirm ${busy ? 'disabled' : ''}>${
          busy ? 'Removing…' : exclusive ? 'Remove guide and places' : 'Remove guide'
        }</button>
      </div>
    </div>
  </dialog>`;
}
/**
 * Wanna go — the member's planning space, grouped into the cities it is about.
 *
 * NOT A FLAT LIST ANY MORE. It was one, and at two imported guides it became a
 * dump of fifty cards in no order a traveller could use. A wishlist is answered
 * city by city — that is the unit somebody plans in — so this is an index of
 * destinations and the places live on each destination's own page.
 *
 * Its own request, unlike Been & loved beside it, and for a reason that is the
 * whole feature: a mark can be read off the scoped catalogue payload because it
 * is scoped-public, and a save cannot, because nothing computed for anybody else
 * knows it exists. saved.ts holds what /api/detour/places/saved answered.
 *
 * Removal is offered here and takes no confirmation. This is the private,
 * reversible rung — a dialogue asking a member whether they are sure about a
 * bookmark is an insult, and the tab is where their own list is theirs to tidy.
 *
 * Newest first, deliberately, and nothing is ever aged out on the member's
 * behalf. A list that only grows risks becoming a graveyard, and sinking the dead
 * weight is a better answer than deleting somebody's intentions for them.
 */
/** Which door a place came through. `provenance.type` from the model. */
type WannaGoSource = 'all' | 'guide' | 'feed' | 'manual';

/** How many cards a destination shows while every city is on screen. */
const WANNA_GO_PREVIEW = 3;

/** The active destination filter: a slug, or 'all'. */
let wannaGoCity = 'all';
/** The active source filter. */
let wannaGoSource: WannaGoSource = 'all';
/** Destinations the member has expanded past the preview cap. */
const wannaGoShowAll = new Set<string>();

/** One city a member has places in, and how many. */
export interface WannaGoDestination {
  /** The city as first written, for display. */
  name: string;
  /** Route slug, and the grouping key everything else compares by. */
  slug: string;
  places: number;
  /** Guides that put at least one place in this city. */
  guides: Guide[];
}

/** The grouping key. One definition, so every surface agrees what a city is. */
function destinationSlugOf(city: string): string {
  return citySlug(city.trim() || 'Unplaced') || 'unplaced';
}

/**
 * The member's wishlist, grouped into the cities it is actually about.
 *
 * A DESTINATION IS DERIVED, NEVER DECLARED. There is no destination record and
 * no way to make one: a city appears because it holds a place and vanishes when
 * it holds none. Renaming one ("NYC trip in May") needs somewhere to keep the
 * name, and that is deliberately not built yet.
 *
 * BOTH DOORS, ONE GROUPING. An imported place and a place the member pressed
 * Wanna go on are the same kind of thing standing in the same city, so they are
 * counted together. Which door a place came through is a property of the place —
 * its provenance chip — not a reason to file it somewhere else.
 *
 * A place whose city is unknown groups under "Unplaced" rather than being
 * dropped: it is on the wishlist, and a member who cannot find it would
 * reasonably conclude the import lost it.
 */
export function wannaGoDestinations(): WannaGoDestination[] {
  const byKey = new Map<string, WannaGoDestination>();
  const add = (rawCity: string, guide?: Guide) => {
    const name = rawCity.trim() || 'Unplaced';
    const slug = destinationSlugOf(name);
    const found: WannaGoDestination =
      byKey.get(slug) || { name, slug, places: 0, guides: [] };
    found.places += 1;
    if (guide && !found.guides.some((entry) => entry.id === guide.id)) found.guides.push(guide);
    byKey.set(slug, found);
  };

  const guideOf = guideByPlaceId();
  for (const place of allImportedPlaces()) add(place.city, guideOf.get(place.id));

  // A save on a place an imported row already covers is the same place twice.
  const covered = importedVenueIds();
  for (const save of savedPlaces()) {
    if (covered.has(save.venue_id)) continue;
    add(save.city);
  }

  return [...byKey.values()].sort(
    (a, b) => b.places - a.places || a.name.localeCompare(b.name)
  );
}

/** The guide each imported place arrived on, when one still names it. */
function guideByPlaceId(): Map<string, Guide> {
  const guideOf = new Map<string, Guide>();
  for (const guide of guides()) {
    for (const place of guide.places) if (!guideOf.has(place.id)) guideOf.set(place.id, guide);
  }
  return guideOf;
}

/**
 * Where a place came from, as the chip states it.
 *
 * Three kinds and no fourth. A guide names the publication and links back to the
 * piece; the feed names the member whose note the place was read on; manual is
 * the member's own hand. An imported place whose guides have all been removed is
 * still guide-sourced — the piece wrote it, and losing the guide does not change
 * who did.
 */
function provenanceOf(
  place: { name: string; city: string },
  imported?: ImportedPlace,
  guide?: Guide
): { kind: 'guide' | 'feed' | 'manual'; label: string; href: string } {
  if (imported) {
    return guide
      ? { kind: 'guide', label: `Guide · ${guideAuthorLabel(guide)}`, href: guideHref(guide.id) }
      : { kind: 'guide', label: `Guide · ${importedPlaceSourceLabel(imported)}`, href: '' };
  }
  const author = notesForPlace(place.name, place.city).find(
    (note) => !note.is_own && note.recommender_pseudo?.trim()
  );
  if (author) {
    return {
      kind: 'feed',
      label: `Feed · via ${pseudoLabel(author.recommender_pseudo || '')}`,
      href: '',
    };
  }
  return { kind: 'manual', label: 'Added by you', href: '' };
}

/**
 * One destination's cards — imported and saved together, each wearing its own
 * provenance and filtered by the active source.
 *
 * The whole point of the model: an imported place and a place the member pressed
 * Wanna go on are the same kind of thing standing in the same city, so they sit
 * in one grid rather than in two sections divided by which door they came
 * through.
 */
function wannaGoDestinationCards(slug: string) {
  const guideOf = guideByPlaceId();
  const wanted = (kind: 'guide' | 'feed' | 'manual') =>
    wannaGoSource === 'all' || wannaGoSource === kind;

  const imported = wannaGoDestinationPlaces(slug)
    .map((place) => ({ place, provenance: provenanceOf(place, place, guideOf.get(place.id)) }))
    .filter((entry) => wanted(entry.provenance.kind))
    .map((entry) => importedPlaceCard(entry.place, entry.provenance));

  const covered = importedVenueIds();
  const saves = savedPlaces()
    .filter((place) => !covered.has(place.venue_id) && destinationSlugOf(place.city) === slug)
    .map((place) => {
      const venue = store.knownVenues.find((item) => item.id === place.venue_id);
      const name = place.venue_name || venue?.name || 'A place you saved';
      return { place, venue, name, provenance: provenanceOf({ name, city: place.city }) };
    })
    .filter((entry) => wanted(entry.provenance.kind))
    .map(({ place, venue, name, provenance }) => {
      const failure = savePlaceFailure(place.venue_id);
      const busy = savingPlace(place.venue_id);
      return {
        venue,
        name,
        city: place.city,
        country: place.country,
        emptyNote: 'On your wishlist. Nobody else can see it.',
        fallbackByline: provenance.label,
        fallbackBylineKind: provenance.kind,
        footer: `<div class="community-queue-bar community-queue-bar-single">
          <button class="community-queue-delete" type="button" data-saved-drop="${esc(
            place.venue_id
          )}" ${busy ? 'disabled' : ''} aria-label="${esc(
            `Remove ${name} from your wishlist`
          )}">${busy ? 'Removing…' : 'Remove'}</button>
          ${failure ? `<p class="community-form-error" role="alert">${esc(failure)}</p>` : ''}
        </div>`,
      };
    });

  return [...imported, ...saves];
}

// NO `wannaGoDestinationCardsMarkup`. The destination board used to be this
// tab's card grid on a page of its own; it is now a numbered list tied to a map
// — see `renderCity` and `wannaGoBoardPlaces`. The grid stays here,
// where the tab still shows a preview per city.

export function savedPanel(): string {
  const loading = !savedPlacesLoaded() || !guidesLoaded();
  const destinations = wannaGoDestinations();
  if (loading) {
    return `<div class="community-saved-list">
      ${wannaGoIntroMarkup(destinations)}
      <p class="community-loading" role="status">Loading…</p>
    </div>`;
  }
  if (!destinations.length) {
    return `<div class="community-saved-list">
      ${wannaGoIntroMarkup(destinations)}
      <p class="community-empty">Nothing here yet. Open a place you mean to get to and press “Wanna go”, or paste a link to a guide you have been reading — nobody but you ever sees this.</p>
    </div>`;
  }

  // The destination filter narrows to one city; the source filter narrows by
  // which door a place came through. Both are views of the same set, never
  // different data.
  const shown = destinations.filter(
    (destination) => wannaGoCity === 'all' || destination.slug === wannaGoCity
  );
  const sections = shown
    .map((destination) => wannaGoSectionMarkup(destination, shown.length === 1))
    .filter(Boolean);

  return `<div class="community-saved-list">
    ${wannaGoIntroMarkup(destinations)}
    ${
      sections.length
        ? sections.join('')
        : '<p class="community-empty">Nothing on your wishlist matches that filter.</p>'
    }
  </div>`;
}

/**
 * The note, the filters, and the one way in.
 *
 * The chips are the whole navigation of this tab: a destination narrows the page
 * to one city, and the source filter answers "what did I import?" without giving
 * guides rows of their own. Counts are on the chips because a filter that does
 * not say how much it holds makes a member press it to find out.
 */
function wannaGoIntroMarkup(destinations: WannaGoDestination[]): string {
  const total = destinations.reduce((sum, destination) => sum + destination.places, 0);
  const cityChip = (slug: string, label: string, count: number) =>
    `<button class="wanna-chip${wannaGoCity === slug ? ' is-active' : ''}" type="button"
      data-wanna-city="${esc(slug)}" aria-pressed="${wannaGoCity === slug}">${esc(
      label
    )} <span aria-hidden="true">·</span> ${esc(String(count))}</button>`;
  return `<div class="wanna-intro">
    <p class="community-form-note">Your private planning space. Nobody else sees this.</p>
    <div class="wanna-controls">
      <div class="wanna-chips" role="group" aria-label="Filter your wishlist">
        ${cityChip('all', 'All', total)}
        ${destinations
          .map((destination) => cityChip(destination.slug, destination.name, destination.places))
          .join('')}
        <label class="wanna-source">
          <span class="visually-hidden">Filter by where a place came from</span>
          <select data-wanna-source>
            ${SOURCE_FILTERS.map(
              ([value, label]) =>
                `<option value="${esc(value)}"${
                  wannaGoSource === value ? ' selected' : ''
                }>${esc(label)}</option>`
            ).join('')}
          </select>
        </label>
      </div>
      <button class="primary-button wanna-add" type="button" data-import-open>Import Guide</button>
    </div>
  </div>`;
}

/** The source filter's options. `provenance.type`, plus the everything case. */
const SOURCE_FILTERS: readonly (readonly [WannaGoSource, string])[] = [
  ['all', 'Source: all'],
  ['guide', 'Source: guides'],
  ['feed', 'Source: the feed'],
  ['manual', 'Source: added by me'],
];

/**
 * One destination, inline: its heading, the guides that fed it, and its places.
 *
 * Capped while every city is on screen and uncapped once one is chosen, because
 * the two views answer different questions — "where am I going?" wants a glance
 * per city, "what is in New York?" wants the list. `Open map` leads to the
 * destination's own page, which is where the map lives; a map per section would
 * be four map instances on one tab — and, since Google bills per instance, four
 * charges for a screen nobody asked to see a map on.
 */
function wannaGoSectionMarkup(destination: WannaGoDestination, expanded: boolean): string {
  const cards = wannaGoDestinationCards(destination.slug);
  if (!cards.length) return '';
  const shown = expanded || wannaGoShowAll.has(destination.slug)
    ? cards
    : cards.slice(0, WANNA_GO_PREVIEW);
  const hidden = cards.length - shown.length;
  return `<section class="wanna-section" aria-labelledby="wanna-dest-${esc(destination.slug)}">
    <header class="wanna-section-head">
      <h3 id="wanna-dest-${esc(destination.slug)}">${esc(destination.name)}</h3>
      <p class="wanna-section-meta">${esc(String(destination.places))} place${
        destination.places === 1 ? '' : 's'
      }${
        destination.guides.length
          ? ` · ${esc(String(destination.guides.length))} guide${
              destination.guides.length === 1 ? '' : 's'
            }`
          : ''
      }</p>
      <a class="wanna-section-map" href="${esc(
        destinationBoardHref(destination.slug)
      )}" data-wanna-destination="${esc(destination.slug)}">Open the city</a>
    </header>
    ${
      destination.guides.length
        ? `<div class="wanna-guides">
      <span class="wanna-guides-label">Guides here</span>
      ${destination.guides
        .map(
          (guide) => `<a class="wanna-guide-chip" href="${esc(guideHref(guide.id))}" data-guide>${esc(
            guideAuthorLabel(guide)
          )} <span>${esc(String(guide.places.length))} place${
            guide.places.length === 1 ? '' : 's'
          }</span></a>`
        )
        .join('')}
    </div>`
        : ''
    }
    ${placeCardGrid(shown)}
    ${
      hidden > 0
        ? `<p class="wanna-section-more"><button type="button" data-wanna-show-all="${esc(
            destination.slug
          )}">+ ${esc(String(hidden))} more in ${esc(destination.name)} — show all</button></p>`
        : ''
    }
  </section>`;
}

/** Every imported place the member holds in one destination. */
export function wannaGoDestinationPlaces(slug: string): ImportedPlace[] {
  return allImportedPlaces().filter((place) => destinationSlugOf(place.city) === slug);
}

/**
 * One row on a destination board: a place this member holds in this city.
 *
 * The board is the planning surface, so the row is deliberately flat — a name, a
 * quarter, one line of why, which door it came through, and whether they have
 * been. Everything the board needs to filter, number, plot and link is on it, so
 * neither the list nor the map has to go looking a second time and find a
 * different answer.
 */
export interface BoardPlace {
  /** The row's identity: the venue id where there is one, the imported row's id
   *  otherwise. Ties a list row to its pin. */
  key: string;
  name: string;
  /** The catalogue record, when Detour has one for this place. */
  venue?: Venue;
  /** The imported row, when the member holds this place through a guide. */
  imported?: ImportedPlace;
  /** The quarter — the only locating fact most imported places carry. */
  area: string;
  category: string;
  /** One line of why: a member's recommendation, or the publication's sentence. */
  quote: string;
  /**
   * Who wrote that line: a member's pseudonym, "You", or the publication.
   *
   * NOT "via". A member's note is that member's recommendation — they are its
   * author, not the route it travelled — and "via @marta" credited her the way
   * you credit whoever forwarded you an article. The word belongs to provenance
   * ("Feed · via @marta" on a card, where the question is which door), never to
   * a byline over somebody's own sentence.
   */
  quoteBy: string;
  /**
   * Who stands behind the place, for the card's foot: the publication that
   * printed it, or the member who recommended it. '' when neither — a place the
   * member added by hand has nobody's name on it but their own.
   */
  sourceName: string;
  provenance: { kind: 'guide' | 'feed' | 'manual'; label: string; href: string };
  /** Every guide of the member's that names this place, for the source chips. */
  guideIds: string[];
  /** They have been and said so — the top rung, and a filter of its own. */
  been: boolean;
  /** It is on their wishlist. Always true on their own lens; a fact on the other. */
  saved: boolean;
  /**
   * The member said "not this one" about a place their guide named. False
   * everywhere but a guide page, which is the only surface that still shows it.
   */
  skipped: boolean;
  lat: number | null;
  lng: number | null;
}

/**
 * The city page's card reading, through the one card renderer this app has.
 *
 * NOT A CARD OF ITS OWN. `groupedRecommendationCardMarkup` renders every
 * recommendation card on every surface — home, the city page, Explore — and the
 * rule is in AGENTS.md: extend the shared renderer when the treatment changes,
 * never add a second one. A city page that drew its own cards would drift from
 * the feed's within a release, and a member would be looking at two things that
 * are the same thing.
 *
 * The rows come in already filtered, ordered and cut by the page; all this does
 * is hand each one to the renderer in the shape it takes, with the imported
 * fallbacks — private href, hotlinked cover, the publication's byline — set for
 * the places that have no catalogue record behind them.
 */
export function boardCardsMarkup(
  rows: BoardPlace[],
  /** What to print under one card, when the surface has something to offer there. */
  footerFor: (row: BoardPlace) => string = () => ''
): string {
  return placeCardGrid(
    rows.map((row) => {
      const extras = {
        footer: footerFor(row),
        rowClass: row.skipped ? 'is-skipped' : '',
      };
      if (row.imported && !row.venue) {
        return { ...importedPlaceCard(row.imported, row.provenance), ...extras };
      }
      return {
        ...extras,
        venue: row.venue,
        name: row.name,
        city: row.venue?.city || row.imported?.city || '',
        country: row.venue?.country || row.imported?.country || '',
        // Reached only when nobody this reader can see has written about the
        // place — on their own lens that is the ordinary state of a save.
        emptyNote: row.saved
          ? 'On your wishlist. Nobody else can see that.'
          : 'No note you can read yet.',
      };
    })
  );
}

/**
 * The city as everybody reads it: the places members recommend there.
 *
 * The other lens on the same page — see `wannaGoBoardPlaces`, which answers the
 * same question about the member's own holdings. One row shape for both, because
 * they are one page: the list, the map, the numbering and the controls are
 * identical and only the set of places differs.
 *
 * Every one of these is published, which means a member recommended it, so the
 * provenance is the feed and the quote is whoever's note this reader can see.
 */
export function cityPickPlaces(venues: Venue[]): BoardPlace[] {
  return venues.map((venue) => {
    const quoted = newestNoteFor(venue.name, venue.city);
    return {
      key: venue.id,
      name: venue.name,
      venue,
      area: venue.neighborhood || '',
      category: venue.category || '',
      ...quoted,
      provenance: provenanceOf({ name: venue.name, city: venue.city }),
      guideIds: [],
      been: beenThere(venue, venue.name, venue.city),
      saved: isSavedPlace(venue.id),
      skipped: false,
      lat: venue.lat,
      lng: venue.lng,
    };
  });
}

/**
 * Everything the member holds in one city, from all three doors at once.
 *
 * A DESTINATION IS THE UNIT OF PLANNING, so this is the whole of it: places kept
 * off a guide, places saved one at a time, and places already been to. The last
 * of those is new here — the board used to be the wishlist alone, and a city you
 * have half-eaten your way through showed only the half you had not. A member
 * planning a return trip wants both, which is why the board counts them together
 * and offers *Been* as a filter rather than as a separate page.
 *
 * The catalogue comes in as an argument rather than off `knownVenues`: the board
 * has its own route and can be loaded cold, before any panel that would have
 * warmed that cache has rendered.
 */
/**
 * The one note a row or a card quotes: the newest one this reader can see, and
 * their own when they wrote it.
 *
 * DELIBERATELY THE NEWEST, and deliberately stated. It used to be whichever note
 * the feed payload happened to list first, which is an order nothing promises —
 * two members writing about the same place would swap places on the city page
 * for no reason a reader could name. Newest-first is the rule the cards already
 * sort by, so one place reads the same wherever it appears; ties break on the
 * recommendation id so the answer never flickers between renders.
 *
 * A member's own note wins outright. On their own city page, the sentence they
 * wrote is the one they will recognise.
 */
function newestNoteFor(name: string, city: string): {
  quote: string;
  quoteBy: string;
  sourceName: string;
} {
  const notes = [...notesForPlace(name, city)].sort(
    (a, b) =>
      Date.parse(b.created || '') - Date.parse(a.created || '') ||
      (b.id || '').localeCompare(a.id || '')
  );
  const note = notes.find((entry) => entry.is_own) || notes[0];
  const said = note?.note?.trim() || '';
  if (!said) return { quote: '', quoteBy: '', sourceName: '' };
  const who = note?.is_own ? 'You' : pseudoLabel(note?.recommender_pseudo || '');
  return { quote: said, quoteBy: who, sourceName: who };
}

/**
 * Have they been — the question the To try / Been split actually asks.
 *
 * TWO ANSWERS COUNT, not one. The Been & loved mark is the explicit one, but a
 * member's own recommendation is the rung above it: the place page hides both
 * *Been* and *Wanna go* once somebody has written here, on the grounds that a
 * note says more than a mark can. A board that read only the mark left those
 * places sitting under *To try* with no control left anywhere that could move
 * them — a member looking at a city they had written about was told they still
 * meant to get there.
 *
 * The ladder runs forward only, and this is what keeps it running: wishlist,
 * mark, note, each one standing for everything below it.
 */
function beenThere(venue: Venue | undefined, name: string, city: string): boolean {
  if (venue?.endorsedByCaller === true) return true;
  return notesForPlace(name, city).some((item) => item.is_own && Boolean(item.note?.trim()));
}

/** An imported place's category as a word, from the closed set's own labels. */
function importedCategoryLabel(value: string): string {
  const found = CATEGORY_OPTIONS.find(([option]) => option === value);
  return found ? found[1] : '';
}

/**
 * One imported place as a row, wherever it is being read.
 *
 * The city page and the guide page show the same object under two headings, so
 * they build it here rather than each shaping its own — two spellings of one row
 * is how a place ends up quoting the publication in one place and a member in
 * the other.
 */
function importedBoardPlace(
  place: ImportedPlace,
  guide: Guide | undefined,
  venue: Venue | undefined
): BoardPlace {
  const fromFeed = venue
    ? newestNoteFor(venue.name, venue.city)
    : { quote: '', quoteBy: '', sourceName: '' };
  const located = Number.isFinite(place.lat) && (place.lat !== 0 || place.lng !== 0);
  const said = place.excerpt.trim();
  return {
    key: venue?.id || place.id,
    name: place.name,
    venue,
    imported: place,
    area: place.area || venue?.neighborhood || '',
    // A matched catalogue place keeps the category a member chose; the
    // publication's own answer stands in only where Detour has none. Its word
    // for the cuisine beats the bare label — a row saying "Georgian" tells a
    // planner what "Ethnic cuisine" does not.
    category: venue?.category || place.cuisine || importedCategoryLabel(place.category),
    // The publication's sentence is why this place is on the list at all, so it
    // leads; a member's note stands in when the piece said nothing quotable.
    quote: said || fromFeed.quote,
    quoteBy: said ? '' : fromFeed.quoteBy,
    sourceName: said
      ? guide
        ? guideAuthorLabel(guide)
        : importedPlaceSourceLabel(place)
      : fromFeed.sourceName,
    provenance: provenanceOf(place, place, guide),
    guideIds: place.guides,
    been: beenThere(venue, venue?.name || place.name, venue?.city || place.city),
    saved: !place.skipped,
    skipped: place.skipped,
    lat: venue?.lat ?? (located ? place.lat : null),
    lng: venue?.lng ?? (located ? place.lng : null),
  };
}

/**
 * One guide's places as rows — skipped ones included, because this is the only
 * page that still shows them. Everywhere else they are gone; see `skipped` on
 * `ImportedPlace`.
 */
export function guideBoardPlaces(guide: Guide, venues: Venue[]): BoardPlace[] {
  const catalogue = venues.length ? venues : store.knownVenues;
  const byId = new Map(catalogue.map((venue) => [venue.id, venue]));
  return guide.places.map((place) =>
    importedBoardPlace(place, guide, place.matched_venue ? byId.get(place.matched_venue) : undefined)
  );
}

export function wannaGoBoardPlaces(slug: string, venues: Venue[]): BoardPlace[] {
  const catalogue = venues.length ? venues : store.knownVenues;
  const byId = new Map(catalogue.map((venue) => [venue.id, venue]));
  const guideOf = guideByPlaceId();
  const rows: BoardPlace[] = [];
  const claimed = new Set<string>();


  for (const place of wannaGoDestinationPlaces(slug)) {
    const venue = place.matched_venue ? byId.get(place.matched_venue) : undefined;
    if (venue) claimed.add(venue.id);
    rows.push(importedBoardPlace(place, guideOf.get(place.id), venue));
  }

  const covered = importedVenueIds();
  for (const save of savedPlaces()) {
    if (destinationSlugOf(save.city) !== slug) continue;
    if (covered.has(save.venue_id) || claimed.has(save.venue_id)) continue;
    claimed.add(save.venue_id);
    const venue = byId.get(save.venue_id);
    const name = save.venue_name || venue?.name || 'A place you saved';
    rows.push({
      key: save.venue_id,
      name,
      venue,
      area: venue?.neighborhood || '',
      category: venue?.category || '',
      ...newestNoteFor(name, save.city),
      provenance: provenanceOf({ name, city: save.city }),
      guideIds: [],
      been: beenThere(venue, name, save.city),
      saved: true,
      skipped: false,
      lat: venue?.lat ?? null,
      lng: venue?.lng ?? null,
    });
  }

  // Been & loved in this city, however it got there — the mark, or a
  // recommendation of their own, which stands for it. A place they marked or
  // wrote about without ever saving belongs on the board too: it is one of their
  // places in this city, and the board is the answer to "what do I have in New
  // York".
  for (const venue of catalogue) {
    if (claimed.has(venue.id)) continue;
    if (!beenThere(venue, venue.name, venue.city)) continue;
    if (destinationSlugOf(venue.city) !== slug) continue;
    claimed.add(venue.id);
    rows.push({
      key: venue.id,
      name: venue.name,
      venue,
      area: venue.neighborhood || '',
      category: venue.category || '',
      ...newestNoteFor(venue.name, venue.city),
      provenance: provenanceOf({ name: venue.name, city: venue.city }),
      guideIds: [],
      been: true,
      // Been but never saved — the mark is the reason it is on this board.
      saved: false,
      skipped: false,
      lat: venue.lat,
      lng: venue.lng,
    });
  }

  return rows;
}

// NO `bindWannaGoCards`. It wired Remove on the destination board back when that
// board was this tab's card grid on another page. The board is its own surface
// now and offers no removal: a member tidies their own list on My detours and
// nowhere else, which is the rule Wanna go has always run on.


/**
 * The import dialogue: paste, then review, in one modal.
 *
 * Two states rather than two dialogues, because the twenty seconds a long page
 * takes to read happen between them, and a member who has waited that long must
 * not have the answer appear somewhere other than where they were looking.
 *
 * Rendered only while open, and `showModal()` is called from the bind step — the
 * same shape as the delete-recommendation dialogue, and for the same reason: the
 * whole panel re-renders on every state change, so the element is recreated each
 * time and has to be re-opened rather than kept.
 */
export function importDialogMarkup(): string {
  if (!importDialogOpen()) return '';
  const draft = importDraft();
  const failure = importFailure();
  return `<dialog class="community-import-dialog" data-import-dialog aria-labelledby="import-dialog-title">
    <div class="community-import-sheet">
      ${draft ? importReviewMarkup(draft, failure) : importReadMarkup(failure)}
    </div>
  </dialog>`;
}

/** The dialogue's first state: the field, and what the last attempt said. */
function importReadMarkup(failure: string): string {
  const reading = importReading();
  return `<form class="community-form community-import-form" data-import-read>
    <p class="community-confirm-kicker">Add to your wishlist</p>
    <h2 id="import-dialog-title" tabindex="-1">Save a guide you have been reading.</h2>
    <label>Link to the guide<input name="url" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="Paste the link — e.g. a city’s best-of guide" ${
      reading ? 'disabled' : ''
    } required></label>
    <p class="community-form-note">${
      reading
        ? 'Reading the page...'
        : 'We read the page and show you what is on it. Nothing is kept until you say so.'
    }</p>
    ${failure ? `<p class="community-form-error" role="alert">${esc(failure)}</p>` : ''}
    <div class="community-import-bar">
      <button class="secondary-button" type="submit" ${reading ? 'disabled' : ''}>${
        reading ? 'Reading…' : 'Read the guide'
      }</button>
      <button class="community-queue-delete" type="button" data-import-cancel ${
        reading ? 'disabled' : ''
      }>Cancel</button>
    </div>
  </form>`;
}

/**
 * What the link turned out to hold, and the member's answer to it.
 *
 * Everything is checked except what they already have, because the honest
 * default on a list somebody chose to paste is yes. The name is theirs to change
 * before it is kept — the article's headline is a headline, and "NYC trip,
 * October" is what the list is actually for.
 *
 * The city field is the one piece of work asked of the member, and it is asked
 * because it is the only thing that decides whether a place already on Detour is
 * recognised as the same place. It is prefilled from the page whenever the page
 * said.
 */
function importReviewMarkup(draft: ImportDraft, failure: string): string {
  const keeping = importKeeping();
  const chosen = draft.places.filter((place) => place.keep).length;
  const matched = draft.places.filter((place) => place.matched).length;
  const held = draft.places.filter((place) => place.already_have).length;
  return `<form class="community-form community-import-review" data-import-keep>
    <div class="community-import-head">
      <p class="community-confirm-kicker">Add to your wishlist</p>
      <h2 id="import-dialog-title" tabindex="-1">${esc(String(draft.places.length))} place${
        draft.places.length === 1 ? '' : 's'
      } on this guide</h2>
      <p class="community-form-note">${esc(draft.source || 'From the page you pasted')}${
        draft.knownListTitle
          ? ` · you have kept this link before, as “${esc(draft.knownListTitle)}” — keeping again refreshes it`
          : ''
      }</p>
    </div>
    <label>List name<input name="title" value="${esc(draft.title)}" maxlength="200" ${
      keeping ? 'disabled' : ''
    } required></label>
    <label>City<input name="city" value="${esc(draft.city)}" maxlength="120" placeholder="e.g. New York" ${
      keeping ? 'disabled' : ''
    }></label>
    <p class="community-form-note">The city is how we tell whether a place is already on Detour.${
      matched ? ` ${matched} of these already ${matched === 1 ? 'is' : 'are'}.` : ''
    }${held ? ` ${held} ${held === 1 ? 'is' : 'are'} already on your list.` : ''}</p>
    <div class="community-import-actions">
      <button class="community-import-bulk" type="button" data-import-all="1" ${keeping ? 'disabled' : ''}>Check all</button>
      <button class="community-import-bulk" type="button" data-import-all="" ${keeping ? 'disabled' : ''}>Clear all</button>
    </div>
    <ul class="community-import-list">
      ${draft.places
        .map((place, index) => {
          const where = [place.area, place.address].filter(Boolean).join(' · ');
          return `<li class="community-import-row${place.already_have ? ' is-held' : ''}">
        <label>
          <input type="checkbox" data-import-place="${index}" ${place.keep ? 'checked' : ''} ${
            keeping ? 'disabled' : ''
          }>
          <span class="community-import-name">${esc(place.name)}</span>
          ${where ? `<span class="community-import-where">${esc(where)}</span>` : ''}
          ${
            place.already_have
              ? '<span class="community-import-flag">Already on your list</span>'
              : place.matched
                ? '<span class="community-import-flag is-matched">On Detour</span>'
                : ''
          }
        </label>
      </li>`;
        })
        .join('')}
    </ul>
    ${failure ? `<p class="community-form-error" role="alert">${esc(failure)}</p>` : ''}
    <div class="community-import-bar">
      <button class="secondary-button" type="submit" ${keeping || !chosen ? 'disabled' : ''}>${
        keeping ? 'Keeping…' : `Add ${chosen} to Wanna go`
      }</button>
      <button class="community-queue-delete" type="button" data-import-cancel ${keeping ? 'disabled' : ''}>Cancel</button>
    </div>
  </form>`;
}


/**
 * ONE BUILDER FOR AN IMPORTED PLACE'S CARD, wherever it is standing.
 *
 * Under its guide heading, or under "Not from a guide" once that heading is gone —
 * the card is the same either way, because the place is. Splitting these would
 * be the same mistake `placeCardMarkup` exists to prevent one level up: a place
 * that looks different depending on which part of the tab it is on.
 */
function importedPlaceCard(
  place: ImportedPlace,
  provenance: { kind: 'guide' | 'feed' | 'manual'; label: string; href: string }
) {
  const busy = removingImported(place.id);
  return {
    name: place.name,
    // The area is the only locating fact most of these carry, and
    // on a card it belongs where the city goes — "Astoria, New
    // York" is what the member needs to place it.
    city: [place.area, place.city].filter(Boolean).join(', ') || place.city,
    country: place.country,
    // The publication's own sentence, in the quote a member's note
    // would occupy — it is why the place was kept, and reading the
    // card without it says nothing at all. It carries the
    // publication's byline rather than a member's, so the card is
    // never mistakable for somebody's recommendation. Only the
    // fallback branch takes this: see placeCardMarkup.
    fallback: place.excerpt ? { note: place.excerpt } : undefined,
    fallbackByline: provenance.label,
    fallbackBylineKind: provenance.kind,
    // The chip is the way back to the piece — and now that guides are sources
    // rather than containers, the only way in.
    fallbackBylineHref: provenance.href,
    // Reached only when the piece said nothing quotable about it.
    emptyNote: `${provenance.label}. Only you can see this.`,
    fallbackHref: privatePlaceHref(place.id),
    fallbackCoverHref: importedCoverHref(place.image_url),
    footer: `<div class="community-queue-bar community-queue-bar-single">
      <button class="community-queue-delete" type="button" data-imported-drop="${esc(place.id)}" ${
        busy ? 'disabled' : ''
      } aria-label="${esc(`Remove ${place.name} from your wishlist`)}">${
        busy ? 'Removing…' : 'Remove'
      }</button>
    </div>`,
  };
}

// NO `guideCardsMarkup`. The guide page renders through `boardCardsMarkup` like
// every other city surface — same rows, same card, same shell — so there is one
// place where a card's contents are decided.


/**
 * The import flow's own wiring: the paste, the review screen, and removal.
 *
 * ONE DELIBERATE DEPARTURE FROM RENDER-EVERYTHING. Ticking a checkbox does not
 * re-render. The rest of this module redraws the whole panel on every state
 * change, which is right for a form with four fields and wrong for a list of
 * thirty-eight: a redraw per tick throws away the scroll position, so a member
 * unchecking the places they do not want would be sent back to the top of the
 * list after each one. The draft is updated and the one thing that changed — the
 * count on the submit button — is patched in place instead. Same reason the
 * name and city fields update the draft on input without redrawing.
 */
/**
 * Where the member was inside the import dialogue, kept across its rebuilds.
 *
 * The dialogue is thrown away and rebuilt on every render, so without this the
 * browser has nothing to give focus back to and the code below hands it to the
 * heading — which took the caret out of the name field every time anything else
 * on the review screen moved. The member typing a name is the person we are
 * least entitled to interrupt: the name is the only part of a kept guide they
 * author.
 *
 * `stage` is read/review. Focus is placed by us exactly once per stage — on the
 * first open, and again when the read finishes and the review takes over, which
 * is a wait long enough that the answer has to arrive under the member's eyes.
 * Every other rebuild restores what they had.
 */
let importFocusStage = '';
let importFocusKey = '';
let importFocusCaret = -1;
let importListScroll = 0;

/** A selector that survives the rebuild, for the controls worth returning to. */
function importFocusKeyFor(element: Element | null): string {
  if (!(element instanceof HTMLElement)) return '';
  if (element instanceof HTMLInputElement && element.name) {
    return `input[name="${element.name}"]`;
  }
  const place = element.dataset.importPlace;
  if (place) return `[data-import-place="${place}"]`;
  const all = element.dataset.importAll;
  if (all !== undefined) return `[data-import-all="${all}"]`;
  if (element.hasAttribute('data-import-cancel')) return '[data-import-cancel]';
  if (element instanceof HTMLButtonElement && element.type === 'submit') {
    return '[data-import-keep] button[type="submit"]';
  }
  return '';
}

function bindGuides(root: HTMLElement, render: () => void): void {
  root.querySelector<HTMLButtonElement>('[data-import-open]')?.addEventListener('click', () => {
    openImportDialog(render);
  });

  const dialog = root.querySelector<HTMLDialogElement>('[data-import-dialog]');
  if (!dialog) {
    // Closed, so there is nothing to come back to. Cleared here rather than in
    // each of the three ways it closes.
    importFocusStage = '';
    importFocusKey = '';
    importFocusCaret = -1;
    importListScroll = 0;
  }
  if (dialog) {
    // Escape, and the backdrop click the browser turns into a cancel. Both mean
    // the same thing here and both are safe: nothing has been written, because
    // reading and keeping are separate calls.
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeImportDialog(render);
    });
    // One Cancel, bound on the dialogue rather than on either form: the button
    // appears in both states and means the same thing in both.
    dialog.querySelector<HTMLButtonElement>('[data-import-cancel]')?.addEventListener('click', () => {
      cancelImport(render);
    });
    // Remembered so the rebuild can put it back — see `importFocusKey`.
    dialog.addEventListener('focusin', () => {
      const key = importFocusKeyFor(document.activeElement);
      if (!key) return;
      importFocusKey = key;
      importFocusCaret = -1;
    });

    // The list is the only scroller in the sheet, and a rebuild would otherwise
    // send a member who was forty places down back to the top.
    const list = dialog.querySelector<HTMLElement>('.community-import-list');
    if (list) {
      if (importListScroll) list.scrollTop = importListScroll;
      list.addEventListener('scroll', () => {
        importListScroll = list.scrollTop;
      });
    }

    if (!dialog.open) {
      dialog.showModal();
      const stage = importDraft() ? 'review' : 'read';
      const held = importFocusKey
        ? dialog.querySelector<HTMLElement>(importFocusKey)
        : null;
      if (held) {
        held.focus({ preventScroll: true });
        if (importFocusCaret >= 0 && held instanceof HTMLInputElement) {
          held.setSelectionRange(importFocusCaret, importFocusCaret);
        }
      } else if (importFocusStage !== stage) {
        // Focus the field rather than the heading: the member pressed a button
        // called "Add a guide from a link" and the next thing they do is paste.
        // On the review screen there is no field to paste into, so the heading
        // takes it — the count of places is the answer they waited for.
        const field =
          dialog.querySelector<HTMLElement>('input[name="url"]') ||
          dialog.querySelector<HTMLElement>('#import-dialog-title');
        field?.focus({ preventScroll: true });
      }
      importFocusStage = stage;
    }
  }

  const readForm = root.querySelector<HTMLFormElement>('[data-import-read]');
  readForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const field = readForm.querySelector<HTMLInputElement>('input[name="url"]');
    const value = field?.value.trim() || '';
    if (!value) return;
    void readListLink(value, render);
  });

  const reviewForm = root.querySelector<HTMLFormElement>('[data-import-keep]');
  if (!reviewForm) return;

  const keepButton = reviewForm.querySelector<HTMLButtonElement>('button[type="submit"]');
  const syncKeepBar = (): void => {
    const draft = importDraft();
    if (!draft || !keepButton || importKeeping()) return;
    const chosen = draft.places.filter((place) => place.keep).length;
    keepButton.textContent = `Add ${chosen} to Wanna go`;
    keepButton.disabled = chosen === 0;
  };

  reviewForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void keepImportDraft(render);
  });

  // The caret rides along with the value: a rebuild mid-word must not drop the
  // member at the end of what they had already typed.
  reviewForm
    .querySelector<HTMLInputElement>('input[name="title"]')
    ?.addEventListener('input', (event) => {
      const field = event.currentTarget as HTMLInputElement;
      setDraftTitle(field.value);
      importFocusKey = 'input[name="title"]';
      importFocusCaret = field.selectionStart ?? -1;
    });
  reviewForm
    .querySelector<HTMLInputElement>('input[name="city"]')
    ?.addEventListener('input', (event) => {
      const field = event.currentTarget as HTMLInputElement;
      setDraftCity(field.value);
      importFocusKey = 'input[name="city"]';
      importFocusCaret = field.selectionStart ?? -1;
    });

  reviewForm.querySelectorAll<HTMLInputElement>('[data-import-place]').forEach((box) => {
    box.addEventListener('change', () => {
      const index = Number(box.dataset.importPlace);
      if (!Number.isInteger(index)) return;
      toggleDraftPlace(index, syncKeepBar);
    });
  });

  reviewForm.querySelectorAll<HTMLButtonElement>('[data-import-all]').forEach((button) => {
    button.addEventListener('click', () => {
      setAllDraftPlaces(Boolean(button.dataset.importAll), render);
    });
  });

}

/**
 * The remove-a-list dialogue, for a surface that renders it itself.
 *
 * The guide page is the only place that asks — it is the page about the list, so
 * it is where "remove this list" belongs — and it renders the same dialogue the
 * tab would, rather than a second one worded differently.
 */
export function guideRemovalDialogMarkup(): string {
  return removeGuideDialogMarkup();
}

/** Removal of a kept list, or of one place on one. Bound wherever they render. */
export function bindImportedRemoval(root: HTMLElement, render: () => void): void {
  root.querySelectorAll<HTMLButtonElement>('[data-guide-drop]').forEach((button) => {
    button.addEventListener('click', () => {
      // `data-guide-drop`, which is what the selector above matches. It read
      // `dataset.listDrop` — a name from an earlier spelling of this feature —
      // so every press found an empty id and returned silently.
      const id = button.dataset.guideDrop || '';
      if (!id || button.disabled) return;
      const list = guides().find((entry) => entry.id === id);
      if (!list) return;
      pendingGuideRemoval = {
        id,
        title: list.title,
        total: list.places.length,
        // Places another list also names survive whichever answer is given, so
        // the dialogue counts them out of the choice rather than into it.
        shared: list.places.filter((place) => place.guides.length > 1).length,
      };
      render();
    });
  });

  const listDialog = root.querySelector<HTMLDialogElement>('[data-guide-remove-dialog]');
  if (listDialog) {
    const close = () => {
      pendingGuideRemoval = null;
      render();
    };
    listDialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close();
    });
    listDialog.querySelector<HTMLButtonElement>('[data-guide-remove-cancel]')?.addEventListener('click', close);
    const answer = (places: 'keep' | 'remove') => () => {
      const pending = pendingGuideRemoval;
      if (!pending) return;
      void removeGuide(pending.id, places, () => {
        pendingGuideRemoval = null;
        render();
      });
    };
    listDialog
      .querySelector<HTMLButtonElement>('[data-guide-remove-keep]')
      ?.addEventListener('click', answer('keep'));
    listDialog
      .querySelector<HTMLButtonElement>('[data-guide-remove-confirm]')
      ?.addEventListener('click', answer('remove'));
    if (!listDialog.open) {
      listDialog.showModal();
      listDialog.querySelector<HTMLElement>('#remove-guide-title')?.focus({ preventScroll: true });
    }
  }
  root.querySelectorAll<HTMLButtonElement>('[data-imported-drop]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.importedDrop || '';
      if (!id || button.disabled) return;
      void removeImportedPlace(id, render);
    });
  });
}

onCommunityReset(() => {
  wannaGoCity = 'all';
  wannaGoSource = 'all';
  wannaGoShowAll.clear();
});

export function bindBoards(root: HTMLElement, render: () => void): void {
  // Removal from the member's own Wanna go list. No confirmation, in keeping
  // with the rest of the rung: it is private, reversible, and one tap put it
  // there in the first place.
  root.querySelectorAll<HTMLButtonElement>('[data-saved-drop]').forEach((button) => {
    button.addEventListener('click', () => {
      const venueId = button.dataset.savedDrop || '';
      if (!venueId || button.disabled) return;
      void toggleSavedPlace(venueId, 'place_page', render);
    });
  });

  bindGuides(root, render);
  // The tab's own navigation: destination and source filters, and the per-city
  // expand. All three are view state — they never touch what the member holds.
  root.querySelectorAll<HTMLButtonElement>('[data-wanna-city]').forEach((button) => {
    button.addEventListener('click', () => {
      const slug = button.dataset.wannaCity || 'all';
      if (wannaGoCity === slug) return;
      wannaGoCity = slug;
      // A city chosen on purpose shows everything in it; the cap is only for the
      // all-cities glance.
      wannaGoShowAll.clear();
      render();
    });
  });
  root.querySelector<HTMLSelectElement>('[data-wanna-source]')?.addEventListener('change', (event) => {
    const value = (event.currentTarget as HTMLSelectElement).value as WannaGoSource;
    wannaGoSource = SOURCE_FILTERS.some(([option]) => option === value) ? value : 'all';
    render();
  });
  root.querySelectorAll<HTMLButtonElement>('[data-wanna-show-all]').forEach((button) => {
    button.addEventListener('click', () => {
      const slug = button.dataset.wannaShowAll || '';
      if (!slug) return;
      wannaGoShowAll.add(slug);
      render();
    });
  });
  bindImportedRemoval(root, render);
}
