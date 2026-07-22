import { pb } from './pocketbase';

type DiscoveryStatus = 'idle' | 'loading' | 'ready' | 'error';
type ShareDirection = 'received' | 'sent';

export interface DiscoveryRecommendation {
  recommender_pseudo?: string;
  note?: string;
  venue_name?: string;
  city?: string;
  country?: string;
  address?: string;
  created?: string;
}

interface DiscoveryReply {
  id: string;
  body: string;
  author_pseudo?: string;
  created?: string;
}

interface DiscoveryShare {
  id?: string;
  direction: ShareDirection;
  venue_name?: string;
  city?: string;
  country?: string;
  address?: string;
  personal_note?: string;
  sender_pseudo?: string;
  recipient_pseudo?: string;
  seen?: boolean;
  created?: string;
  replies: DiscoveryReply[];
}

interface ReplyState {
  body: string;
  submitting: boolean;
  message: string;
  error: boolean;
  validationError: boolean;
}

const REPLY_MIN_LENGTH = 8;
const REPLY_MAX_LENGTH = 1200;

/**
 * Resolves a recommended place to a published catalogue venue so the feed can
 * open it on the destination map. Returns null when the place has no published
 * venue yet — the entry then renders as plain text.
 */
export type NetworkPlaceResolver = (venueName: string, city: string) => { venueId: string; destinationSlug: string } | null;

interface NetworkDiscovery {
  recommendations: DiscoveryRecommendation[];
  shares: DiscoveryShare[];
}

let status: DiscoveryStatus = 'idle';
let loadedFor = '';
let errorMessage = '';
const replyStates = new Map<string, ReplyState>();
let discovery: NetworkDiscovery = {
  recommendations: [],
  shares: [],
};

function esc(value: unknown): string {
  return typeof value === 'string'
    ? value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
    : '';
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.trim();
  return cleaned || undefined;
}

function cleanDate(value: unknown): string | undefined {
  const text = cleanText(value);
  if (!text || Number.isNaN(new Date(text).getTime())) return undefined;
  return text;
}

function cleanRecommendation(value: unknown): DiscoveryRecommendation | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const venueName = cleanText(item.venue_name);
  if (!venueName) return null;
  return {
    venue_name: venueName,
    recommender_pseudo: cleanText(item.recommender_pseudo),
    note: cleanText(item.note),
    city: cleanText(item.city),
    country: cleanText(item.country),
    address: cleanText(item.address),
    created: cleanDate(item.created),
  };
}

function cleanReply(value: unknown): DiscoveryReply | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const id = cleanText(item.id);
  const body = cleanText(item.body);
  if (!id || !body) return null;
  return {
    id,
    body,
    author_pseudo: cleanText(item.author_pseudo),
    created: cleanDate(item.created),
  };
}

function cleanShare(value: unknown): DiscoveryShare | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const venueName = cleanText(item.venue_name);
  if (!venueName || (item.direction !== 'received' && item.direction !== 'sent')) return null;
  const replies = Array.isArray(item.replies)
    ? item.replies
        .map(cleanReply)
        .filter((reply): reply is DiscoveryReply => reply !== null)
        .sort((a, b) => {
          const first = a.created ? new Date(a.created).getTime() : Number.MAX_SAFE_INTEGER;
          const second = b.created ? new Date(b.created).getTime() : Number.MAX_SAFE_INTEGER;
          return first - second;
        })
    : [];
  return {
    id: cleanText(item.id),
    direction: item.direction,
    venue_name: venueName,
    city: cleanText(item.city),
    country: cleanText(item.country),
    address: cleanText(item.address),
    personal_note: cleanText(item.personal_note),
    sender_pseudo: cleanText(item.sender_pseudo),
    recipient_pseudo: cleanText(item.recipient_pseudo),
    seen: item.seen === true,
    created: cleanDate(item.created),
    replies,
  };
}

function cleanPayload(value: unknown): NetworkDiscovery {
  const payload = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const recommendations = Array.isArray(payload.recommendations)
    ? payload.recommendations.map(cleanRecommendation).filter((item): item is DiscoveryRecommendation => item !== null)
    : [];
  const shares = Array.isArray(payload.shares)
    ? payload.shares.map(cleanShare).filter((item): item is DiscoveryShare => item !== null)
    : [];
  return {
    recommendations,
    shares,
  };
}

function readableError(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    const response = error as { response?: { message?: string }; message?: string };
    return response.response?.message || response.message || fallback;
  }
  return fallback;
}

function replyCreateError(error: unknown): string {
  if (error && typeof error === 'object') {
    const response = error as { response?: { message?: string } };
    if (response.response?.message) return response.response.message;
  }
  return 'That reply could not be sent. Check your connection and the reply text, then try again.';
}

function memberRecord(): { id: string; pseudo?: string; email?: string } | null {
  if (!pb.authStore.isValid || !pb.authStore.record?.id) return null;
  return pb.authStore.record as unknown as { id: string; pseudo?: string; email?: string };
}

export function isAuthenticatedMember(): boolean {
  return memberRecord() !== null;
}

/**
 * Recommendations from the shared Detour circle that carry a note, so the
 * catalogue detail can show what another member said about a place.
 * Empty until the discovery feed has loaded for the signed-in member.
 */
export function networkPlaceNotes(): DiscoveryRecommendation[] {
  if (!memberRecord() || status !== 'ready') return [];
  return discovery.recommendations.filter((item) => Boolean(item.note));
}

/** Loads the signed-in member's discovery data when it isn't loaded yet. */
export function ensureNetworkDiscovery(render: () => void): void {
  const record = memberRecord();
  if (record && loadedFor !== record.id && status !== 'loading') {
    status = 'idle';
    void loadNetworkDiscovery(render);
  }
}

export function resetNetworkDiscovery(): void {
  status = 'idle';
  loadedFor = '';
  errorMessage = '';
  replyStates.clear();
  discovery = { recommendations: [], shares: [] };
}

function formatDate(value: string | undefined): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(parsed);
}

function placeMeta(item: { address?: string; city?: string; country?: string }): string {
  return [item.address, item.city, item.country].filter(Boolean).join(', ');
}

function pseudo(value: string | undefined, fallback = 'A Detour member'): string {
  const cleaned = value?.trim().replace(/^@+/, '');
  return `<strong class="network-pseudo">${cleaned ? `@${esc(cleaned)}` : esc(fallback)}</strong>`;
}

function replyState(shareId: string): ReplyState {
  const existing = replyStates.get(shareId);
  if (existing) return existing;
  const next = { body: '', submitting: false, message: '', error: false, validationError: false };
  replyStates.set(shareId, next);
  return next;
}

function replyValidation(body: string): string {
  if (body.length > REPLY_MAX_LENGTH) return `Reply must be ${REPLY_MAX_LENGTH.toLocaleString()} characters or fewer.`;
  const cleaned = body.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = cleaned
    .split(/\s+/)
    .map((word) => word.replace(/[.,!?;:'"()\[\]{}<>/\\|`~@#$%^&*+=_-]+/g, ''))
    .filter((word) => word.length >= 2);
  if (cleaned.length < REPLY_MIN_LENGTH || words.length < 2) return `Use at least ${REPLY_MIN_LENGTH} characters and two words.`;
  return '';
}

function domToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function replyMarkup(item: DiscoveryReply): string {
  const when = formatDate(item.created);
  return `<li class="network-reply">
    <p class="network-reply-byline">${pseudo(item.author_pseudo)}${when ? `<span aria-hidden="true"> · </span><time datetime="${esc(item.created)}">${esc(when)}</time>` : ''}</p>
    <p class="network-reply-body">${esc(item.body)}</p>
  </li>`;
}

function replyThreadMarkup(item: DiscoveryShare): string {
  if (!item.id) return '';
  const state = replyState(item.id);
  const token = domToken(item.id);
  const titleId = `network-replies-${token}`;
  const fieldId = `network-reply-body-${token}`;
  const helpId = `network-reply-help-${token}`;
  const statusId = `network-reply-status-${token}`;
  const count = item.replies.length;
  return `<section class="network-replies" aria-labelledby="${titleId}">
    <div class="network-replies-heading">
      <h4 id="${titleId}">Private replies</h4>
      <p>${count} ${count === 1 ? 'reply' : 'replies'}</p>
    </div>
    ${count ? `<ol class="network-reply-list">${item.replies.map(replyMarkup).join('')}</ol>` : '<p class="network-replies-empty">No replies yet. Keep the conversation tied to this place.</p>'}
    <form class="network-reply-form" data-network-reply-form data-share-id="${esc(item.id)}" novalidate>
      <label for="${fieldId}">Reply about ${esc(item.venue_name || 'this place')}</label>
      <textarea id="${fieldId}" name="body" rows="3" minlength="${REPLY_MIN_LENGTH}" maxlength="${REPLY_MAX_LENGTH}" required aria-describedby="${helpId} ${statusId}"${state.validationError ? ' aria-invalid="true"' : ''} placeholder="Add a private note about this place…" ${state.submitting ? 'disabled' : ''}>${esc(state.body)}</textarea>
      <div class="network-reply-form-footer">
        <p id="${helpId}" class="network-reply-help">Visible only within this private share · ${REPLY_MIN_LENGTH}–${REPLY_MAX_LENGTH.toLocaleString()} characters · at least two words</p>
        <button type="submit" class="network-reply-submit" ${state.submitting ? 'disabled aria-busy="true"' : ''}>${state.submitting ? 'Sending…' : 'Send reply'}</button>
      </div>
      <p id="${statusId}" class="network-reply-status${state.error ? ' is-error' : state.message && !state.submitting ? ' is-success' : ''}" ${state.error ? 'role="alert"' : 'role="status"'} aria-live="${state.error ? 'assertive' : 'polite'}">${esc(state.message)}</p>
    </form>
  </section>`;
}

function recommendationMarkup(item: DiscoveryRecommendation, resolvePlace?: NetworkPlaceResolver): string {
  const when = formatDate(item.created);
  const metadata = placeMeta(item);
  const name = item.venue_name || 'Recommended place';
  const place = item.venue_name && resolvePlace ? resolvePlace(item.venue_name, item.city || '') : null;
  const title = place
    ? `<button type="button" class="network-entry-place" data-open-destination="${esc(place.destinationSlug)}" data-open-venue="${esc(place.venueId)}" aria-label="Open ${esc(name)} on the map">${esc(name)}<span aria-hidden="true"> ↗</span></button>`
    : esc(name);
  return `<article class="network-entry network-recommendation">
    <header class="network-entry-head">
      <div>
        <h3>${title}</h3>
        ${metadata ? `<p class="network-place-meta">${esc(metadata)}</p>` : ''}
      </div>
      <span class="network-entry-kind">Recommendation</span>
    </header>
    ${item.note ? `<blockquote><p>${esc(item.note)}</p></blockquote>` : '<p class="network-entry-note-empty">No note was included with this recommendation.</p>'}
    <p class="network-entry-byline">${pseudo(item.recommender_pseudo)}${when ? `<span aria-hidden="true"> · </span><time datetime="${esc(item.created)}">${esc(when)}</time>` : ''}</p>
  </article>`;
}

function shareMarkup(item: DiscoveryShare): string {
  const received = item.direction === 'received';
  const personPseudo = received ? item.sender_pseudo : item.recipient_pseudo;
  const when = formatDate(item.created);
  const metadata = placeMeta(item);
  return `<article class="network-entry network-share${received && !item.seen ? ' is-new' : ''}">
    <header class="network-entry-head">
      <div>
        <h3>${esc(item.venue_name || 'Shared place')}</h3>
        ${metadata ? `<p class="network-place-meta">${esc(metadata)}</p>` : ''}
      </div>
      <span class="network-entry-kind">${received ? (item.seen ? 'Received' : 'New share') : 'Sent'}</span>
    </header>
    ${item.personal_note ? `<blockquote><p>${esc(item.personal_note)}</p></blockquote>` : '<p class="network-entry-note-empty">No personal note was included.</p>'}
    <p class="network-entry-byline">${received ? 'From' : 'To'} ${pseudo(personPseudo, received ? 'A Detour member' : 'a Detour member')}${when ? `<span aria-hidden="true"> · </span><time datetime="${esc(item.created)}">${esc(when)}</time>` : ''}</p>
    ${replyThreadMarkup(item)}
  </article>`;
}

function memberFeedMarkup(resolvePlace?: NetworkPlaceResolver): string {
  const recommendations = discovery.recommendations;
  const received = discovery.shares.filter((share) => share.direction === 'received');
  const sent = discovery.shares.filter((share) => share.direction === 'sent');
  const shareCount = received.length + sent.length;

  if (status === 'loading' || status === 'idle') {
    return `<div class="network-state network-state-loading" role="status">
      <span class="network-loading-mark" aria-hidden="true"></span>
      <div><h2>Gathering the Detour circle</h2><p>Loading full-circle recommendations and private place shares.</p></div>
    </div>`;
  }

  if (status === 'error') {
    return `<div class="network-state network-state-error" role="alert">
      <div><h2>The Detour circle could not be loaded</h2><p>${esc(errorMessage || 'Please try again. Circle recommendations and your private shares have not been shown.')}</p></div>
      <button type="button" class="network-retry" data-network-retry>Try again</button>
    </div>`;
  }

  return `<div class="network-member-content">
    <section class="network-stream" aria-labelledby="network-recommendations-title">
      <div class="network-section-heading">
        <div><h2 id="network-recommendations-title">Recommended by the community</h2><p>Recommendations shared by members across the invite-only Detour circle.</p></div>
        <p class="network-section-count">${recommendations.length} ${recommendations.length === 1 ? 'recommendation' : 'recommendations'}</p>
      </div>
      ${recommendations.length ? `<div class="network-entry-list">${recommendations.map((item) => recommendationMarkup(item, resolvePlace)).join('')}</div>` : `<div class="network-empty"><h3>No circle recommendations yet</h3><p>Recommendations will appear here as members add them, unless they choose to keep theirs private.</p></div>`}
    </section>
    <section class="network-stream network-shares" aria-labelledby="network-shares-title">
      <div class="network-section-heading">
        <div><h2 id="network-shares-title"Shared Places</h2><p>Private incoming and outgoing shares, kept together.</p></div>
        <p class="network-section-count">${shareCount} ${shareCount === 1 ? 'share' : 'shares'}</p>
      </div>
      ${shareCount ? `<div class="network-share-columns">
        <section aria-labelledby="network-received-title"><h3 id="network-received-title">Shared with you</h3>${received.length ? `<div class="network-entry-list">${received.map(shareMarkup).join('')}</div>` : '<p class="network-column-empty">Nothing received yet.</p>'}</section>
        <section aria-labelledby="network-sent-title"><h3 id="network-sent-title">Sent by you</h3>${sent.length ? `<div class="network-entry-list">${sent.map(shareMarkup).join('')}</div>` : '<p class="network-column-empty">Nothing sent yet.</p>'}</section>
      </div>` : `<div class="network-empty"><h3>No place shares yet</h3><p>Use the member area to send a place privately to another member of the circle.</p></div>`}
    </section>
  </div>`;
}

export function networkDiscoveryMarkup(accountHref: string, resolvePlace?: NetworkPlaceResolver): string {
  const record = memberRecord();
  if (!record) {
    return `<section class="network-invitation" aria-labelledby="network-home-title">
      <div class="network-invitation-copy">
        <p class="network-kicker">An invite-only circle for place discovery</p>
        <h1 id="network-home-title">Discover places through the Detour circle.</h1>
        <p class="network-invitation-lead">Members share their recommendations across one trusted circle, while direct place shares and replies remain private between the people involved.</p>
        <ol class="network-how" aria-label="How Detour works">
          <li><span aria-hidden="true">1</span><div><strong>Recommend a place</strong><p>Add somewhere you would genuinely send another Detourist.</p></div></li>
          <li><span aria-hidden="true">2</span><div><strong>Discover together</strong><p>Recommendations are visible across the full circle unless a member keeps theirs private.</p></div></li>
          <li><span aria-hidden="true">3</span><div><strong>Share privately</strong><p>Send a place and continue the conversation directly with another member.</p></div></li>
        </ol>
      </div>
      <aside class="network-invitation-action" aria-labelledby="network-membership-title">
        <p class="network-membership-label">Membership</p>
        <h2 id="network-membership-title">Start with a personal invitation.</h2>
        <p>Already a member, or holding an invitation code? Continue to the member area.</p>
        <a class="network-primary-link" href="${esc(accountHref)}" data-community-route>Sign in or join with a code <span aria-hidden="true">↗</span></a>
        <p class="network-invitation-note">Invitations are shared personally by current Detour members.</p>
      </aside>
    </section>`;
  }

  const pseudoName = record.pseudo?.trim().replace(/^@+/, '');
  const memberLabel = pseudoName ? `@${pseudoName}` : record.email || 'Detourist';
  return `<section class="network-home" aria-labelledby="network-home-title">
    <div class="network-home-heading">
      <p class="network-kicker">Your Detour circle</p>
      <h1 id="network-home-title">Places shared around the circle.</h1>
      <p>Welcome back, ${esc(memberLabel)}. Discover recommendations from the full circle and keep your direct place shares together here.</p>
    </div>
    ${memberFeedMarkup(resolvePlace)}
  </section>`;
}

async function loadNetworkDiscovery(render: () => void): Promise<void> {
  const record = memberRecord();
  if (!record || status === 'loading') return;
  status = 'loading';
  loadedFor = record.id;
  errorMessage = '';
  render();
  try {
    const payload = await pb.send<unknown>('/api/detour/network-discovery', { requestKey: null });
    if (memberRecord()?.id !== record.id) return;
    discovery = cleanPayload(payload);
    status = 'ready';
  } catch (error) {
    if (memberRecord()?.id !== record.id) return;
    discovery = { recommendations: [], shares: [] };
    status = 'error';
    errorMessage = readableError(error, 'The Detour circle is unavailable right now. Please try again shortly.');
  }
  render();
}

function showReplyFeedback(form: HTMLFormElement, state: ReplyState, message: string, error: boolean, validationError: boolean): void {
  state.message = message;
  state.error = error;
  state.validationError = validationError;
  const textarea = form.querySelector<HTMLTextAreaElement>('textarea[name="body"]');
  const statusElement = form.querySelector<HTMLElement>('.network-reply-status');
  if (textarea) {
    if (validationError) textarea.setAttribute('aria-invalid', 'true');
    else textarea.removeAttribute('aria-invalid');
  }
  if (statusElement) {
    statusElement.textContent = message;
    statusElement.classList.toggle('is-error', error);
    statusElement.classList.toggle('is-success', Boolean(message) && !error);
    statusElement.setAttribute('role', error ? 'alert' : 'status');
    statusElement.setAttribute('aria-live', error ? 'assertive' : 'polite');
  }
}

export function bindNetworkDiscovery(root: HTMLElement, render: () => void): void {
  ensureNetworkDiscovery(render);

  root.querySelector<HTMLButtonElement>('[data-network-retry]')?.addEventListener('click', () => {
    status = 'idle';
    void loadNetworkDiscovery(render);
  });

  root.querySelectorAll<HTMLFormElement>('[data-network-reply-form]').forEach((form) => {
    const shareId = form.dataset.shareId || '';
    if (!shareId) return;
    const state = replyState(shareId);
    const textarea = form.querySelector<HTMLTextAreaElement>('textarea[name="body"]');

    textarea?.addEventListener('input', () => {
      state.body = textarea.value;
    });

    textarea?.addEventListener('blur', () => {
      state.body = textarea.value;
      if (!state.body.trim()) return;
      const validationMessage = replyValidation(state.body);
      if (validationMessage) showReplyFeedback(form, state, validationMessage, true, true);
      else if (state.validationError) showReplyFeedback(form, state, '', false, false);
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const active = memberRecord();
      if (!active || state.submitting) return;
      const body = String(new FormData(form).get('body') || '');
      state.body = body;
      const validationMessage = replyValidation(body);
      if (validationMessage) {
        showReplyFeedback(form, state, validationMessage, true, true);
        textarea?.focus();
        return;
      }

      state.submitting = true;
      state.message = 'Sending reply…';
      state.error = false;
      state.validationError = false;
      render();

      try {
        await pb.collection('community_share_replies').create({ share: shareId, body: body.trim() }, { requestKey: null });
        if (memberRecord()?.id !== active.id) return;
        state.body = '';
        state.message = 'Reply sent. Updating the thread…';
        render();

        try {
          const payload = await pb.send<unknown>('/api/detour/network-discovery', { requestKey: null });
          if (memberRecord()?.id !== active.id) return;
          discovery = cleanPayload(payload);
          loadedFor = active.id;
          status = 'ready';
          errorMessage = '';
          state.message = 'Reply sent.';
          state.error = false;
        } catch {
          if (memberRecord()?.id !== active.id) return;
          state.message = 'Your reply was sent, but the thread could not refresh. Reload the page to see it.';
          state.error = true;
        }
      } catch (error) {
        if (memberRecord()?.id !== active.id) return;
        state.message = replyCreateError(error);
        state.error = true;
      } finally {
        if (memberRecord()?.id === active.id) {
          state.submitting = false;
          render();
        }
      }
    });
  });

}
