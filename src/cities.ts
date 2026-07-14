/**
 * The cities Detour currently curates. Each entry carries the editorial copy
 * and the map fallback view for one city; the UI derives every city-specific
 * string from here so no city name is ever hard-coded in the views.
 */

export type CitySlug = 'madrid' | 'paris' | 'san-francisco';

export interface CityBounds {
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
}

export interface CityConfig {
  slug: CitySlug;
  /** City name exactly as stored in the catalogue's `city` field. */
  name: string;
  country: string;
  /** Hero headline. */
  title: string;
  /** Hero tagline; `{year}` is replaced with the current guide year. */
  tagline: string;
  footer: string;
  searchPlaceholder: string;
  /** Browser tab title once the app has booted into this city. */
  metaTitle: string;
  /** `meta[name="description"]` content once the app has booted into this city. */
  metaDescription: string;
  /** Shown when the city is configured but its selection is not published yet. */
  unavailableCopy: string;
  /** Map view used when there are no plottable pins to derive bounds from. */
  center: [number, number];
  zoom: number;
  /**
   * Conservative geographic box for the metropolitan area. The visitor's
   * position is only drawn/framed when it falls inside this box, so a distant
   * visitor never drags the city map out to another region.
   */
  bounds: CityBounds;
}

export const CITIES: readonly CityConfig[] = [
  {
    slug: 'madrid',
    name: 'Madrid',
    country: 'Spain',
    title: 'Madrid’s exceptional tables, mapped.',
    tagline:
      'A deliberately small selection — every place holds a current award from a named guide. {year} selections.',
    footer:
      'Detour is a current, deliberately edited selection of Madrid’s awarded tables. Each award belongs to its guide — follow the official guide links for the original listings.',
    searchPlaceholder: 'Search by name — Casa, DiverXO…',
    metaTitle: 'Detour — Madrid’s exceptional tables, mapped',
    metaDescription:
      'A deliberately small map of Madrid’s awarded tables — every place holds a current award from a named guide, from Repsol Soles to Michelin Stars.',
    unavailableCopy:
      'The Madrid selection isn’t available right now. It will be back shortly.',
    center: [40.4168, -3.7038],
    zoom: 13,
    bounds: { latMin: 40.2, latMax: 40.65, lngMin: -3.95, lngMax: -3.45 },
  },
  {
    slug: 'paris',
    name: 'Paris',
    country: 'France',
    title: 'Paris’s starred tables, gathered.',
    tagline:
      'A deliberately small selection — every place holds a current award from a named guide. Map positions for this selection are being refined. {year} selections.',
    footer:
      'Detour is a current, deliberately edited selection of Paris’s awarded tables — map positions for this selection are being refined. Each award belongs to its guide — follow the official guide links for the original listings.',
    searchPlaceholder: 'Search by name — Kei, Arpège…',
    metaTitle: 'Detour — Paris’s starred tables, gathered',
    metaDescription:
      'A deliberately small selection of Paris’s starred tables — every place holds a current award from a named guide, gathered on one map.',
    unavailableCopy:
      'The Paris selection isn’t published here yet. Check back soon — Madrid is ready to explore in the meantime.',
    center: [48.8566, 2.3522],
    zoom: 12,
    bounds: { latMin: 48.75, latMax: 48.95, lngMin: 2.2, lngMax: 2.5 },
  },
  {
    slug: 'san-francisco',
    name: 'San Francisco',
    country: 'United States',
    title: 'San Francisco’s starred tables, mapped.',
    tagline:
      'A deliberately small selection — every place holds a current award from a named guide. {year} selections.',
    footer:
      'Detour is a current, deliberately edited selection of San Francisco’s awarded tables. Each award belongs to its guide — follow the official guide links for the original listings.',
    searchPlaceholder: 'Search by name — Quince, Benu…',
    metaTitle: 'Detour — San Francisco’s starred tables, mapped',
    metaDescription:
      'A deliberately small map of San Francisco’s awarded tables — every place holds a current award from a named guide.',
    unavailableCopy:
      'The San Francisco selection isn’t published here yet. Check back soon — Madrid is ready to explore in the meantime.',
    center: [37.7749, -122.4194],
    zoom: 13,
    bounds: { latMin: 37.6, latMax: 37.85, lngMin: -122.55, lngMax: -122.33 },
  },
];

export const DEFAULT_CITY: CitySlug = 'madrid';

export function cityBySlug(slug: string | null | undefined): CityConfig | null {
  if (!slug) return null;
  const wanted = slug.trim().toLowerCase();
  return CITIES.find((c) => c.slug === wanted) ?? null;
}

/** Safe boot-time parse of `?city=…`; falls back to the default city. */
export function citySlugFromUrl(search: string): CitySlug {
  try {
    const raw = new URLSearchParams(search).get('city');
    return cityBySlug(raw)?.slug ?? DEFAULT_CITY;
  } catch {
    return DEFAULT_CITY;
  }
}
