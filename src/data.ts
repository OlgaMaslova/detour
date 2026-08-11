import { pb } from './pocketbase';
import { citySlug, venueCitySlug, venuePlaceSlug } from './slugs';
import type { CityBounds, CityMapSource } from './cities';
import { knownOccasions } from './occasions';
import type { Occasion } from './occasions';

export interface Venue {
  id: string;
  name: string;
  /** City the venue is in, and the route it is listed under. */
  city: string;
  /** Country as stored on the venue record; '' when unknown. */
  country: string;
  /** Stable venue category from the catalogue (e.g. 'Pizza', 'Coffee'); '' when unspecified. */
  category: string;
  neighborhood: string;
  address: string;
  /** Null when no verified coordinate exists — render as "location pending verification", never a fake pin. */
  lat: number | null;
  lng: number | null;
  approxLocation: boolean;
  /** Optional route metadata retained for compatibility with the city-scoped catalogue UI. */
  slug?: string;
  cityId?: string;
  citySlug?: string;
  /** Validated operator/social links. Only http/https URLs are retained. */
  officialUrl?: string;
  instagramUrl?: string;
  /** Optional detail content retained for compatibility with the existing UI contract. */
  description?: string;
  /**
   * The place's own cover, resolved by the enrichment sweeps from its website or
   * Instagram profile. Never a member's photograph: a member's picture belongs
   * to the recommendation they wrote, and this is only the fallback for a card
   * or hero whose fronting recommendation has no photo of its own.
   */
  imageUrl?: string;
  /**
   * A cover chosen by a founding member, as a root-relative API file path — pass
   * it through `recommendationPhotoHref` for the size a surface needs.
   *
   * Sits between a member's photo and the enrichment cover: a person's judgment
   * beats a scrape, and a member's own photograph of a place they recommended
   * beats both. It carries no member attribution on any public surface, which is
   * what separates it from a recommendation photo — it is the place's picture,
   * not anybody's.
   */
  curatedCover?: string;
  /**
   * Factual occasion tags. Owned by the venue record itself — a place has
   * outdoor seating whether or not a selection was published for it this year.
   * Still unioned with tags from approved contributions and, transitionally,
   * from current recognition records.
   */
  occasions?: Occasion[];
  /**
   * Curator takedown. Visibility is derived from real member recommendations, so
   * this is how a place is hidden while the recommendation behind it stands.
   * Suppressed places are excluded from every public surface.
   */
  suppressed?: boolean;
  /**
   * Whether publication has made this place public — the precondition for anyone
   * outside its recommenders' circles reading about it at all.
   *
   * Never a substitute for `visibleToCaller`, which is the caller's own list and
   * the only thing any browsing surface may filter on. Not a visitor's list
   * either: a visitor sees the places the founding circle recommends, which is a
   * subset of this. It is here for the one question that is not about the caller —
   * whether a stranger opening a link to this place would be shown it, which is
   * what decides whether a reader who cannot reach it through their own scope is
   * shown it too.
   */
  published?: boolean;
  /**
   * Whether this place is on *this caller's* list: true only when a member they
   * can see stands behind it and no curator has suppressed it.
   *
   * Not a property of the place. Two members legitimately disagree about it at
   * the same moment, because the recommendations behind a place are scoped to the
   * reader's circle. Computed once per load in `loadLiveCatalogue` from the
   * server's caller-scoped signal payload, and filtered on by every surface —
   * see `allVenues` in main.ts.
   */
  visibleToCaller?: boolean;
  /**
   * Members the caller can see who have recommended this place — the sum of
   * `circleCount` and `founderCount`. Aggregate only, no identity attached;
   * private shares never contribute to it. Absent when nobody the caller can see
   * recommended the place, which is also why the place is not on their list.
   *
   * Do not use this to say anything about the reader's circle. It counts both
   * reasons a recommender can be in reach, and only one of them is a relationship.
   */
  detouristCount?: number;
  /**
   * Recommenders reached through the caller's invitation graph: their inviter,
   * their invitees, one hop out, and themselves. These are the people who are
   * genuinely in the reader's circle, and the only ones any surface may describe
   * that way.
   */
  circleCount?: number;
  /**
   * Recommenders reached only because they are founding members. Visible to every
   * member at any distance, and therefore in nobody's circle — a place with
   * `circleCount: 0` and `founderCount: 2` is on the reader's list without one
   * person they know standing behind it, and the copy has to say so.
   */
  founderCount?: number;
  /**
   * Every distinct member who has recommended this place, in any circle.
   *
   * The one member-authored figure that is not scoped, and a deliberate carve-out:
   * a place carries more weight when you can see that people beyond your own
   * circle back it too. It is safe only because the server sends it exclusively
   * for places the caller can already see — it can never reveal that a place
   * exists — and because it is a bare count. The notes, names, dates and photos
   * behind the difference between this and `detouristCount` stay invisible.
   */
  detouristTotal?: number;
  /**
   * True when at least one of those distinct recommendations came from the
   * founding circle. Carries no member identity and is rendered only on the
   * place page.
   */
  foundingRecommended?: boolean;
  /**
   * Been & loved: every member who went here on somebody's recommendation and
   * would send you too, in any circle.
   *
   * The same carve-out as `detouristTotal`, for the same reason and with the same
   * guard — a global fact about the place, served only for places the caller can
   * already see. It is corroboration, never authorship: it does not publish a
   * place, does not feed `detouristCount`, and never decides what is visible.
   */
  endorsementTotal?: number;
  /**
   * The endorsers this caller may see, each carrying the clause that put them in
   * reach. Fewer than `endorsementTotal`, often none — a caller who can see the
   * place but none of the members who marked it gets the count and no names, and
   * that is the correct outcome rather than a degraded one.
   */
  endorsements?: PlaceEndorser[];
  /** Whether the caller is one of them. Drives the button's pressed state. */
  endorsedByCaller?: boolean;
}

/** One member who has been and loved a place, as the caller may see them. */
export interface PlaceEndorser {
  /** The pseudo — members have one name on Detour. */
  name: string;
  /**
   * True when the invitation graph put them in reach. False means they are
   * visible only as a founding member, which is in nobody's circle in
   * particular; the copy has to say so, and must never reach for "your circle"
   * to describe them.
   */
  inGraph: boolean;
  /** The caller themself. */
  isOwn: boolean;
}

export interface LiveCity extends CityMapSource {
  id: string;
  /**
   * True when this city is backed by a real `cities` record. Cities derived
   * only from venue city-name strings join venues to a route but are never
   * offered in the chooser — a typo in one venue row must not publish a city.
   */
  hasRecord: boolean;
}

export interface LiveCatalogue {
  cities: LiveCity[];
  venues: Venue[];
}

type VenueRecord = Record<string, unknown> & {
  id: string;
  name?: string;
  city?: string;
  country?: string;
  address?: string;
  lat?: number | string;
  lng?: number | string;
  category?: string;
  official_url?: string;
  instagram_url?: string;
  image_url?: string;
  approx_location?: boolean;
  /**
   * Occasion tags now live on the venue: they are place facts, not properties of
   * a publication event. Publication unions the recommending members' tags onto
   * the venue (see mergeEntryOccasionsIntoVenue in pb_hooks/community_waitlist.js).
   */
  occasions?: string[];
  /**
   * Curator takedown. Visibility is derived from real member recommendations, so
   * corrections and rights concerns need a way to hide a place while the
   * recommendation behind it still stands. Set and cleared only by the curation
   * routes; a later member recommendation never undoes it.
   */
  suppressed?: boolean;
  /**
   * Publication marker, written by the publication paths in pb_hooks. A durable
   * cache of a derived fact, not a competing source of truth — it exists so the
   * server has a work-list for the enrichment sweeps, and so this client can
   * degrade rather than blank the catalogue when the member-signal route fails.
   */
  published?: boolean;
};

type MemberContributionRecord = Record<string, unknown> & {
  id: string;
  place_name?: string;
  city?: string;
  country?: string;
  address?: string;
  category?: string;
  occasions?: string[];
  status?: string;
};

type CityRecord = Record<string, unknown> & {
  id: string;
  name?: string;
  slug?: string;
  country?: string;
  presentation?: string;
  center_lat?: number | string;
  center_lng?: number | string;
  zoom?: number | string;
  bounds_lat_min?: number | string;
  bounds_lat_max?: number | string;
  bounds_lng_min?: number | string;
  bounds_lng_max?: number | string;
};

const LIST_RANK_RE = /\bNo\.\s*(\d+)\b/i;

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Keep only absolute http/https links from live catalogue fields. */
function cleanExternalUrl(value: unknown): string {
  const raw = cleanString(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

function contributionCategory(value: unknown): string {
  const category = cleanString(value);
  const labels: Record<string, string> = {
    restaurant: 'Restaurant',
    ethnic_cuisine: 'Ethnic cuisine',
    cafe: 'Café',
    bakery: 'Bakery',
    bar: 'Bar',
    cocktail_bar: 'Cocktail bar',
    wine_bar: 'Wine bar',
    brewery: 'Brewery',
    food_market: 'Food market',
    deli: 'Deli',
    dessert_shop: 'Dessert shop',
    ice_cream: 'Ice cream',
    takeaway: 'Takeaway',
    other: 'Other',
  };
  return labels[category] ?? category;
}

/**
 * The key two records have to agree on to be the same place.
 *
 * The qualifier is part of it because a name and a city are no longer unique:
 * two places can share both, told apart by the street or neighbourhood a member
 * supplied. Leaving it out here would silently collapse them back into one on the
 * client, which is the exact failure the server-side key was widened to fix.
 */
function identityKey(name: string, city: string, disambiguator = ''): string {
  return `${citySlug(city)}::${citySlug(name)}::${citySlug(disambiguator)}`;
}

/**
 * The API path for a venue's curated cover file, or undefined.
 *
 * Root-relative on purpose, exactly as recommendation photos are: the PocketBase
 * API and the static frontend sit on different origins, and the path is resolved
 * against the configured API base — with the thumb size appended — by whichever
 * surface renders it.
 */
function curatedCoverPath(venueId: string, fileName: unknown): string | undefined {
  const file = cleanString(fileName);
  if (!venueId || !file) return undefined;
  return `/api/files/venues/${encodeURIComponent(venueId)}/${encodeURIComponent(file)}`;
}

/** How many tinted treatments the generated cover cycles through. */
const COVER_TINTS = 6;

/**
 * Which generated treatment a place gets when it has no photograph at all.
 *
 * Derived from the place's own identity so it is stable: the same place keeps the
 * same cover across sessions, devices and re-renders, which is what stops a wall
 * of coverless cards reading as a loading state. Two places differ because their
 * names differ, not because of where they happen to sit in a list.
 */
export function coverTint(name: string, city: string): number {
  const seed = `${name}${city}`;
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 100000;
  }
  return hash % COVER_TINTS;
}

function mergeOccasions(...groups: Array<readonly Occasion[] | undefined>): Occasion[] {
  return [...new Set(groups.flatMap((group) => group ?? []))];
}

function cleanNumber(value: unknown): number | null {
  const number = typeof value === 'string' ? Number.parseFloat(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
}

function positiveInteger(value: unknown): number | null {
  const number = cleanNumber(value);
  return number !== null && Number.isInteger(number) && number > 0 ? number : null;
}

/**
 * The endorsers the server named for one place.
 *
 * Tolerant by construction: a row without a name is dropped rather than rendered
 * blank, and the clause defaults to *not* in the graph. That default matters —
 * guessing "in your circle" from a missing flag is the exact bug the two-clause
 * split exists to prevent, and the safe guess is the one that claims less.
 */
function readEndorsers(value: unknown): PlaceEndorser[] {
  if (!Array.isArray(value)) return [];
  const endorsers: PlaceEndorser[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const name = cleanString(row.name).replace(/^@+/, '');
    if (!name) continue;
    endorsers.push({ name, inGraph: row.in_graph === true, isOwn: row.is_own === true });
  }
  return endorsers;
}

/**
 * The place-to-URL slugs live in `./slugs`, which imports nothing: the preview
 * Worker resolves `?d=` and `?p=` with the same three functions this module and
 * main.ts use, and it cannot pull in the PocketBase client to get at them. They
 * are re-exported here because every caller in the app already asks data.ts for
 * them, and where a slug comes from is not worth a churn of imports.
 */
export { citySlug, venueCitySlug, venuePlaceSlug };

/** The venue fields every read of the catalogue asks for, member or public. */
const VENUE_FIELDS =
  'id,name,city,country,address,disambiguator,lat,lng,category,official_url,instagram_url,image_url,curated_cover,approx_location,occasions,suppressed,published';

/** What a venue needs from its city: the route it is listed under, and a country. */
type VenueCity = Pick<LiveCity, 'id' | 'slug' | 'country'>;

/**
 * The `cities` records, keyed by lowercased name — the authority on which cities
 * exist and how they present.
 *
 * Shared by the member catalogue and the public single-place read so a place is
 * listed under the same route either way: a city record's own slug can differ
 * from the one derived from its name, and a visitor's URL for a place has to be
 * the member's URL for the same place.
 */
function citiesFromRecords(cityRecords: CityRecord[]): Map<string, LiveCity> {
  const citiesByName = new Map<string, LiveCity>();
  for (const record of cityRecords) {
    const name = cleanString(record.name);
    const slug = cleanString(record.slug).toLowerCase() || citySlug(name);
    if (!name || !slug) continue;
    const key = name.toLowerCase();
    if (citiesByName.has(key)) continue;

    const centerLat = cleanNumber(record.center_lat);
    const centerLng = cleanNumber(record.center_lng);
    const zoom = cleanNumber(record.zoom);
    const latMin = cleanNumber(record.bounds_lat_min);
    const latMax = cleanNumber(record.bounds_lat_max);
    const lngMin = cleanNumber(record.bounds_lng_min);
    const lngMax = cleanNumber(record.bounds_lng_max);
    // A 0/0 centre is the catalogue's non-location sentinel — never a view.
    const center: [number, number] | null =
      centerLat !== null && centerLng !== null && !(centerLat === 0 && centerLng === 0)
        ? [centerLat, centerLng]
        : null;
    const bounds: CityBounds | null =
      latMin !== null && latMax !== null && lngMin !== null && lngMax !== null && latMin < latMax && lngMin < lngMax
        ? { latMin, latMax, lngMin, lngMax }
        : null;

    citiesByName.set(key, {
      id: record.id,
      hasRecord: true,
      name,
      slug,
      country: cleanString(record.country),
      presentation: cleanString(record.presentation),
      center,
      zoom,
      bounds,
    });
  }
  return citiesByName;
}

/**
 * One venue record as the app's Venue, or null when the row is too incomplete to
 * route (no id, no name, no city).
 *
 * Carries no visibility and no counts. Those are per-caller facts the server
 * answers separately, so this function cannot accidentally assert that a place is
 * on somebody's list.
 */
function venueFromRecord(record: VenueRecord, city: VenueCity): Venue | null {
  const id = cleanString(record.id);
  const name = cleanString(record.name);
  const cityName = cleanString(record.city);
  if (!id || !name || !cityName) return null;

  const rawLat = cleanNumber(record.lat);
  const rawLng = cleanNumber(record.lng);
  const hasCoordinates = rawLat !== null && rawLng !== null && !(rawLat === 0 && rawLng === 0);

  return {
    id,
    name,
    cityId: city.id,
    citySlug: city.slug,
    city: cityName,
    country: cleanString(record.country) || city.country,
    category: cleanString(record.category),
    // The qualifier that tells this place from another of the same name in the
    // same city. It reads as the place's locality wherever a neighborhood would
    // have — "Toma Café · Calle de la Palma" — and is empty for almost every
    // place, since it is only ever asked for after a name collision.
    neighborhood: cleanString(record.disambiguator),
    address: cleanString(record.address),
    lat: hasCoordinates ? rawLat : null,
    lng: hasCoordinates ? rawLng : null,
    approxLocation: record.approx_location === true,
    officialUrl: cleanExternalUrl(record.official_url) || undefined,
    instagramUrl: cleanExternalUrl(record.instagram_url) || undefined,
    imageUrl: cleanExternalUrl(record.image_url) || undefined,
    curatedCover: curatedCoverPath(id, record.curated_cover),
    // The venue owns its occasion tags. Award records are still merged by the
    // catalogue load for backends that predate the move, but this is the authority.
    occasions: knownOccasions(record.occasions),
    suppressed: record.suppressed === true,
    // Asked for by both reads, and until now dropped on the floor by this one.
    // The member read carries no filter — it has to, since visibility is computed
    // from recommenders rather than from this flag — so this is the only thing
    // that says which of those rows a visitor would have been shown. main.ts needs
    // that to open a shared link to a place outside the caller's own circle.
    published: record.published === true,
  };
}

/**
 * The caller-scoped signal payload: who each place reaches, and how many of them.
 * `/api/detour/place-detourists` answers a member with `scope: "circle"` and a
 * visitor with `scope: "founding"`, and the marker is load-bearing — see the
 * refusals in both loaders below.
 */
interface PlaceSignalPayload {
  scope?: string;
  counts?: Record<string, unknown>;
  circle?: Record<string, unknown>;
  founders?: Record<string, unknown>;
  totals?: Record<string, unknown>;
  founding?: Record<string, unknown>;
  endorsements?: {
    totals?: Record<string, unknown>;
    names?: Record<string, unknown>;
    own?: Record<string, unknown>;
  };
}

/**
 * Attach the caller's scoped signal to each candidate: how many members they can
 * see recommended it, whether any of those was a founding member, and the place's
 * total across every circle. Then derive visibility from it.
 *
 * Shared by both loaders because the derivation must not fork. A place is on your
 * list because a member you can see recommended it — nothing else puts it there,
 * not the server's publication marker, not the existence of a catalogue row, not a
 * share someone sent you. A visitor differs only in who "a member you can see"
 * means: the founding circle, and nobody else. That difference is entirely the
 * server's to make, and it is already made by the time the payload arrives.
 *
 * Recomputed on every load rather than remembered against the venue, so a member
 * who joins your circle tomorrow brings their places with them and no card
 * silently stops updating.
 *
 * One carve-out: `suppressed` always wins. A curator takedown hides a place from
 * everyone, in every circle, even though the recommendation behind it still stands.
 */
function attachPlaceSignals(venues: Iterable<Venue>, signals: PlaceSignalPayload): void {
  const signalCounts = signals.counts ?? {};
  const signalCircle = signals.circle ?? {};
  const signalFounders = signals.founders ?? {};
  const signalTotals = signals.totals ?? {};
  const signalFounding = signals.founding ?? {};
  // Absent on a backend that predates Been & loved. No marks is the honest
  // reading of that, and the surfaces render nothing rather than a zero.
  const endorsementTotals = signals.endorsements?.totals ?? {};
  const endorsementNames = signals.endorsements?.names ?? {};
  const endorsementOwn = signals.endorsements?.own ?? {};

  for (const venue of venues) {
    const count = positiveInteger(signalCounts[venue.id]);
    if (count !== null) venue.detouristCount = count;
    // Split by the reason each recommender is in reach. Kept as two separate
    // figures all the way to the copy, so no surface has to infer "in your circle"
    // from "visible to you" — those are different claims and only one of them is
    // about a relationship. A visitor's `circle` is always empty, which is what
    // stops a public page describing a founding member as someone they know.
    venue.circleCount = positiveInteger(signalCircle[venue.id]) ?? 0;
    venue.founderCount = positiveInteger(signalFounders[venue.id]) ?? 0;
    // The total is clamped to at least the scoped count. The server derives both
    // from one deduplicated pass so they cannot disagree, but a total lower than
    // the number of notes a member can actually read would be visibly wrong, and
    // silently wrong is worse than absent.
    const total = positiveInteger(signalTotals[venue.id]);
    if (total !== null) venue.detouristTotal = Math.max(total, venue.detouristCount ?? 0);
    if (signalFounding[venue.id] === true) venue.foundingRecommended = true;

    // Been & loved, on the same terms: a global count, and only the names this
    // caller may see. Clamped to at least the number of names, so the line can
    // never name more people than the figure beside it admits to.
    const endorsers = readEndorsers(endorsementNames[venue.id]);
    const endorsed = positiveInteger(endorsementTotals[venue.id]) ?? 0;
    if (endorsers.length) venue.endorsements = endorsers;
    // Never fewer than the names beside it: a line that names three people under
    // the figure 2 is visibly wrong, and silently wrong is worse than absent.
    const endorsedTotal = Math.max(endorsed, endorsers.length);
    if (endorsedTotal > 0) venue.endorsementTotal = endorsedTotal;
    if (endorsementOwn[venue.id] === true) venue.endorsedByCaller = true;

    venue.visibleToCaller = venue.suppressed ? false : (venue.detouristCount ?? 0) > 0;
  }
}

/**
 * The catalogue a signed-out visitor is served: the places the founding circle
 * recommends.
 *
 * A visitor has no invitation graph, so there is no relational list to compute —
 * but there is still a list, and it is the one tier that already reaches every
 * member at any distance. The founding circle is a visitor's circle. That is what
 * makes the whole app browsable without a session: Explore, the city pages, the
 * map, the feed and the place pages all read `visibleToCaller` and none of them
 * needs to know whether a session produced it.
 *
 * Two boundaries, and both are enforced by the server. `published` filters the
 * venue read, so nothing publication has not made public is even a candidate. Then
 * `/api/detour/place-detourists` decides which of those candidates a founding
 * member actually stands behind, and a candidate with none is dropped by
 * `attachPlaceSignals` exactly as it is for a member.
 *
 * The signal request is deliberately not caught, for the same reason the member
 * path does not catch it: falling back to "everything the server ever published"
 * would answer a visitor entitled to the founding circle's places with the whole
 * catalogue. A rejection here fails the load, the app enters its error state, and
 * the reader retries.
 */
async function loadPublicCatalogue(): Promise<LiveCatalogue> {
  const [venueRecords, cityRecords, signals] = await Promise.all([
    pb.collection('venues').getFullList<VenueRecord>({
      filter: 'published = true && suppressed != true',
      fields: VENUE_FIELDS,
      sort: 'city,name',
      requestKey: null,
    }),
    // Same tolerance as the member catalogue: no city records means venues still
    // join their route by name.
    pb
      .collection('cities')
      .getFullList<CityRecord>({ sort: 'name', requestKey: null })
      .catch(() => [] as CityRecord[]),
    pb.send<PlaceSignalPayload>('/api/detour/place-detourists', { requestKey: null }),
  ]);

  // A payload that came back scoped to somebody's circle was answered for a
  // session this caller does not have. Refuse it rather than render a list
  // derived from a scope nobody asked for.
  if (signals?.scope !== 'founding') {
    throw new Error('The place-visibility route did not answer with a founding-scoped payload.');
  }

  const citiesByName = citiesFromRecords(cityRecords);
  const venues: Venue[] = [];
  for (const record of venueRecords) {
    const cityName = cleanString(record.city);
    const slug = citySlug(cityName);
    if (!slug) continue;
    const city = citiesByName.get(cityName.toLowerCase()) ?? {
      id: `legacy-city-${slug}`,
      hasRecord: false,
      name: cityName,
      slug,
      country: cleanString(record.country),
    };
    if (!citiesByName.has(cityName.toLowerCase())) citiesByName.set(cityName.toLowerCase(), city);
    const venue = venueFromRecord(record, city);
    if (!venue) continue;
    venues.push(venue);
  }

  attachPlaceSignals(venues, signals);

  const cities = [...citiesByName.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { cities, venues };
}

/**
 * Load the caller's catalogue.
 *
 * `venues` carries everything global about a place — its identity, address,
 * coordinates, links, category, occasion tags, enrichment cover. What is *not*
 * global is whether a place is on your list: that follows from the members who
 * recommended it, and those are scoped to your circle plus the founding circle.
 * So the venue rows are only candidates. `/api/detour/place-detourists` decides
 * which of them you can actually see, and a candidate with no visible
 * recommender is dropped entirely below.
 *
 * A signed-out visitor has no invitation graph, so their scoped list is computed
 * from the one tier that reaches everybody: see `loadPublicCatalogue`. Same route,
 * same derivation, different scope.
 */
export async function loadLiveCatalogue(): Promise<LiveCatalogue> {
  if (!pb.authStore.isValid || !pb.authStore.record) {
    return loadPublicCatalogue();
  }

  const [venueRecords, cityRecords, contributionRecords, detouristSignals] = await Promise.all([
    pb.collection('venues').getFullList<VenueRecord>({
      fields: VENUE_FIELDS,
      sort: 'city,name',
      requestKey: null,
    }),
    // The `cities` collection is the authority on which cities exist and how
    // they present. Tolerate a backend that predates it so the catalogue
    // still renders (no city records → no chooser entries, venues keep
    // joining by name).
    pb
      .collection('cities')
      .getFullList<CityRecord>({ sort: 'name', requestKey: null })
      .catch(() => [] as CityRecord[]),
    // Approved member contributions are a public, optional discovery lane.
    // Query only the safe public fields and tolerate older backends where the
    // collection does not exist or is temporarily unavailable.
    pb
      .collection('member_place_contributions')
      .getFullList<MemberContributionRecord>({
        filter: "status = 'approved'",
        fields: 'id,place_name,city,country,address,disambiguator,category,occasions,status',
        sort: 'city,place_name',
        requestKey: null,
      })
      .catch(() => [] as MemberContributionRecord[]),
    // The visibility boundary: how many members the caller can see recommended
    // each venue, keyed by venue id. Private shares are excluded.
    //
    // Deliberately not caught. This used to degrade to the server's `published`
    // marker so a transient failure could not blank the catalogue, which was the
    // right trade while the list was the same for everyone. It is the wrong trade
    // now: the fallback would answer "every place a member ever published"
    // to a caller entitled to a fraction of it, turning one failed request into a
    // catalogue-wide visibility breach. A rejection here fails the whole load, the
    // app enters its error state, and the member retries.
    pb.send<PlaceSignalPayload>('/api/detour/place-detourists', { requestKey: null }),
  ]);

  // A payload without the scope marker came from a backend that predates
  // circle-scoped visibility and would be answering globally. `founding` is the
  // visitor's answer and would be a fraction of this caller's list. Refuse either
  // rather than render a scope nobody asked for.
  if (detouristSignals?.scope !== 'circle') {
    throw new Error('The place-visibility route did not answer with a circle-scoped payload.');
  }

  const citiesByName = citiesFromRecords(cityRecords);

  for (const record of [...venueRecords, ...contributionRecords]) {
    if ('status' in record && cleanString(record.status) !== 'approved') continue;
    // Every place routes by its own city — venues and contributions alike.
    const name = cleanString(record.city);
    if (!name) continue;
    const key = name.toLowerCase();
    const country = cleanString(record.country);
    const existing = citiesByName.get(key);
    if (existing) {
      if (!existing.country && country) existing.country = country;
      continue;
    }
    const slug = citySlug(name);
    if (!slug) continue;
    citiesByName.set(key, {
      id: `legacy-city-${slug}`,
      hasRecord: false,
      name,
      slug,
      country,
    });
  }

  const venuesById = new Map<string, Venue>();
  for (const record of venueRecords) {
    const city = citiesByName.get(cleanString(record.city).toLowerCase());
    if (!city) continue;
    const venue = venueFromRecord(record, city);
    if (venue) venuesById.set(venue.id, venue);
  }

  const venueByIdentity = new Map<string, Venue>();
  for (const venue of venuesById.values()) {
    venueByIdentity.set(identityKey(venue.name, venue.city, venue.neighborhood), venue);
  }

  for (const record of contributionRecords) {
    if (cleanString(record.status) !== 'approved') continue;
    const id = cleanString(record.id);
    const name = cleanString(record.place_name);
    const cityName = cleanString(record.city);
    const city = citiesByName.get(cityName.toLowerCase());
    if (!id || !name || !city) continue;

    const occasions = knownOccasions(record.occasions);
    const disambiguator = cleanString(record.disambiguator);
    const existing = venueByIdentity.get(identityKey(name, city.name, disambiguator));
    if (existing) {
      // No count is asserted here. A contribution is one member's recommendation,
      // so whether it counts for this caller is a scoping question, and only the
      // server can answer it — see the scoped payload below.
      existing.occasions = mergeOccasions(existing.occasions, occasions);
      if (!existing.country) existing.country = cleanString(record.country) || city.country;
      if (!existing.address) existing.address = cleanString(record.address);
      if (!existing.category) existing.category = contributionCategory(record.category);
      continue;
    }

    const venue: Venue = {
      id: `member-contribution-${id}`,
      name,
      cityId: city.id,
      citySlug: city.slug,
      city: city.name,
      country: cleanString(record.country) || city.country,
      category: contributionCategory(record.category),
      neighborhood: disambiguator,
      address: cleanString(record.address),
      lat: null,
      lng: null,
      approxLocation: false,
      occasions,
      // Contribution-only places have no catalogue venue row, so the scoped
      // payload keys them by `member-contribution-<id>` instead. No count is
      // assumed here either.
    };
    venuesById.set(venue.id, venue);
    venueByIdentity.set(identityKey(venue.name, venue.city), venue);
  }

  // Signals, then visibility — the same derivation a visitor gets, differing only
  // in which payload the server answered with.
  attachPlaceSignals(venuesById.values(), detouristSignals);

  const cities = [...citiesByName.values()].sort((a, b) => a.name.localeCompare(b.name));
  const venues = [...venuesById.values()]
    .sort(
      (a, b) =>
        a.city.localeCompare(b.city) ||
        a.name.localeCompare(b.name)
    );

  return { cities, venues };
}
