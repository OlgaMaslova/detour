/**
 * The contract between the app and the preview card: one link, one place, both
 * runtimes agreeing which.
 *
 * A member copies a place URL out of the app and pastes it into a chat. The app
 * minted that URL from `src/slugs.ts`; the Worker then has to resolve the same
 * URL back to the same place, using the same functions but from a different
 * starting point — raw API records rather than the catalogue's own `Venue`, and
 * no access to the `cities` collection at all. A disagreement does not throw. It
 * describes a different restaurant, or silently falls back to the generic site
 * card, and nobody finds out.
 *
 * So these tests do not exercise the fetch or the HTML rewrite. They shape one
 * fixture catalogue two ways — as the app holds it and as the Worker holds it —
 * and assert the two arrive at the same answers. Where they cannot agree, the
 * test says so out loud rather than leaving the assumption unwritten.
 */

import { describe, expect, it } from 'vitest';
import { citySlug, venueCitySlug, venuePlaceSlug } from '../src/slugs';
import type { SluggableVenue } from '../src/slugs';
import { matchPlace } from './index';

/* ---------- the fixture, as the API returns it ---------- */

/** Only the venue fields the address is computed from. */
interface Record {
  id: string;
  name: string;
  city: string;
  disambiguator?: string;
}

/** One `cities` row, as the app reads it in `citiesFromRecords`. */
interface City {
  name: string;
  slug: string;
}

const CITIES: City[] = [
  { name: 'Madrid', slug: 'madrid' },
  { name: 'Paris', slug: 'paris' },
  { name: 'San Francisco', slug: 'san-francisco' },
  { name: 'San Sebastián', slug: 'san-sebastian' },
];

/**
 * A catalogue with every shape that decides a slug: plain names, an accented
 * city, one name shared across cities, one shared inside a city and separated by
 * its qualifier, one shared with the qualifier no help at all, and one name that
 * slugs to nothing.
 */
const RECORDS: Record[] = [
  { id: 'rec_botin', name: 'Sobrino de Botín', city: 'Madrid' },
  { id: 'rec_lucio', name: 'Casa Lucio', city: 'Madrid' },
  { id: 'rec_basq_m1', name: 'Bar Basque', city: 'Madrid', disambiguator: 'Chueca' },
  { id: 'rec_basq_m2', name: 'Bar Basque', city: 'Madrid', disambiguator: 'Las Salesas' },
  { id: 'rec_twin_1', name: 'La Tasquita', city: 'Madrid', disambiguator: 'Centro' },
  { id: 'rec_twin_2', name: 'La Tasquita', city: 'Madrid', disambiguator: 'Centro' },
  { id: 'rec_basq_p', name: 'Bar Basque', city: 'Paris' },
  { id: 'rec_septime', name: 'Septime', city: 'Paris' },
  { id: 'rec_zuni', name: 'Zuni Café', city: 'San Francisco' },
  { id: 'rec_akelarre', name: 'Akelarre', city: 'San Sebastián' },
  { id: 'rec_kanji', name: '東京屋', city: 'Madrid' },
];

/**
 * The app's shape. `venueFromRecord` in `src/data.ts` attaches the city record's
 * own slug to every venue, so the app routes by the `cities` collection.
 */
function asApp(records: Record[]): SluggableVenue[] {
  return records.map((record) => {
    const city = CITIES.find((entry) => entry.name === record.city);
    return {
      id: record.id,
      name: record.name,
      city: record.city,
      citySlug: city?.slug ?? citySlug(record.city),
      neighborhood: record.disambiguator ?? '',
    };
  });
}

/**
 * The Worker's shape. `fromRecord` in `./index.ts` reads the same
 * `disambiguator` field but never the `cities` collection — there is no
 * `citySlug`, so `venueCitySlug` derives one from the city name.
 */
function asWorker(records: Record[]): SluggableVenue[] {
  return records.map((record) => ({
    id: record.id,
    name: record.name,
    city: record.city,
    neighborhood: record.disambiguator ?? '',
  }));
}

/** The link the app mints for one of its venues: `?d=<city>&p=<place>`. */
function appLink(venue: SluggableVenue, catalogue: SluggableVenue[]) {
  return { city: venueCitySlug(venue), place: venuePlaceSlug(venue, catalogue) };
}

const app = asApp(RECORDS);
const worker = asWorker(RECORDS);

describe('a link the app minted resolves in the Worker', () => {
  it('resolves every place in the catalogue back to that exact place', () => {
    // The round trip, and the whole point of the file: every address the app can
    // put on a clipboard has to name the same record on the other side.
    for (const venue of app) {
      const { city, place } = appLink(venue, app);
      const found = matchPlace(worker, city, place);
      expect(found, `${venue.name} (${venue.city}) → ?d=${city}&p=${place}`).not.toBeNull();
      expect(found?.id).toBe(venue.id);
    }
  });

  it('gives no two places the same address', () => {
    // Resolution takes the first match, so a collision would not error — it would
    // hand every reader of one link the other place, permanently.
    const addresses = app.map((venue) => {
      const { city, place } = appLink(venue, app);
      return `${city}/${place}`;
    });
    expect(new Set(addresses).size).toBe(addresses.length);
  });

  it('agrees with the app on the readable form, not merely on which record', () => {
    // Both sides landing on the same place by different-looking slugs would still
    // break the canonical URL the card asserts, which is rebuilt from the slugs.
    for (let i = 0; i < app.length; i += 1) {
      expect(appLink(worker[i], worker)).toEqual(appLink(app[i], app));
    }
  });

  it('mints addresses that are already lowercase', () => {
    // The Worker lowercases both query parameters before resolving. That is only
    // safe because a minted slug never contains an uppercase character to lose.
    for (const venue of app) {
      const { city, place } = appLink(venue, app);
      expect(city).toBe(city.toLowerCase());
      expect(place).toBe(place.toLowerCase());
    }
  });
});

describe('matchPlace', () => {
  it('resolves a plain name inside its city', () => {
    expect(matchPlace(worker, 'madrid', 'casa-lucio')?.id).toBe('rec_lucio');
    expect(matchPlace(worker, 'paris', 'septime')?.id).toBe('rec_septime');
  });

  it('resolves an accented name and an accented city', () => {
    expect(matchPlace(worker, 'san-francisco', 'zuni-cafe')?.id).toBe('rec_zuni');
    expect(matchPlace(worker, 'san-sebastian', 'akelarre')?.id).toBe('rec_akelarre');
  });

  it('keeps one name shared by two cities pointing at the right one', () => {
    expect(matchPlace(worker, 'madrid', 'bar-basque-chueca')?.id).toBe('rec_basq_m1');
    expect(matchPlace(worker, 'paris', 'bar-basque')?.id).toBe('rec_basq_p');
  });

  it('will not answer a city with a place from another city', () => {
    // Paris's Bar Basque holds the bare slug; Madrid's two do not, and Madrid must
    // not borrow it.
    expect(matchPlace(worker, 'madrid', 'bar-basque')).toBeNull();
    expect(matchPlace(worker, 'paris', 'casa-lucio')).toBeNull();
  });

  it('separates a same-name, same-qualifier pair by id', () => {
    expect(matchPlace(worker, 'madrid', 'la-tasquita-rec_twin_1')?.id).toBe('rec_twin_1');
    expect(matchPlace(worker, 'madrid', 'la-tasquita-rec_twin_2')?.id).toBe('rec_twin_2');
    expect(matchPlace(worker, 'madrid', 'la-tasquita')).toBeNull();
  });

  it('resolves a place whose name slugs to nothing by its id', () => {
    expect(matchPlace(worker, 'madrid', 'rec_kanji')?.id).toBe('rec_kanji');
  });

  it('returns null for an unknown city, an unknown place, and an empty catalogue', () => {
    expect(matchPlace(worker, 'lisbon', 'casa-lucio')).toBeNull();
    expect(matchPlace(worker, 'madrid', 'a-place-that-closed')).toBeNull();
    expect(matchPlace(worker, '', '')).toBeNull();
    expect(matchPlace([], 'madrid', 'casa-lucio')).toBeNull();
  });

  it('disambiguates against the whole catalogue it is handed', () => {
    // venuePlaceSlug does its own city comparison, so pre-filtering the catalogue
    // to one city would change its answer: Madrid's two Bar Basques would still
    // clash, but a caller who passed only Madrid's rows would be asking a
    // different question than the app asked when it minted the link. Handing
    // matchPlace the full catalogue is what keeps the two questions the same.
    const madridOnly = worker.filter((entry) => citySlug(entry.city) === 'madrid');
    expect(matchPlace(madridOnly, 'madrid', 'bar-basque-chueca')?.id).toBe('rec_basq_m1');
    // ...and this is the divergence pre-filtering would cause elsewhere: Paris's
    // Bar Basque is unique in a Paris-only list, but so it is in the full one.
    // The narrower list only ever loses places, never renames the survivors — so
    // resolution can fail, but it cannot resolve to the wrong place.
    expect(matchPlace(madridOnly, 'paris', 'bar-basque')).toBeNull();
  });
});

describe('where the two runtimes cannot agree', () => {
  it('loses the card when a city record’s slug is not derived from its name', () => {
    // The standing assumption, written down: `cities.slug` equals
    // `citySlug(cities.name)` for every city. The app routes by the record's
    // slug; the Worker has no cities collection and derives one from the venue's
    // city name. Set a slug the derivation would not produce and the app's own
    // links stop resolving here.
    //
    // The failure is a generic site card rather than the wrong place — matchPlace
    // filters by city first, so a mismatch finds nothing at all. Cheap to fix if
    // it ever happens (the Worker would have to read `cities`), and this test is
    // what would notice.
    const records: Record[] = [{ id: 'rec_ny', name: 'Gage & Tollner', city: 'New York' }];
    const routed = records.map((record) => ({
      id: record.id,
      name: record.name,
      city: record.city,
      citySlug: 'nyc', // the cities row says 'nyc'; citySlug('New York') says 'new-york'
    }));
    const { city, place } = appLink(routed[0], routed);
    expect(city).toBe('nyc');
    expect(matchPlace(asWorker(records), city, place)).toBeNull();
    // Derived instead, the same link resolves.
    expect(matchPlace(asWorker(records), 'new-york', place)?.id).toBe('rec_ny');
  });

  it('loses the card for a legacy id-only link the app still opens', () => {
    // `outsidePlaceRoute` and `activePlace` in src/main.ts accept a bare venue id
    // as `?p=`, so links minted before readable slugs existed keep working. The
    // Worker matches on the slug alone and has no such fallback: an old link in an
    // old chat thread opens the right page and previews as the site.
    expect(matchPlace(worker, 'madrid', 'rec_lucio')).toBeNull();
    expect(matchPlace(worker, 'madrid', 'casa-lucio')?.id).toBe('rec_lucio');
  });
});
