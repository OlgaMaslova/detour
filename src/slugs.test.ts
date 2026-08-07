/**
 * What `?d=` and `?p=` mean.
 *
 * These three functions are the only definition of a place's address, and two
 * runtimes compute it independently — the app resolves a link into a place, the
 * Worker in `worker/` resolves the same link into the preview card a messaging
 * app shows. Neither would fail loudly if they disagreed, so the cases below fix
 * the answer rather than describe it. The agreement itself is tested in
 * `worker/place-link.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { citySlug, venueCitySlug, venuePlaceSlug } from './slugs';
import type { SluggableVenue } from './slugs';

/** A sluggable place, with only the fields under test spelled out per case. */
function place(fields: Partial<SluggableVenue> & { id: string }): SluggableVenue {
  return { name: '', city: '', ...fields };
}

describe('citySlug', () => {
  it('lowercases and hyphenates', () => {
    expect(citySlug('San Francisco')).toBe('san-francisco');
    expect(citySlug('MADRID')).toBe('madrid');
  });

  it('strips diacritics rather than dropping the letters they sit on', () => {
    // 'San Sebastián' must not become 'san-sebasti-n' — the accent is decomposed
    // and discarded, leaving the base letter.
    expect(citySlug('San Sebastián')).toBe('san-sebastian');
    expect(citySlug('Málaga')).toBe('malaga');
    expect(citySlug('Café Central')).toBe('cafe-central');
    expect(citySlug('Zürich')).toBe('zurich');
  });

  it('collapses each run of punctuation or space into one hyphen', () => {
    expect(citySlug("L'Escala")).toBe('l-escala');
    expect(citySlug('Bar   Basque')).toBe('bar-basque');
    expect(citySlug('Sant Pau — del Camp')).toBe('sant-pau-del-camp');
    expect(citySlug('Ça Va, Bien!')).toBe('ca-va-bien');
  });

  it('trims leading and trailing hyphens', () => {
    expect(citySlug('  Lisbon  ')).toBe('lisbon');
    expect(citySlug('¡Olé!')).toBe('ole');
    expect(citySlug('...Rest')).toBe('rest');
  });

  it('keeps digits', () => {
    expect(citySlug('Bar 44')).toBe('bar-44');
    expect(citySlug('7 Portes')).toBe('7-portes');
  });

  it('returns an empty string when nothing sluggable is left', () => {
    // The caller has to handle this: venuePlaceSlug falls back to the record id.
    expect(citySlug('')).toBe('');
    expect(citySlug('!!!')).toBe('');
    expect(citySlug('   ')).toBe('');
    expect(citySlug('東京')).toBe('');
  });

  it('does not transliterate letters that have no decomposed form', () => {
    // Documented limitation, not an aspiration: NFKD leaves 'ß' and 'ø' whole,
    // so they are punctuation as far as the character class is concerned. Both
    // still produce a stable, non-empty slug, which is all the routing needs.
    expect(citySlug('Straße')).toBe('stra-e');
    expect(citySlug('Nørrebro')).toBe('n-rrebro');
  });
});

describe('venueCitySlug', () => {
  it("prefers the city record's own slug", () => {
    // The catalogue's cities carry a slug column; when it is set it wins, so a
    // city can be routed under a name the derivation would not produce.
    expect(venueCitySlug(place({ id: 'v1', city: 'New York', citySlug: 'nyc' }))).toBe('nyc');
  });

  it('derives from the city name when no record slug travelled with the place', () => {
    // The Worker holds raw API records and never reads the cities collection, so
    // this is the branch it always takes.
    expect(venueCitySlug(place({ id: 'v1', city: 'San Francisco' }))).toBe('san-francisco');
    expect(venueCitySlug(place({ id: 'v1', city: 'San Sebastián' }))).toBe('san-sebastian');
  });

  it('derives when the record slug is empty', () => {
    expect(venueCitySlug(place({ id: 'v1', city: 'Madrid', citySlug: '' }))).toBe('madrid');
  });
});

describe('venuePlaceSlug', () => {
  it('is the name slug when no other place in the city shares it', () => {
    const sobrino = place({ id: 'v1', name: 'Sobrino de Botín', city: 'Madrid' });
    const all = [sobrino, place({ id: 'v2', name: 'Casa Lucio', city: 'Madrid' })];
    expect(venuePlaceSlug(sobrino, all)).toBe('sobrino-de-botin');
  });

  it('ignores same-named places in other cities', () => {
    // The slug only has to be unique inside its own city route, so two cities'
    // Bar Basque both keep the readable form.
    const madrid = place({ id: 'v1', name: 'Bar Basque', city: 'Madrid' });
    const paris = place({ id: 'v2', name: 'Bar Basque', city: 'Paris' });
    const all = [madrid, paris];
    expect(venuePlaceSlug(madrid, all)).toBe('bar-basque');
    expect(venuePlaceSlug(paris, all)).toBe('bar-basque');
  });

  it('compares cities by slug, not by name', () => {
    // Two spellings of one city routed under the same slug are the same city for
    // uniqueness purposes — otherwise both places would claim the same address.
    const a = place({ id: 'v1', name: 'Bar Basque', city: 'San Sebastian', citySlug: 'donostia' });
    const b = place({ id: 'v2', name: 'Bar Basque', city: 'San Sebastián', citySlug: 'donostia' });
    const all = [a, b];
    expect(venuePlaceSlug(a, all)).not.toBe(venuePlaceSlug(b, all));
  });

  it('separates a clash by the qualifier a member gave to tell them apart', () => {
    const chueca = place({
      id: 'v1',
      name: 'Bar Basque',
      city: 'Madrid',
      neighborhood: 'Chueca',
    });
    const salesas = place({
      id: 'v2',
      name: 'Bar Basque',
      city: 'Madrid',
      neighborhood: 'Las Salesas',
    });
    const all = [chueca, salesas];
    expect(venuePlaceSlug(chueca, all)).toBe('bar-basque-chueca');
    expect(venuePlaceSlug(salesas, all)).toBe('bar-basque-las-salesas');
  });

  it('falls back to the id when the qualifier does not distinguish either', () => {
    // Same name, same qualifier: the qualifier tells a reader nothing here, so it
    // would tell a URL nothing either.
    const first = place({ id: 'v1', name: 'Bar Basque', city: 'Madrid', neighborhood: 'Centro' });
    const second = place({ id: 'v2', name: 'Bar Basque', city: 'Madrid', neighborhood: 'Centro' });
    const all = [first, second];
    expect(venuePlaceSlug(first, all)).toBe('bar-basque-v1');
    expect(venuePlaceSlug(second, all)).toBe('bar-basque-v2');
  });

  it('falls back to the id for the place in a clash that has no qualifier', () => {
    const named = place({ id: 'v1', name: 'Bar Basque', city: 'Madrid', neighborhood: 'Chueca' });
    const bare = place({ id: 'v2', name: 'Bar Basque', city: 'Madrid' });
    const all = [named, bare];
    expect(venuePlaceSlug(named, all)).toBe('bar-basque-chueca');
    expect(venuePlaceSlug(bare, all)).toBe('bar-basque-v2');
  });

  it('keeps every place in a three-way clash separately addressable', () => {
    const all = [
      place({ id: 'v1', name: 'Bar Basque', city: 'Madrid', neighborhood: 'Chueca' }),
      place({ id: 'v2', name: 'Bar Basque', city: 'Madrid', neighborhood: 'Centro' }),
      place({ id: 'v3', name: 'Bar Basque', city: 'Madrid', neighborhood: 'Centro' }),
    ];
    const slugs = all.map((v) => venuePlaceSlug(v, all));
    expect(slugs).toEqual(['bar-basque-chueca', 'bar-basque-v2', 'bar-basque-v3']);
    expect(new Set(slugs).size).toBe(3);
  });

  it('is the id outright when the name yields no slug', () => {
    const tokyo = place({ id: 'v1', name: '東京', city: 'Tokyo' });
    expect(venuePlaceSlug(tokyo, [tokyo])).toBe('v1');
  });

  it('does not treat a place as clashing with itself', () => {
    // The same record may appear in the catalogue list it is being slugged
    // against — matching on id is what keeps it from disambiguating against a
    // copy of itself and picking up an id suffix nothing needed.
    const only = place({ id: 'v1', name: 'Casa Lucio', city: 'Madrid' });
    expect(venuePlaceSlug(only, [only])).toBe('casa-lucio');
  });

  it('does not depend on the order of the catalogue it is given', () => {
    const chueca = place({ id: 'v1', name: 'Bar Basque', city: 'Madrid', neighborhood: 'Chueca' });
    const centro = place({ id: 'v2', name: 'Bar Basque', city: 'Madrid', neighborhood: 'Centro' });
    const other = place({ id: 'v3', name: 'Casa Lucio', city: 'Madrid' });
    const forwards = [chueca, centro, other];
    const backwards = [other, centro, chueca];
    for (const v of forwards) {
      expect(venuePlaceSlug(v, backwards)).toBe(venuePlaceSlug(v, forwards));
    }
  });
});
