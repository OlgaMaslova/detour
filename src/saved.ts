/**
 * Wanna go — the member's own list of places they mean to get to.
 *
 * A module of its own because three surfaces read it and none of them owns it:
 * the place page offers the action, My detours lists what it produced, and the
 * private-share inbox is the only way somebody else's suggestion becomes one of
 * these. Putting the state in any one of those would make the other two import
 * it sideways.
 *
 * IT IS FULLY PRIVATE, and that is what shapes this file. There is no count to
 * hold, no other member's saves to merge in, and no projection to reconcile
 * against — the server has exactly one read path for this feature and it returns
 * the caller's own rows. So the client holds the whole list, which is small, and
 * every surface answers "have I saved this?" from it rather than asking again.
 *
 * See docs/wanna-go-spec.md.
 */

import { pb } from './pocketbase';

/** One place on the member's own list, as the server reports it. */
export interface SavedPlace {
  id: string;
  venue_id: string;
  venue_name: string;
  city: string;
  country: string;
  /** Which surface produced the intention: place_page, triage, share, feed. */
  source: string;
  created: string;
}

/** Where a save was pressed. The server accepts these four and nothing else. */
export type SaveSource = 'place_page' | 'triage' | 'share' | 'feed';

let items: SavedPlace[] = [];
let savedIds = new Set<string>();
let loaded = false;
let request: Promise<void> | null = null;
/** Toggles in flight, by the reference the surface pressed with. */
const pending = new Set<string>();
/**
 * The last refusal, keyed by the reference that was pressed, so the surface that
 * pressed can show the server's own sentence beside the control that failed
 * rather than raising a notice somewhere else on the page.
 */
const failures = new Map<string, string>();

function readSaved(value: unknown): SavedPlace[] {
  if (!value || typeof value !== 'object') return [];
  const list = (value as { items?: unknown }).items;
  if (!Array.isArray(list)) return [];
  const parsed: SavedPlace[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const text = (key: string): string => (typeof row[key] === 'string' ? (row[key] as string) : '');
    const venueId = text('venue_id');
    // A row whose entry has no venue yet cannot be linked to or opened, so it is
    // no use on the tab and no use as a "have I saved this?" answer either.
    if (!venueId) continue;
    parsed.push({
      id: text('id'),
      venue_id: venueId,
      venue_name: text('venue_name'),
      city: text('city'),
      country: text('country'),
      source: text('source'),
      created: text('created'),
    });
  }
  return parsed;
}

function adopt(list: SavedPlace[]): void {
  items = list;
  savedIds = new Set(list.map((item) => item.venue_id));
  loaded = true;
}

async function loadSavedPlaces(signedInAs: string, render: () => void): Promise<void> {
  const payload = await pb
    .send<unknown>('/api/detour/places/saved', { requestKey: null })
    .catch(() => null);
  // A read that failed states nothing: the list stays as it was and open to a
  // retry. A session that changed hands mid-flight is answered by its own
  // request, never by this one.
  if (!payload || pb.authStore.record?.id !== signedInAs) return;
  adopt(readSaved(payload));
  render();
}

/**
 * Read the list once per session. Safe to call on any render — the answer is
 * fetched at most once, and a failed read leaves the list untouched so a later
 * surface can try again.
 */
export function ensureSavedPlaces(render: () => void): Promise<void> {
  const signedInAs = pb.authStore.record?.id;
  if (!signedInAs || loaded) return Promise.resolve();
  if (!request) {
    request = loadSavedPlaces(signedInAs, render).finally(() => {
      request = null;
    });
  }
  return request;
}

/** The list, newest first, as the server ordered it. */
export function savedPlaces(): SavedPlace[] {
  return items;
}

/** Whether the list has been read yet — an empty list and an unread one differ. */
export function savedPlacesLoaded(): boolean {
  return loaded;
}

/** Is this place on the member's list? Answered from what has already been read. */
export function isSavedPlace(venueId: string): boolean {
  return savedIds.has(venueId);
}

/** Whether a toggle for this reference is in flight. */
export function savingPlace(reference: string): boolean {
  return pending.has(reference);
}

/** The server's own sentence when the last toggle for this reference failed. */
export function savePlaceFailure(reference: string): string {
  return failures.get(reference) || '';
}

/**
 * Save a place, or drop it. The route toggles; the client asks for the list again
 * afterwards rather than reconstructing the row it just created.
 *
 * That extra read looks wasteful and is not: a save pressed on a share or a card
 * carries no place name, and guessing one to fill a tab the member is about to
 * open is how a list ends up disagreeing with the server about what is on it. The
 * flag flips immediately either way, so the control the member pressed settles at
 * once and only the tab waits.
 *
 * `reference` is whatever the pressing surface holds — a venue id or a
 * waiting-list entry id. The server resolves both.
 */
export async function toggleSavedPlace(
  reference: string,
  source: SaveSource,
  render: () => void
): Promise<void> {
  if (!reference || pending.has(reference)) return;
  pending.add(reference);
  failures.delete(reference);
  render();
  try {
    const result = await pb.send<{ place?: string; saved?: boolean }>(
      `/api/detour/places/${encodeURIComponent(reference)}/save`,
      { method: 'POST', body: { source }, requestKey: null }
    );
    const venueId = typeof result.place === 'string' ? result.place : reference;
    if (result.saved === true) savedIds.add(venueId);
    else savedIds.delete(venueId);
    // The flag is right now; the list catches up. Deliberately not awaited — the
    // member is looking at the control they pressed, not at the tab.
    void refreshSavedPlaces(render);
  } catch (error) {
    failures.set(reference, readSaveError(error));
  } finally {
    pending.delete(reference);
    render();
  }
}

/** Re-read the list. Used after a toggle, and after a rung above it clears one. */
export async function refreshSavedPlaces(render: () => void): Promise<void> {
  const signedInAs = pb.authStore.record?.id;
  if (!signedInAs) return;
  const payload = await pb
    .send<unknown>('/api/detour/places/saved', { requestKey: null })
    .catch(() => null);
  if (!payload || pb.authStore.record?.id !== signedInAs) return;
  adopt(readSaved(payload));
  render();
}

/** A new session reads its own list; the previous member's is not inherited. */
export function resetSavedPlaces(): void {
  items = [];
  savedIds = new Set<string>();
  loaded = false;
  request = null;
  pending.clear();
  failures.clear();
}

/** The server's own sentence when it sent one — every refusal here is readable. */
function readSaveError(error: unknown): string {
  if (error && typeof error === 'object') {
    // Only what the server itself said: the SDK's own `message` is a placeholder
    // on transport failures, and says less than the sentence below.
    const response = error as { response?: { message?: string } };
    return response.response?.message || 'That could not be saved just now. Try again in a moment.';
  }
  return 'That could not be saved just now. Try again in a moment.';
}
