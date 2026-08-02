import { apiBaseUrl, pb } from './pocketbase';
import { coverTint } from './data';
import { placePromptMarkup, type PlacePrompt } from './place-prompt';
// No signal badge on a card: see groupedRecommendationCardMarkup. The stamp is
// the place page's, and network.ts no longer renders one.

type DiscoveryStatus = 'idle' | 'loading' | 'ready' | 'error';
type PublicRecommendationStatus = 'idle' | 'loading' | 'ready' | 'error';
type FirstPlaceStatus = 'idle' | 'loading' | 'ready' | 'error';
type ShareDirection = 'received' | 'sent';
type InviteRequestStatus = 'idle' | 'submitting' | 'success';
type InviteRequestField = 'name' | 'email' | 'city' | 'why';

export interface DiscoveryRecommendation {
  /** The recommendation's own id, used to break recency ties deterministically. */
  id?: string;
  recommender_pseudo?: string;
  is_own?: boolean;
  founding_member?: boolean;
  /**
   * Whether the invitation graph put this recommender in reach, independently of
   * the founding circle. Distinct from `founding_member`: an inviter who is also a
   * founding member is both, and the Founders' places switch must keep them.
   */
  in_graph?: boolean;
  note?: string;
  venue_name?: string;
  venue_id?: string;
  city?: string;
  country?: string;
  address?: string;
  created?: string;
  /**
   * The photo this member attached to this note, as an API file path. Arrives in
   * the same projection as the note, so it is never visible to anyone the note
   * is not — and can never be shown above somebody else's words.
   */
  photo_url?: string;
}

interface PublicRecommendation {
  id?: string;
  venue_name: string;
  city: string;
  country?: string;
  note: string;
  recommender_pseudo: string;
  founding_member?: boolean;
  created?: string;
  venue_id?: string;
  photo_url?: string;
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
const PUBLIC_RECOMMENDATION_PREVIEW_LIMIT = 3;
// Each cassette side opens on its newest shares and expands from there, so a
// long ledger cannot stretch the shell past the flip control.
const SHARE_PREVIEW_LIMIT = 3;

/**
 * Resolves a recommended place to a published catalogue venue so the feed can
 * open it on the destination map. Returns null when the place has no published
 * venue yet — the entry then renders as plain text.
 */
export type NetworkPlaceResolver = (
  venueName: string,
  city: string
) => {
  venueId: string;
  destinationSlug: string;
  destinationHref: string;
  placeHref: string;
  imageUrl?: string;
} | null;

interface NetworkDiscovery {
  recommendations: DiscoveryRecommendation[];
  shares: DiscoveryShare[];
}

let status: DiscoveryStatus = 'idle';
let loadedFor = '';
let errorMessage = '';
let recommendationsExpanded = false;
/**
 * Whether the landing feed includes the founding circle's places. On by default —
 * switching it off is a deliberate act, and for most members it would otherwise
 * empty most of the page. Remembered per browser, like the column choice: only the
 * explicit "off" is stored, so a new browser and a cleared browser both default to
 * showing them.
 */
const FOUNDING_PLACES_KEY = 'detour-show-founding-places';
let showFoundingPlaces = localStorage.getItem(FOUNDING_PLACES_KEY) !== 'off';
type RecommendationColumns = 2 | 3;
const RECOMMENDATION_COLUMNS_KEY = 'detour-recommendation-columns';
let recommendationColumns: RecommendationColumns =
  localStorage.getItem(RECOMMENDATION_COLUMNS_KEY) === '3' ? 3 : 2;
let sharesSide: 'a' | 'b' = 'a';
let sharesExpanded = false;
const archivingShareIds = new Set<string>();

function cassetteFlipLabel(): string {
  return sharesSide === 'a' ? 'Flip to side B ▸' : '◂ Flip to side A';
}

interface PublicRecommendationFeed {
  status: PublicRecommendationStatus;
  error: string;
  request: number;
  recommendations: PublicRecommendation[];
}

const publicRecommendationFeeds = new Map<string, PublicRecommendationFeed>();
let publicRecommendationRequest = 0;
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

/**
 * A recommendation photo as the server addresses it: a root-relative API file
 * path. Resolved here against the configured API base, because the frontend and
 * the API are on different origins. Anything else — an absolute link, a
 * protocol-relative one, a path pointing outside the files API — is dropped
 * rather than rendered, so a stored value can never redirect a member's browser
 * somewhere the API did not put a file.
 */
function cleanPhotoPath(value: unknown): string | undefined {
  const raw = cleanText(value);
  if (!raw || !raw.startsWith('/api/files/') || raw.startsWith('//')) return undefined;
  return raw;
}

/**
 * Recommendation photos that failed to load this session. A card whose photo is
 * in here falls through to its place's cover instead of re-requesting a broken
 * URL on every render — the same memory main.ts keeps for venue covers, kept
 * here because this module renders the cards.
 */
const failedPhotoUrls = new Set<string>();

export function markRecommendationPhotoFailed(url: string): void {
  if (url) failedPhotoUrls.add(url);
}

/** The absolute URL for a recommendation photo at the size a surface needs. */
export function recommendationPhotoHref(path: string | undefined, thumb: string): string {
  if (!path) return '';
  const href = `${apiBaseUrl.replace(/\/$/, '')}${path}?thumb=${encodeURIComponent(thumb)}`;
  return failedPhotoUrls.has(href) ? '' : href;
}

function cleanRecommendation(value: unknown): DiscoveryRecommendation | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const venueName = cleanText(item.venue_name);
  if (!venueName) return null;
  return {
    id: cleanText(item.id),
    venue_name: venueName,
    venue_id: cleanText(item.venue_id),
    recommender_pseudo: cleanText(item.recommender_pseudo),
    is_own: item.is_own === true,
    founding_member: item.founding_member === true,
    // Absent on a backend that predates the flag, and absent from the anonymous
    // sample. `undefined` must not read as "not in my circle", so the Founders'
    // places switch hides an item only on an explicit false.
    in_graph: typeof item.in_graph === 'boolean' ? item.in_graph : undefined,
    note: cleanText(item.note),
    city: cleanText(item.city),
    country: cleanText(item.country),
    address: cleanText(item.address),
    created: cleanDate(item.created),
    photo_url: cleanPhotoPath(item.photo_url),
  };
}

function cleanPublicRecommendation(value: unknown): PublicRecommendation | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const venueName = cleanText(item.venue_name);
  const city = cleanText(item.city);
  const note = cleanText(item.note);
  const recommenderPseudo = cleanText(item.recommender_pseudo)?.replace(/^@+/, '');
  if (!venueName || !city || !note || !recommenderPseudo) return null;
  return {
    id: cleanText(item.id),
    venue_name: venueName,
    city,
    country: cleanText(item.country),
    note,
    recommender_pseudo: recommenderPseudo,
    founding_member: item.founding_member === true,
    created: cleanDate(item.created),
    venue_id: cleanText(item.venue_id),
    photo_url: cleanPhotoPath(item.photo_url),
  };
}

function cleanPublicPayload(value: unknown): PublicRecommendation[] {
  if (!value || typeof value !== 'object') throw new Error('The public recommendation response was not valid.');
  const recommendations = (value as { recommendations?: unknown }).recommendations;
  if (!Array.isArray(recommendations)) throw new Error('The public recommendation response was not valid.');
  return recommendations
    .map(cleanPublicRecommendation)
    .filter((item): item is PublicRecommendation => item !== null);
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
  if (field === 'name' && !value) return 'Enter your name — every place here has a person behind it.';
  if (field === 'city' && value.length < 2) return 'Tell us where you live — the city you live in.';
  if (field === 'why' && !value) return "Name one place you'd recommend, and why — this is the part we read.";
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
      <p>The Detour team has your recommendation and will read it and reply personally. This is a request, not immediate membership or access.</p>
    </div>
    <div class="network-member-return">
      <p class="network-membership-label">Already invited?</p>
      <a class="network-primary-link" href="${esc(accountHref)}" data-community-route>Sign in or join with a code <span class="nav-arrow nav-arrow-external" aria-hidden="true">&#x2197;&#xFE0E;</span></a>
      <p class="network-invitation-note">Invitations and replies are shared personally by the Detour team and current members.</p>
    </div>`;
  }

  const pending = inviteRequestState.status === 'submitting';
  const statusRole = inviteRequestState.message ? (pending ? 'status' : 'alert') : '';
  const statusClass = inviteRequestState.message && !pending ? ' is-error' : '';
  return `<div class="network-invite-intro">
      <p class="network-membership-label">Founding membership</p>
      <h2 id="network-membership-title">Ask to join the Detour circle.</h2>
      <p>Tell us about one place you'd recommend, and why. We read every request and reply personally.</p>
      <p class="network-founding-benefits-title">What founding membership gives you</p>
      <ul class="network-founding-benefits">
        <li><strong>Free membership for life.</strong> Your place is permanent, whatever Detour becomes.</li>
        <li><strong>One of fifty.</strong> Fifty founding seats, and no more.</li>
        <li><strong>More invitations to give.</strong> Enough for everyone whose taste you trust.</li>
        <li><strong>Whole circle visibility.</strong> Every member sees your places. Your taste defines what this becomes.</li>
      </ul>
    </div>
    <form class="network-invite-form" data-invite-request-form novalidate aria-labelledby="network-membership-title">
      <fieldset${pending ? ' disabled' : ''}>
        <legend class="visually-hidden">Founding-member invite request</legend>
        <div class="network-invite-fields">
          <div class="network-invite-field">
            <label for="invite-request-name">Name</label>
            <input id="invite-request-name" name="name" type="text" autocomplete="name" maxlength="120" required value="${esc(inviteRequestState.name)}" aria-describedby="invite-request-name-error"${inviteRequestState.fieldErrors.name ? ' aria-invalid="true"' : ''}>
            <p class="network-invite-field-error" id="invite-request-name-error">${esc(inviteRequestState.fieldErrors.name)}</p>
          </div>
          <div class="network-invite-field">
            <label for="invite-request-city">Where do you live?</label>
            <input id="invite-request-city" name="city" type="text" autocomplete="address-level2" maxlength="120" required placeholder="City — e.g. Lisbon" value="${esc(inviteRequestState.city)}" aria-describedby="invite-request-city-error"${inviteRequestState.fieldErrors.city ? ' aria-invalid="true"' : ''}>
            <p class="network-invite-field-error" id="invite-request-city-error">${esc(inviteRequestState.fieldErrors.city)}</p>
          </div>
          <div class="network-invite-field network-invite-field-wide">
            <label for="invite-request-email">Email</label>
            <input id="invite-request-email" name="email" type="email" autocomplete="email" inputmode="email" required value="${esc(inviteRequestState.email)}" aria-describedby="invite-request-email-error"${inviteRequestState.fieldErrors.email ? ' aria-invalid="true"' : ''}>
            <p class="network-invite-field-error" id="invite-request-email-error">${esc(inviteRequestState.fieldErrors.email)}</p>
          </div>
          <div class="network-invite-field network-invite-field-wide">
            <label for="invite-request-why">Name one place you'd recommend, and why.</label>
            <textarea id="invite-request-why" name="why" rows="3" maxlength="500" required aria-describedby="invite-request-why-hint invite-request-why-error"${inviteRequestState.fieldErrors.why ? ' aria-invalid="true"' : ''}>${esc(inviteRequestState.why)}</textarea>
            <p class="network-invite-field-hint" id="invite-request-why-hint">The one you'd send a friend to without checking anything first. A couple of sentences is plenty — this is your first recommendation, not an application letter.</p>
            <p class="network-invite-field-error" id="invite-request-why-error">${esc(inviteRequestState.fieldErrors.why)}</p>
          </div>
        </div>
        <button class="network-primary-link network-invite-submit" type="submit"${pending ? ' disabled' : ''}>${pending ? 'Sending request…' : 'Request a founding-member invite'}</button>
      </fieldset>
      <p class="network-invite-status${statusClass}" data-invite-request-status${statusRole ? ` role="${statusRole}" aria-live="${pending ? 'polite' : 'assertive'}"` : ''} tabindex="-1">${esc(inviteRequestState.message)}</p>
      <p class="network-invite-smallprint">If the fifty are gone by the time we reach your request, it's considered for regular membership instead.</p>
    </form>
    <div class="network-member-return">
      <p class="network-membership-label">Already invited?</p>
      <a class="network-primary-link" href="${esc(accountHref)}" data-community-route>Sign in or join with a code <span class="nav-arrow nav-arrow-external" aria-hidden="true">&#x2197;&#xFE0E;</span></a>
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

function publicRecommendationKey(city = ''): string {
  return city.trim().toLowerCase();
}

function publicRecommendationFeed(city = ''): PublicRecommendationFeed {
  const key = publicRecommendationKey(city);
  const existing = publicRecommendationFeeds.get(key);
  if (existing) return existing;
  const feed: PublicRecommendationFeed = {
    status: 'idle',
    error: '',
    request: 0,
    recommendations: [],
  };
  publicRecommendationFeeds.set(key, feed);
  return feed;
}

export interface NetworkPlaceNotesState {
  status: PublicRecommendationStatus | DiscoveryStatus;
  error: string;
}

/**
 * Real recommendation notes that can be attributed to a member. Signed-in
 * members receive the existing full-circle feed; signed-out visitors receive
 * the safely scoped public feed for the requested city.
 */
export function networkPlaceNotes(city = ''): DiscoveryRecommendation[] {
  if (memberRecord()) {
    if (status !== 'ready') return [];
    return discovery.recommendations.filter((item) => Boolean(item.note));
  }
  const feed = publicRecommendationFeed(city);
  if (feed.status !== 'ready') return [];
  return feed.recommendations.map((item) => ({ ...item }));
}

export function networkPlaceNotesState(city = ''): NetworkPlaceNotesState {
  if (memberRecord()) return { status, error: errorMessage };
  const feed = publicRecommendationFeed(city);
  return { status: feed.status, error: feed.error };
}

/** Loads the appropriate circle data for the current authentication state. */
export function ensureNetworkDiscovery(render: () => void, city = ''): void {
  const record = memberRecord();
  if (!record) {
    const feed = publicRecommendationFeed(city);
    if (feed.status === 'idle') void loadPublicRecommendations(render, city);
    return;
  }
  if (loadedFor !== record.id && status !== 'loading') {
    status = 'idle';
    void loadNetworkDiscovery(render);
  }
  if (record && firstPlaceLoadedFor !== record.id && firstPlaceStatus !== 'loading') {
    firstPlaceStatus = 'idle';
    void loadFirstPlaceEligibility(render);
  }
}

export function retryNetworkPlaceNotes(render: () => void, city = ''): void {
  if (memberRecord()) {
    status = 'idle';
    void loadNetworkDiscovery(render);
    return;
  }
  const feed = publicRecommendationFeed(city);
  feed.status = 'idle';
  feed.error = '';
  void loadPublicRecommendations(render, city);
}

/**
 * Clears the "New share" markers once the member area has marked the same
 * incoming shares as seen on the server, so the deck and the tab badge agree
 * on the next render.
 */
export function markNetworkSharesSeen(): void {
  discovery.shares.forEach((share) => {
    if (share.direction === 'received') share.seen = true;
  });
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
  publicRecommendationRequest += 1;
  publicRecommendationFeeds.clear();
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

/**
 * The ordering that decides which recommendation fronts a place: most recent
 * first, ties broken by id.
 *
 * The tie-break is not cosmetic. Two recommendations written in the same second
 * would otherwise swap places between renders, and because a card's photo comes
 * from whichever one fronts it, the card would flicker between two members'
 * photographs — each time re-pairing a picture with the note beside it. Sorting
 * on a stable key makes the pairing stable too.
 */
function frontingOrder(a: DiscoveryRecommendation, b: DiscoveryRecommendation): number {
  return recencyValue(b) - recencyValue(a) || (b.id || '').localeCompare(a.id || '');
}

/** Rendered sizes. Cards get a thumbnail; a hero and a note block get the wide crop. */
const CARD_PHOTO_THUMB = '480x360';
export const PLACE_PHOTO_THUMB = '1200x900';
export const NOTE_PHOTO_THUMB = '480x360';

/**
 * The recommendation a cover is taken from: the most recent visible one that
 * actually has a photo, which is not always the one fronting the note.
 *
 * This is a deliberate reversal of the stricter rule that a card may only show
 * the fronting recommendation's own photo. Under that rule a place fell back to
 * its monogram whenever the newest note happened to carry no picture, even
 * though an older member had contributed a perfectly good one — which is the
 * common case, since most notes have no photo. The cost is real and should be
 * named: the picture above a note may now be someone else's, so a cover is no
 * longer evidence that the member quoted beneath it took the photograph.
 *
 * What this does NOT do is widen visibility. `items` is already the caller's
 * visible set — the server only ever projects notes the caller may read, and
 * the photo rides along in that same projection — so searching it for a photo
 * can never surface one from a recommendation the caller was not already shown,
 * and can never hint that such a recommendation exists.
 */
function coverRecommendation(
  items: DiscoveryRecommendation[]
): DiscoveryRecommendation | undefined {
  return [...items].sort(frontingOrder).find((item) => Boolean(item.photo_url));
}

/** The cover photo for a place, given every recommendation the caller can see. */
export function coverPhotoHref(items: DiscoveryRecommendation[], thumb: string): string {
  return recommendationPhotoHref(coverRecommendation(items)?.photo_url, thumb);
}

const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * One definition of "new" for the feed: the header's recency count and the
 * badge on each card both ask this, so the "3 new places" line can never claim
 * something the list itself does not show.
 */
function isRecent(item: { created?: string }): boolean {
  return recencyValue(item) >= Date.now() - RECENT_WINDOW_MS;
}

/** Pseudos read as plain handles on screen — no decorative @ in front. */
function pseudo(value: string | undefined, fallback = 'A Detour member'): string {
  const cleaned = value?.trim().replace(/^@+/, '');
  return `<strong class="network-pseudo">${esc(cleaned || fallback)}</strong>`;
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
      <textarea id="${fieldId}" name="body" rows="3" minlength="${REPLY_MIN_LENGTH}" maxlength="${REPLY_MAX_LENGTH}" required aria-describedby="${helpId} ${statusId}"${state.validationError ? ' aria-invalid="true"' : ''} placeholder="Add a private note…" ${state.submitting ? 'disabled' : ''}>${esc(state.body)}</textarea>
      <div class="network-reply-form-footer">
        <p id="${helpId}" class="network-reply-help">Visible only within this private share · ${REPLY_MIN_LENGTH}–${REPLY_MAX_LENGTH.toLocaleString()} characters · at least two words</p>
        <button type="submit" class="network-reply-submit" ${state.submitting ? 'disabled aria-busy="true"' : ''}>${state.submitting ? 'Sending…' : 'Send reply'}</button>
      </div>
      <p id="${statusId}" class="network-reply-status${state.error ? ' is-error' : state.message && !state.submitting ? ' is-success' : ''}" ${state.error ? 'role="alert"' : 'role="status"'} aria-live="${state.error ? 'assertive' : 'polite'}">${esc(state.message)}</p>
    </form>
  </section>`;
}

// The single recommendation-card renderer. The anonymous sample and the
// signed-in feed both use it, so the two surfaces cannot drift apart — only
// the byline attribution differs per caller.
function recommendationCardMarkup(
  view: {
    venueName: string;
    city?: string;
    country?: string;
    note?: string;
    created?: string;
    bylineHtml: string;
    recent?: boolean;
    trustedEntry?: boolean;
    selected?: boolean;
    /** The fronting recommendation's photo, already resolved to a full URL. */
    photoHref?: string;
  },
  resolvePlace?: NetworkPlaceResolver
): string {
  const when = view.created ? formatDate(view.created) : '';
  const whereabouts = [view.city, view.country].filter(Boolean).join(', ');
  const place = view.venueName && resolvePlace ? resolvePlace(view.venueName, view.city || '') : null;
  // A published place is a link to its own page, so a feed card behaves like
  // every other card in the app — and can be opened in a new tab.
  const title = place
    ? `<a class="network-entry-place" href="${esc(place.placeHref)}" data-place="${esc(place.venueId)}" aria-label="Open the ${esc(view.venueName)} place page">${esc(view.venueName)}</a>`
    : esc(view.venueName);
  // The cover is the newest visible recommendation's photo, falling back to the
  // place's enrichment cover — resolved by the caller, which is the only place
  // that knows the full set of recommendations behind this card. It is not
  // necessarily the photo of the member quoted below; see coverRecommendation.
  //
  // With neither, the card keeps the monogram placeholder the catalogue and
  // detail views use rather than dropping the figure. This is the "no image"
  // rendering, not a demotion — every card holds the same silhouette, and one
  // that skipped its cover would be stretched to its neighbour's photo and
  // collect the difference as a dead gap.
  const initial = (view.venueName.trim().charAt(0) || '•').toUpperCase();
  const coverHref = view.photoHref || place?.imageUrl || '';
  // Same generated-cover attributes the catalogue writes, so a card with no
  // photograph anywhere gets the designed treatment rather than a faint letter —
  // and so the runtime swap for a dead image reproduces it from the markup.
  const coverData = `data-cover-initial="${esc(initial)}" data-cover-tint="${coverTint(
    view.venueName,
    view.city || ''
  )}"`;
  const thumb = coverHref
    ? `<figure class="network-entry-thumb" ${coverData} aria-hidden="true"><img src="${esc(coverHref)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-network-thumb></figure>`
    : `<figure class="network-entry-thumb cover-placeholder network-entry-thumb-placeholder" ${coverData} aria-hidden="true"><span aria-hidden="true">${esc(initial)}</span></figure>`;
  return `<article class="network-entry network-recommendation network-entry-with-thumb${view.recent ? ' is-recent' : ''}${view.trustedEntry ? ' trusted-entry' : ''}${view.selected ? ' is-selected' : ''}" data-network-recommendation${place ? ' data-place-card' : ''}>
    <div class="network-entry-main">
      <header class="network-entry-head">
        <div>
          <h3>${title}</h3>
          ${whereabouts ? `<p class="network-place-meta">${esc(whereabouts)}</p>` : ''}
        </div>
        ${view.recent ? '<p class="network-entry-recent">New<span class="visually-hidden"> in the last 24 hours</span></p>' : ''}
      </header>
      ${view.note ? `<blockquote><p>${esc(view.note)}</p></blockquote>` : '<p class="network-entry-note-empty">No note was included with this recommendation.</p>'}
      ${
        view.bylineHtml || when
          ? `<p class="network-entry-byline">${view.bylineHtml}${when ? `<span aria-hidden="true"> · </span><time datetime="${esc(view.created)}">${esc(when)}</time>` : ''}</p>`
          : ''
      }
    </div>
    ${thumb}
  </article>`;
}

interface RecommendationGroup {
  items: DiscoveryRecommendation[];
}

function recommendationPlaceKey(
  item: DiscoveryRecommendation,
  resolvePlace?: NetworkPlaceResolver
): string {
  const venueName = item.venue_name?.trim() || '';
  const resolved = venueName && resolvePlace ? resolvePlace(venueName, item.city || '') : null;
  if (resolved) return `venue:${resolved.venueId}`;
  const normalize = (value: string | undefined) =>
    (value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  return `place:${normalize(venueName)}\u0000${normalize(item.city)}\u0000${normalize(item.country)}`;
}

function groupRecommendations(
  items: DiscoveryRecommendation[],
  resolvePlace?: NetworkPlaceResolver
): RecommendationGroup[] {
  const groups = new Map<string, DiscoveryRecommendation[]>();
  // Sorted by the fronting order, so each group's first item is the one that
  // fronts its card — and stays the one across renders.
  for (const item of [...items].sort(frontingOrder)) {
    const key = recommendationPlaceKey(item, resolvePlace);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return Array.from(groups.values())
    .map((groupItems) => ({ items: groupItems }))
    .sort((a, b) => frontingOrder(a.items[0], b.items[0]));
}

/**
 * The one grouped place-card renderer used by home and destination/Explore
 * lists. A place gets one card, one representative note and one combined
 * byline; its place page is where every recommendation is shown in full.
 *
 * The representative note is the fronting recommendation. The cover is the
 * newest visible photo among all of them, which may belong to a different
 * member — the place keeps showing a picture once any recommender has
 * contributed one, rather than blanking whenever the newest note has none.
 */
export function groupedRecommendationCardMarkup(
  items: DiscoveryRecommendation[],
  resolvePlace?: NetworkPlaceResolver,
  options: {
    trustedEntry?: boolean;
    selected?: boolean;
    markRecent?: boolean;
  } = {}
): string {
  const fronting = [...items].sort(frontingOrder)[0];
  if (!fronting) return '';
  // The byline names the author of the note quoted above it — nobody else. A
  // combined byline read as though both members wrote the one note, and the
  // date beside it belongs to the fronting recommendation alone. The place page
  // carries every note with its own author.
  const bylineHtml = fronting.is_own
    ? '<strong class="network-pseudo">You</strong>'
    : fronting.recommender_pseudo?.trim()
      ? pseudo(fronting.recommender_pseudo)
      : '';
  // No count on a card, of either kind. A card is one place, one photograph and
  // one member's sentence about it, and a stamped figure beside that turns
  // reading into scoring — the eye takes the number first and the note second,
  // and a place with a 1 next to a neighbour's 3 reads as the lesser of the two
  // before a word of either note has been read. Both figures live on the place
  // page, where there is room to say what they count.
  return recommendationCardMarkup(
    {
      venueName: fronting.venue_name || 'Recommended food-and-drink destination',
      city: fronting.city,
      country: fronting.country,
      note: fronting.note,
      created: fronting.created,
      bylineHtml,
      // Only the home feed states a 24-hour count, so only it asks for badges.
      recent: options.markRecent ? isRecent(fronting) : false,
      trustedEntry: options.trustedEntry,
      selected: options.selected,
      // Searched across the group, not taken from `fronting`.
      photoHref: coverPhotoHref(items, CARD_PHOTO_THUMB),
    },
    resolvePlace
  );
}

function recommendationMarkup(item: DiscoveryRecommendation, resolvePlace?: NetworkPlaceResolver): string {
  return recommendationCardMarkup(
    {
      venueName: item.venue_name || 'Recommended food-and-drink destination',
      city: item.city,
      country: item.country,
      note: item.note,
      created: item.created,
      bylineHtml: item.is_own ? '<strong class="network-pseudo">You</strong>' : pseudo(item.recommender_pseudo),
      // A single-recommendation card fronts the only recommendation it has.
      photoHref: recommendationPhotoHref(item.photo_url, CARD_PHOTO_THUMB),
    },
    resolvePlace
  );
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
      <div class="network-entry-side">
        <span class="network-entry-kind">${received ? (item.seen ? 'Received' : 'New share') : 'Sent'}</span>
        ${item.id ? `<button type="button" class="network-share-archive" data-network-archive-share="${esc(item.id)}" ${archivingShareIds.has(item.id) ? 'disabled' : ''}>${archivingShareIds.has(item.id) ? 'Archiving…' : 'Archive'}</button>` : ''}
      </div>
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
    <a class="network-primary-link" href="${esc(accountHref)}" data-community-route="recommend-place">Add your first place <span class="nav-arrow nav-arrow-external" aria-hidden="true">&#x2197;&#xFE0E;</span></a>
  </aside>`;
}

function shareColumnMarkup(items: DiscoveryShare[], emptyText: string): string {
  if (!items.length) return `<p class="network-column-empty">${emptyText}</p>`;
  const sorted = [...items].sort((a, b) => recencyValue(b) - recencyValue(a));
  const shown = sharesExpanded ? sorted : sorted.slice(0, SHARE_PREVIEW_LIMIT);
  const hidden = sorted.length - shown.length;
  const toggle =
    hidden > 0
      ? `<button type="button" class="secondary-button network-retry network-show-more" data-shares-toggle>Show ${hidden} more</button>`
      : sharesExpanded && sorted.length > SHARE_PREVIEW_LIMIT
        ? '<button type="button" class="secondary-button network-retry network-show-more" data-shares-toggle>Show fewer</button>'
        : '';
  return `<div class="network-entry-list">${shown.map(shareMarkup).join('')}</div>${toggle}`;
}

/**
 * The private-share deck. It belongs to the member area (My detours → Shares)
 * rather than the landing feed: home is a discovery surface, and a member's
 * incoming and outgoing shares are private ledger work. The cassette flip,
 * the archive controls, and the reply threads travel with it.
 */
export function memberSharesMarkup(): string {
  const received = discovery.shares.filter((share) => share.direction === 'received');
  const sent = discovery.shares.filter((share) => share.direction === 'sent');
  const shareCount = received.length + sent.length;

  if (status === 'loading' || status === 'idle') {
    return `<div class="network-state network-state-loading" role="status">
      <span class="network-loading-mark" aria-hidden="true"></span>
      <div><h2>Gathering your private shares</h2><p>Loading incoming and outgoing destination shares.</p></div>
    </div>`;
  }

  if (status === 'error') {
    return `<div class="network-state network-state-error" role="alert">
      <div><h2>Your private shares could not be loaded</h2><p>${esc(errorMessage || 'Please try again. Your private shares have not been shown.')}</p></div>
      <button type="button" class="secondary-button network-retry" data-network-shares-retry>Try again</button>
    </div>`;
  }

  // The deck sits beside My recommendations in the member area, so it wears the
  // member-area ledger heading — subheading row, counter chip, one mono note —
  // rather than the landing feed's larger section heading it was born with.
  return `<section class="network-stream network-shares" aria-labelledby="network-shares-title">
    <div class="community-subheading">
      <h4 id="network-shares-title">My private shares</h4>
      <div class="network-section-actions">
        <p class="community-queue-count">${shareCount} ${shareCount === 1 ? 'share' : 'shares'}</p>
        ${shareCount ? `<button type="button" class="secondary-button network-retry network-cassette-flip" data-cassette-flip>${cassetteFlipLabel()}</button>` : ''}
      </div>
    </div>
    <p class="community-form-note">Private incoming and outgoing destination shares, kept together.</p>
    ${shareCount ? `<div class="network-share-columns${sharesSide === 'b' ? ' is-side-b' : ''}">
      <section aria-labelledby="network-received-title"><h3 id="network-received-title">Shared with me</h3>${shareColumnMarkup(received, 'Nothing received yet.')}</section>
      <section aria-labelledby="network-sent-title"><h3 id="network-sent-title">Sent by me</h3>${shareColumnMarkup(sent, 'Nothing sent yet.')}</section>
    </div>` : `<div class="network-empty"><h3>No shares yet</h3><p>Use Share new below to send a restaurant, café, bar, or other food-and-drink destination privately to another member of the circle.</p></div>`}
  </section>`;
}

/**
 * The founding circle reaches every member, at any distance, so for a member with
 * few invitations of their own it can be most of the feed — a new member with one
 * inviter and no invitees sees the founding circle's places and little else. That
 * is what keeps the app from being empty on day one, and it is also why they need
 * a way to set it aside and look at what their own people brought.
 *
 * A LIGHT FILTER OVER PLACES, NOT A REDACTION OF NOTES. A card either appears or
 * it doesn't; nothing inside one changes. This filter used to drop the founders'
 * individual notes from the cards that survived, which quietly rewrote their
 * bylines and — because a photo belongs to the note it was attached to, not to the
 * venue — stripped the cover image off a place whose only photo came from a
 * founder. The member was always allowed to see that photo and those words. They
 * asked to see fewer places, so only places are removed.
 *
 * A place stays when anyone in the caller's own invitation graph stands behind it,
 * themselves included. Note that a founder who is *also* in the graph — an inviter
 * is very often founding too — keeps their places: `in_graph` and
 * `founding_member` are reported separately by the server for exactly this
 * distinction.
 */
function fromOwnCircle(item: DiscoveryRecommendation): boolean {
  return item.is_own === true || item.in_graph !== false;
}

function groupIsFromOwnCircle(group: { items: DiscoveryRecommendation[] }): boolean {
  return group.items.some(fromOwnCircle);
}

function foundingFeedToggleMarkup(hiddenPlaceCount: number): string {
  // Nothing to set aside — so no control, rather than a switch that visibly does
  // nothing. This is the normal state for a member the Founder invited directly:
  // the founding circle is their inviter and their siblings, so it is already
  // their own circle and there is nothing to separate out. The further from the
  // founding circle a member sits, the more this switch has to do.
  if (hiddenPlaceCount < 1) return '';
  // On or off, and the plate's own fill says which — the same pressed/unpressed
  // language as the layout picker beside it. No count, no explanation, no separate
  // state box: a member who flips it sees the answer in the feed a moment later.
  const pressed = showFoundingPlaces ? 'true' : 'false';
  return `<button type="button" class="network-founding-toggle" data-network-founding aria-pressed="${pressed}">Founders’ places</button>`;
}

function memberFeedMarkup(
  accountHref: string,
  resolvePlace?: NetworkPlaceResolver
): string {
  const recommendations = discovery.recommendations;

  if (status === 'loading' || status === 'idle') {
    return `<div class="network-state network-state-loading" role="status">
      <span class="network-loading-mark" aria-hidden="true"></span>
      <div><h2>Gathering the Detour circle</h2><p>Loading full-circle food-and-drink recommendations.</p></div>
    </div>`;
  }

  if (status === 'error') {
    return `<div class="network-state network-state-error" role="alert">
      <div><h2>The Detour circle could not be loaded</h2><p>${esc(errorMessage || 'Please try again. Circle recommendations have not been shown.')}</p></div>
      <button type="button" class="secondary-button network-retry" data-network-retry>Try again</button>
    </div>`;
  }

  // Grouped once, from every note the member can see, so each card is built from
  // its full set of recommendations however the filter sits. Then whole cards are
  // kept or dropped — never edited.
  const allGrouped = groupRecommendations(recommendations, resolvePlace);
  const ownCircleGrouped = allGrouped.filter(groupIsFromOwnCircle);
  const foundingOnlyPlaces = allGrouped.length - ownCircleGrouped.length;
  const grouped = showFoundingPlaces ? allGrouped : ownCircleGrouped;
  const previewLimit = recommendationColumns * 2;
  const latest = recommendationsExpanded ? grouped : grouped.slice(0, previewLimit);
  const hiddenCount = grouped.length - latest.length;
  const recentCount = grouped.filter((group) => isRecent(group.items[0])).length;
  const recentLabel = recentCount
    ? `${recentCount} new ${recentCount === 1 ? 'place' : 'places'}`
    : 'No new places';

  return `<div class="network-member-content">
    <section class="network-stream" aria-label="Places recommended by the circle">
      <div class="network-section-heading network-section-toolbar">
        <p class="network-recency-status">${recentLabel}<span>Last 24 hours</span></p>
        ${foundingFeedToggleMarkup(foundingOnlyPlaces)}
        <div class="network-layout-picker" role="group" aria-label="Cards per row">
          ${([2, 3] as const)
            .map(
              (columns) =>
                `<button type="button" data-network-columns="${columns}" aria-label="${columns} cards per row" aria-pressed="${
                  recommendationColumns === columns ? 'true' : 'false'
                }"><span class="network-layout-icon network-layout-icon-${columns}" aria-hidden="true">${Array.from(
                  { length: columns * columns },
                  () => '<i></i>'
                ).join('')}</span></button>`
            )
            .join('')}
        </div>
        <div class="network-section-actions">
          <a class="network-primary-link network-recommend-cta" href="${esc(accountHref)}" data-community-route="recommend-place">Recommend<span class="nav-arrow nav-arrow-external" aria-hidden="true">&#x2197;&#xFE0E;</span></a>
          <a class="secondary-button network-share-cta" href="${esc(accountHref)}" data-community-route="share-place">Share privately<span class="nav-arrow nav-arrow-external" aria-hidden="true">&#x2197;&#xFE0E;</span></a>
        </div>
      </div>
      ${
        latest.length
          ? `<div class="network-entry-list network-recommendation-grid network-recommendation-grid-${recommendationColumns}">${latest.map((group) => groupedRecommendationCardMarkup(group.items, resolvePlace, { markRecent: true })).join('')}</div>${
              hiddenCount > 0
                ? `<button type="button" class="secondary-button network-retry network-show-more" data-network-show-more>Show ${hiddenCount} more ${hiddenCount === 1 ? 'place' : 'places'}</button>`
                : recommendationsExpanded && grouped.length > previewLimit
                  ? '<button type="button" class="secondary-button network-retry network-show-more" data-network-show-more>Show fewer</button>'
                  : ''
            }`
          : !showFoundingPlaces && allGrouped.length
            ? // Emptied by the filter, not by the circle. Saying "no places yet"
              // here would blame the circle for a filter the member just applied.
              `<div class="network-empty"><h3>Nothing from your own circle yet</h3><p>Every place you can see right now came from a founding member. Switch Founders’ places back on, or invite someone whose taste you want here.</p></div>`
            : `<div class="network-empty"><h3>No places from the circle yet</h3><p>Places will appear here as members recommend them, unless they choose to keep their notes private.</p></div>`
      }
    </section>
  </div>`;
}

// The anonymous sample section: same card renderer as the member feed. The
// server supplies at most three founding-circle recommendations, one per city.
function publicRecommendationSampleMarkup(resolvePlace?: NetworkPlaceResolver): string {
  const feed = publicRecommendationFeed();
  const heading = `<div class="network-public-sample-heading">
    <div><p class="network-membership-label">From the circle</p><h2 id="network-public-recommendations-title">What the circle recommends.</h2></div>
  </div>`;

  if (feed.status === 'loading' || feed.status === 'idle') {
    return `<section class="network-public-sample" aria-labelledby="network-public-recommendations-title">
      ${heading}
      <div class="network-public-state" role="status"><span class="network-loading-mark" aria-hidden="true"></span><p>Loading current member recommendations…</p></div>
    </section>`;
  }

  if (feed.status === 'error') {
    return `<section class="network-public-sample" aria-labelledby="network-public-recommendations-title">
      ${heading}
      <div class="network-public-state is-unavailable" role="status">
        <p>${esc(feed.error || 'The live recommendation sample is unavailable right now. Membership requests and sign-in still work.')}</p>
        <button type="button" class="secondary-button network-public-retry" data-public-recommendations-retry>Try the sample again</button>
      </div>
    </section>`;
  }

  const sample = feed.recommendations.slice(0, PUBLIC_RECOMMENDATION_PREVIEW_LIMIT);
  return `<section class="network-public-sample" aria-labelledby="network-public-recommendations-title">
    ${heading}
    ${sample.length
      ? `<div class="network-public-list">${sample.map((item) => recommendationMarkup(item, resolvePlace)).join('')}</div><p class="network-public-sample-note">This sample stays small: only real, published member recommendations appear here.</p>`
      : '<div class="network-public-state"><p>No public recommendation sample is available right now. You can still request an invitation or sign in.</p></div>'}
  </section>`;
}

export function networkDiscoveryMarkup(
  accountHref: string,
  resolvePlace?: NetworkPlaceResolver,
  /**
   * The first-place ask for this member, when the server settled on one. Passed in
   * rather than read from here: the session flags live in community.ts, which
   * already imports this module.
   */
  placePrompt?: PlacePrompt | null
): string {
  const record = memberRecord();
  if (!record) {
    return `<section class="network-invitation" aria-labelledby="network-home-title">
      <div class="network-invitation-copy">
        <p class="network-kicker">An invite-only circle shaped by member taste</p>
        <h1 id="network-home-title">Detours from people you trust.</h1>
        <p class="network-invitation-lead">This isn't a restaurant directory. Every place here is one a member put their name behind and said why — no ads, no paid listings, no anonymous stars. Add one of yours — someone needs it.</p>
        <p class="network-invitation-lead">Members publish straight to the circle: no approval queue, no editors, no minimum. We trust you.</p>
      </div>
      ${publicRecommendationSampleMarkup(resolvePlace)}
      <aside class="network-invitation-action" data-invite-request-section aria-label="Founding membership and member sign-in">
        ${inviteRequestFormMarkup(accountHref)}
      </aside>
    </section>`;
  }

  const pseudoName = record.pseudo?.trim().replace(/^@+/, '');
  const memberLabel = pseudoName || record.email || 'Detourist';
  return `<section class="network-home" aria-labelledby="network-home-title">
    <div class="network-home-heading">
      <p class="network-kicker">Your Detour circle</p>
      <h1 id="network-home-title">Places the circle recommends.</h1>
      <p>Welcome back, ${esc(memberLabel)}. Each place appears once, with the members who recommend it and why. Your private shares stay in My detours.</p>
    </div>
    ${
      // The ask is the specific version of the first-place nudge — same member,
      // better question — so it replaces it rather than stacking under it.
      placePrompt ? placePromptMarkup(placePrompt, accountHref) : firstPlaceInvitationMarkup(accountHref)
    }
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

async function loadPublicRecommendations(render: () => void, city = ''): Promise<void> {
  const feed = publicRecommendationFeed(city);
  if (memberRecord() || feed.status === 'loading') return;
  const request = ++publicRecommendationRequest;
  feed.request = request;
  feed.status = 'loading';
  feed.error = '';
  const cityQuery = city.trim();
  render();
  try {
    const url = new URL('/api/detour/public-recommendations', `${apiBaseUrl}/`);
    if (cityQuery) url.searchParams.set('city', cityQuery);
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'omit',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Public recommendations returned ${response.status}.`);
    const payload: unknown = await response.json();
    if (memberRecord() || feed.request !== request || publicRecommendationFeeds.get(publicRecommendationKey(city)) !== feed) return;
    feed.recommendations = cleanPublicPayload(payload);
    feed.status = 'ready';
  } catch {
    if (memberRecord() || feed.request !== request || publicRecommendationFeeds.get(publicRecommendationKey(city)) !== feed) return;
    feed.recommendations = [];
    feed.status = 'error';
    feed.error = cityQuery
      ? `Member notes for ${cityQuery} are unavailable right now. The published places are still here.`
      : 'The live recommendation sample is unavailable right now. Membership requests and sign-in still work.';
  }
  render();
}

async function loadNetworkDiscovery(render: () => void): Promise<void> {
  if (status === 'loading') return;
  const identity = memberRecord()?.id || '';
  status = 'loading';
  loadedFor = identity || '@anonymous';
  errorMessage = '';
  render();
  try {
    const payload = await pb.send<unknown>('/api/detour/network-discovery', { requestKey: null });
    if ((memberRecord()?.id || '') !== identity) return;
    discovery = cleanPayload(payload);
    status = 'ready';
  } catch (error) {
    if ((memberRecord()?.id || '') !== identity) return;
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

  root.querySelector<HTMLButtonElement>('[data-public-recommendations-retry]')?.addEventListener('click', () => {
    const feed = publicRecommendationFeed();
    feed.status = 'idle';
    feed.error = '';
    void loadPublicRecommendations(render);
  });

  root.querySelector<HTMLButtonElement>('[data-network-retry]')?.addEventListener('click', () => {
    status = 'idle';
    void loadNetworkDiscovery(render);
  });

  root.querySelector<HTMLButtonElement>('[data-network-show-more]')?.addEventListener('click', () => {
    recommendationsExpanded = !recommendationsExpanded;
    render();
  });
  root.querySelector<HTMLButtonElement>('[data-network-founding]')?.addEventListener('click', () => {
    showFoundingPlaces = !showFoundingPlaces;
    localStorage.setItem(FOUNDING_PLACES_KEY, showFoundingPlaces ? 'on' : 'off');
    // The preview limit counts places, so a feed that just shrank should not stay
    // expanded from the larger one.
    recommendationsExpanded = false;
    render();
  });
  root.querySelectorAll<HTMLButtonElement>('[data-network-columns]').forEach((button) => {
    button.addEventListener('click', () => {
      const columns: RecommendationColumns = button.dataset.networkColumns === '3' ? 3 : 2;
      if (columns === recommendationColumns) return;
      recommendationColumns = columns;
      localStorage.setItem(RECOMMENDATION_COLUMNS_KEY, String(columns));
      render();
    });
  });

}

/**
 * Binds the private-share deck wherever it is mounted — the member area's
 * My detours → Shares tab. Kept apart from the landing-feed bindings so the
 * two surfaces can be rendered independently.
 */
export function bindMemberShares(root: HTMLElement, render: () => void, onArchived?: (shareId: string) => void): void {
  ensureNetworkDiscovery(render);

  root.querySelector<HTMLButtonElement>('[data-network-shares-retry]')?.addEventListener('click', () => {
    status = 'idle';
    void loadNetworkDiscovery(render);
  });

  root.querySelectorAll<HTMLButtonElement>('[data-shares-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      sharesExpanded = !sharesExpanded;
      render();
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-network-archive-share]').forEach((button) => {
    button.addEventListener('click', async () => {
      const shareId = button.dataset.networkArchiveShare || '';
      const share = discovery.shares.find((item) => item.id === shareId);
      if (!share || archivingShareIds.has(shareId)) return;
      // Archive state is per-side: receiving and sending each hide only the
      // caller's own copy; the discovery route filters the same way.
      const field = share.direction === 'received' ? 'archived' : 'sender_archived';
      archivingShareIds.add(shareId);
      render();
      try {
        await pb.collection('community_shares').update(shareId, { [field]: true }, { requestKey: null });
        discovery.shares = discovery.shares.filter((item) => item.id !== shareId);
        // The member area keeps its own copy of the share ledger for the tab
        // badge, so it is told to drop the archived share too.
        onArchived?.(shareId);
      } catch {
        // Leave the share in place; the button simply becomes pressable again.
      } finally {
        archivingShareIds.delete(shareId);
        render();
      }
    });
  });

  // The cassette flip animates via a CSS transition, so it toggles classes on
  // the live DOM instead of re-rendering (a re-render would rebuild the DOM
  // and skip the animation). Module state keeps later re-renders consistent.
  root.querySelector<HTMLButtonElement>('[data-cassette-flip]')?.addEventListener('click', (event) => {
    sharesSide = sharesSide === 'a' ? 'b' : 'a';
    root.querySelector('.network-share-columns')?.classList.toggle('is-side-b', sharesSide === 'b');
    (event.currentTarget as HTMLButtonElement).textContent = cassetteFlipLabel();
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
