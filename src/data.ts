import { pb } from './pocketbase';

export type AwardLevel = 1 | 2 | 3;

/** One guide award held by a venue, with its own source attribution. */
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
  /**
   * True when this recognition is a Detour community selection — public
   * provenance from the Detour community itself (guide source slug
   * 'detour-community'), not an award from an external guide. Community
   * selections never carry star/sole icons, list ranks, or external
   * guide links.
   */
  community: boolean;
  /** True when this entry adapts a public `places.source_badges` value rather than a graded award. */
  sourceBadge?: boolean;
}

export interface Venue {
  id: string;
  name: string;
  /** City name as stored in the catalogue (e.g. 'Madrid'); scopes every view to one city. */
  city: string;
  /** Every current recognition for this canonical venue, one entry per guide. */
  awards: VenueAward[];
  /** Stable venue category from the catalogue (e.g. 'Pizza', 'Coffee'); '' when unspecified. */
  category: string;
  neighborhood: string;
  address: string;
  /** Null when no verified coordinate exists — render as "location pending verification", never a fake pin. */
  lat: number | null;
  lng: number | null;
  approxLocation: boolean;
  /** Optional route metadata used by the city-scoped catalogue UI. */
  slug?: string;
  cityId?: string;
  citySlug?: string;
  /** Optional detail content retained for compatibility with the existing UI contract. */
  description?: string;
  sourceBadges?: string[];
  imageUrl?: string;
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
      awards: [
        {
          awardLevel: solLabel(award),
          awardRank: award,
          listRank: null,
          edition: '',
          awardYear: GUIDE_YEAR,
          sourceName: SOURCE_NAME,
          sourceUrl: AWARD_PAGE_URLS[award],
          note: NEW_AWARD_NOTE,
          community: false,
        },
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
      awards: [
        {
          awardLevel: solLabel(award),
          awardRank: award,
          listRank: null,
          edition: '',
          awardYear: GUIDE_YEAR,
          sourceName: SOURCE_NAME,
          sourceUrl: BOOKLET_URL,
          note: CONTINUING_NOTE,
          community: false,
        },
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
    awards: [
      {
        awardLevel: `${PIZZA_EDITION} — No. 2`,
        awardRank: null,
        listRank: 2,
        edition: PIZZA_EDITION,
        awardYear: GUIDE_YEAR,
        sourceName: PIZZA_SOURCE_NAME,
        sourceUrl: PIZZA_RANKING_URL,
        note: 'Rank verified on the official 50 Top Pizza Europa 2026 ranking page. Coordinates are OpenStreetMap-sourced (© OpenStreetMap contributors, ODbL), not taken from the guide.',
        community: false,
      },
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
    awards: [
      {
        awardLevel: `${PIZZA_EDITION} — No. 11`,
        awardRank: null,
        listRank: 11,
        edition: PIZZA_EDITION,
        awardYear: GUIDE_YEAR,
        sourceName: PIZZA_SOURCE_NAME,
        sourceUrl: PIZZA_RANKING_URL,
        note: 'Rank verified on the official 50 Top Pizza Europa 2026 ranking page; the ranking names the venue without a specific branch. Shown location is the operator’s primary pizzeria, corroborated via the official site and OpenStreetMap (© OpenStreetMap contributors, ODbL).',
        community: false,
      },
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
    awards: [
      {
        awardLevel: `${COFFEE_EDITION} — No. 19`,
        awardRank: null,
        listRank: 19,
        edition: COFFEE_EDITION,
        awardYear: GUIDE_YEAR,
        sourceName: COFFEE_SOURCE_NAME,
        sourceUrl: COFFEE_RECORD_URL,
        note: 'Rank verified on the official global top-100 ranking page and the official venue record. Coordinates are OpenStreetMap/Nominatim-sourced (© OpenStreetMap contributors, ODbL), not taken from the guide.',
        community: false,
      },
    ],
    category: 'Coffee',
    neighborhood: '',
    address: 'Calle Lagasca, 42, 28001, Madrid, Spain',
    lat: 40.4248823,
    lng: -3.6853284,
    approxLocation: false,
  },
];

export interface LiveCity {
  id: string;
  name: string;
  slug: string;
  country: string;
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
  current?: boolean;
};

const COMMUNITY_SOURCE_SLUG = 'detour-community';
const COMMUNITY_SOURCE_NAME = 'detour community';
const COMMUNITY_LEVEL = 'detour community selection';
const COMMUNITY_LABEL = 'Detour community selection';
const LIST_RANK_RE = /\bNo\.\s*(\d+)\b/i;

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanNumber(value: unknown): number | null {
  const number = typeof value === 'string' ? Number.parseFloat(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
}

function positiveInteger(value: unknown): number | null {
  const number = cleanNumber(value);
  return number !== null && Number.isInteger(number) && number > 0 ? number : null;
}

function citySlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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
 * guide names, literal levels, ranks, years, and official links stay attached
 * to the recognition that supplied them.
 */
export async function loadLiveCatalogue(): Promise<LiveCatalogue> {
  const [venueRecords, awardRecords, sourceRecords] = await Promise.all([
    pb.collection('venues').getFullList<VenueRecord>({
      fields: 'id,name,city,country,address,lat,lng,category,official_url,approx_location',
      sort: 'city,name',
      requestKey: null,
    }),
    pb.collection('venue_awards').getFullList<VenueAwardRecord>({
      fields: 'id,source,venue,year,level,rank,source_url,current',
      sort: 'venue,source,year',
      requestKey: null,
    }),
    pb.collection('guide_sources').getFullList<GuideSourceRecord>({
      fields: 'id,name,slug,official_url,current_year',
      sort: 'name',
      requestKey: null,
    }),
  ]);

  const sourceById = new Map(sourceRecords.map((source) => [source.id, source]));
  const citiesByName = new Map<string, LiveCity>();

  for (const record of venueRecords) {
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
    if (!id || !name || !city) continue;

    const rawLat = cleanNumber(record.lat);
    const rawLng = cleanNumber(record.lng);
    const hasCoordinates =
      rawLat !== null && rawLng !== null && !(rawLat === 0 && rawLng === 0);

    venuesById.set(id, {
      id,
      name,
      cityId: city.id,
      citySlug: city.slug,
      city: city.name,
      awards: [],
      category: cleanString(record.category),
      neighborhood: '',
      address: cleanString(record.address),
      lat: hasCoordinates ? rawLat : null,
      lng: hasCoordinates ? rawLng : null,
      approxLocation: record.approx_location === true,
    });
  }

  for (const record of awardRecords) {
    if (record.current === false) continue;

    const venue = venuesById.get(cleanString(record.venue));
    const level = cleanString(record.level);
    if (!venue || !level) continue;

    const source = sourceById.get(cleanString(record.source));
    const sourceName = cleanString(source?.name) || 'Unknown guide';
    const community = isCommunityRecognition(level, source);
    const explicitRank = positiveInteger(record.rank);
    const parsedListRank = listRankOf(level);
    const isRankedList = explicitRank !== null || parsedListRank !== null;
    const awardYear = positiveInteger(record.year) ?? positiveInteger(source?.current_year) ?? GUIDE_YEAR;

    venue.awards.push({
      awardLevel: community ? COMMUNITY_LABEL : level,
      awardRank: community || isRankedList ? null : awardRankOf(level),
      listRank: community || !isRankedList ? null : (explicitRank ?? parsedListRank),
      edition: community || !isRankedList ? '' : editionOf(level),
      awardYear,
      sourceName: community ? 'Detour community' : sourceName,
      sourceUrl: community
        ? ''
        : cleanString(record.source_url) || cleanString(source?.official_url),
      note: '',
      community,
    });
  }

  const cities = [...citiesByName.values()].sort((a, b) => a.name.localeCompare(b.name));
  const venues = [...venuesById.values()]
    .map((venue) => ({ ...venue, awards: sortAwards(venue.awards) }))
    .sort((a, b) => a.city.localeCompare(b.city) || a.name.localeCompare(b.name));

  return { cities, venues };
}
