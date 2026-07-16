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
  /** Hero tagline; `{count}` is replaced with the current published venue count. */
  tagline: string;
  footer: string;
  searchPlaceholder: string;
  /** Browser tab title once the app has booted into this city. */
  metaTitle: string;
  /** `meta[name="description"]` content once the app has booted into this city. */
  metaDescription: string;
  /** Whether this city is ready for map-led discovery or published as a list-first preview. */
  presentation: 'map' | 'list';
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

export const GLOBAL_META_TITLE = 'Detour — Exceptional tables, city by city';
export const GLOBAL_META_DESCRIPTION =
  'Detour is a deliberately edited collection of exceptional tables across cities. Choose a city to explore current selections from named guides and the Detour community.';

export const CITIES: readonly CityConfig[] = [
  {
    slug: 'madrid',
    name: 'Madrid',
    country: 'Spain',
    title: 'Madrid’s exceptional tables, selected.',
    tagline:
      '{count} current places, from awarded dining to destination pizza and standout coffee.',
    footer:
      'Detour is a current, deliberately edited selection of Madrid’s exceptional tables. Each recognition belongs to its guide, with official links preserved for the original listings.',
    searchPlaceholder: 'Search by name — Casa, DiverXO…',
    metaTitle: 'Detour — Madrid’s exceptional tables',
    metaDescription:
      'Explore Detour’s current Madrid selection: exceptional restaurants, pizzerias and coffee shops with published recognition from named guides or the Detour community.',
    presentation: 'map',
    center: [40.4168, -3.7038],
    zoom: 13,
    bounds: { latMin: 40.2, latMax: 40.65, lngMin: -3.95, lngMax: -3.45 },
  },
  {
    slug: 'paris',
    name: 'Paris',
    country: 'France',
    title: 'Paris’s exceptional tables, selected.',
    tagline: '{count} current places holding published recognition from named guides.',
    footer:
      'Detour is a current, deliberately edited selection of Paris’s exceptional tables. Each recognition belongs to its guide, with official links preserved for the original listings.',
    searchPlaceholder: 'Search by name — Kei, Arpège…',
    metaTitle: 'Detour — Paris’s exceptional tables',
    metaDescription:
      'Explore Detour’s current Paris selection: exceptional tables with published recognition from named guides or the Detour community.',
    presentation: 'map',
    center: [48.8566, 2.3522],
    zoom: 12,
    bounds: { latMin: 48.75, latMax: 48.95, lngMin: 2.2, lngMax: 2.5 },
  },
  {
    slug: 'san-francisco',
    name: 'San Francisco',
    country: 'United States',
    title: 'San Francisco’s exceptional tables, selected.',
    tagline: '{count} current places holding published recognition from named guides.',
    footer:
      'Detour is a current, deliberately edited selection of San Francisco’s exceptional tables. Each recognition belongs to its guide, with official links preserved for the original listings.',
    searchPlaceholder: 'Search by name — Quince, Benu…',
    metaTitle: 'Detour — San Francisco’s exceptional tables',
    metaDescription:
      'Explore Detour’s current San Francisco selection: exceptional tables with published recognition from named guides or the Detour community.',
    presentation: 'map',
    center: [37.7749, -122.4194],
    zoom: 13,
    bounds: { latMin: 37.6, latMax: 37.85, lngMin: -122.55, lngMax: -122.33 },
  },
];

export function cityBySlug(slug: string | null | undefined): CityConfig | null {
  if (!slug) return null;
  const wanted = slug.trim().toLowerCase();
  return CITIES.find((c) => c.slug === wanted) ?? null;
}

/** Safe boot-time parse of `?city=…`; absent or invalid values resolve to the chooser. */
export function citySlugFromUrl(search: string): CitySlug | null {
  try {
    return cityBySlug(new URLSearchParams(search).get('city'))?.slug ?? null;
  } catch {
    return null;
  }
}
