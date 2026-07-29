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
   * The derived publication answer: true only when a real member recommendation
   * stands behind this place and no curator has suppressed it. Computed once per
   * load in `loadLiveCatalogue`, which is the only place that knows whether the
   * member-signal route actually answered. Every public surface filters on it —
   * see `allVenues` in main.ts.
   */
  publiclyVisible?: boolean;
  /**
   * The server's own publication marker, as stored on the venue. Used only as the
   * degradation fallback when the member-signal route does not answer — never as
   * the primary reason a place is public. Prefer `publiclyVisible`.
   */
  publicationMarked?: boolean;
  /**
   * Distinct members who have recommended this place through the member loops.
   * Aggregate only — no identity attached. Private shares never contribute to
   * this figure. Absent when the backend predates the signals route or the
   * place has no recorded signals.
   */
  detouristCount?: number;
  /**
   * True when at least one distinct recommendation came from the founding
   * circle. This derived flag carries no member identity and is rendered only
   * on the place page.
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
 * Load the public catalogue. `venues` is the canonical place list and now carries
 * everything public about a place — its facts, its occasion tags, its publication
 * marker. There is no award join: Detour has one lane, and a place is on it
 * because a real member recommended it.
 */
export async function loadLiveCatalogue(): Promise<LiveCatalogue> {
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
    // Aggregate social proof: distinct members who recommended each venue,
    // keyed by venue id. Private shares are excluded. Purely additive —
    // tolerate backends without the route by falling back to no counts.
    pb
      .send<{ counts?: Record<string, unknown>; founding?: Record<string, unknown> }>(
        '/api/detour/place-detourists',
        { requestKey: null }
      )
      .then((payload) => ({
        counts: payload?.counts ?? {},
        founding: payload?.founding ?? {},
        // The signal answered, so an absent count genuinely means "no
        // recommender" and publication can be derived from it.
        available: true,
      }))
      .catch(() => ({
        counts: {} as Record<string, unknown>,
        founding: {} as Record<string, unknown>,
        // The signal did NOT answer. Publication must not be derived from an
        // empty payload — every count would read as zero and the whole public
        // catalogue would vanish on a transient route failure.
        available: false,
      })),
  ]);

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
      publicationMarked: record.published === true,
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
      // The contributing member is at least one signal even when the counts
      // route is unavailable or missed this identity.
      existing.detouristCount = Math.max(existing.detouristCount ?? 0, 1);
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
      // Contribution-only places have no catalogue venue record for the
      // counts route to key on; the contributing member is the one signal.
      detouristCount: 1,
    };
    venuesById.set(venue.id, venue);
    venueByIdentity.set(identityKey(venue.name, venue.city), venue);
  }

  // Attach aggregate member signals (distinct recommenders/sharers) to their
  // venues. Server counts win when larger — they dedupe across every loop.
  for (const venue of venuesById.values()) {
    const count = positiveInteger(detouristSignals.counts[venue.id]);
    if (count !== null) venue.detouristCount = Math.max(venue.detouristCount ?? 0, count);
    if (detouristSignals.founding[venue.id] === true) venue.foundingRecommended = true;
  }

  // Publication, derived.
  //
  // A place is public because a real member recommended it — nothing else. This
  // used to be *asserted* by the existence of a catalogue row while the reason a
  // place belonged here lived in `community_recommendations`, with nothing
  // keeping the two honest; a leftover guide-era venue could therefore sit on
  // the public list with no recommender behind it. Deriving it from the member
  // signal (which the server computes from real recommendations only, excluding
  // synthetic `.invalid` members) makes that state unrepresentable.
  //
  // Two deliberate carve-outs:
  //   - `suppressed` always wins: a curator takedown hides a place even though
  //     the recommendation behind it still stands.
  //   - When the signal route did not answer, fall back to the server's own
  //     publication marker instead of treating every count as zero. A transient
  //     failure must degrade to the previous behaviour, never blank the public
  //     catalogue.
  for (const venue of venuesById.values()) {
    const recommended = (venue.detouristCount ?? 0) > 0;
    venue.publiclyVisible = venue.suppressed
      ? false
      : detouristSignals.available
        ? recommended
        : recommended || venue.publicationMarked === true;
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
