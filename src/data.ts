import { pb } from './pocketbase';
import type { CityBounds, CityEditorialSource } from './cities';
import { knownOccasions } from './occasions';
import type { Occasion } from './occasions';

export type AwardLevel = 1 | 2 | 3;

/** One published recognition held by a venue, with its own source attribution. */
export interface VenueAward {
  /** Literal award-level label exactly as published by the guide, e.g. '1 Sol', '3 Soles', '2 Stars'. */
  awardLevel: string;
  /**
   * Numeric star/sole count parsed from a level-style label (1–3), used only
   * for ordering/styling. Always null for ranked-list awards — a list position
   * is never a star count.
   */
  awardRank: number | null;
  /**
   * Position on an ordered ranking list (e.g. 2 for 'No. 2') when the source
   * publishes one; taken from the backend's explicit rank field when present.
   * Null for level awards (Stars/Soles).
   */
  listRank: number | null;
  /** Exact edition/list name for ranked awards, e.g. '50 Top Pizza Europa 2026'; '' for level awards. */
  edition: string;
  awardYear: number;
  sourceName: string;
  sourceUrl: string;
  note: string;
  /** True when this entry adapts a public `places.source_badges` value rather than a graded award. */
  sourceBadge?: boolean;
  /** Factual occasion tags stored on this recognition record. */
  occasions?: Occasion[];
}

export interface Venue {
  id: string;
  name: string;
  /** Physical city/locality as stored on the venue record (e.g. 'Oakland'); always used for display. */
  city: string;
  /** Route market name. Falls back to `city` when the backend has no explicit market. */
  market: string;
  /** Stable route slug derived from the route market (e.g. 'san-francisco'). */
  marketSlug: string;
  /** Country as stored on the venue record; '' when unknown. */
  country: string;
  /** Every current recognition for this canonical venue, one entry per attributed source. */
  awards: VenueAward[];
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
  marketId?: string;
  cityId?: string;
  citySlug?: string;
  /** Validated operator/social links. Only http/https URLs are retained. */
  officialUrl?: string;
  instagramUrl?: string;
  /** Optional detail content retained for compatibility with the existing UI contract. */
  description?: string;
  sourceBadges?: string[];
  imageUrl?: string;
  /** Factual occasion tags aggregated from public recognition and approved contribution records. */
  occasions?: Occasion[];
  /**
   * True when the place is on the Detourist List — Detour's single
   * member-recommended lane. Set by approved member contributions and by
   * Detour-originated recognition records, which are folded into this lane
   * rather than shown as awards.
   */
  detouristList?: boolean;
  /**
   * Distinct members who have recommended this place through the member loops.
   * Aggregate only — no identity attached. Private shares never contribute to
   * this figure. Absent when the backend predates the signals route or the
   * place has no recorded signals.
   */
  detouristCount?: number;
}

export const GUIDE_YEAR = 2026;

const SOURCE_NAME = 'Guía Repsol';
// Official per-award-level 2026 announcement pages — the verification sources
// for the 10 venues newly awarded Soles in Guía Repsol 2026.
const THREE_SOL_URL =
  'https://www.guiarepsol.com/es/soles-repsol/soles-2026/nuevo-restaurante-3-soles-guia-repsol/';
const TWO_SOL_URL =
  'https://www.guiarepsol.com/es/soles-repsol/soles-2026/nuevos-restaurantes-2-soles-guia-repsol/';
const ONE_SOL_URL =
  'https://www.guiarepsol.com/es/soles-repsol/soles-2026/nuevos-restaurantes-un-sol-guia-repsol/';
// Official Guía Repsol 2026 digital booklet (complete Soles listing) — the
// verification source for the continuing 2026 Madrid Sol holders below.
const BOOKLET_URL =
  'https://www.guiarepsol.com/content/dam/repsol-guia/documentos/es/Cuadernillo%20digital%20Gu%C3%ADa%20Repsol%202026.pdf';
const COORD_NOTE =
  'Address and coordinates verified 2026-07-12 via OpenStreetMap/Nominatim (© OpenStreetMap contributors, ODbL).';
const NEW_AWARD_NOTE = `Award verified in the official 2026 Guía Repsol award listing. ${COORD_NOTE}`;
const CONTINUING_NOTE = `Award verified in the official 2026 booklet. ${COORD_NOTE}`;

// Official ranking/venue-record pages for the two ranked-list guides — the
// verification sources documented in
// pb_migrations/1767975000_add_pizza_coffee_2026_madrid.js.
const PIZZA_SOURCE_NAME = '50 Top Pizza';
const PIZZA_EDITION = '50 Top Pizza Europa 2026';
const PIZZA_RANKING_URL = 'https://www.50toppizza.it/50-top-pizza-europa-2026/';
const COFFEE_SOURCE_NAME = "The World's 100 Best Coffee Shops";
const COFFEE_EDITION = "The World's 100 Best Coffee Shops 2026";
const COFFEE_RECORD_URL =
  'https://theworlds100bestcoffeeshops.com/locales/hola-coffee-lagasca/';

function solLabel(level: AwardLevel): string {
  return `${level} ${level === 1 ? 'Sol' : 'Soles'}`;
}

const AWARD_PAGE_URLS: Record<AwardLevel, string> = {
  1: ONE_SOL_URL,
  2: TWO_SOL_URL,
  3: THREE_SOL_URL,
};

/**
 * Venues newly awarded Soles in Guía Repsol 2026, verified on the official
 * award-level pages: [id, name, sol level, address, lat, lng, approxLocation].
 * Addresses/coordinates match the OSM-verified values in
 * pb_migrations/1767973000_verify_madrid_venue_coordinates.js.
 */
const newAwardSeed: Array<[string, string, AwardLevel, string, number, number, boolean]> = [
  ['demo-ramon-freixa-atelier', 'Ramón Freixa Atelier', 3, 'Calle de Velázquez 24, 28001 Madrid', 40.4242034, -3.6840318, false],
  ['demo-bascoat', 'Bascoat', 2, 'Paseo de la Habana 33, 28036 Madrid', 40.4530399, -3.6851204, false],
  ['demo-smoked-room', 'Smoked Room', 2, 'Paseo de la Castellana 57, 28046 Madrid', 40.4388252, -3.6917467, false],
  ['demo-bancal', 'Bancal', 1, 'Calle de Serrano 95, 28006 Madrid', 40.4381489, -3.6866899, false],
  ['demo-desborre', 'Desborre', 1, 'Calle de la Unión 8, 28013 Madrid', 40.4173998, -3.7104301, false],
  ['demo-emi', 'EMi', 1, 'Calle de Gaztambide 64, 28015 Madrid', 40.4388461, -3.7151504, false],
  ['demo-los-33', 'Los 33', 1, 'Plaza de las Salesas 9, 28004 Madrid', 40.4238621, -3.6948322, false],
  // Street-level only in OSM (no house-number node for Fernández de la Hoz 35): pin is approximate.
  ['demo-otoro-jukusei', 'Otoro Jukusei', 1, 'Calle de Fernández de la Hoz 35, 28010 Madrid', 40.4339, -3.6949, true],
  ['demo-ramon-freixa-tradicion', 'Ramón Freixa Tradición', 1, 'Calle de Velázquez 24, 28001 Madrid', 40.4242034, -3.6840318, false],
  ['demo-tresde', 'Trèsde', 1, 'Calle de la Cava Alta 17, 28005 Madrid', 40.4121178, -3.7092308, false],
];

/**
 * Continuing 2026 Madrid Sol holders verified in the official booklet:
 * [id, name, sol level, address, lat, lng, approxLocation]. Addresses and
 * coordinates match pb_migrations/1767973000_verify_madrid_venue_coordinates.js.
 */
const continuingSeed: Array<[string, string, AwardLevel, string, number, number, boolean]> = [
  ['demo-coque', 'Coque', 3, 'Calle del Marqués de Riscal 11, 28010 Madrid', 40.4306865, -3.6905135, false],
  ['demo-diverxo', 'DiverXO', 3, 'Calle del Padre Damián 23, 28036 Madrid', 40.4577954, -3.6859491, false],
  ['demo-dstage', 'DSTAgE', 3, 'Calle de Regueros 8, 28004 Madrid', 40.4245942, -3.6963316, false],
  ['demo-deessa', 'Deessa', 2, 'Plaza de la Lealtad 5 (Mandarin Oriental Ritz), 28014 Madrid', 40.4155502, -3.6927255, false],
  ['demo-saddle', 'Saddle', 2, 'Calle de Amador de los Ríos 6, 28010 Madrid', 40.427537, -3.6911125, false],
  ['demo-ugo-chan', 'Ugo Chan', 2, 'Calle de Félix Boix 6, 28036 Madrid', 40.4632356, -3.6883724, false],
  ['demo-a-barra', "A'Barra", 1, 'Calle del Pinar 15, 28006 Madrid', 40.4386539, -3.6878292, false],
  ['demo-alabaster', 'Alabaster', 1, 'Calle de Montalbán 9, 28014 Madrid', 40.4181895, -3.6899478, false],
  ['demo-fismuler', 'Fismuler', 1, 'Calle de Sagasta 29, 28004 Madrid', 40.4281715, -3.6975246, false],
  ['demo-la-catapa', 'La Catapa', 1, 'Calle de Menorca 14, 28009 Madrid', 40.4193576, -3.6772879, false],
];

/**
 * Local demo selection shown while the live catalogue is unavailable.
 * The exact 20-record conservative Madrid 2026 selection seeded into the live
 * backend: the 10 verified venues newly awarded Soles in Guía Repsol 2026
 * plus the 10 continuing 2026 Sol holders verified in the official booklet.
 * Addresses and coordinates are the OSM/Nominatim-verified values from the
 * production coordinate migration. Cuisine categories and neighborhoods were
 * not source-verified, so those fields stay blank rather than showing
 * undocumented data. Each demo venue holds exactly one verified award, so
 * every awards list has a single element.
 */
export const demoVenues: Venue[] = [
  ...newAwardSeed.map(
    ([id, name, award, address, lat, lng, approxLocation]): Venue => ({
      id,
      name,
      city: 'Madrid',
      market: 'Madrid',
      marketSlug: 'madrid',
      country: 'Spain',
      awards: [
        {
          awardLevel: solLabel(award),
          awardRank: award,
          listRank: null,
          edition: '',
          awardYear: GUIDE_YEAR,
          sourceName: SOURCE_NAME,
          sourceUrl: AWARD_PAGE_URLS[award],
          note: NEW_AWARD_NOTE,        },
      ],
      category: '',
      neighborhood: '',
      address,
      lat,
      lng,
      approxLocation,
    })
  ),
  ...continuingSeed.map(
    ([id, name, award, address, lat, lng, approxLocation]): Venue => ({
      id,
      name,
      city: 'Madrid',
      market: 'Madrid',
      marketSlug: 'madrid',
      country: 'Spain',
      awards: [
        {
          awardLevel: solLabel(award),
          awardRank: award,
          listRank: null,
          edition: '',
          awardYear: GUIDE_YEAR,
          sourceName: SOURCE_NAME,
          sourceUrl: BOOKLET_URL,
          note: CONTINUING_NOTE,        },
      ],
      category: '',
      neighborhood: '',
      address,
      lat,
      lng,
      approxLocation,
    })
  ),
  // The three verified ranked-list venues documented by
  // pb_migrations/1767975000_add_pizza_coffee_2026_madrid.js — the only
  // canonical Pizza/Coffee rows; addresses and coordinates are the
  // OSM-verified values from that migration.
  {
    id: 'demo-baldoria',
    name: 'Baldoria',
    city: 'Madrid',
    market: 'Madrid',
    marketSlug: 'madrid',
    country: 'Spain',
    awards: [
      {
        awardLevel: `${PIZZA_EDITION} — No. 2`,
        awardRank: null,
        listRank: 2,
        edition: PIZZA_EDITION,
        awardYear: GUIDE_YEAR,
        sourceName: PIZZA_SOURCE_NAME,
        sourceUrl: PIZZA_RANKING_URL,
        note: 'Rank verified on the official 50 Top Pizza Europa 2026 ranking page. Coordinates are OpenStreetMap-sourced (© OpenStreetMap contributors, ODbL), not taken from the guide.',      },
    ],
    category: 'Pizza',
    neighborhood: '',
    address: 'C. de José Ortega y Gasset, 100, 28006 Madrid',
    lat: 40.4294985,
    lng: -3.6707425,
    approxLocation: false,
  },
  {
    id: 'demo-fratelli-figurato',
    name: 'Fratelli Figurato',
    city: 'Madrid',
    market: 'Madrid',
    marketSlug: 'madrid',
    country: 'Spain',
    awards: [
      {
        awardLevel: `${PIZZA_EDITION} — No. 11`,
        awardRank: null,
        listRank: 11,
        edition: PIZZA_EDITION,
        awardYear: GUIDE_YEAR,
        sourceName: PIZZA_SOURCE_NAME,
        sourceUrl: PIZZA_RANKING_URL,
        note: 'Rank verified on the official 50 Top Pizza Europa 2026 ranking page; the ranking names the venue without a specific branch. Shown location is the operator’s primary pizzeria, corroborated via the official site and OpenStreetMap (© OpenStreetMap contributors, ODbL).',      },
    ],
    category: 'Pizza',
    neighborhood: '',
    address: 'Calle Alonso Cano, 37, 28003 Madrid',
    lat: 40.438991,
    lng: -3.6978429,
    approxLocation: false,
  },
  {
    id: 'demo-hola-coffee-lagasca',
    name: 'Hola Coffee Lagasca',
    city: 'Madrid',
    market: 'Madrid',
    marketSlug: 'madrid',
    country: 'Spain',
    awards: [
      {
        awardLevel: `${COFFEE_EDITION} — No. 19`,
        awardRank: null,
        listRank: 19,
        edition: COFFEE_EDITION,
        awardYear: GUIDE_YEAR,
        sourceName: COFFEE_SOURCE_NAME,
        sourceUrl: COFFEE_RECORD_URL,
        note: 'Rank verified on the official global top-100 ranking page and the official venue record. Coordinates are OpenStreetMap/Nominatim-sourced (© OpenStreetMap contributors, ODbL), not taken from the guide.',      },
    ],
    category: 'Coffee',
    neighborhood: '',
    address: 'Calle Lagasca, 42, 28001, Madrid, Spain',
    lat: 40.4248823,
    lng: -3.6853284,
    approxLocation: false,
  },
];

export interface LiveCity extends CityEditorialSource {
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
  market?: string;
  country?: string;
  address?: string;
  lat?: number | string;
  lng?: number | string;
  category?: string;
  official_url?: string;
  instagram_url?: string;
  image_url?: string;
  approx_location?: boolean;
};

type GuideSourceRecord = Record<string, unknown> & {
  id: string;
  name?: string;
  slug?: string;
  official_url?: string;
  current_year?: number | string;
};

type VenueAwardRecord = Record<string, unknown> & {
  id: string;
  source?: string;
  venue?: string;
  year?: number | string;
  level?: string;
  rank?: number | string;
  source_url?: string;
  provenance?: string;
  occasions?: string[];
  current?: boolean;
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
  title?: string;
  tagline?: string;
  footer?: string;
  meta_title?: string;
  meta_description?: string;
  presentation?: string;
  center_lat?: number | string;
  center_lng?: number | string;
  zoom?: number | string;
  bounds_lat_min?: number | string;
  bounds_lat_max?: number | string;
  bounds_lng_min?: number | string;
  bounds_lng_max?: number | string;
};

const COMMUNITY_SOURCE_SLUG = 'detour-community';
const COMMUNITY_SOURCE_NAME = 'detour community';
const COMMUNITY_LEVEL = 'detour community selection';
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

/** Route slug of the market a venue is listed under (e.g. 'san-francisco'). */
export function venueMarketSlug(v: Venue): string {
  return v.marketSlug || citySlug(v.market || v.city);
}

/**
 * Readable slug identifying one place inside its market route, so every place
 * page has a shareable URL. Two places in the same market can normalise to the
 * same name slug (two 'Bar Basque'); the venue id disambiguates only those, and
 * a place whose name yields no slug at all falls back to the id outright.
 */
export function venuePlaceSlug(v: Venue, all: Venue[]): string {
  const base = citySlug(v.name);
  if (!base) return v.id;
  const market = venueMarketSlug(v);
  const clash = all.some(
    (other) => other.id !== v.id && venueMarketSlug(other) === market && citySlug(other.name) === base
  );
  return clash ? `${base}-${v.id}` : base;
}

function listRankOf(level: string): number | null {
  return positiveInteger(level.match(LIST_RANK_RE)?.[1]);
}

function editionOf(level: string): string {
  return level.split(/\s*—\s*No\.\s*\d+/i)[0].trim() || level;
}

function awardRankOf(level: string): number | null {
  const match = level.match(/^\s*([1-3])\s+(?:sol(?:es)?|stars?)\b/i);
  return positiveInteger(match?.[1]);
}

function isCommunityRecognition(level: string, source: GuideSourceRecord | undefined): boolean {
  return (
    cleanString(source?.slug).toLowerCase() === COMMUNITY_SOURCE_SLUG ||
    cleanString(source?.name).toLowerCase() === COMMUNITY_SOURCE_NAME ||
    level.toLowerCase() === COMMUNITY_LEVEL
  );
}

/**
 * Whether a recognition record originates from Detour itself rather than an
 * external guide. Such records place the venue on the Detourist List instead
 * of becoming awards. Records from backends that predate
 * `venue_awards.provenance` (and unknown values) keep the established
 * guide-backed presentation.
 */
function isDetourOriginated(
  value: unknown,
  level: string,
  source: GuideSourceRecord | undefined
): boolean {
  return (
    cleanString(value).toLowerCase() === 'community_selection' ||
    isCommunityRecognition(level, source)
  );
}

function sortAwards(awards: VenueAward[]): VenueAward[] {
  return [...awards].sort(
    (a, b) =>
      (b.awardRank ?? -1) - (a.awardRank ?? -1) ||
      (a.listRank ?? Number.MAX_SAFE_INTEGER) - (b.listRank ?? Number.MAX_SAFE_INTEGER) ||
      a.awardLevel.localeCompare(b.awardLevel) ||
      a.sourceName.localeCompare(b.sourceName)
  );
}

/**
 * Load the established public catalogue. `venues` is the canonical place list;
 * each current `venue_awards` row is joined to its `guide_sources` record so
 * guide/publication names, provenance, literal levels, ranks, years, and source
 * links stay attached to the recognition that supplied them.
 */
export async function loadLiveCatalogue(): Promise<LiveCatalogue> {
  const [venueRecords, awardRecords, sourceRecords, cityRecords, contributionRecords, detouristCounts] = await Promise.all([
    pb.collection('venues').getFullList<VenueRecord>({
      fields: 'id,name,city,market,country,address,lat,lng,category,official_url,instagram_url,image_url,approx_location',
      // Keep the request compatible with pre-migration backends; final route
      // ordering is applied client-side after optional market values load.
      sort: 'city,name',
      requestKey: null,
    }),
    pb.collection('venue_awards').getFullList<VenueAwardRecord>({
      fields: 'id,source,venue,year,level,rank,source_url,provenance,occasions,current',
      sort: 'venue,source,year',
      requestKey: null,
    }),
    pb.collection('guide_sources').getFullList<GuideSourceRecord>({
      fields: 'id,name,slug,official_url,current_year',
      sort: 'name',
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
      .send<{ counts?: Record<string, unknown> }>('/api/detour/place-detourists', { requestKey: null })
      .then((payload) => payload?.counts ?? {})
      .catch(() => ({} as Record<string, unknown>)),
  ]);

  const sourceById = new Map(sourceRecords.map((source) => [source.id, source]));
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
      title: cleanString(record.title),
      tagline: cleanString(record.tagline),
      footer: cleanString(record.footer),
      metaTitle: cleanString(record.meta_title),
      metaDescription: cleanString(record.meta_description),
      presentation: cleanString(record.presentation),
      center,
      zoom,
      bounds,
    });
  }

  for (const record of [...venueRecords, ...contributionRecords]) {
    if ('status' in record && cleanString(record.status) !== 'approved') continue;
    // A venue's explicit market owns its route; contributions and older venue
    // records continue to route by their physical city.
    const name = cleanString('market' in record ? record.market : '') || cleanString(record.city);
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
    const physicalCity = cleanString(record.city);
    const marketName = cleanString(record.market) || physicalCity;
    const market = citiesByName.get(marketName.toLowerCase());
    if (!id || !name || !physicalCity || !market) continue;

    const rawLat = cleanNumber(record.lat);
    const rawLng = cleanNumber(record.lng);
    const hasCoordinates =
      rawLat !== null && rawLng !== null && !(rawLat === 0 && rawLng === 0);

    venuesById.set(id, {
      id,
      name,
      marketId: market.id,
      market: market.name,
      marketSlug: market.slug,
      // Keep the legacy route aliases aligned with the explicit market route.
      cityId: market.id,
      citySlug: market.slug,
      city: physicalCity,
      country: cleanString(record.country) || market.country,
      awards: [],
      category: cleanString(record.category),
      neighborhood: '',
      address: cleanString(record.address),
      lat: hasCoordinates ? rawLat : null,
      lng: hasCoordinates ? rawLng : null,
      approxLocation: record.approx_location === true,
      officialUrl: cleanExternalUrl(record.official_url) || undefined,
      instagramUrl: cleanExternalUrl(record.instagram_url) || undefined,
      imageUrl: cleanExternalUrl(record.image_url) || undefined,
    });
  }

  for (const record of awardRecords) {
    if (record.current === false) continue;

    const venue = venuesById.get(cleanString(record.venue));
    const level = cleanString(record.level);
    if (!venue || !level) continue;

    const source = sourceById.get(cleanString(record.source));
    // Detour-originated records are not guide awards — they put the venue on
    // the Detourist List (the single member-recommended lane).
    if (isDetourOriginated(record.provenance, level, source)) {
      venue.detouristList = true;
      venue.occasions = mergeOccasions(venue.occasions, knownOccasions(record.occasions));
      continue;
    }
    const sourceName = cleanString(source?.name) || 'Unknown guide';
    const explicitRank = positiveInteger(record.rank);
    const parsedListRank = listRankOf(level);
    const isRankedList = explicitRank !== null || parsedListRank !== null;
    const awardYear = positiveInteger(record.year) ?? positiveInteger(source?.current_year) ?? GUIDE_YEAR;

    venue.awards.push({
      awardLevel: level,
      awardRank: isRankedList ? null : awardRankOf(level),
      listRank: isRankedList ? (explicitRank ?? parsedListRank) : null,
      edition: isRankedList ? editionOf(level) : '',
      awardYear,
      sourceName,
      sourceUrl: cleanExternalUrl(record.source_url) || cleanExternalUrl(source?.official_url),
      note: '',
      occasions: knownOccasions(record.occasions),
    });
    venue.occasions = mergeOccasions(venue.occasions, knownOccasions(record.occasions));
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
      existing.detouristList = true;
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
      marketId: city.id,
      market: city.name,
      marketSlug: city.slug,
      cityId: city.id,
      citySlug: city.slug,
      city: city.name,
      country: cleanString(record.country) || city.country,
      awards: [],
      category: contributionCategory(record.category),
      neighborhood: '',
      address: cleanString(record.address),
      lat: null,
      lng: null,
      approxLocation: false,
      occasions,
      detouristList: true,
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
    const count = positiveInteger(detouristCounts[venue.id]);
    if (count !== null) venue.detouristCount = Math.max(venue.detouristCount ?? 0, count);
  }

  const cities = [...citiesByName.values()].sort((a, b) => a.name.localeCompare(b.name));
  const venues = [...venuesById.values()]
    .map((venue) => ({ ...venue, awards: sortAwards(venue.awards) }))
    .sort(
      (a, b) =>
        a.market.localeCompare(b.market) ||
        a.city.localeCompare(b.city) ||
        a.name.localeCompare(b.name)
    );

  return { cities, venues };
}
