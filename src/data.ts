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
  /**
   * Recognition-shaped entries used by the established UI. Live source badges
   * are adapted here too; the array may be empty when a place has no badges.
   */
  awards: VenueAward[];
  /** Stable venue category from the catalogue (e.g. 'Pizza', 'Coffee'); '' when unspecified. */
  category: string;
  neighborhood: string;
  address: string;
  /** Null when no verified coordinate exists — render as "location pending verification", never a fake pin. */
  lat: number | null;
  lng: number | null;
  approxLocation: boolean;
  /** Public place slug and relation metadata from the live `places` collection. */
  slug?: string;
  cityId?: string;
  citySlug?: string;
  /** Public place-page content from the live `places` collection. */
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

type CityRecord = Record<string, unknown> & {
  id: string;
  name?: string;
  slug?: string;
  country?: string;
};

type PlaceRecord = Record<string, unknown> & {
  id: string;
  name?: string;
  slug?: string;
  category?: string;
  city?: string;
  description?: string;
  address?: string;
  source_badges?: string[];
  image_url?: string;
};

const CATEGORY_LABELS: Record<string, string> = {
  restaurant: 'Restaurant',
  coffee: 'Coffee',
  boulangerie: 'Boulangerie',
  other: 'Other',
};

const SOURCE_BADGE_LABELS: Record<string, string> = {
  michelin: 'Michelin',
  mof: 'MOF',
  other: 'Other',
  'detour community': 'Detour community',
};

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(cleanString).filter(Boolean))];
}

function categoryLabel(value: unknown): string {
  const category = cleanString(value).toLowerCase();
  return CATEGORY_LABELS[category] ?? (category ? category[0].toUpperCase() + category.slice(1) : '');
}

function sourceBadgeLabel(value: string): string {
  return SOURCE_BADGE_LABELS[value.toLowerCase()] ?? value;
}

function badgeAward(label: string): VenueAward {
  const community = label.toLowerCase() === 'detour community';
  return {
    awardLevel: community ? 'Detour community selection' : label,
    awardRank: null,
    listRank: null,
    edition: '',
    awardYear: 0,
    sourceName: community ? 'Detour community' : label,
    sourceUrl: '',
    note: '',
    community,
    sourceBadge: !community,
  };
}

/**
 * Load the public catalogue used by city discovery and place details.
 * The adapter intentionally reads only `cities` and `places`, joins each place
 * to its live city relation, and never substitutes hardcoded place records.
 */
export async function loadLiveCatalogue(): Promise<LiveCatalogue> {
  const [cityRecords, placeRecords] = await Promise.all([
    pb.collection('cities').getFullList<CityRecord>({
      fields: 'id,name,slug,country',
      sort: 'name',
      requestKey: null,
    }),
    pb.collection('places').getFullList<PlaceRecord>({
      fields: 'id,name,slug,category,city,description,address,source_badges,image_url',
      sort: 'name',
      requestKey: null,
    }),
  ]);

  const cities = cityRecords
    .map((record): LiveCity | null => {
      const name = cleanString(record.name);
      const slug = cleanString(record.slug);
      if (!record.id || !name || !slug) return null;
      return {
        id: record.id,
        name,
        slug,
        country: cleanString(record.country),
      };
    })
    .filter((city): city is LiveCity => city !== null);
  const cityById = new Map(cities.map((city) => [city.id, city]));

  const venues = placeRecords
    .map((record): Venue | null => {
      const cityId = cleanString(record.city);
      const city = cityById.get(cityId);
      const name = cleanString(record.name);
      if (!record.id || !city || !name) return null;

      const sourceBadges = stringList(record.source_badges).map(sourceBadgeLabel);
      return {
        id: record.id,
        name,
        slug: cleanString(record.slug),
        cityId,
        citySlug: city.slug,
        city: city.name,
        awards: sourceBadges.map(badgeAward),
        category: categoryLabel(record.category),
        neighborhood: '',
        address: cleanString(record.address),
        description: cleanString(record.description),
        sourceBadges,
        imageUrl: cleanString(record.image_url),
        lat: null,
        lng: null,
        approxLocation: false,
      };
    })
    .filter((venue): venue is Venue => venue !== null);

  return { cities, venues };
}
