/**
 * Imported lists — a published list of places, read off its own page and kept
 * privately by the member who pasted the link.
 *
 * A module of its own for the same reason `saved.ts` is one: more than one
 * surface reads it and none of them owns it. The Wanna go tab groups its places
 * under their list headings, the paste-and-review flow above that tab builds
 * them, and the private place page opens one. Putting the state in any of those
 * would make the other two import it sideways.
 *
 * IT IS FULLY PRIVATE, the same way Wanna go is, and for the same reason: these
 * are places nobody has stood behind. There is no count, no projection, and no
 * response computed for another member that knows any of it exists. See
 * docs/guides-spec.md.
 *
 * TWO KINDS OF STATE LIVE HERE and they have different lifetimes. The lists
 * themselves are read once per session and re-read after a write, exactly like
 * the saved list. The draft — what the last pasted link turned out to hold, and
 * which of it the member still wants — is per-attempt and is thrown away the
 * moment it is kept or abandoned.
 */

import { pb } from './pocketbase';

/** One place on an imported list, as the server reports it. */
export interface ImportedPlace {
  id: string;
  name: string;
  /** The neighbourhood the piece gave — often the only locating fact it had. */
  area: string;
  city: string;
  country: string;
  address: string;
  lat: number;
  lng: number;
  /** Whether locating has been tried — tells "not yet" from "cannot be". */
  locate_tried: boolean;
  /** One sentence of the publication's own copy. Never presented as a note. */
  excerpt: string;
  /**
   * What kind of place the publication said it is, from the closed set the
   * catalogue uses; '' when the page declared nothing.
   *
   * Read from the page's structured data, never inferred from its prose — see
   * the migration. A fallback for display only: a place that turns out to have a
   * catalogue record keeps the category a member gave it, because that is the
   * one somebody stood behind.
   */
  category: string;
  /** The publication's own word for the cuisine — "Georgian"; '' when none. */
  cuisine: string;
  source_url: string;
  /**
   * The publication's photograph, at their address. Hotlinked, never copied, and
   * last in the card's cover chain — a member's own photo and the catalogue's
   * verified cover both beat it. '' when the page offered none, or when it
   * offered one this app would not put in an `src`.
   */
  image_url: string;
  /** The published venue this turned out to be, or '' — re-checked on every read. */
  matched_venue: string;
  /**
   * "Not this one." The member said so, and it holds.
   *
   * A place a member skipped stays on the guide that named it — dimmed, under
   * Skipped, with an undo — because that page is a record of what the piece
   * said. Everywhere else it is gone: not on the wishlist, not on the city page,
   * not in a count, not a pin. The alternative was Remove, which deletes the row
   * and lets the next re-import of the same link bring it straight back.
   */
  skipped: boolean;
  /** Every guide this place appears on. Empty once its guides are gone. */
  guides: string[];
  created: string;
}

/** One list the member kept. */
export interface Guide {
  id: string;
  /** What the member calls it; the article's headline until they change it. */
  title: string;
  source_name: string;
  source_title: string;
  source_url: string;
  created: string;
  places: ImportedPlace[];
}

/** One place as the review screen holds it, before anything is written. */
export interface DraftPlace {
  name: string;
  area: string;
  address: string;
  city: string;
  country: string;
  excerpt: string;
  image_url: string;
  /** What the page said this place is, carried through the review unchanged. */
  category: string;
  cuisine: string;
  /** Detour already has this place, because somebody recommended it. */
  matched: boolean;
  matched_venue: string;
  /** It is already on this member's own list. Checked off by default. */
  already_have: boolean;
  keep: boolean;
}

/** What the last pasted link turned out to hold, awaiting the member's answer. */
export interface ImportDraft {
  url: string;
  title: string;
  source: string;
  city: string;
  readBy: string;
  /** Set when this link has been imported before: keeping refreshes that list. */
  knownListTitle: string;
  places: DraftPlace[];
}

let items: Guide[] = [];
/**
 * Imported places belonging to no list at all.
 *
 * A real state, not an accident: a member who removes a list is asked whether
 * to take its places with it, and "keep the places" leaves exactly these. They
 * show on Wanna go under "Not from a guide", beside the saves pressed one at a
 * time — which is what they now are.
 */
let ungroupedItems: ImportedPlace[] = [];
let loaded = false;
let request: Promise<void> | null = null;

let draft: ImportDraft | null = null;
/**
 * Whether the import dialogue is open.
 *
 * Its own flag rather than "open when there is a draft", because the dialogue
 * opens *before* there is one — the paste field and the review screen are two
 * states of one modal, and the twenty seconds a long page takes to read happen
 * between them. A member who has waited that long must not have the thing they
 * were waiting for open in a different place from where they started.
 */
let dialogOpen = false;
let reading = false;
let keeping = false;
/** The server's own sentence when the last read or keep failed. */
let failure = '';
/** Ids of lists mid-removal, so their control settles without the whole tab moving. */
const removing = new Set<string>();

function text(row: Record<string, unknown>, key: string): string {
  return typeof row[key] === 'string' ? (row[key] as string) : '';
}

function number(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function readPlace(value: unknown): ImportedPlace | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const id = text(row, 'id');
  const name = text(row, 'name');
  // A row with no id cannot be opened or removed, and one with no name cannot be
  // read; either way it is no use on the tab.
  if (!id || !name) return null;
  const guides = Array.isArray(row.guides) ? row.guides.filter((entry) => typeof entry === 'string') : [];
  return {
    id,
    name,
    area: text(row, 'area'),
    city: text(row, 'city'),
    country: text(row, 'country'),
    address: text(row, 'address'),
    lat: number(row, 'lat'),
    lng: number(row, 'lng'),
    locate_tried: row.locate_tried === true,
    excerpt: text(row, 'excerpt'),
    category: text(row, 'category'),
    cuisine: text(row, 'cuisine'),
    source_url: text(row, 'source_url'),
    image_url: text(row, 'image_url'),
    matched_venue: text(row, 'matched_venue'),
    skipped: row.skipped === true,
    guides: guides as string[],
    created: text(row, 'created'),
  };
}

function readUngrouped(value: unknown): ImportedPlace[] {
  if (!value || typeof value !== 'object') return [];
  const rows = (value as { ungrouped?: unknown }).ungrouped;
  if (!Array.isArray(rows)) return [];
  return rows.map(readPlace).filter(Boolean) as ImportedPlace[];
}

function readGuides(value: unknown): Guide[] {
  if (!value || typeof value !== 'object') return [];
  const rows = (value as { items?: unknown }).items;
  if (!Array.isArray(rows)) return [];
  const parsed: Guide[] = [];
  for (const entry of rows) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const id = text(row, 'id');
    if (!id) continue;
    const places = Array.isArray(row.places)
      ? (row.places.map(readPlace).filter(Boolean) as ImportedPlace[])
      : [];
    parsed.push({
      id,
      title: text(row, 'title'),
      source_name: text(row, 'source_name'),
      source_title: text(row, 'source_title'),
      source_url: text(row, 'source_url'),
      created: text(row, 'created'),
      places,
    });
  }
  return parsed;
}

async function loadLists(signedInAs: string, render: () => void): Promise<void> {
  const payload = await pb.send<unknown>('/api/detour/guides', { requestKey: null }).catch(() => null);
  // A read that failed states nothing: the lists stay as they were and open to a
  // retry. A session that changed hands mid-flight is answered by its own
  // request, never by this one.
  if (!payload || pb.authStore.record?.id !== signedInAs) return;
  items = readGuides(payload);
  ungroupedItems = readUngrouped(payload);
  loaded = true;
  render();
}

/**
 * Read the lists once per session. Safe to call on any render — the answer is
 * fetched at most once, and a failed read leaves them untouched.
 */
export function ensureGuides(render: () => void): Promise<void> {
  const signedInAs = pb.authStore.record?.id;
  if (!signedInAs || loaded) return Promise.resolve();
  if (!request) {
    request = loadLists(signedInAs, render).finally(() => {
      request = null;
    });
  }
  return request;
}

/** Re-read the lists. Used after every write. */
export async function refreshGuides(render: () => void): Promise<void> {
  const signedInAs = pb.authStore.record?.id;
  if (!signedInAs) return;
  const payload = await pb.send<unknown>('/api/detour/guides', { requestKey: null }).catch(() => null);
  if (!payload || pb.authStore.record?.id !== signedInAs) return;
  items = readGuides(payload);
  ungroupedItems = readUngrouped(payload);
  loaded = true;
  render();
}

/** The lists, newest first, as the server ordered them. */
export function guides(): Guide[] {
  return items;
}

/**
 * Every imported place the member holds, once, whichever guides name it.
 *
 * The destinations index and the destination pages both group by city rather
 * than by guide — a guide is a source, not a container — so both want the flat
 * set. Deduped by id, because a place on two guides is one place.
 */
export function allImportedPlaces(): ImportedPlace[] {
  const byId = new Map<string, ImportedPlace>();
  for (const guide of items) {
    for (const place of guide.places) byId.set(place.id, place);
  }
  for (const place of ungroupedItems) byId.set(place.id, place);
  // Skipped places are not on the wishlist and never appear in a count: they
  // survive on their own guide page and nowhere else. Filtered here rather than
  // at each caller, so nothing downstream has to remember.
  return [...byId.values()].filter((place) => !place.skipped);
}

/** Imported places on no guide — kept when the guide they arrived on was removed. */
function ungroupedImportedPlaces(): ImportedPlace[] {
  return ungroupedItems;
}

/** Whether the lists have been read yet — an empty set and an unread one differ. */
export function guidesLoaded(): boolean {
  return loaded;
}

/** One imported place by id, across every list. */
export function importedPlace(id: string): ImportedPlace | null {
  for (const list of items) {
    for (const place of list.places) {
      if (place.id === id) return place;
    }
  }
  // A kept place has no list to be found under, and its page must still open.
  for (const place of ungroupedItems) {
    if (place.id === id) return place;
  }
  return null;
}

/**
 * Venue ids the member holds through an imported list.
 *
 * The Wanna go tab uses this to keep a place from appearing twice: a member who
 * pressed Wanna go on Tatiana last week and then imports a list naming Tatiana
 * should see it once, under the list heading, not once there and once loose
 * above it. The list heading wins because it carries where the place came from.
 */
export function importedVenueIds(): Set<string> {
  const ids = new Set<string>();
  for (const list of items) {
    for (const place of list.places) {
      if (place.matched_venue && !place.skipped) ids.add(place.matched_venue);
    }
  }
  // Kept places are shown under "Not from a guide" as imported cards, so a loose
  // save on the same venue would still be the duplicate this set exists to stop.
  for (const place of ungroupedItems) {
    if (place.matched_venue && !place.skipped) ids.add(place.matched_venue);
  }
  return ids;
}

/* ---------- the paste, and what it turned out to hold ---------- */

export function importDraft(): ImportDraft | null {
  return draft;
}

export function importReading(): boolean {
  return reading;
}

export function importKeeping(): boolean {
  return keeping;
}

export function importFailure(): string {
  return failure;
}

// NO "KEPT …" CONFIRMATION, deliberately. There was one, and it was wrong twice:
// it never cleared, and it repeated word for word the heading of the list that
// had just appeared directly beneath it. A list on the tab that was not there a
// moment ago is the confirmation — a sentence saying so is furniture that
// outlives the moment it was for.

/**
 * An imported cover at a size the surface asking for it can afford.
 *
 * Eater serves its photographs at around 3.7MB each. That is a fine photograph
 * and an absurd thumbnail — a grid of thirty-eight would be well over a hundred
 * megabytes. Their CDN is the WordPress/Photon one, which resizes from a `w`
 * parameter: the same image comes back at 58KB, a sixty-fold saving for one
 * query parameter.
 *
 * APPLIED ONLY TO URLS THAT ALREADY CARRY PHOTON'S OWN PARAMETERS. An
 * unrecognised CDN may sign its URLs, and an extra parameter would turn a
 * working photograph into a 403 — trading a heavy image for no image. Anything
 * unrecognised is left exactly as the publisher wrote it and simply loads at
 * full size, lazily, which is the status quo rather than a regression.
 */
export function importedCoverHref(url: string, width = 640): string {
  if (!url) return '';
  if (!/[?&](?:quality|strip|crop|resize|fit)=/i.test(url)) return url;
  if (/[?&]w=/i.test(url)) return url;
  return `${url}${url.indexOf('?') === -1 ? '?' : '&'}w=${width}`;
}

/**
 * What to credit a list's words to: the publication, not the member's name for
 * the list.
 *
 * "NYC trip, October" is what the member calls their own collection; "Eater NY"
 * is who wrote the sentence under each place. Only the second is an
 * attribution, and attributing somebody else's prose to a title the member
 * invented would be the wrong half of the pair. Falls back to the host, which is
 * always something, and to a plain phrase when even that is missing.
 */
export function guideAuthorLabel(list: Guide): string {
  return list.source_name.trim() || hostLabel(list.source_url) || 'the guide you kept';
}

/**
 * The same credit for a place with no list left to ask.
 *
 * A kept place outlives the list it arrived on, and the publication is still who
 * wrote its sentence — so the host of the URL it was read from stands in for the
 * name that list was carrying.
 */
export function importedPlaceSourceLabel(place: ImportedPlace): string {
  return hostLabel(place.source_url) || 'a guide you kept';
}

function hostLabel(url: string): string {
  return url.replace(/^https?:\/\//i, '').split('/')[0].replace(/^www\./i, '');
}

/** Whether a removal for this id — a list's or a place's — is in flight. */
export function removingImported(id: string): boolean {
  return removing.has(id);
}

/**
 * The route of one private place. Defined here rather than in main.ts because
 * this feature owns the shape of its own link, and two modules building `?mine=`
 * separately is how a link and the router quietly stop agreeing.
 *
 * A private place has no city and no slug: it is not in the catalogue, so there
 * is no `?d=` for it to sit inside and nothing about it is shareable. The id is
 * the whole address, and it only resolves for the member who holds the row.
 */
export function privatePlaceHref(id: string): string {
  return `?mine=${encodeURIComponent(id)}`;
}

/** Whether the import dialogue should be showing. */
export function importDialogOpen(): boolean {
  return dialogOpen;
}

/** Open the dialogue on its first state: the empty paste field. */
export function openImportDialog(render: () => void): void {
  dialogOpen = true;
  draft = null;
  failure = '';
  render();
}

/**
 * Close the dialogue and abandon whatever was in it.
 *
 * Nothing to undo: the read writes nothing, so a member who pastes a link, looks
 * at what came back and closes the dialogue has changed nothing anywhere. That
 * is the whole reason reading and keeping are separate calls, and it is what
 * makes closing on Escape safe enough to allow.
 *
 * A read still in flight is deliberately not cancelled — it writes nothing
 * either, and its own `finally` clears the flag against a dialogue that is no
 * longer there.
 */
export function closeImportDialog(render: () => void): void {
  dialogOpen = false;
  draft = null;
  failure = '';
  render();
}

/** Abandon the review screen. The draft was never written, so nothing is undone. */
export function cancelImport(render: () => void): void {
  closeImportDialog(render);
}

/** Toggle one place on the review screen. */
export function toggleDraftPlace(index: number, render: () => void): void {
  if (!draft || index < 0 || index >= draft.places.length) return;
  draft.places[index].keep = !draft.places[index].keep;
  render();
}

/** Check or clear every place on the review screen at once. */
export function setAllDraftPlaces(keep: boolean, render: () => void): void {
  if (!draft) return;
  // Never re-checks a place the member already holds: "select all" is about the
  // ones still on offer.
  for (const place of draft.places) place.keep = keep && !place.already_have;
  render();
}

export function setDraftTitle(value: string): void {
  if (draft) draft.title = value;
}

export function setDraftCity(value: string): void {
  if (draft) draft.city = value;
}

/**
 * Read a pasted link. Writes nothing, here or on the server.
 *
 * A link that cannot be read leaves the member exactly where they were, with the
 * server's own sentence beside the field. That is the contract the route keeps
 * too: no part of this feature may be made to depend on a page having been
 * readable.
 */
export async function readListLink(url: string, render: () => void): Promise<void> {
  const value = url.trim();
  if (!value || reading) return;
  reading = true;
  failure = '';
  render();
  try {
    const result = await pb.send<Record<string, unknown>>('/api/detour/guides/read', {
      method: 'POST',
      body: { url: value },
      requestKey: null,
    });
    if (result.resolved !== true) {
      failure = text(result, 'reason') || 'We could not read that link.';
      draft = null;
      return;
    }
    const rows = Array.isArray(result.places) ? result.places : [];
    draft = {
      url: text(result, 'url') || value,
      title: text(result, 'title'),
      source: text(result, 'source'),
      city: text(result, 'city'),
      readBy: text(result, 'read_by'),
      knownListTitle: text(result, 'known_list_title'),
      places: rows
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null;
          const row = entry as Record<string, unknown>;
          const name = text(row, 'name');
          if (!name) return null;
          const alreadyHave = row.already_have === true;
          return {
            name,
            area: text(row, 'area'),
            address: text(row, 'address'),
            city: text(row, 'city'),
            country: text(row, 'country'),
            excerpt: text(row, 'excerpt'),
            image_url: text(row, 'image_url'),
            category: text(row, 'category'),
            cuisine: text(row, 'cuisine'),
            matched: row.matched === true,
            matched_venue: text(row, 'matched_venue'),
            already_have: alreadyHave,
            // Everything is offered checked except what the member already has.
            // Re-checking those would make "keep 35" mean "keep 35, two of which
            // do nothing", which is a count that lies.
            keep: !alreadyHave,
          } as DraftPlace;
        })
        .filter(Boolean) as DraftPlace[],
    };
    if (!draft.places.length) {
      failure = 'We could not find any places on that page.';
      draft = null;
    }
  } catch (error) {
    failure = readError(error, 'We could not read that link just now. Try again in a moment.');
    draft = null;
  } finally {
    reading = false;
    render();
  }
}

/** Keep the checked places under the named list. The one write this feature has. */
export async function keepImportDraft(render: () => void): Promise<void> {
  if (!draft || keeping) return;
  const chosen = draft.places.filter((place) => place.keep);
  if (!chosen.length) {
    failure = 'Choose at least one place to keep.';
    render();
    return;
  }
  const title = draft.title.trim();
  if (!title) {
    failure = 'Give the guide a name.';
    render();
    return;
  }
  keeping = true;
  failure = '';
  render();
  try {
    await pb.send('/api/detour/guides', {
      method: 'POST',
      body: {
        url: draft.url,
        title,
        source: draft.source,
        source_title: draft.title,
        city: draft.city.trim(),
        read_by: draft.readBy,
        places: chosen.map((place) => ({
          name: place.name,
          area: place.area,
          address: place.address,
          city: place.city || draft?.city.trim() || '',
          country: place.country,
          excerpt: place.excerpt,
          image_url: place.image_url,
          category: place.category,
          cuisine: place.cuisine,
        })),
      },
      requestKey: null,
    });
    draft = null;
    // The dialogue's work is done, so it closes itself. The confirmation is on
    // the tab behind it, next to the list that just landed — which is the thing
    // the member wanted to see, and it is not visible from inside a modal.
    dialogOpen = false;
    await refreshGuides(render);
  } catch (error) {
    failure = readError(error, 'That guide could not be kept just now. Try again in a moment.');
  } finally {
    keeping = false;
    render();
  }
}

/** Remove a whole list. Places it shares with another list are kept. */
export async function removeGuide(
  id: string,
  places: 'keep' | 'remove',
  render: () => void
): Promise<void> {
  if (!id || removing.has(id)) return;
  removing.add(id);
  failure = '';
  render();
  try {
    await pb.send(`/api/detour/guides/${encodeURIComponent(id)}?places=${places}`, {
      method: 'DELETE',
      requestKey: null,
    });
    await refreshGuides(render);
  } catch (error) {
    failure = readError(error, 'That guide could not be removed just now.');
  } finally {
    removing.delete(id);
    render();
  }
}

/**
 * Skip one place off a list, or take the skip back.
 *
 * The one write on this page that is not a removal, and the reason the removal
 * is now rarely the right answer: skipping keeps the row, so the guide still
 * reads as the piece the member kept, and a re-import of the same link does not
 * hand back the twenty-seven places they had already said no to.
 *
 * Shares `removing` with the delete: both are per-row states a control has to
 * settle without the whole tab moving, and no row is ever mid-skip and
 * mid-removal at once.
 */
export async function setImportedPlaceSkipped(
  id: string,
  skipped: boolean,
  render: () => void
): Promise<void> {
  if (!id || removing.has(id)) return;
  removing.add(id);
  failure = '';
  render();
  try {
    await pb.send(`/api/detour/guides/places/${encodeURIComponent(id)}/skip`, {
      method: 'PATCH',
      body: { skipped },
      requestKey: null,
    });
    await refreshGuides(render);
  } catch (error) {
    failure = readError(error, 'That could not be recorded just now.');
  } finally {
    removing.delete(id);
    render();
  }
}

/** Remove one place from every list it sits under. */
export async function removeImportedPlace(id: string, render: () => void): Promise<void> {
  if (!id || removing.has(id)) return;
  removing.add(id);
  failure = '';
  render();
  try {
    await pb.send(`/api/detour/guides/places/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      requestKey: null,
    });
    await refreshGuides(render);
  } catch (error) {
    failure = readError(error, 'That place could not be removed just now.');
  } finally {
    removing.delete(id);
    render();
  }
}

/**
 * The route of one city — every place it holds, and the map of them.
 *
 * A slug rather than an id, because a city has no record to carry one: it is
 * derived from the places that name it, and it exists only while at least one of
 * them does.
 *
 * The plain `?d=` route and nothing else. It carried `&lens=yours` while the
 * city page had two readings and this link meant the member's own; the page
 * shows both in one list now, so there is no reading left to name. `?dest=`, the
 * separate page that came before that, still resolves here too.
 */
export function destinationBoardHref(slug: string): string {
  return `?d=${encodeURIComponent(slug)}`;
}

/**
 * The route of one guide's own page — the places it brought, and their map.
 *
 * Defined beside `privatePlaceHref` and for the same reason: this feature owns
 * the shape of its own links, and two modules building `?guide=` separately is
 * how a link and the router quietly stop agreeing.
 */
export function guideHref(id: string): string {
  return `?guide=${encodeURIComponent(id)}`;
}

/**
 * Read one list in full, locating a batch of its places on the way.
 *
 * The list page's own call. That server-side batch is what fills the map in:
 * see the route. Returns null rather than throwing — a list that cannot be
 * re-read is shown from whatever the tab already holds.
 */
export async function loadGuide(id: string): Promise<Guide | null> {
  if (!id) return null;
  const payload = await pb
    .send<{ guide?: unknown }>(`/api/detour/guides/${encodeURIComponent(id)}`, { requestKey: null })
    .catch(() => null);
  if (!payload || !payload.guide || typeof payload.guide !== 'object') return null;
  const parsed = readGuides({ items: [payload.guide] })[0];
  if (!parsed) return null;
  // Fold it back in, so the tab and the map agree about what this list holds and
  // a second visit already has the coordinates this read just settled.
  let replaced = false;
  items = items.map((entry) => {
    if (entry.id !== parsed.id) return entry;
    replaced = true;
    return parsed;
  });
  if (!replaced) items = [parsed, ...items];
  return parsed;
}

/** One list by id, from what has already been read. */
export function guide(id: string): Guide | null {
  return items.find((entry) => entry.id === id) || null;
}

/**
 * Read one private place in full, filling in its coordinates if they can be.
 *
 * The private page's own read, and the only call that locates anything — see the
 * route. Returns null rather than throwing: a place that cannot be re-read is
 * shown from what the list already holds.
 */
export async function loadImportedPlace(id: string): Promise<ImportedPlace | null> {
  if (!id) return null;
  const payload = await pb
    .send<{ place?: unknown }>(`/api/detour/guides/places/${encodeURIComponent(id)}`, {
      requestKey: null,
    })
    .catch(() => null);
  if (!payload) return null;
  const place = readPlace(payload.place);
  if (!place) return null;
  // Fold the fresh row back in, so a second visit to the tab shows the
  // coordinates and the match this read just settled.
  for (const list of items) {
    for (let index = 0; index < list.places.length; index += 1) {
      if (list.places[index].id === place.id) list.places[index] = place;
    }
  }
  return place;
}

/** A new session reads its own lists; the previous member's are not inherited. */
export function resetGuides(): void {
  items = [];
  ungroupedItems = [];
  loaded = false;
  request = null;
  draft = null;
  dialogOpen = false;
  reading = false;
  keeping = false;
  failure = '';
  removing.clear();
}

/**
 * The server's own sentence when it sent one — every refusal here is readable.
 *
 * Only `response.message` counts, because only that came from the server. The
 * SDK fills `error.message` in on every failure, including the ones where
 * nothing answered at all, and its placeholder there — "Something went wrong." —
 * is worse than the fallback: it tells the member neither what happened nor that
 * trying again is the thing to do.
 */
function readError(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    const response = error as { response?: { message?: string } };
    return response.response?.message || fallback;
  }
  return fallback;
}
