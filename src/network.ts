import { pb } from './pocketbase';

type DiscoveryStatus = 'idle' | 'loading' | 'ready' | 'error';
type ShareDirection = 'received' | 'sent';

interface DiscoveryRecommendation {
  recommender_name?: string;
  recommender_pseudo?: string;
  note?: string;
  venue_name?: string;
  city?: string;
  country?: string;
  address?: string;
  created?: string;
}

interface DiscoveryShare {
  direction: ShareDirection;
  venue_name?: string;
  city?: string;
  country?: string;
  address?: string;
  personal_note?: string;
  sender_name?: string;
  sender_pseudo?: string;
  recipient_name?: string;
  recipient_pseudo?: string;
  seen?: boolean;
  created?: string;
}

interface NetworkDiscovery {
  discovery_visible: boolean;
  recommendations: DiscoveryRecommendation[];
  shares: DiscoveryShare[];
}

let status: DiscoveryStatus = 'idle';
let loadedFor = '';
let errorMessage = '';
let visibilitySaving = false;
let visibilityMessage = '';
let visibilityError = false;
let discovery: NetworkDiscovery = {
  discovery_visible: false,
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
    recommender_name: cleanText(item.recommender_name),
    recommender_pseudo: cleanText(item.recommender_pseudo),
    note: cleanText(item.note),
    city: cleanText(item.city),
    country: cleanText(item.country),
    address: cleanText(item.address),
    created: cleanDate(item.created),
  };
}

function cleanShare(value: unknown): DiscoveryShare | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const venueName = cleanText(item.venue_name);
  if (!venueName || (item.direction !== 'received' && item.direction !== 'sent')) return null;
  return {
    direction: item.direction,
    venue_name: venueName,
    city: cleanText(item.city),
    country: cleanText(item.country),
    address: cleanText(item.address),
    personal_note: cleanText(item.personal_note),
    sender_name: cleanText(item.sender_name),
    sender_pseudo: cleanText(item.sender_pseudo),
    recipient_name: cleanText(item.recipient_name),
    recipient_pseudo: cleanText(item.recipient_pseudo),
    seen: item.seen === true,
    created: cleanDate(item.created),
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
    discovery_visible: payload.discovery_visible === true,
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

function memberRecord(): { id: string; display_name?: string; email?: string } | null {
  if (!pb.authStore.isValid || !pb.authStore.record?.id) return null;
  return pb.authStore.record as unknown as { id: string; display_name?: string; email?: string };
}

export function isAuthenticatedMember(): boolean {
  return memberRecord() !== null;
}

export function resetNetworkDiscovery(): void {
  status = 'idle';
  loadedFor = '';
  errorMessage = '';
  visibilitySaving = false;
  visibilityMessage = '';
  visibilityError = false;
  discovery = { discovery_visible: false, recommendations: [], shares: [] };
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

function pseudo(value: string | undefined): string {
  return value ? `<span class="network-pseudo">@${esc(value.replace(/^@+/, ''))}</span>` : '';
}

function recommendationMarkup(item: DiscoveryRecommendation): string {
  const who = item.recommender_name || 'A connection';
  const when = formatDate(item.created);
  const metadata = placeMeta(item);
  return `<article class="network-entry network-recommendation">
    <header class="network-entry-head">
      <div>
        <h3>${esc(item.venue_name || 'Recommended place')}</h3>
        ${metadata ? `<p class="network-place-meta">${esc(metadata)}</p>` : ''}
      </div>
      <span class="network-entry-kind">Recommendation</span>
    </header>
    ${item.note ? `<blockquote><p>${esc(item.note)}</p></blockquote>` : '<p class="network-entry-note-empty">No note was included with this recommendation.</p>'}
    <p class="network-entry-byline"><strong>${esc(who)}</strong>${pseudo(item.recommender_pseudo)}${when ? `<span aria-hidden="true"> · </span><time datetime="${esc(item.created)}">${esc(when)}</time>` : ''}</p>
  </article>`;
}

function shareMarkup(item: DiscoveryShare): string {
  const received = item.direction === 'received';
  const person = received ? item.sender_name || 'A connection' : item.recipient_name || 'a connection';
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
    <p class="network-entry-byline">${received ? 'From' : 'To'} <strong>${esc(person)}</strong>${pseudo(personPseudo)}${when ? `<span aria-hidden="true"> · </span><time datetime="${esc(item.created)}">${esc(when)}</time>` : ''}</p>
  </article>`;
}

function visibilityControl(): string {
  const checked = discovery.discovery_visible;
  return `<section class="network-visibility" aria-labelledby="network-visibility-title">
    <div class="network-visibility-copy">
      <h2 id="network-visibility-title">Let your recommendations travel</h2>
      <p>Turn this on to let your direct network connections see your recommendations in their private discovery feed. It does not make them public.</p>
    </div>
    <label class="network-switch">
      <input type="checkbox" data-network-visibility ${checked ? 'checked' : ''} ${visibilitySaving ? 'disabled' : ''}>
      <span aria-hidden="true"></span>
      <strong>${visibilitySaving ? 'Saving…' : checked ? 'Visible to connections' : 'Only visible to you'}</strong>
    </label>
    ${visibilityMessage ? `<p class="network-visibility-status${visibilityError ? ' is-error' : ''}" role="${visibilityError ? 'alert' : 'status'}">${esc(visibilityMessage)}</p>` : ''}
  </section>`;
}

function memberFeedMarkup(): string {
  const recommendations = discovery.recommendations;
  const received = discovery.shares.filter((share) => share.direction === 'received');
  const sent = discovery.shares.filter((share) => share.direction === 'sent');
  const shareCount = received.length + sent.length;

  if (status === 'loading' || status === 'idle') {
    return `<div class="network-state network-state-loading" role="status">
      <span class="network-loading-mark" aria-hidden="true"></span>
      <div><h2>Gathering your private network</h2><p>Loading recommendations and place shares that belong to your account.</p></div>
    </div>`;
  }

  if (status === 'error') {
    return `<div class="network-state network-state-error" role="alert">
      <div><h2>Your network could not be loaded</h2><p>${esc(errorMessage || 'Please try again. Your private activity has not been shown.')}</p></div>
      <button type="button" class="network-retry" data-network-retry>Try again</button>
    </div>`;
  }

  return `<div class="network-member-content">
    ${visibilityControl()}
    <section class="network-stream" aria-labelledby="network-recommendations-title">
      <div class="network-section-heading">
        <div><h2 id="network-recommendations-title">Recommended by your network</h2><p>Notes from members directly connected to you.</p></div>
        <p class="network-section-count">${recommendations.length} ${recommendations.length === 1 ? 'recommendation' : 'recommendations'}</p>
      </div>
      ${recommendations.length ? `<div class="network-entry-list">${recommendations.map(recommendationMarkup).join('')}</div>` : `<div class="network-empty"><h3>No network recommendations yet</h3><p>When a direct connection chooses to share their recommendations, they will appear here.</p></div>`}
    </section>
    <section class="network-stream network-shares" aria-labelledby="network-shares-title">
      <div class="network-section-heading">
        <div><h2 id="network-shares-title">Places passed between you</h2><p>Private incoming and outgoing shares, kept together.</p></div>
        <p class="network-section-count">${shareCount} ${shareCount === 1 ? 'share' : 'shares'}</p>
      </div>
      ${shareCount ? `<div class="network-share-columns">
        <section aria-labelledby="network-received-title"><h3 id="network-received-title">Shared with you</h3>${received.length ? `<div class="network-entry-list">${received.map(shareMarkup).join('')}</div>` : '<p class="network-column-empty">Nothing received yet.</p>'}</section>
        <section aria-labelledby="network-sent-title"><h3 id="network-sent-title">Sent by you</h3>${sent.length ? `<div class="network-entry-list">${sent.map(shareMarkup).join('')}</div>` : '<p class="network-column-empty">Nothing sent yet.</p>'}</section>
      </div>` : `<div class="network-empty"><h3>No place shares yet</h3><p>Use the member area to send a place directly to someone in your network.</p></div>`}
    </section>
  </div>`;
}

export function networkDiscoveryMarkup(accountHref: string): string {
  const record = memberRecord();
  if (!record) {
    return `<section class="network-invitation" aria-labelledby="network-home-title">
      <div class="network-invitation-copy">
        <p class="network-kicker">A private community for considered places</p>
        <h1 id="network-home-title">Places passed hand to hand.</h1>
        <p>Detour is built around people you know: recommendations from your network and private place shares, without a public social feed.</p>
      </div>
      <div class="network-invitation-action">
        <p>Membership is by personal invitation. Already a member?</p>
        <a class="network-primary-link" href="${esc(accountHref)}" data-community-route>Sign in to your Detour <span aria-hidden="true">↗</span></a>
        <p class="network-invitation-note">Have an invitation code? The same member page will help you join.</p>
      </div>
    </section>`;
  }

  const firstName = (record.display_name || record.email?.split('@')[0] || 'Member').trim();
  return `<section class="network-home" aria-labelledby="network-home-title">
    <div class="network-home-heading">
      <div>
        <p class="network-kicker">Your private discovery</p>
        <h1 id="network-home-title">Places passed hand to hand.</h1>
        <p>Welcome back, ${esc(firstName)}. This is what your connections have recommended and what you have shared with each other.</p>
      </div>
      <a class="network-member-link" href="${esc(accountHref)}" data-community-route>Manage your Detour <span aria-hidden="true">↗</span></a>
    </div>
    ${memberFeedMarkup()}
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
    discovery = { discovery_visible: false, recommendations: [], shares: [] };
    status = 'error';
    errorMessage = readableError(error, 'Your network is unavailable right now. Please try again shortly.');
  }
  render();
}

export function bindNetworkDiscovery(root: HTMLElement, render: () => void): void {
  const record = memberRecord();
  if (record && loadedFor !== record.id && status !== 'loading') {
    status = 'idle';
    void loadNetworkDiscovery(render);
  }

  root.querySelector<HTMLButtonElement>('[data-network-retry]')?.addEventListener('click', () => {
    status = 'idle';
    void loadNetworkDiscovery(render);
  });

  root.querySelector<HTMLInputElement>('[data-network-visibility]')?.addEventListener('change', async (event) => {
    const active = memberRecord();
    const input = event.currentTarget as HTMLInputElement;
    if (!active || visibilitySaving) return;
    const previous = discovery.discovery_visible;
    const next = input.checked;
    discovery.discovery_visible = next;
    visibilitySaving = true;
    visibilityMessage = '';
    visibilityError = false;
    render();
    try {
      await pb.collection('members').update(active.id, { discovery_visible: next }, { requestKey: null });
      if (memberRecord()?.id !== active.id) return;
      visibilityMessage = next
        ? 'Your direct connections can now see your recommendations.'
        : 'Your recommendations are now hidden from your connections.';
      visibilityError = false;
    } catch (error) {
      if (memberRecord()?.id !== active.id) return;
      discovery.discovery_visible = previous;
      visibilityMessage = readableError(error, 'That visibility setting could not be saved. Please try again.');
      visibilityError = true;
    } finally {
      visibilitySaving = false;
      render();
    }
  });
}
