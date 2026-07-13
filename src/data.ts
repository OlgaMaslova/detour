export type AwardLevel = 1 | 2 | 3;

export interface Venue {
  id: string;
  name: string;
  /** Literal award-level label exactly as published by the guide, e.g. '1 Sol', '3 Soles', '2 Stars'. */
  awardLevel: string;
  /** Numeric rank parsed from the level when available (1–3), used only for ordering/styling. */
  awardRank: number | null;
  awardYear: number;
  cuisine: string;
  neighborhood: string;
  address: string;
  /** Null when no verified coordinate exists — render as "location pending verification", never a fake pin. */
  lat: number | null;
  lng: number | null;
  sourceName: string;
  sourceUrl: string;
  note: string;
  approxLocation: boolean;
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
 * undocumented data.
 */
export const demoVenues: Venue[] = [
  ...newAwardSeed.map(
    ([id, name, award, address, lat, lng, approxLocation]): Venue => ({
      id,
      name,
      awardLevel: solLabel(award),
      awardRank: award,
      awardYear: GUIDE_YEAR,
      cuisine: '',
      neighborhood: '',
      address,
      lat,
      lng,
      sourceName: SOURCE_NAME,
      sourceUrl: AWARD_PAGE_URLS[award],
      note: NEW_AWARD_NOTE,
      approxLocation,
    })
  ),
  ...continuingSeed.map(
    ([id, name, award, address, lat, lng, approxLocation]): Venue => ({
      id,
      name,
      awardLevel: solLabel(award),
      awardRank: award,
      awardYear: GUIDE_YEAR,
      cuisine: '',
      neighborhood: '',
      address,
      lat,
      lng,
      sourceName: SOURCE_NAME,
      sourceUrl: BOOKLET_URL,
      note: CONTINUING_NOTE,
      approxLocation,
    })
  ),
];
