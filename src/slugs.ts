/**
 * How a place becomes a URL.
 *
 * Its own module, and a leaf one on purpose: these three functions decide what
 * `?d=` and `?p=` mean, and two different runtimes have to agree on the answer.
 * The app resolves a link into a place; the Cloudflare Worker in `worker/`
 * resolves the same link into the preview card a messaging app shows for it. A
 * second implementation of `venuePlaceSlug` on either side would not fail
 * loudly — it would quietly describe the wrong restaurant in a WhatsApp bubble.
 *
 * So nothing here may import `pocketbase`, `./data`, or anything else that
 * reaches for the browser or a session. The venue arguments are structural
 * rather than `Venue` for the same reason: the Worker holds raw API records with
 * a handful of fields, not the catalogue's own type.
 */

/** The parts of a place these slugs are computed from, and nothing more. */
export interface SluggableVenue {
  id: string;
  name: string;
  city: string;
  /** The city record's own slug when there is one; derived from `city` otherwise. */
  citySlug?: string;
  /**
   * Read from the venue's `disambiguator` — the qualifier a member gave to tell
   * two same-named places apart. Optional here because a caller holding only
   * API records may not have asked for the field.
   */
  neighborhood?: string;
}

export function citySlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Route slug of the city a venue is listed under (e.g. 'san-francisco'). */
export function venueCitySlug(v: SluggableVenue): string {
  return v.citySlug || citySlug(v.city);
}

/**
 * Readable slug identifying one place inside its city route, so every place
 * page has a shareable URL. Two places in the same city can normalise to the
 * same name slug (two 'Bar Basque'); the venue id disambiguates only those, and
 * a place whose name yields no slug at all falls back to the id outright.
 */
export function venuePlaceSlug(v: SluggableVenue, all: SluggableVenue[]): string {
  const base = citySlug(v.name);
  if (!base) return v.id;
  const city = venueCitySlug(v);
  const sharing = all.filter(
    (other) => other.id !== v.id && venueCitySlug(other) === city && citySlug(other.name) === base
  );
  if (!sharing.length) return base;
  // Two places share this name in this city. The qualifier a member gave to tell
  // them apart for a reader tells them apart in the URL too, so long as it is
  // unique among the places it is distinguishing this one from. Falling back to
  // the record id keeps every other clash addressable, just less legibly.
  const qualifier = citySlug(v.neighborhood || '');
  if (qualifier && !sharing.some((other) => citySlug(other.neighborhood || '') === qualifier)) {
    return `${base}-${qualifier}`;
  }
  return `${base}-${v.id}`;
}
