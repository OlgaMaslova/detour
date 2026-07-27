import { pb } from './pocketbase';

type DiscoveryStatus = 'idle' | 'loading' | 'ready' | 'error';
type FirstPlaceStatus = 'idle' | 'loading' | 'ready' | 'error';
type ShareDirection = 'received' | 'sent';
type InviteRequestStatus = 'idle' | 'submitting' | 'success';
type InviteRequestField = 'name' | 'email' | 'city' | 'why';

export interface DiscoveryRecommendation {
  recommender_pseudo?: string;
  is_own?: boolean;
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

interface InviteRequestState {
  status: InviteRequestStatus;
  name: string;
  email: string;
  city: string;
  why: string;
  message: string;
  fieldErrors: Record<InviteRequestField, string>;
}

const REPLY_MIN_LENGTH = 8;
const REPLY_MAX_LENGTH = 1200;
// The landing feed shows only the most recent recommendations to keep the page
// short; the country filter lets members reach the rest.
const RECOMMENDATION_PREVIEW_LIMIT = 4;

/**
 * Resolves a recommended place to a published catalogue venue so the feed can
 * open it on the destination map. Returns null when the place has no published
 * venue yet — the entry then renders as plain text.
 */
export type NetworkPlaceResolver = (venueName: string, city: string) => { venueId: string; destinationSlug: string; imageUrl?: string } | null;

interface NetworkDiscovery {
  recommendations: DiscoveryRecommendation[];
  shares: DiscoveryShare[];
}

let status: DiscoveryStatus = 'idle';
let loadedFor = '';
let errorMessage = '';
let recommendationCountry = '';
let firstPlaceStatus: FirstPlaceStatus = 'idle';
let firstPlaceLoadedFor = '';
let firstPlaceCount = 0;
let firstPlaceRequest = 0;
const replyStates = new Map<string, ReplyState>();
const inviteRequestState: InviteRequestState = {
  status: 'idle',
  name: '',
  email: '',
  city: '',
  why: '',
  message: '',
  fieldErrors: { name: '', email: '', city: '', why: '' },
};
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
    is_own: item.is_own === true,
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

function safeInlineMessage(value: unknown): string {
  if (typeof value !== 'string') return '';
  const message = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return message.length <= 500 ? message : '';
}

function inviteRequestCreateError(error: unknown): string {
  if (error && typeof error === 'object') {
    const response = (error as { response?: { message?: unknown; data?: Record<string, { message?: unknown }> } }).response;
    const responseMessage = safeInlineMessage(response?.message);
    if (responseMessage && !/^failed to create record\.?$/i.test(responseMessage)) return responseMessage;
    if (response?.data && typeof response.data === 'object') {
      for (const detail of Object.values(response.data)) {
        const fieldMessage = safeInlineMessage(detail?.message);
        if (fieldMessage) return fieldMessage;
      }
    }
  }
  return "We couldn't send your request. Check your connection and try again; your answers are still here.";
}

function inviteRequestSource(): string {
  const ref = new URLSearchParams(window.location.search).get('ref')?.trim() || '';
  return /^[a-zA-Z0-9][a-zA-Z0-9._:/?&=+\-]{0,119}$/.test(ref) ? ref : 'public-site';
}

function inviteRequestFieldError(field: InviteRequestField, element: HTMLInputElement | HTMLTextAreaElement): string {
  const value = element.value.trim();
  if (field === 'email') {
    if (!value) return 'Enter your email address.';
    if (element.validity.typeMismatch) return 'Enter an email address in the usual name@example.com format.';
  }
  const limits: Record<InviteRequestField, number> = { name: 120, email: 0, city: 120, why: 500 };
  const limit = limits[field];
  if (limit && value.length > limit) return `${field === 'why' ? 'This answer' : field === 'name' ? 'Name' : 'City'} must be ${limit} characters or fewer.`;
  return '';
}

function inviteRequestFormMarkup(accountHref: string): string {
  if (inviteRequestState.status === 'success') {
    return `<div class="network-invite-success" data-invite-request-success role="status" aria-live="polite" tabindex="-1">
      <p class="network-membership-label">Request received</p>
      <h2>Thank you for raising your hand.</h2>
      <p>The Detour team received your founding-member request and will reply personally. This is a request, not immediate membership or access.</p>
    </div>
    <div class="network-member-return">
      <p class="network-membership-label">Already invited?</p>
      <a class="network-primary-link" href="${esc(accountHref)}" data-community-route>Sign in or join with a code <span aria-hidden="true">↗</span></a>
      <p class="network-invitation-note">Invitations and replies are shared personally by the Detour team and current members.</p>
    </div>`;
  }

  const pending = inviteRequestState.status === 'submitting';
  const statusRole = inviteRequestState.message ? (pending ? 'status' : 'alert') : '';
  const statusClass = inviteRequestState.message && !pending ? ' is-error' : '';
  return `<div class="network-invite-intro">
      <p class="network-membership-label">Founding membership</p>
      <h2 id="network-membership-title">Ask to join the Detour circle.</h2>
      <p>Tell us a little about yourself. The Detour team reads every request and replies personally; submitting does not grant immediate access.</p>
    </div>
    <form class="network-invite-form" data-invite-request-form novalidate aria-labelledby="network-membership-title">
      <fieldset${pending ? ' disabled' : ''}>
        <legend class="visually-hidden">Founding-member invite request</legend>
        <div class="network-invite-fields">
          <div class="network-invite-field">
            <label for="invite-request-name">Name <span>(optional)</span></label>
            <input id="invite-request-name" name="name" type="text" autocomplete="name" maxlength="120" value="${esc(inviteRequestState.name)}" aria-describedby="invite-request-name-error"${inviteRequestState.fieldErrors.name ? ' aria-invalid="true"' : ''}>
            <p class="network-invite-field-error" id="invite-request-name-error">${esc(inviteRequestState.fieldErrors.name)}</p>
          </div>
          <div class="network-invite-field">
            <label for="invite-request-email">Email</label>
            <input id="invite-request-email" name="email" type="email" autocomplete="email" inputmode="email" required value="${esc(inviteRequestState.email)}" aria-describedby="invite-request-email-error"${inviteRequestState.fieldErrors.email ? ' aria-invalid="true"' : ''}>
            <p class="network-invite-field-error" id="invite-request-email-error">${esc(inviteRequestState.fieldErrors.email)}</p>
          </div>
          <div class="network-invite-field">
            <label for="invite-request-city">City <span>(optional)</span></label>
            <input id="invite-request-city" name="city" type="text" autocomplete="address-level2" maxlength="120" value="${esc(inviteRequestState.city)}" aria-describedby="invite-request-city-error"${inviteRequestState.fieldErrors.city ? ' aria-invalid="true"' : ''}>
            <p class="network-invite-field-error" id="invite-request-city-error">${esc(inviteRequestState.fieldErrors.city)}</p>
          </div>
          <div class="network-invite-field network-invite-field-wide">
            <label for="invite-request-why">What would you bring to Detour? <span>(optional)</span></label>
            <textarea id="invite-request-why" name="why" rows="3" maxlength="500" aria-describedby="invite-request-why-hint invite-request-why-error"${inviteRequestState.fieldErrors.why ? ' aria-invalid="true"' : ''}>${esc(inviteRequestState.why)}</textarea>
            <p class="network-invite-field-hint" id="invite-request-why-hint">A short line about the places, perspective, or local knowledge you would share.</p>
            <p class="network-invite-field-error" id="invite-request-why-error">${esc(inviteRequestState.fieldErrors.why)}</p>
          </div>
        </div>
        <button class="network-primary-link network-invite-submit" type="submit"${pending ? ' disabled' : ''}>${pending ? 'Sending request…' : 'Request a founding-member invite'}</button>
      </fieldset>
      <p class="network-invite-status${statusClass}" data-invite-request-status${statusRole ? ` role="${statusRole}" aria-live="${pending ? 'polite' : 'assertive'}"` : ''} tabindex="-1">${esc(inviteRequestState.message)}</p>
    </form>
    <div class="network-member-return">
      <p class="network-membership-label">Already invited?</p>
      <a class="network-primary-link" href="${esc(accountHref)}" data-community-route>Sign in or join with a code <span aria-hidden="true">↗</span></a>
      <p class="network-invitation-note">Invitations are shared personally by current Detour members.</p>
    </div>`;
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
 * catalogue detail can show what members (including the signed-in member)
 * said about a place. Empty until the discovery feed has loaded.
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
  if (record && firstPlaceLoadedFor !== record.id && firstPlaceStatus !== 'loading') {
    firstPlaceStatus = 'idle';
    void loadFirstPlaceEligibility(render);
  }
}

/** Hides the invitation immediately after the existing add-a-place flow succeeds. */
export function markFirstPlaceContributed(): void {
  const record = memberRecord();
  if (!record) return;
  firstPlaceRequest += 1;
  firstPlaceLoadedFor = record.id;
  firstPlaceCount = Math.max(1, firstPlaceCount);
  firstPlaceStatus = 'ready';
}

export function resetNetworkDiscovery(): void {
  status = 'idle';
  loadedFor = '';
  errorMessage = '';
  recommendationCountry = '';
  firstPlaceRequest += 1;
  firstPlaceStatus = 'idle';
  firstPlaceLoadedFor = '';
  firstPlaceCount = 0;
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

function recencyValue(item: { created?: string }): number {
  return item.created ? new Date(item.created).getTime() : 0;
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
    ${count ? `<ol class="network-reply-list">${item.replies.map(replyMarkup).join('')}</ol>` : '<p class="network-replies-empty">No replies yet. Keep the conversation tied to this food-and-drink destination.</p>'}
    <form class="network-reply-form" data-network-reply-form data-share-id="${esc(item.id)}" novalidate>
      <label for="${fieldId}">Reply about ${esc(item.venue_name || 'this destination')}</label>
      <textarea id="${fieldId}" name="body" rows="3" minlength="${REPLY_MIN_LENGTH}" maxlength="${REPLY_MAX_LENGTH}" required aria-describedby="${helpId} ${statusId}"${state.validationError ? ' aria-invalid="true"' : ''} placeholder="Add a private note about this food-and-drink destination…" ${state.submitting ? 'disabled' : ''}>${esc(state.body)}</textarea>
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
  const whereabouts = [item.city, item.country].filter(Boolean).join(', ');
  const name = item.venue_name || 'Recommended food-and-drink destination';
  const place = item.venue_name && resolvePlace ? resolvePlace(item.venue_name, item.city || '') : null;
  const title = place
    ? `<button type="button" class="network-entry-place" data-open-destination="${esc(place.destinationSlug)}" data-open-venue="${esc(place.venueId)}" aria-label="Open ${esc(name)} on the map">${esc(name)}</button>`
    : esc(name);
  const thumb = place?.imageUrl
    ? `<figure class="network-entry-thumb"><img src="${esc(place.imageUrl)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-network-thumb></figure>`
    : '';
  return `<article class="network-entry network-recommendation${thumb ? ' network-entry-with-thumb' : ''}">
    <div class="network-entry-main">
      <header class="network-entry-head">
        <div>
          <h3>${title}</h3>
          ${whereabouts ? `<p class="network-place-meta">${esc(whereabouts)}</p>` : ''}
        </div>
        <span class="network-entry-kind">${item.is_own ? 'Your recommendation' : 'Recommendation'}</span>
      </header>
      ${item.note ? `<blockquote><p>${esc(item.note)}</p></blockquote>` : '<p class="network-entry-note-empty">No note was included with this recommendation.</p>'}
      <p class="network-entry-byline">${item.is_own ? '<strong class="network-pseudo">You</strong>' : pseudo(item.recommender_pseudo)}${when ? `<span aria-hidden="true"> · </span><time datetime="${esc(item.created)}">${esc(when)}</time>` : ''}</p>
    </div>
    ${thumb}
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
        <h3>${esc(item.venue_name || 'Shared food-and-drink destination')}</h3>
        ${metadata ? `<p class="network-place-meta">${esc(metadata)}</p>` : ''}
      </div>
      <span class="network-entry-kind">${received ? (item.seen ? 'Received' : 'New share') : 'Sent'}</span>
    </header>
    ${item.personal_note ? `<blockquote><p>${esc(item.personal_note)}</p></blockquote>` : '<p class="network-entry-note-empty">No personal note was included.</p>'}
    <p class="network-entry-byline">${received ? 'From' : 'To'} ${pseudo(personPseudo, received ? 'A Detour member' : 'a Detour member')}${when ? `<span aria-hidden="true"> · </span><time datetime="${esc(item.created)}">${esc(when)}</time>` : ''}</p>
    ${replyThreadMarkup(item)}
  </article>`;
}

function firstPlaceInvitationMarkup(accountHref: string): string {
  const hasCurrentRecommendation = discovery.recommendations.some((item) => item.is_own);
  if (status !== 'ready' || firstPlaceStatus !== 'ready' || firstPlaceCount !== 0 || hasCurrentRecommendation) return '';
  return `<aside class="network-first-place" aria-labelledby="network-first-place-title">
    <div>
      <h2 id="network-first-place-title">Know somewhere worth a detour?</h2>
      <p>Your first place gives the circle somewhere new to discover.</p>
    </div>
    <a class="network-primary-link" href="${esc(accountHref)}" data-community-route="recommend-place">Add your first place <span aria-hidden="true">↗</span></a>
  </aside>`;
}

function memberFeedMarkup(accountHref: string, resolvePlace?: NetworkPlaceResolver): string {
  const recommendations = discovery.recommendations;
  const received = discovery.shares.filter((share) => share.direction === 'received');
  const sent = discovery.shares.filter((share) => share.direction === 'sent');
  const shareCount = received.length + sent.length;

  if (status === 'loading' || status === 'idle') {
    return `<div class="network-state network-state-loading" role="status">
      <span class="network-loading-mark" aria-hidden="true"></span>
      <div><h2>Gathering the Detour circle</h2><p>Loading full-circle food-and-drink recommendations and private shares.</p></div>
    </div>`;
  }

  if (status === 'error') {
    return `<div class="network-state network-state-error" role="alert">
      <div><h2>The Detour circle could not be loaded</h2><p>${esc(errorMessage || 'Please try again. Circle recommendations and your private shares have not been shown.')}</p></div>
      <button type="button" class="network-retry" data-network-retry>Try again</button>
    </div>`;
  }

  // Country facets are derived from the recommendations themselves, so the
  // filter only ever offers countries that actually have something to show.
  const countries = [...new Set(recommendations.map((item) => item.country?.trim()).filter((country): country is string => Boolean(country)))].sort(
    (a, b) => a.localeCompare(b)
  );
  const activeCountry = countries.includes(recommendationCountry) ? recommendationCountry : '';
  const matching = activeCountry ? recommendations.filter((item) => item.country?.trim() === activeCountry) : recommendations;
  const latest = [...matching].sort((a, b) => recencyValue(b) - recencyValue(a)).slice(0, RECOMMENDATION_PREVIEW_LIMIT);
  const hiddenCount = matching.length - latest.length;

  return `<div class="network-member-content">
    <section class="network-stream" aria-labelledby="network-recommendations-title">
      <div class="network-section-heading">
        <div><h2 id="network-recommendations-title">Destinations recommended by the community</h2><p>Restaurants, cafés, bars, and other food-and-drink destinations shared across the invite-only Detour circle.</p></div>
        <div class="network-section-actions">
          <p class="network-section-count">${matching.length} ${matching.length === 1 ? 'recommendation' : 'recommendations'}</p>
          <a class="network-primary-link network-recommend-cta" href="${esc(accountHref)}" data-community-route="recommend-place">Recommend<span aria-hidden="true">↗</span></a>
        </div>
      </div>
      ${
        countries.length > 1
          ? `<div class="network-filter">
              <label for="network-country-filter">Country</label>
              <select id="network-country-filter" data-network-country>
                <option value="">All countries</option>
                ${countries.map((country) => `<option value="${esc(country)}"${country === activeCountry ? ' selected' : ''}>${esc(country)}</option>`).join('')}
              </select>
            </div>`
          : ''
      }
      ${
        latest.length
          ? `<div class="network-entry-list network-recommendation-grid">${latest.map((item) => recommendationMarkup(item, resolvePlace)).join('')}</div>${
              hiddenCount > 0
                ? `<p class="network-entry-more">Showing the ${RECOMMENDATION_PREVIEW_LIMIT} most recent${activeCountry ? ` in ${esc(activeCountry)}` : ''}. ${hiddenCount} more ${hiddenCount === 1 ? 'recommendation is' : 'recommendations are'} in the circle${!activeCountry && countries.length > 1 ? ' — filter by country to see others' : ''}.</p>`
                : ''
            }`
          : `<div class="network-empty"><h3>No circle recommendations yet</h3><p>Recommendations will appear here as members add them, unless they choose to keep theirs private.</p></div>`
      }
    </section>
    <section class="network-stream network-shares" aria-labelledby="network-shares-title">
      <div class="network-section-heading">
        <div><h2 id="network-shares-title">Shared destinations</h2><p>Private incoming and outgoing destination shares, kept together.</p></div>
        <div class="network-section-actions">
          <p class="network-section-count">${shareCount} ${shareCount === 1 ? 'share' : 'shares'}</p>
          <a class="network-primary-link network-share-cta" href="${esc(accountHref)}" data-community-route="share-place">Share<span aria-hidden="true">↗</span></a>
        </div>
      </div>
      ${shareCount ? `<div class="network-share-columns">
        <section aria-labelledby="network-received-title"><h3 id="network-received-title">Shared with you</h3>${received.length ? `<div class="network-entry-list">${received.map(shareMarkup).join('')}</div>` : '<p class="network-column-empty">Nothing received yet.</p>'}</section>
        <section aria-labelledby="network-sent-title"><h3 id="network-sent-title">Sent by you</h3>${sent.length ? `<div class="network-entry-list">${sent.map(shareMarkup).join('')}</div>` : '<p class="network-column-empty">Nothing sent yet.</p>'}</section>
      </div>` : `<div class="network-empty"><h3>No shares yet</h3><p>Use the member area to send a restaurant, café, bar, or other food-and-drink destination privately to another member of the circle.</p></div>`}
    </section>
  </div>`;
}

export function networkDiscoveryMarkup(accountHref: string, resolvePlace?: NetworkPlaceResolver): string {
  const record = memberRecord();
  if (!record) {
    return `<section class="network-invitation" aria-labelledby="network-home-title">
      <div class="network-invitation-copy">
        <p class="network-kicker">An invite-only circle for food-and-drink discovery</p>
        <h1 id="network-home-title">Discover memorable places to eat and drink through the Detour circle.</h1>
        <p class="network-invitation-lead">Detour is an invitation-only, community-curated food-and-drink list built from recommendations by people you can trust. Direct shares and replies remain private between the people involved.</p>
        <ol class="network-how" aria-label="How Detour works">
          <li><span aria-hidden="true">1</span><div><strong>Recommend somewhere to eat or drink</strong><p>Add a restaurant, café, bar, or other food-and-drink destination you would genuinely send another Detourist.</p></div></li>
          <li><span aria-hidden="true">2</span><div><strong>Discover together</strong><p>Recommendations are visible across the full circle unless a member keeps theirs private.</p></div></li>
          <li><span aria-hidden="true">3</span><div><strong>Share privately</strong><p>Send a food-and-drink destination and continue the conversation directly with another member.</p></div></li>
        </ol>
      </div>
      <aside class="network-invitation-action" aria-label="Founding membership and member sign-in">
        ${inviteRequestFormMarkup(accountHref)}
      </aside>
    </section>`;
  }

  const pseudoName = record.pseudo?.trim().replace(/^@+/, '');
  const memberLabel = pseudoName ? `@${pseudoName}` : record.email || 'Detourist';
  return `<section class="network-home" aria-labelledby="network-home-title">
    <div class="network-home-heading">
      <p class="network-kicker">Your Detour circle</p>
      <h1 id="network-home-title">Food-and-drink destinations shared around the circle.</h1>
      <p>Welcome back, ${esc(memberLabel)}. Discover restaurants, cafés, bars, and other food-and-drink recommendations from the full circle, and keep your direct shares together here.</p>
    </div>
    ${firstPlaceInvitationMarkup(accountHref)}
    ${memberFeedMarkup(accountHref, resolvePlace)}
  </section>`;
}

async function loadFirstPlaceEligibility(render: () => void): Promise<void> {
  const record = memberRecord();
  if (!record || firstPlaceStatus === 'loading') return;
  const request = ++firstPlaceRequest;
  firstPlaceStatus = 'loading';
  firstPlaceLoadedFor = record.id;
  try {
    const payload = await pb.send<unknown>('/api/detour/member-place-contributions', { requestKey: null });
    if (memberRecord()?.id !== record.id || request !== firstPlaceRequest) return;
    if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { items?: unknown }).items)) {
      throw new Error('The member contribution response was not valid.');
    }
    firstPlaceCount = (payload as { items: unknown[] }).items.length;
    firstPlaceStatus = 'ready';
  } catch {
    if (memberRecord()?.id !== record.id || request !== firstPlaceRequest) return;
    firstPlaceCount = 0;
    firstPlaceStatus = 'error';
  }
  render();
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

  const inviteForm = root.querySelector<HTMLFormElement>('[data-invite-request-form]');
  if (inviteForm) {
    const fields: InviteRequestField[] = ['name', 'email', 'city', 'why'];
    const fieldElement = (field: InviteRequestField): HTMLInputElement | HTMLTextAreaElement | null =>
      inviteForm.elements.namedItem(field) as HTMLInputElement | HTMLTextAreaElement | null;
    const showFieldError = (field: InviteRequestField, message: string): void => {
      inviteRequestState.fieldErrors[field] = message;
      const element = fieldElement(field);
      const error = inviteForm.querySelector<HTMLElement>(`#invite-request-${field}-error`);
      if (element) {
        if (message) element.setAttribute('aria-invalid', 'true');
        else element.removeAttribute('aria-invalid');
      }
      if (error) error.textContent = message;
    };
    const showFormStatus = (message: string, error: boolean): void => {
      inviteRequestState.message = message;
      const statusElement = inviteForm.querySelector<HTMLElement>('[data-invite-request-status]');
      if (!statusElement) return;
      statusElement.textContent = message;
      statusElement.classList.toggle('is-error', error);
      statusElement.setAttribute('role', error ? 'alert' : 'status');
      statusElement.setAttribute('aria-live', error ? 'assertive' : 'polite');
    };

    fields.forEach((field) => {
      const element = fieldElement(field);
      element?.addEventListener('input', () => {
        inviteRequestState[field] = element.value;
        if (inviteRequestState.fieldErrors[field]) showFieldError(field, '');
      });
      element?.addEventListener('blur', () => {
        const message = inviteRequestFieldError(field, element);
        showFieldError(field, message);
      });
    });

    inviteForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (inviteRequestState.status === 'submitting') return;

      let firstInvalid: HTMLInputElement | HTMLTextAreaElement | null = null;
      for (const field of fields) {
        const element = fieldElement(field);
        if (!element) continue;
        inviteRequestState[field] = element.value;
        const message = inviteRequestFieldError(field, element);
        showFieldError(field, message);
        if (message && !firstInvalid) firstInvalid = element;
      }
      if (firstInvalid) {
        showFormStatus('Check the highlighted field and try again.', true);
        firstInvalid.focus();
        return;
      }

      const payload = {
        name: inviteRequestState.name.trim(),
        email: inviteRequestState.email.trim(),
        city: inviteRequestState.city.trim(),
        why: inviteRequestState.why.trim(),
        source: inviteRequestSource(),
      };
      inviteRequestState.status = 'submitting';
      inviteRequestState.message = 'Sending your request…';
      const fieldset = inviteForm.querySelector<HTMLFieldSetElement>('fieldset');
      const submit = inviteForm.querySelector<HTMLButtonElement>('.network-invite-submit');
      if (fieldset) fieldset.disabled = true;
      if (submit) {
        submit.disabled = true;
        submit.textContent = 'Sending request…';
      }
      showFormStatus(inviteRequestState.message, false);

      try {
        await pb.collection('invite_requests').create(payload, { requestKey: null });
        inviteRequestState.status = 'success';
        inviteRequestState.message = '';
        render();
        root.querySelector<HTMLElement>('[data-invite-request-success]')?.focus();
      } catch (error) {
        inviteRequestState.status = 'idle';
        const message = inviteRequestCreateError(error);
        inviteRequestState.message = message;
        if (!inviteForm.isConnected) {
          render();
          root.querySelector<HTMLElement>('[data-invite-request-status]')?.focus();
          return;
        }
        if (fieldset) fieldset.disabled = false;
        if (submit) {
          submit.disabled = false;
          submit.textContent = 'Request a founding-member invite';
        }
        showFormStatus(message, true);
        inviteForm.querySelector<HTMLElement>('[data-invite-request-status]')?.focus();
      }
    });
  }

  root.querySelector<HTMLButtonElement>('[data-network-retry]')?.addEventListener('click', () => {
    status = 'idle';
    void loadNetworkDiscovery(render);
  });

  root.querySelector<HTMLSelectElement>('[data-network-country]')?.addEventListener('change', (event) => {
    recommendationCountry = (event.currentTarget as HTMLSelectElement).value;
    render();
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
