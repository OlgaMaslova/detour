/**
 * Settings: the member's own record — pseudo, home city, discovery
 * visibility — and the way out, both the ordinary sign-out's neighbour
 * (account removal) and the session details row.
 */
import { pb } from '../pocketbase';
import {
  esc,
  member,
  memberName,
  onCommunityReset,
  readableError,
  resetCommunityState,
  store,
  syncMemberRecord,
} from './store';
import type { MemberRecord } from './store';
import { setCommunityMode } from './auth';

let visibilitySaving = false;
let visibilityPending: boolean | null = null;
let memberRefreshed = false;
let refreshingMember = false;
export function settingsPanel(record: MemberRecord): string {
  const keepPrivate = visibilityPending ?? record.discovery_visible === false;
  return `<section class="community-tab-panel community-settings-panel" id="member-panel-settings" role="tabpanel" aria-labelledby="member-tab-settings" tabindex="0">
    <div class="community-session-row">
      <p class="community-session-note">Signed in as <strong>${esc(record.email || memberName(record))}</strong></p>
      ${store.foundingMember ? '<span class="community-founder-badge">Founding member</span>' : ''}
      <button class="secondary-button community-session-signout" type="button" data-community-sign-out>Sign out</button>
    </div>
    <div class="community-pseudo-row">
      <form class="community-form community-pseudo-form" data-community-pseudo>
        <label>My pseudo<input name="pseudo" value="${esc(record.pseudo || '')}" autocomplete="off" spellcheck="false" minlength="3" maxlength="30" pattern="@?[a-zA-Z0-9][a-zA-Z0-9-]{1,28}[a-zA-Z0-9]" title="3-30 characters: letters, digits, and hyphens" required></label>
        <button class="secondary-button" type="submit" ${store.submitting ? 'disabled' : ''}>${store.submitting ? 'Saving…' : 'Save pseudo'}</button>
      </form>
      <p class="community-form-note">Your unique handle — other members search for it to share food-and-drink destinations with you.</p>
    </div>
    <div class="community-pseudo-row">
      <form class="community-form community-pseudo-form" data-community-home-city>
        <label>Where do you live?<input name="home_city" value="${esc(record.home_city || '')}" autocomplete="address-level2" minlength="2" maxlength="120" required placeholder="City — e.g. San Francisco"></label>
        <button class="secondary-button" type="submit" ${store.submitting ? 'disabled' : ''}>${store.submitting ? 'Saving…' : 'Save city'}</button>
      </form>
      <p class="community-form-note">Signup asks every member where they live; this is where members who joined before it was asked can answer.</p>
    </div>
    <div class="community-visibility-row">
      <div class="community-visibility-copy">
        <h3>Food-and-drink discovery</h3>
        <p class="community-form-note">${
          store.foundingMember
            ? 'As a founding member, your food-and-drink recommendations reach every member of Detour — and they are what Detour shows people who are not signed in at all, so your notes and photographs are readable by anyone with the address. This switch is how you stop that.'
            : 'Your food-and-drink recommendations reach the members whose circles you appear in: the person who invited you, the people you invited, the others they invited, and the person who invited your inviter. Nobody further out sees them, and nobody signed out sees them at all.'
        } Private shares and replies stay private.</p>
      </div>
      <label class="community-switch">
        <input type="checkbox" data-community-visibility ${keepPrivate ? 'checked' : ''} ${visibilitySaving ? 'disabled' : ''}>
        <span class="community-switch-track" aria-hidden="true"></span>
        <span class="community-switch-copy"><strong>Keep recommendations private</strong><small>${
          visibilitySaving
            ? 'Saving…'
            : keepPrivate
              ? 'Hidden from everyone'
              : store.foundingMember
                ? 'Public — readable by anyone'
                : 'Discoverable by your circle'
        }</small></span>
      </label>
    </div>
    <div class="community-danger-row">
      <p class="community-danger-note">Removing your account deletes your recommendations, shares, and invitations. This cannot be undone.</p>
      <button class="community-danger" type="button" data-community-remove-account ${store.submitting ? 'disabled' : ''}>${store.submitting ? 'Removing…' : 'Remove account'}</button>
    </div>
  </section>`;
}
async function refreshMemberRecord(render: () => void): Promise<void> {
  if (!member() || memberRefreshed || refreshingMember) return;
  refreshingMember = true;
  try {
    await pb.collection('members').authRefresh({ requestKey: null });
    memberRefreshed = true;
    render();
  } catch {
    // Keep the cached auth record; the toggle still saves correctly on change.
  } finally {
    refreshingMember = false;
  }
}

onCommunityReset(() => {
  visibilitySaving = false;
  visibilityPending = null;
  memberRefreshed = false;
  refreshingMember = false;
});

export function bindSettings(root: HTMLElement, render: () => void): void {
  if (store.memberTab === 'settings') void refreshMemberRecord(render);
  root.querySelector<HTMLFormElement>('[data-community-pseudo]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const record = member();
    if (!record || store.submitting) return;
    const values = new FormData(event.currentTarget as HTMLFormElement);
    const pseudo = String(values.get('pseudo') || '').trim().replace(/^@+/, '').toLowerCase();
    if (!pseudo || pseudo === (record.pseudo || '')) return;
    store.submitting = true;
    store.notice = null;
    render();
    try {
      const updated = await pb.collection('members').update<MemberRecord>(record.id, { pseudo }, { requestKey: null });
      if (!syncMemberRecord(record, updated)) return;
      store.notice = { kind: 'success', text: `Your pseudo is now ${pseudo}.` };
    } catch (error) {
      store.notice = { kind: 'error', text: readableError(error, 'Your pseudo could not be updated. Please try again.') };
    } finally {
      store.submitting = false;
      render();
    }
  });

  root.querySelector<HTMLFormElement>('[data-community-home-city]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const record = member();
    if (!record || store.submitting) return;
    const values = new FormData(event.currentTarget as HTMLFormElement);
    const homeCity = String(values.get('home_city') || '').trim();
    if (homeCity === (record.home_city || '')) return;
    if (homeCity.length < 2) {
      store.notice = { kind: 'error', text: 'Tell us where you live — the city you live in.' };
      render();
      return;
    }
    store.submitting = true;
    store.notice = null;
    render();
    try {
      const updated = await pb.collection('members').update<MemberRecord>(record.id, { home_city: homeCity }, { requestKey: null });
      if (!syncMemberRecord(record, updated)) return;
      store.notice = { kind: 'success', text: `Your circle now sees you in ${updated.home_city || homeCity}.` };
    } catch (error) {
      store.notice = { kind: 'error', text: readableError(error, 'Your city could not be updated. Please try again.') };
    } finally {
      store.submitting = false;
      render();
    }
  });

  root.querySelector<HTMLInputElement>('[data-community-visibility]')?.addEventListener('change', async (event) => {
    const record = member();
    const input = event.currentTarget as HTMLInputElement;
    if (!record || visibilitySaving) return;
    const keepPrivate = input.checked;
    const discoveryVisible = !keepPrivate;
    visibilitySaving = true;
    visibilityPending = keepPrivate;
    store.notice = null;
    render();
    try {
      const updated = await pb.collection('members').update<MemberRecord>(record.id, { discovery_visible: discoveryVisible }, { requestKey: null });
      if (!syncMemberRecord(record, updated)) return;
      store.notice = {
        kind: 'success',
        text: keepPrivate
          ? 'Your recommendations are now private and hidden from your circle.'
          : store.foundingMember
            ? 'Your recommendations are now discoverable by every member of Detour.'
            : 'Your recommendations are now discoverable by the members whose circles you appear in.',
      };
    } catch (error) {
      if (member()?.id !== record.id) return;
      store.notice = { kind: 'error', text: readableError(error, 'That recommendation privacy setting could not be saved. Please try again.') };
    } finally {
      if (member()?.id === record.id) {
        visibilitySaving = false;
        visibilityPending = null;
        render();
      }
    }
  });

  root.querySelector<HTMLButtonElement>('[data-community-remove-account]')?.addEventListener('click', async () => {
    const record = member();
    if (!record || store.submitting) return;
    if (!window.confirm('Remove your account? Your recommendations, shares, and invitations will be deleted. This cannot be undone.')) return;
    store.submitting = true;
    store.notice = null;
    render();
    try {
      await pb.collection('members').delete(record.id);
      pb.authStore.clear();
      resetCommunityState();
      setCommunityMode('sign-in');
      store.notice = { kind: 'info', text: 'Your account has been removed.' };
    } catch (error) {
      store.notice = { kind: 'error', text: readableError(error, 'Your account could not be removed. Please try again.') };
    } finally {
      store.submitting = false;
      render();
    }
  });
}
