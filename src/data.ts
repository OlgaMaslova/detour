export type AwardLevel = 1 | 2 | 3;

export interface Venue {
  id: string;
  name: string;
  award: AwardLevel;
  awardYear: number;
  cuisine: string;
  neighborhood: string;
  address: string;
  lat: number;
  lng: number;
  sourceName: string;
  sourceUrl: string;
  note: string;
  approxLocation: boolean;
}

export const GUIDE_YEAR = 2026;

const SOURCE_NAME = 'Guía Repsol';
const SOURCE_URL =
  'https://www.guiarepsol.com/es/soles-repsol/soles-2026/listado-de-nuevos-restaurantes-con-soles-guia-repsol-2026/';

/**
 * Local demo selection shown while the live catalogue is unavailable.
 * The 10 verified Madrid venues newly awarded Soles in Guía Repsol 2026 —
 * the same set seeded into the live backend.
 */
export const demoVenues: Venue[] = [
  {
    id: 'demo-ramon-freixa-atelier',
    name: 'Ramón Freixa Atelier',
    award: 3,
    awardYear: GUIDE_YEAR,
    cuisine: 'Fine dining',
    neighborhood: '',
    address: 'Calle de Velázquez 24, 28001 Madrid',
    lat: 40.4242034,
    lng: -3.6840318,
    sourceName: SOURCE_NAME,
    sourceUrl: SOURCE_URL,
    note: 'Coordinates exact.',
    approxLocation: false,
  },
  {
    id: 'demo-bascoat',
    name: 'Bascoat',
    award: 2,
    awardYear: GUIDE_YEAR,
    cuisine: 'Fine dining',
    neighborhood: '',
    address: 'Paseo de la Habana 33, 28036 Madrid',
    lat: 40.4530399,
    lng: -3.6851204,
    sourceName: SOURCE_NAME,
    sourceUrl: SOURCE_URL,
    note: 'Coordinates exact.',
    approxLocation: false,
  },
  {
    id: 'demo-smoked-room',
    name: 'Smoked Room',
    award: 2,
    awardYear: GUIDE_YEAR,
    cuisine: 'Fine dining',
    neighborhood: '',
    address: 'Paseo de la Castellana 57, 28046 Madrid',
    lat: 40.4388252,
    lng: -3.6917467,
    sourceName: SOURCE_NAME,
    sourceUrl: SOURCE_URL,
    note: 'Coordinates are building centroid.',
    approxLocation: false,
  },
  {
    id: 'demo-bancal',
    name: 'Bancal',
    award: 1,
    awardYear: GUIDE_YEAR,
    cuisine: 'Fine dining',
    neighborhood: '',
    address: 'Calle de Serrano 95, 28006 Madrid',
    lat: 40.4381489,
    lng: -3.6866899,
    sourceName: SOURCE_NAME,
    sourceUrl: SOURCE_URL,
    note: 'Coordinates at building address.',
    approxLocation: false,
  },
  {
    id: 'demo-desborre',
    name: 'Desborre',
    award: 1,
    awardYear: GUIDE_YEAR,
    cuisine: 'Fine dining',
    neighborhood: '',
    address: 'Calle de la Unión 8, 28013 Madrid',
    lat: 40.4175734,
    lng: -3.7104434,
    sourceName: SOURCE_NAME,
    sourceUrl: SOURCE_URL,
    note: 'Coordinates exact address.',
    approxLocation: false,
  },
  {
    id: 'demo-emi',
    name: 'EMi',
    award: 1,
    awardYear: GUIDE_YEAR,
    cuisine: 'Fine dining',
    neighborhood: '',
    address: 'Calle de Gaztambide 64, 28015 Madrid',
    lat: 40.4388461,
    lng: -3.7151504,
    sourceName: SOURCE_NAME,
    sourceUrl: SOURCE_URL,
    note: 'Coordinates exact address; address corroborated by press.',
    approxLocation: false,
  },
  {
    id: 'demo-los-33',
    name: 'Los 33',
    award: 1,
    awardYear: GUIDE_YEAR,
    cuisine: 'Fine dining',
    neighborhood: '',
    address: 'Plaza de las Salesas 9, 28004 Madrid',
    lat: 40.4238621,
    lng: -3.6948322,
    sourceName: SOURCE_NAME,
    sourceUrl: SOURCE_URL,
    note: 'Coordinates exact.',
    approxLocation: false,
  },
  {
    id: 'demo-otoro-jukusei',
    name: 'Otoro Jukusei',
    award: 1,
    awardYear: GUIDE_YEAR,
    cuisine: 'Fine dining',
    neighborhood: '',
    address: 'Calle de Fernández de la Hoz 35, 28010 Madrid',
    lat: 40.4339,
    lng: -3.6949,
    sourceName: SOURCE_NAME,
    sourceUrl: SOURCE_URL,
    note: 'Coordinates approximate street-level; require manual pin verification.',
    approxLocation: true,
  },
  {
    id: 'demo-ramon-freixa-tradicion',
    name: 'Ramón Freixa Tradición',
    award: 1,
    awardYear: GUIDE_YEAR,
    cuisine: 'Fine dining',
    neighborhood: '',
    address: 'Calle de Velázquez 24, 28001 Madrid',
    lat: 40.4242034,
    lng: -3.6840318,
    sourceName: SOURCE_NAME,
    sourceUrl: SOURCE_URL,
    note: 'Coordinates exact; shared location.',
    approxLocation: false,
  },
  {
    id: 'demo-tresde',
    name: 'Trèsde',
    award: 1,
    awardYear: GUIDE_YEAR,
    cuisine: 'Fine dining',
    neighborhood: '',
    address: 'Calle de la Cava Alta 17, 28005 Madrid',
    lat: 40.4121178,
    lng: -3.7092308,
    sourceName: SOURCE_NAME,
    sourceUrl: SOURCE_URL,
    note: 'Coordinates exact.',
    approxLocation: false,
  },
];
