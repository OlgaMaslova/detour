/**
 * City map settings and global copy.
 *
 * City *copy* is not data-driven: the hero is built in renderDestination, meta
 * in syncDocumentMeta, and the footer from FOOTER_TAGLINE — all in main.ts.
 * Migration 1768028000 dropped the `cities` copy columns that once fed a
 * config layer here, so there is a single place each string is defined. Only
 * the map fields still travel with a city record.
 */

export interface CityBounds {
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
}

/** The city fields the live catalogue supplies: identity plus map settings. */
export interface CityMapSource {
  name: string;
  slug: string;
  country: string;
  presentation?: string;
  center?: [number, number] | null;
  zoom?: number | null;
  bounds?: CityBounds | null;
}

export const GLOBAL_META_TITLE = 'Detour — Places your network would actually recommend';
export const GLOBAL_META_DESCRIPTION =
  'An invite-only food-and-drink circle built on recommendations from people whose taste you trust. No ads, paid listings, or anonymous stars.';
