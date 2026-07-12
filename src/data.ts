export type AwardLevel = 1 | 2 | 3;

export interface Venue {
  id: string;
  name: string;
  award: AwardLevel;
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
const NEW_AWARD_NOTE =
  'Location pending verification; award verified in the official 2026 Guía Repsol award listing.';
const CONTINUING_NOTE =
  'Location pending verification; award verified in the official 2026 booklet.';

const AWARD_PAGE_URLS: Record<AwardLevel, string> = {
  1: ONE_SOL_URL,
  2: TWO_SOL_URL,
  3: THREE_SOL_URL,
};

/** Venues newly awarded Soles in Guía Repsol 2026, verified on the official award-level pages: [id, name, sol level]. */
const newAwardSeed: Array<[string, string, AwardLevel]> = [
  ['demo-ramon-freixa-atelier', 'Ramón Freixa Atelier', 3],
  ['demo-bascoat', 'Bascoat', 2],
  ['demo-smoked-room', 'Smoked Room', 2],
  ['demo-bancal', 'Bancal', 1],
  ['demo-desborre', 'Desborre', 1],
  ['demo-emi', 'EMi', 1],
  ['demo-los-33', 'Los 33', 1],
  ['demo-otoro-jukusei', 'Otoro Jukusei', 1],
  ['demo-ramon-freixa-tradicion', 'Ramón Freixa Tradición', 1],
  ['demo-tresde', 'Trèsde', 1],
];

/** Continuing 2026 Madrid Sol holders verified in the official booklet: [id, name, sol level]. */
const continuingSeed: Array<[string, string, AwardLevel]> = [
  ['demo-coque', 'Coque', 3],
  ['demo-diverxo', 'DiverXO', 3],
  ['demo-dstage', 'DSTAgE', 3],
  ['demo-deessa', 'Deessa', 2],
  ['demo-saddle', 'Saddle', 2],
  ['demo-ugo-chan', 'Ugo Chan', 2],
  ['demo-a-barra', "A'Barra", 1],
  ['demo-alabaster', 'Alabaster', 1],
  ['demo-fismuler', 'Fismuler', 1],
  ['demo-la-catapa', 'La Catapa', 1],
];

/**
 * Local demo selection shown while the live catalogue is unavailable.
 * The exact 20-record conservative Madrid 2026 selection seeded into the live
 * backend: the 10 verified venues newly awarded Soles in Guía Repsol 2026
 * plus the 10 continuing 2026 Sol holders verified in the official booklet.
 * Only source-verified award facts are stored: no addresses, coordinates,
 * cuisine categories, or venue URLs were verified for either cohort, so those
 * fields stay blank/null rather than showing undocumented data.
 */
export const demoVenues: Venue[] = [
  ...newAwardSeed.map(
    ([id, name, award]): Venue => ({
      id,
      name,
      award,
      awardYear: GUIDE_YEAR,
      cuisine: '',
      neighborhood: '',
      address: '',
      lat: null,
      lng: null,
      sourceName: SOURCE_NAME,
      sourceUrl: AWARD_PAGE_URLS[award],
      note: NEW_AWARD_NOTE,
      approxLocation: false,
    })
  ),
  ...continuingSeed.map(
    ([id, name, award]): Venue => ({
      id,
      name,
      award,
      awardYear: GUIDE_YEAR,
      cuisine: '',
      neighborhood: '',
      address: '',
      lat: null,
      lng: null,
      sourceName: SOURCE_NAME,
      sourceUrl: BOOKLET_URL,
      note: CONTINUING_NOTE,
      approxLocation: false,
    })
  ),
];
