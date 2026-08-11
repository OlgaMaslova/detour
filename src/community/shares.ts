/**
 * Private shares: the deck of shares sent and received (rendered by
 * network.ts), the send-a-place form behind Share new, and the deep-link
 * route that opens it pointed at a person, a place, or both.
 */
import { pb } from '../pocketbase';
import type { Venue } from '../data';
import { bindMemberShares, markNetworkSharesSeen, memberSharesMarkup } from '../network';
import {
  esc,
  incomingShares,
  loadCommunity,
  member,
  onCommunityReset,
  pseudoLabel,
  readableError,
  store,
} from './store';
import {
  applyPseudoLookup,
  directoryMarkup,
  directoryState,
  dropDirectory,
  lookupPseudo,
} from './directory';

// Private share works the same way: the deck of sent and received shares is the
// tab, and the sending form is revealed by Share new.
let shareFormOpen = false;
// A pseudo a deep link asked to share with, held until the next bind can turn it
// into a picked member through the directory.
let pendingShareRecipient: string | null = null;
// The place a route intent already named — a place page's Share item. Held
// as the string the form's own matcher understands rather than an id, because the
// field is a free-text one: a member may still edit it into somewhere off the
// list, and prefilling it must not take that away.
let sharePlacePrefill = '';
/**
 * The place a share names, resolved against the catalogue. `city` settles the one
 * ambiguous case — two places of the same name in different cities — and is only
 * passed by callers that hold one; the list's own options carry the city in them,
 * so anything picked rather than typed resolves on the first test.
 */
function matchVenue(placeInput: string, city = ''): Venue | undefined {
  const norm = (value: string) => value.trim().toLowerCase();
  const input = norm(placeInput);
  if (!input) return undefined;
  const byCombo = store.knownVenues.find((venue) => norm(`${venue.name} — ${venue.city}`) === input);
  if (byCombo) return byCombo;
  const byName = store.knownVenues.filter((venue) => norm(venue.name) === input);
  if (byName.length === 1) return byName[0];
  if (city) return byName.find((venue) => norm(venue.city) === norm(city));
  return undefined;
}

/**
 * Send one place to one member.
 *
 * A share points at a place that is already on Detour, and nothing else — so the
 * form is the recipient, the place, and why you thought of them. It used to carry
 * an address, a city and a country as well, for sending somewhere the catalogue
 * had never heard of; that made the share a second, quieter way to enter a place
 * into Detour, bypassing the recommendation it is supposed to arrive with. A place
 * worth telling one person about is worth recommending, and that form is one tab
 * away.
 */
function sharePlaceForm(): string {
  return `<form class="community-form community-share-place-form" data-community-share-place>
    ${directoryMarkup('share-place', 'Share with a member')}
    <label>Food-and-drink destination<input name="place" list="community-share-place-options" autocomplete="off" maxlength="200" required value="${esc(sharePlacePrefill)}" placeholder="Pick a place from the list"></label>
    <datalist id="community-share-place-options">${store.knownVenues
      .map((venue) => `<option value="${esc(`${venue.name} — ${venue.city}`)}"></option>`)
      .join('')}</datalist>
    <label>Personal note<textarea name="personal_note" rows="3" maxlength="1200" minlength="8" required placeholder="Why you thought of them for this food-and-drink destination"></textarea></label>
    <div class="community-form-actions">
      <button class="primary-button" type="submit" ${store.submitting ? 'disabled' : ''}>${store.submitting ? 'Sharing…' : 'Share destination'}</button>
      <button class="secondary-button community-share-cancel" type="button" data-share-close ${store.submitting ? 'disabled' : ''}>Cancel</button>
    </div>
  </form>`;
}

// Private share is the deck of shares the member already sent and received —
// the deck itself lives in network.ts, where the share payload, its replies,
// and its cassette flip are already modelled — followed by Share new, which
// reveals the sending form. Reading your shares comes before writing one.
export function sharesPanel(): string {
  return `${memberSharesMarkup()}
  ${
    shareFormOpen
      ? `<section class="community-ledger-section community-share-new is-open" id="community-share-new" aria-labelledby="private-shares-title">
          <div class="community-section-heading">
            <div><h3 id="private-shares-title">Share a food-and-drink destination</h3></div>
            <p>Send a place from the list to one member, with a note only they see.</p>
          </div>
          <div class="community-action-grid community-share-place-action">
            ${sharePlaceForm()}
          </div>
        </section>`
      : `<div class="community-ledger-section community-share-new">
          <button class="primary-button community-share-open" type="button" data-share-open>Share new</button>
        </div>`
  }`;
}
/**
 * Point the member area at the Share a place form (My detours → Shares) before it
 * renders. A pseudo names who the share is for — My Circle sends one, since a row
 * there is already a specific person — and the recipient picker resolves it to
 * that member on the next bind. Only the pseudo travels: the circle payload
 * carries no member ids, and the directory is the one place allowed to turn a
 * pseudo into an id.
 *
 * A place names what the share is about — a place page sends one, since a member
 * asking to share from there has already chosen the place and should not have to
 * find it again in a list of everything. The two halves are independent: My Circle
 * knows the person and not the place, the place page the reverse, and whichever
 * half arrives filled leaves the cursor in the other.
 */
export function openSharePlace(recipientPseudo?: string, place?: Venue): void {
  store.detourTab = 'shares';
  // Arriving via a Share CTA is an explicit ask for the form.
  shareFormOpen = true;
  store.pendingFormReveal = 'share';
  // Written the way the form's own matcher reads it back, so a prefilled place
  // resolves to the record rather than being sent as a name with no address.
  sharePlacePrefill = place ? `${place.name} — ${place.city}` : '';
  const pseudo = pseudoLabel(recipientPseudo, '');
  if (!pseudo) return;
  const state = directoryState('share-place');
  state.query = pseudo;
  state.selected = null;
  state.items = [];
  state.error = '';
  state.activeIndex = -1;
  pendingShareRecipient = pseudo;
}

/**
 * Turns the pseudo a deep link arrived with into the picker's selected member —
 * the circle rows in the picker itself take the same path, one function down.
 */
async function resolveShareRecipient(render: () => void): Promise<void> {
  const pseudo = pendingShareRecipient;
  pendingShareRecipient = null;
  if (!pseudo) return;
  const state = directoryState('share-place');
  state.loading = true;
  render();
  applyPseudoLookup(state, pseudo, await lookupPseudo(pseudo));
  render();
}
// Marks the recipient's new shares as seen once the inbox is on screen. Local
// state is updated without re-rendering so the "New" markers stay visible
// until the next render; the tab badge clears then too.
export async function markIncomingSharesSeen(): Promise<void> {
  const unseen = incomingShares().filter((share) => !share.seen);
  if (!unseen.length) return;
  const results = await Promise.allSettled(
    unseen.map((share) => pb.collection('community_shares').update(share.id, { seen: true }, { requestKey: null }))
  );
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') unseen[index].seen = true;
  });
  // The share deck reads its own copy of the ledger, so it is told about the
  // same change rather than showing "New share" until the next full reload.
  if (results.some((result) => result.status === 'fulfilled')) markNetworkSharesSeen();
}

onCommunityReset(() => {
  shareFormOpen = false;
  pendingShareRecipient = null;
  sharePlacePrefill = '';
});

export function bindShares(root: HTMLElement, render: () => void): void {
  // The private-share deck is rendered by network.ts, so its own module binds
  // the flip, the archive buttons, and the reply threads — and loads the share
  // payload when the member area is opened directly on this tab.
  // Mounted where the panel actually is, rather than where the member-area tab
  // says it should be: the same panel is now the signed-in landing, which has no
  // member-area tab behind it.
  const detoursMounted = Boolean(root.querySelector('.community-detours-panel'));
  if (member() && detoursMounted && store.detourTab === 'shares') {
    bindMemberShares(root, render, (shareId) => {
      store.shares = store.shares.filter((share) => share.id !== shareId);
    });
    if (pendingShareRecipient) void resolveShareRecipient(render);
  }
  root.querySelector<HTMLButtonElement>('[data-share-open]')?.addEventListener('click', () => {
    shareFormOpen = true;
    // Share new is a blank form: a place named by an earlier route intent has
    // nothing to do with the share the member is starting here.
    sharePlacePrefill = '';
    store.notice = null;
    render();
    window.requestAnimationFrame(() => {
      const form = document.querySelector<HTMLElement>('[data-community-share-place]');
      form?.scrollIntoView({ block: 'nearest' });
      form?.querySelector<HTMLElement>('input, textarea')?.focus({ preventScroll: true });
    });
  });

  root.querySelector<HTMLButtonElement>('[data-share-close]')?.addEventListener('click', () => {
    shareFormOpen = false;
    store.pendingFormReveal = null;
    sharePlacePrefill = '';
    // A half-filled recipient lookup must not survive a cancelled share.
    dropDirectory('share-place');
    render();
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>('[data-share-open]')?.focus({ preventScroll: true });
    });
  });
  root.querySelectorAll<HTMLFormElement>('[data-community-share]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const waitlist = form.dataset.waitlist || '';
      const selected = directoryState(`share-${waitlist}`).selected;
      if (!selected) {
        store.notice = { kind: 'error', text: 'Search for a member and choose their pseudo before sharing this food-and-drink destination.' };
        render();
        return;
      }
      const values = new FormData(form);
      store.submitting = true;
      store.notice = null;
      render();
      try {
        await pb.collection('community_shares').create({
          waitlist,
          recipient: selected.id,
          personal_note: String(values.get('personal_note') || '').trim(),
        });
        dropDirectory(`share-${waitlist}`);
        store.notice = { kind: 'success', text: `Shared with ${pseudoLabel(selected.pseudo)}.` };
        store.communityLoaded = false;
        await loadCommunity(render);
      } catch (error) {
        store.notice = { kind: 'error', text: readableError(error, 'That share could not be sent. Check the recipient and note, then try again.') };
      } finally {
        store.submitting = false;
        render();
      }
    });
  });

  root.querySelector<HTMLFormElement>('[data-community-share-place]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const selected = directoryState('share-place').selected;
    if (!selected) {
      store.notice = { kind: 'error', text: 'Search for a member and choose their pseudo before sharing a food-and-drink destination.' };
      render();
      return;
    }
    const values = new FormData(event.currentTarget as HTMLFormElement);
    const place = String(values.get('place') || '').trim();
    const note = String(values.get('personal_note') || '').trim();
    const venue = matchVenue(place);
    // Only a place already on Detour can be sent. A name the catalogue does not
    // know is not a share with a missing address any more — it is a place nobody
    // has recommended, and recommending is how one arrives.
    if (!venue) {
      store.notice = {
        kind: 'error',
        text: 'Pick a food-and-drink destination from the list. To send somewhere that is not there yet, recommend it first.',
      };
      render();
      return;
    }
    store.submitting = true;
    store.notice = null;
    render();
    try {
      await pb.collection('community_shares').create({
        venue: venue.id,
        recipient: selected.id,
        personal_note: note,
      });
      dropDirectory('share-place');
      // Sent: the panel returns to the deck, where the new share is listed.
      shareFormOpen = false;
      sharePlacePrefill = '';
      store.notice = { kind: 'success', text: `Shared with ${pseudoLabel(selected.pseudo)}.` };
      store.communityLoaded = false;
      await loadCommunity(render);
    } catch (error) {
      store.notice = { kind: 'error', text: readableError(error, 'That share could not be sent. Check the details and try again.') };
    } finally {
      store.submitting = false;
      render();
    }
  });
}
