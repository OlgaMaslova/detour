/**
 * City presentation config. Since migration 1767986000 the editorial copy and
 * map settings live on the public `cities` collection — adding a city is a
 * content operation (create the record, seed venues), not a frontend deploy.
 * This module only defines the config shape, the neutral fallback copy used
 * when a record leaves editorial fields blank, and slug/url helpers.
 */

/** City route slug. Open-ended: the set of cities is defined by live data. */
export type CitySlug = string;

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
  /** Browser tab title once the app has booted into this city. */
  metaTitle: string;
  /** `meta[name="description"]` content once the app has booted into this city. */
  metaDescription: string;
  /** Whether this city is ready for map-led discovery or published as a list-first preview. */
  presentation: 'map' | 'list';
  /** Map view used when there are no plottable pins to derive bounds from. Present iff presentation is 'map'. */
  center?: [number, number];
  zoom?: number;
  /**
   * Conservative geographic box for the metropolitan area. The visitor's
   * position is only drawn/framed when it falls inside this box, so a distant
   * visitor never drags the city map out to another region. Absent boxes
   * never frame the visitor.
   */
  bounds?: CityBounds;
}

/** The city fields the live catalogue supplies; blanks fall back to neutral copy. */
export interface CityEditorialSource {
  name: string;
  slug: string;
  country: string;
  title?: string;
  tagline?: string;
  footer?: string;
  metaTitle?: string;
  metaDescription?: string;
  presentation?: string;
  center?: [number, number] | null;
  zoom?: number | null;
  bounds?: CityBounds | null;
}

export const GLOBAL_META_TITLE = 'Detour — Exceptional tables, city by city';
export const GLOBAL_META_DESCRIPTION =
  'Detour is a deliberately edited collection of exceptional tables across cities. Choose a city to explore current selections from named guides and the Detour community.';

/**
 * Build the full presentation config for one live city record. Blank
 * editorial fields get neutral copy derived from the city name. A city is
 * only map-led when its record explicitly says `map` AND supplies the
 * fallback view — otherwise it renders as a list-first preview, so an
 * unconfigured or partially configured city can never show a broken map.
 */
export function cityConfigFromLive(live: CityEditorialSource): CityConfig {
  const name = live.name.trim();
  const mapReady =
    live.presentation === 'map' &&
    live.center != null &&
    live.zoom != null &&
    live.bounds != null;
  const config: CityConfig = {
    slug: live.slug,
    name,
    country: live.country,
    title: live.title?.trim() || `${name}’s exceptional tables, selected.`,
    tagline:
      live.tagline?.trim() ||
      '{count} current places holding published recognition from named guides.',
    footer:
      live.footer?.trim() ||
      `Detour is a current, deliberately edited selection of ${name}’s exceptional tables. Each recognition belongs to its guide, with official links preserved for the original listings.`,
    metaTitle: live.metaTitle?.trim() || `Detour — ${name}’s exceptional tables`,
    metaDescription:
      live.metaDescription?.trim() ||
      `Explore Detour’s current ${name} selection: exceptional tables with published recognition from named guides or the Detour community.`,
    presentation: mapReady ? 'map' : 'list',
  };
  if (mapReady) {
    config.center = live.center!;
    config.zoom = live.zoom!;
    config.bounds = live.bounds!;
  }
  return config;
}

/** Safe boot-time parse of `?city=…`. Validated against loaded cities after boot. */
export function citySlugFromUrl(search: string): CitySlug | null {
  try {
    const raw = new URLSearchParams(search).get('city')?.trim().toLowerCase() ?? '';
    return /^[a-z0-9-]+$/.test(raw) ? raw : null;
  } catch {
    return null;
  }
}
