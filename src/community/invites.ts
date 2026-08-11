/**
 * Invitations: the links a member hands to people they trust, the allowance
 * the server meters them against, and the Founder's power to attach one of
 * the fifty founding seats.
 */
import { pb } from '../pocketbase';
import { siteOrigin } from '../site';
import { bindInviteShare, inviteShareMenuMarkup } from '../share';
import {
  ensureMemberFlags,
  esc,
  formatDate,
  member,
  onCommunityReset,
  pseudoLabel,
  readableError,
  store,
} from './store';

interface InviteRecord {
  id: string;
  code?: string;
  claimed_by?: string;
  claimed_at?: string;
  created?: string;
  /** Set by the Founder when issuing: this invitation offers a founding seat. */
  grants_founding?: boolean;
  /** The issuer's own note on who this was sent to — never read server-side. */
  hint?: string;
  /** Snapshot of the claiming member's pseudo, taken at redemption. */
  claimed_pseudo?: string;
}
let invites: InviteRecord[] = [];
let invitesLoaded = false;
let loadingInvites = false;
// Who the next invitation is for, in the issuer's own words. Held here rather
// than only in the DOM because loadInvites can re-render this panel — see
// joinDraft above — while a member is still typing it.
let inviteHintDraft = '';
function openInvites(): InviteRecord[] {
  return invites.filter((invite) => !invite.claimed_by);
}

function invitationLink(code: string): string {
  const url = new URL(siteOrigin);
  url.pathname = '/';
  url.searchParams.set('view', 'members');
  url.searchParams.set('invite', code);
  return url.href;
}

/**
 * The invitation the member already has open, as a link — or null when every code
 * they hold has been claimed. Never creates one, so a caller can ask ahead of
 * time and have the link ready before it is wanted.
 *
 * Founding invitations are skipped. They are an offer of one of the fifty seats,
 * made to a particular person on the Invitations tab; a generic "share my link"
 * button elsewhere in the app must never reach for one lying open.
 */
export async function openInvitationLink(): Promise<string | null> {
  const own = await pb
    .collection('invites')
    .getFullList<InviteRecord>({ sort: 'created', requestKey: null });
  const open = own.find((invite) => !invite.claimed_by && invite.code && !invite.grants_founding);
  return open?.code ? invitationLink(open.code) : null;
}

/**
 * The link a member hands to someone they trust, obtainable from anywhere in the
 * app — My Circle asks for it too, not just the Invitations tab.
 *
 * An unclaimed code is reused rather than replaced: the allowance is codes left
 * outstanding, so asking twice must not spend two of them. A fresh code is
 * created only when the member has none open, and the server enforces the limit
 * either way. Throws if the code cannot be prepared, so callers can say so.
 */
export async function ensureInvitationLink(): Promise<string> {
  const open = await openInvitationLink();
  if (open) return open;
  const created = await pb.collection('invites').create<InviteRecord>({});
  if (!created.code) throw new Error('That invitation link could not be prepared. Please try again.');
  // A code created here has to show up on the Invitations tab as well.
  invitesLoaded = false;
  return invitationLink(created.code);
}
/**
 * The mark that tells one of the Founder's invitations from another, on the two
 * lists below. Shown only to the member who can make the distinction, because
 * every invitation anyone else holds is ordinary and a badge saying so on all of
 * them would be noise.
 */
function foundingInviteTag(invite: InviteRecord): string {
  if (!store.canGrantFounding || !invite.grants_founding) return '';
  return '<span class="community-invite-founding-tag">Founding seat</span>';
}

export function invitesPanel(): string {
  const unclaimed = openInvites();
  const claimed = invites.filter((invite) => invite.claimed_by);
  const available = Math.max(0, store.invitationLimit - unclaimed.length);
  const allowanceKnown = invitesLoaded && !loadingInvites;
  const atLimit = allowanceKnown && available === 0;
  return `<section class="community-tab-panel community-invitation-panel" id="member-panel-invitations" role="tabpanel" aria-labelledby="member-tab-invitations" tabindex="0">
    <div class="community-invite-actions">
      <p class="community-invite-explainer">Your circle grows by personal invitation — create a link and send it to someone you trust. Whoever redeems it joins inside your circle, which is what an open signup cannot do for itself.</p>
      <div class="community-invite-row">
        <label class="community-invite-hint-field"><span>Who's this for? <small>(optional, just for you)</small></span><input type="text" data-invite-hint value="${esc(inviteHintDraft)}" maxlength="120" placeholder="e.g. Jane" ${store.submitting ? 'disabled' : ''}></label>
        ${
          store.canGrantFounding
            ? `<label class="community-switch community-invite-founding">
                <input type="checkbox" data-invite-founding ${store.inviteGrantsFounding ? 'checked' : ''} ${store.submitting ? 'disabled' : ''}>
                <span class="community-switch-track" aria-hidden="true"></span>
                <span class="community-switch-copy"><strong>Offer a founding seat</strong></span>
              </label>`
            : ''
        }
        <button class="secondary-button" type="button" data-community-invite ${store.submitting || !allowanceKnown || atLimit ? 'disabled' : ''}>${store.submitting ? 'Preparing…' : atLimit ? 'Invitation limit reached' : store.inviteGrantsFounding ? 'New founding invitation' : 'New invitation'}</button>
      </div>
      <p class="community-invite-allowance" aria-live="polite"><strong>${allowanceKnown ? available : '—'}</strong> ${allowanceKnown ? (available === 1 ? 'invitation left' : 'invitations left') : 'checking…'}</p>
      ${
        loadingInvites || !invitesLoaded
          ? '<p class="community-loading" role="status">Loading…</p>'
          : unclaimed.length
            ? `<div class="community-invite-list"><h4>Unclaimed invitations</h4><ul class="community-invite-codes" aria-label="Your unclaimed invitation links">${unclaimed
                .map(
                  (invite) =>
                    `<li><div class="community-invite-row-main"><code>${esc(invite.code || '')}</code>${foundingInviteTag(invite)}${invite.hint ? `<span class="community-invite-hint-tag">${esc(invite.hint)}</span>` : ''}</div><div class="community-invite-row-actions"><button class="secondary-button community-invite-copy" type="button" data-copy-invite="${esc(invite.code || '')}" aria-live="polite" aria-label="Copy invitation link for ${esc(invite.code || '')}">Copy link</button>${invite.code ? inviteShareMenuMarkup(invitationLink(invite.code)) : ''}<button class="secondary-button community-invite-remove" type="button" data-remove-invite="${esc(invite.id)}" aria-label="Remove invitation ${esc(invite.code || '')}">Remove</button></div></li>`
                )
                .join('')}</ul></div>`
            : '<p class="community-empty">No unclaimed invitations. Create one to invite someone.</p>'
      }
      ${
        allowanceKnown && claimed.length
          ? `<div class="community-invite-list community-invite-claimed"><h4>Claimed invitations</h4><ul class="community-invite-codes" aria-label="Your claimed invitation codes">${claimed
              .map((invite) => {
                const when = formatDate(invite.claimed_at);
                const claimant = invite.claimed_pseudo ? pseudoLabel(invite.claimed_pseudo) : '';
                return `<li><code>${esc(invite.code || '')}</code>${foundingInviteTag(invite)}<span>${claimant ? `Claimed by ${esc(claimant)}` : 'Claimed'}${when ? ` ${esc(when)}` : ''}</span></li>`;
              })
              .join('')}</ul></div>`
          : ''
      }
    </div>
  </section>`;
}
export async function loadInvites(render: () => void): Promise<void> {
  if (!member() || loadingInvites) return;
  loadingInvites = true;
  render();
  try {
    // The allowance travels with the invitations it governs, so the count and
    // the limit it is measured against are still read in the same pass.
    const [list] = await Promise.all([
      pb.collection('invites').getFullList<InviteRecord>({ sort: '-created', requestKey: null }),
      ensureMemberFlags(render),
    ]);
    invites = list;
    invitesLoaded = true;
  } catch (error) {
    store.notice = { kind: 'error', text: readableError(error, 'Your invitations could not be loaded. Please try again.') };
  } finally {
    loadingInvites = false;
    render();
  }
}

onCommunityReset(() => {
  invites = [];
  invitesLoaded = false;
  loadingInvites = false;
});

export function bindInvites(root: HTMLElement, render: () => void): void {
  root.querySelector<HTMLInputElement>('[data-invite-founding]')?.addEventListener('change', (event) => {
    if (!store.canGrantFounding) return;
    store.inviteGrantsFounding = (event.currentTarget as HTMLInputElement).checked;
    render();
  });

  root.querySelector<HTMLInputElement>('[data-invite-hint]')?.addEventListener('input', (event) => {
    inviteHintDraft = (event.currentTarget as HTMLInputElement).value;
  });

  root.querySelector<HTMLButtonElement>('[data-community-invite]')?.addEventListener('click', async () => {
    if (!member() || !invitesLoaded || loadingInvites || openInvites().length >= store.invitationLimit) return;
    // The server decides this too, and forces it off for anyone but the Founder.
    const grantsFounding = store.canGrantFounding && store.inviteGrantsFounding;
    const hint = inviteHintDraft.trim();
    store.submitting = true;
    store.notice = null;
    render();
    try {
      await pb.collection('invites').create({
        ...(grantsFounding ? { grants_founding: true } : {}),
        ...(hint ? { hint } : {}),
      });
      invitesLoaded = false;
      // Back to an ordinary invitation: the choice is made per invitation, and a
      // seat should never be spent because the toggle was still on from last time.
      store.inviteGrantsFounding = false;
      inviteHintDraft = '';
      store.notice = {
        kind: 'success',
        text: grantsFounding
          ? 'Your founding invitation link is ready.'
          : 'Your invitation link is ready.',
      };
      await loadInvites(render);
    } catch (error) {
      store.notice = { kind: 'error', text: readableError(error, 'That invitation could not be prepared. Please try again.') };
    } finally {
      store.submitting = false;
      render();
    }
  });

  root.querySelectorAll<HTMLButtonElement>('[data-remove-invite]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.removeInvite || '';
      if (!id || store.submitting) return;
      if (!window.confirm('Remove this invitation? The link will stop working.')) return;
      store.submitting = true;
      store.notice = null;
      render();
      try {
        await pb.collection('invites').delete(id);
        invites = invites.filter((invite) => invite.id !== id);
        store.notice = { kind: 'info', text: 'Invitation removed.' };
      } catch (error) {
        store.notice = { kind: 'error', text: readableError(error, 'That invitation could not be removed. Please try again.') };
      } finally {
        store.submitting = false;
        render();
      }
    });
  });

  bindInviteShare(root);

  root.querySelectorAll<HTMLButtonElement>('[data-copy-invite]').forEach((button) => {
    button.addEventListener('click', async () => {
      const code = button.dataset.copyInvite || '';
      if (!code) return;
      try {
        await navigator.clipboard.writeText(invitationLink(code));
        button.textContent = 'Link copied';
        window.setTimeout(() => {
          button.textContent = 'Copy link';
        }, 1800);
      } catch {
        store.notice = { kind: 'error', text: 'The invitation link could not be copied automatically. Please try again.' };
        render();
      }
    });
  });

  if (member() && !invitesLoaded && !loadingInvites) void loadInvites(render);
}
