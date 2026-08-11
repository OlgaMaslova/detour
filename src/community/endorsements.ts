/**
 * Been & loved — the member's own marks, and the one surface that offers to
 * take a mark back.
 */
import { pb } from '../pocketbase';
import { ENDORSE_LABEL } from '../signal';
import { resyncAfterWrite } from '../live';
import { esc, readableError, store } from './store';
import { placeCardGrid } from './cards';

/**
 * The place whose mark is being withdrawn, and the server's sentence if it
 * refused. One at a time, like the recommendation deletion beside it.
 */
let withdrawingEndorsementId = '';
let endorsementFailure = new Map<string, string>();
/**
 * Been & loved — the member's own marks, read off the catalogue they already
 * hold.
 *
 * No request of its own: the scoped payload behind every card already says which
 * places this caller has marked, and asking the server a second time for a list
 * it just sent would be a route that exists only to repeat itself.
 *
 * A record, not a control. There is no withdrawal in the interface at all: the
 * mark is one tap, taken at the moment a member knows the answer, and offering
 * to take it back turns a settled fact back into a decision. The route still
 * toggles, so a mark pressed by accident is not permanent in the data — only in
 * what the app currently offers.
 */
export function endorsementsPanel(): string {
  const marked = store.knownVenues
    .filter((venue) => venue.endorsedByCaller)
    .sort((a, b) => a.city.localeCompare(b.city) || a.name.localeCompare(b.name));
  // The tagline is outside the empty check on purpose: it says what the tab is
  // for, and a member looking at an empty one is exactly who has not worked that
  // out yet. Every tab states its own line whether or not it has anything in it.
  return `<div class="community-endorsement-list">
    <p class="community-form-note">Places you’ve been and would send someone to.</p>
    ${!marked.length
      ? // Says how, and nothing else. An empty state that only described the
        // absence would leave a member who has never seen the control with
        // nowhere to go. The button's label comes from the constant the button
        // itself uses, so the instruction cannot drift from the thing it names.
        `<p class="community-empty">Nothing yet. Open a place you have been to and press “${esc(
          ENDORSE_LABEL
        )}”.</p>`
      : placeCardGrid(
      marked.map((venue) => {
        const busy = withdrawingEndorsementId === venue.id;
        const failure = endorsementFailure.get(venue.id) || '';
        return {
          venue,
          // Only reached when nothing visible stands behind the place any more —
          // the note the member went on can be withdrawn while their mark stands.
          // Normally the card carries that note and names whoever wrote it.
          emptyNote: 'You have been here, and loved it.',
          // Removal, at last, and deliberately here rather than on the place
          // page. `docs/been-and-loved-spec.md` held it back until the member had
          // a list of their own to take a mark back from: a control offering to
          // undo a settled fact, loitering on a public page, invites a second
          // thought nobody asked for. On the member's own list it is an ordinary
          // operation on an ordinary row.
          footer: `<div class="community-queue-bar community-queue-bar-single">
            <button class="community-queue-delete" type="button" data-endorsement-drop="${esc(
              venue.id
            )}" ${busy ? 'disabled' : ''} aria-label="${esc(
              `Remove your mark from ${venue.name}`
            )}">${busy ? 'Removing…' : 'Remove'}</button>
            ${failure ? `<p class="community-form-error" role="alert">${esc(failure)}</p>` : ''}
          </div>`,
        };
      })
    )}
  </div>`;
}

/** Clear the withdrawal-in-flight state — the recommend flow resets it on open. */
export function resetEndorsementWithdrawal(): void {
  withdrawingEndorsementId = '';
  endorsementFailure = new Map<string, string>();
}

export function bindEndorsements(root: HTMLElement, render: () => void): void {
  // Withdrawing a Been & loved mark. The route already toggles — a second POST
  // takes it back — so this is a surface onto what the write path could always
  // do. No confirmation: the member is looking at their own list, and pressing
  // it again re-marks the place.
  root.querySelectorAll<HTMLButtonElement>('[data-endorsement-drop]').forEach((button) => {
    button.addEventListener('click', async () => {
      const venueId = button.dataset.endorsementDrop || '';
      if (!venueId || withdrawingEndorsementId) return;
      withdrawingEndorsementId = venueId;
      endorsementFailure.delete(venueId);
      render();
      try {
        const result = await pb.send<{ endorsed?: boolean; total?: number }>(
          `/api/detour/places/${encodeURIComponent(venueId)}/endorsement`,
          { method: 'POST', requestKey: null }
        );
        const venue = store.knownVenues.find((item) => item.id === venueId);
        if (venue) {
          // Written straight onto the catalogue object every surface shares, so
          // the place page and its stamp settle on the same figures without a
          // catalogue reload for one number.
          venue.endorsedByCaller = result.endorsed === true;
          venue.endorsementTotal =
            typeof result.total === 'number' && Number.isFinite(result.total)
              ? Math.max(0, Math.floor(result.total))
              : Math.max(0, (venue.endorsementTotal ?? 1) - 1);
          venue.endorsements = (venue.endorsements ?? []).filter((person) => !person.isOwn);
        }
        // Withdrawing the mark drops the member back a rung, and a save they had
        // on this place before they went comes back to the Wanna go tab exactly
        // where they left it. Nothing was deleted on the way up.
        //
        // The whole resync rather than the saved list alone: the mark is a server
        // count on the place, so the catalogue row, the feed card built from it and
        // Been & loved are all a mark out of date until they are re-read. The
        // figures written onto the venue above are what keeps the control the member
        // pressed honest in the meantime.
        await resyncAfterWrite(render);
      } catch (error) {
        endorsementFailure.set(
          venueId,
          readableError(error, 'That could not be withdrawn just now. Try again in a moment.')
        );
      } finally {
        withdrawingEndorsementId = '';
        render();
      }
    });
  });
}
