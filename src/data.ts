import { pb } from './pocketbase';
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

function identityKey(name: string, city: string): string {
  return `${citySlug(city)}::${citySlug(name)}`;
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

export function citySlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Route slug of the city a venue is listed under (e.g. 'san-francisco'). */
export function venueCitySlug(v: Venue): string {
  return v.citySlug || citySlug(v.city);
}

/**
 * Readable slug identifying one place inside its city route, so every place
 * page has a shareable URL. Two places in the same city can normalise to the
 * same name slug (two 'Bar Basque'); the venue id disambiguates only those, and
 * a place whose name yields no slug at all falls back to the id outright.
 */
export function venuePlaceSlug(v: Venue, all: Venue[]): string {
  const base = citySlug(v.name);
  if (!base) return v.id;
  const city = venueCitySlug(v);
  const clash = all.some(
    (other) => other.id !== v.id && venueCitySlug(other) === city && citySlug(other.name) === base
  );
  return clash ? `${base}-${v.id}` : base;
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
 * A signed-out visitor has no circle, so they have no list. They are not shown a
 * degraded or partial catalogue — they are shown none of it, and the landing page
 * speaks for the founding circle through its own route instead.
 */
export async function loadLiveCatalogue(): Promise<LiveCatalogue> {
  if (!pb.authStore.isValid || !pb.authStore.record) {
    return { cities: [], venues: [] };
  }

  const [venueRecords, cityRecords, contributionRecords, detouristSignals] = await Promise.all([
    pb.collection('venues').getFullList<VenueRecord>({
      fields: 'id,name,city,country,address,lat,lng,category,official_url,instagram_url,image_url,approx_location,occasions,suppressed,published',
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
        fields: 'id,place_name,city,country,address,category,occasions,status',
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
    pb.send<{
      scope?: string;
      counts?: Record<string, unknown>;
      circle?: Record<string, unknown>;
      founders?: Record<string, unknown>;
      totals?: Record<string, unknown>;
      founding?: Record<string, unknown>;
    }>('/api/detour/place-detourists', { requestKey: null }),
  ]);

  // A payload without the scope marker came from a backend that predates
  // circle-scoped visibility and would be answering globally. Refuse it rather
  // than render another circle's places.
  if (detouristSignals?.scope !== 'circle') {
    throw new Error('The place-visibility route did not answer with a circle-scoped payload.');
  }
  const signalCounts = detouristSignals.counts ?? {};
  const signalCircle = detouristSignals.circle ?? {};
  const signalFounders = detouristSignals.founders ?? {};
  const signalTotals = detouristSignals.totals ?? {};
  const signalFounding = detouristSignals.founding ?? {};

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
    const id = cleanString(record.id);
    const name = cleanString(record.name);
    const cityName = cleanString(record.city);
    const city = citiesByName.get(cityName.toLowerCase());
    if (!id || !name || !cityName || !city) continue;

    const rawLat = cleanNumber(record.lat);
    const rawLng = cleanNumber(record.lng);
    const hasCoordinates =
      rawLat !== null && rawLng !== null && !(rawLat === 0 && rawLng === 0);

    venuesById.set(id, {
      id,
      name,
      cityId: city.id,
      citySlug: city.slug,
      city: cityName,
      country: cleanString(record.country) || city.country,
      category: cleanString(record.category),
      neighborhood: '',
      address: cleanString(record.address),
      lat: hasCoordinates ? rawLat : null,
      lng: hasCoordinates ? rawLng : null,
      approxLocation: record.approx_location === true,
      officialUrl: cleanExternalUrl(record.official_url) || undefined,
      instagramUrl: cleanExternalUrl(record.instagram_url) || undefined,
      imageUrl: cleanExternalUrl(record.image_url) || undefined,
      // The venue owns its occasion tags. Award records are still merged below
      // for backends that predate the move, but this is the authority.
      occasions: knownOccasions(record.occasions),
      suppressed: record.suppressed === true,
    });
  }

  const venueByIdentity = new Map<string, Venue>();
  for (const venue of venuesById.values()) {
    venueByIdentity.set(identityKey(venue.name, venue.city), venue);
  }

  for (const record of contributionRecords) {
    if (cleanString(record.status) !== 'approved') continue;
    const id = cleanString(record.id);
    const name = cleanString(record.place_name);
    const cityName = cleanString(record.city);
    const city = citiesByName.get(cityName.toLowerCase());
    if (!id || !name || !city) continue;

    const occasions = knownOccasions(record.occasions);
    const existing = venueByIdentity.get(identityKey(name, city.name));
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
      neighborhood: '',
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

  // Attach the caller's scoped signal to each candidate: how many members they
  // can see recommended it, whether any of those was a founding member, and the
  // place's total across every circle.
  //
  // The total is clamped to at least the scoped count. The server derives both
  // from one deduplicated pass so they cannot disagree, but a total lower than
  // the number of notes a member can actually read would be visibly wrong, and
  // silently wrong is worse than absent.
  for (const venue of venuesById.values()) {
    const count = positiveInteger(signalCounts[venue.id]);
    if (count !== null) venue.detouristCount = count;
    // Split by the reason each recommender is in reach. Kept as two separate
    // figures all the way to the copy, so no surface has to infer "in your circle"
    // from "visible to you" — those are different claims and only one of them is
    // about a relationship.
    venue.circleCount = positiveInteger(signalCircle[venue.id]) ?? 0;
    venue.founderCount = positiveInteger(signalFounders[venue.id]) ?? 0;
    const total = positiveInteger(signalTotals[venue.id]);
    if (total !== null) venue.detouristTotal = Math.max(total, venue.detouristCount ?? 0);
    if (signalFounding[venue.id] === true) venue.foundingRecommended = true;
  }

  // Visibility, derived — per caller, at read time, never stored.
  //
  // A place is on your list because a member you can see recommended it. Nothing
  // else puts it there: not the server's publication marker, not the existence of
  // a catalogue row, not a share someone sent you. That makes two states
  // unrepresentable — a place with no recommender behind it, and a place whose
  // only recommenders are outside your circle.
  //
  // Recomputed on every load rather than remembered against the venue, so a
  // member who joins your circle tomorrow brings their places with them and no
  // card silently stops updating.
  //
  // One carve-out: `suppressed` always wins. A curator takedown hides a place
  // from everyone, in every circle, even though the recommendation behind it
  // still stands.
  for (const venue of venuesById.values()) {
    venue.visibleToCaller = venue.suppressed ? false : (venue.detouristCount ?? 0) > 0;
  }

  const cities = [...citiesByName.values()].sort((a, b) => a.name.localeCompare(b.name));
  const venues = [...venuesById.values()]
    .sort(
      (a, b) =>
        a.city.localeCompare(b.city) ||
        a.name.localeCompare(b.name)
    );

  return { cities, venues };
}
