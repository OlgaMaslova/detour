import { pb } from './pocketbase';
import { bindMemberShares, markNetworkSharesSeen, memberSharesMarkup, resetNetworkDiscovery } from './network';
import { venueCitySlug, venuePlaceSlug } from './data';
import type { Venue } from './data';
import { OCCASION_OPTIONS } from './occasions';
import { bindInviteShare, inviteShareMarkup } from './share';
import type { RecordModel } from 'pocketbase';

type CommunityMode = 'sign-in' | 'join';
type MemberTab = 'invitations' | 'detours' | 'settings' | 'curation';
type DetourTab = 'recommendations' | 'shares';
type NoticeKind = 'success' | 'error' | 'info';

interface MemberRecord extends RecordModel {
  email?: string;
  display_name?: string;
  pseudo?: string;
  community_status?: string;
  discovery_visible?: boolean;
  home_city?: string;
  home_country?: string;
}

interface InviteRecord {
  id: string;
  code?: string;
  claimed_by?: string;
  claimed_at?: string;
  created?: string;
  /** Set by the Founder when issuing: this invitation offers a founding seat. */
  grants_founding?: boolean;
}

interface WaitlistEntry {
  id: string;
  venue_name?: string;
  city?: string;
  country?: string;
  address?: string;
  /**
   * The street or neighbourhood that tells this place apart from another of the
   * same name in the same city. Empty for almost every place — it is only ever
   * asked for after a submission collides with one already on the list.
   */
  disambiguator?: string;
  category?: string;
  occasions?: string[];
  official_url?: string;
  instagram_url?: string;
  status?: 'pending' | 'published';
  published_venue?: string;
  // `signal_count`, `published_at` and `created` are deliberately absent. They
  // are global facts about members from other circles — how many got here first,
  // and when — and the server hides them on the record rather than trusting every
  // surface to ignore them. What this member may know about who else stands
  // behind the place comes from their own scoped catalogue.
  updated?: string;
}

interface RecommendationRecord {
  id: string;
  waitlist?: string;
  note?: string;
  venue_name?: string;
  city?: string;
  country?: string;
  category?: string;
  occasions?: string[];
  created?: string;
}

interface ShareRecord {
  id: string;
  sender?: string;
  recipient?: string;
  waitlist?: string;
  venue?: string;
  sender_pseudo?: string;
  recipient_pseudo?: string;
  seen?: boolean;
  archived?: boolean;
  sender_archived?: boolean;
  personal_note?: string;
  venue_name?: string;
  city?: string;
  country?: string;
  address?: string;
  created?: string;
}

interface DirectoryMember {
  id: string;
  pseudo?: string;
}

interface DirectoryState {
  query: string;
  selected: DirectoryMember | null;
  items: DirectoryMember[];
  loading: boolean;
  error: string;
  activeIndex: number;
  timer: number | null;
}

interface Notice {
  kind: NoticeKind;
  text: string;
}

interface PendingRecommendationDeletion {
  recommendationId: string;
  entryId: string;
  placeName: string;
  published: boolean;
}

/** The place the server found when a submitted name and city were already taken. */
export interface PlaceCollision {
  entry: string;
  venue_name: string;
  city: string;
  address: string;
  disambiguator: string;
  published: boolean;
}

/**
 * A submission held at the "is this the same place?" question.
 *
 * The member's own words and photo are kept here rather than left in the form,
 * because answering the question re-renders the panel and a file input cannot be
 * repopulated from markup. Nothing is sent again until they answer.
 */
interface PendingCollision {
  collision: PlaceCollision;
  venueName: string;
  city: string;
  note: string;
  photo: File | null;
  /** Set once the member says it is a different place and is asked which. */
  distinguishing: boolean;
}

interface ImageCurationItem {
  id: string;
  collection_id: string;
  snapshot: string;
  place_name: string;
  city: string;
  country: string;
  submitted_by: string;
  screening_status: 'pending' | 'screening_failed';
  relevance: 'relevant' | 'uncertain' | 'irrelevant';
  ai_note: string;
  created: string;
}

/**
 * A published place showing no photograph — neither an enrichment cover nor an
 * approved member photo. The automatic passes have had their turn; this is what
 * they could not do.
 */
interface CoverlessPlace {
  id: string;
  waitlist: string;
  place_name: string;
  city: string;
  country: string;
  disambiguator: string;
  official_url: string;
  instagram_url: string;
  published_at: string;
}

// One order, used by both the member-area tab strip and the masthead menu.
const MEMBER_TAB_LABELS: Record<MemberTab, string> = {
  detours: 'My detours',
  invitations: 'Invitations',
  settings: 'Settings',
  curation: 'Curation',
};
// The invitation allowance is server policy: founding members keep more codes
// open at once than regular members. The server reports the member's computed
// limit (the founding markers themselves are hidden fields), so the panel shows
// the baseline until that arrives and never invents a larger allowance.
const BASELINE_INVITATION_LIMIT = 10;
let invitationLimit = BASELINE_INVITATION_LIMIT;
// Your recommendations reads as a ledger of lines, so it opens on the five
// most recently touched entries and expands from there.
const QUEUE_PREVIEW_LIMIT = 5;
const CATEGORY_OPTIONS = [
  ['restaurant', 'Restaurant'],
  ['cafe', 'Café'],
  ['bakery', 'Bakery'],
  ['bar', 'Bar'],
  ['cocktail_bar', 'Cocktail bar'],
  ['wine_bar', 'Wine bar'],
  ['brewery', 'Brewery'],
  ['food_market', 'Food market'],
  ['deli', 'Deli'],
  ['dessert_shop', 'Dessert shop'],
  ['ice_cream', 'Ice cream'],
  ['takeaway', 'Takeaway'],
  ['other', 'Other'],
] as const;

let mode: CommunityMode = 'sign-in';
let invitationCodePrefill = '';
/**
 * What has been typed into the invitation card.
 *
 * The card asks for everything the server needs to write the account — the join
 * happens here now rather than over two screens — and any one of the five values
 * can come back refused: a code already claimed, a pseudo already taken. Every
 * refusal renders a notice, and a render rebuilds the panel's markup, so values
 * held only in the DOM would be wiped by the very message asking the member to
 * correct one of them.
 *
 * The password rides along for the same reason, but is refilled by bindCommunity
 * rather than written into the markup, so it never becomes a value attribute.
 */
const joinDraft = { email: '', password: '', pseudo: '', city: '' };
let routedInvitationCode: string | null = null;
let memberTab: MemberTab = 'detours';
let detourTab: DetourTab = 'recommendations';
let recommendationDraft: Venue | null = null;
let recommendationIntent: 'add' | 'edit' = 'add';
// Recommendations opens on the member's own ledger; the blank form is revealed
// by Add new, so the tab reads as a record first and a submission second.
let recommendationFormOpen = false;
// Private share works the same way: the deck of sent and received shares is the
// tab, and the sending form is revealed by Share new.
let shareFormOpen = false;
// Set when a route intent — a landing CTA, a place page, a ?recommend= link —
// opened one of those forms, so the render that follows can reveal it.
let pendingFormReveal: 'recommendation' | 'share' | null = null;
// A pseudo a deep link asked to share with, held until the next bind can turn it
// into a picked member through the directory.
let pendingShareRecipient: string | null = null;
let notice: Notice | null = null;
let knownVenues: Venue[] = [];
let waitlistEntries: WaitlistEntry[] = [];
let recommendations: RecommendationRecord[] = [];
let shares: ShareRecord[] = [];
let lockedEntryIds = new Set<string>();
let communityLoaded = false;
let loadingCommunity = false;
let invites: InviteRecord[] = [];
let invitesLoaded = false;
let loadingInvites = false;
let submitting = false;
let deletingRecommendationId = '';
let pendingRecommendationDeletion: PendingRecommendationDeletion | null = null;
let pendingCollision: PendingCollision | null = null;
let highlightedWaitlistId = '';
let queueExpanded = false;
let visibilitySaving = false;
let visibilityPending: boolean | null = null;
let memberRefreshed = false;
let refreshingMember = false;
let foundingMember = false;
// The member's own standing belongs to the session, not to the member area: the
// masthead menu on every surface asks whether this member curates, so the answer
// is fetched once as soon as a session is present and held until sign-out.
// Without it, a place page loaded cold built its menu from the initial `false`
// and dropped Curation from it.
let memberFlagsLoaded = false;
let memberFlagsRequest: Promise<void> | null = null;
// This member's attendance, as the server counts it: sessions since Detour
// started counting, whole days since the previous visit, and whether this
// document load is what opened the current session. Read once with the flags
// above, so it stays fixed for the session rather than shifting under a surface
// mid-visit — anything keyed to the count wants exactly that.
let memberVisitCount = 0;
let memberDaysAway: number | null = null;
let memberNewSession = false;
// Whether this member may offer one of the fifty founding seats with an
// invitation. The Founder alone, as the server decides it — every other member's
// invitations are ordinary, and they are never shown the choice.
let canGrantFounding = false;
// Founding seats nobody holds yet, reported only to the member who can offer one.
// Null until the server says, so the toggle never claims a number it invented.
let foundingSeatsRemaining: number | null = null;
// Whether the next invitation created here offers a founding seat. Deliberately
// resets to off after every issue: a founding invitation is the exception, and a
// toggle left on would spend the fifty by inattention.
let inviteGrantsFounding = false;
let imageCurationCount = 0;
let curationItems: ImageCurationItem[] = [];
let curationLoaded = false;
let loadingCuration = false;
let coverlessPlaces: CoverlessPlace[] = [];
let coverlessLoaded = false;
let loadingCoverless = false;
let refreshingCoverlessId = '';
let coverUploadingId = '';
let curationSavingId = '';
const directories = new Map<string, DirectoryState>();

function memberTabs(): MemberTab[] {
  return foundingMember
    ? ['detours', 'invitations', 'curation', 'settings']
    : ['detours', 'invitations', 'settings'];
}

function esc(value: string | undefined | null): string {
  return (value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function member(): MemberRecord | null {
  if (!pb.authStore.isValid || !pb.authStore.record) return null;
  return pb.authStore.record as unknown as MemberRecord;
}

/** Persist a profile update in the auth store as well as in PocketBase.
 * Record updates return the new member but do not refresh the SDK auth cache,
 * and member() reads that cache on every render. */
function syncMemberRecord(original: MemberRecord, updated: MemberRecord): boolean {
  if (member()?.id !== original.id) return false;
  pb.authStore.save(pb.authStore.token, { ...original, ...updated });
  return true;
}

function memberName(record: MemberRecord): string {
  const pseudo = record.pseudo?.trim().replace(/^@+/, '');
  return pseudo || record.display_name?.trim() || record.email?.split('@')[0] || 'Member';
}

/**
 * The same normalization the server applies in pb_hooks/member_profile.js:
 * decompose accents away, drop the leading @, lowercase. Applying it here means
 * "Café-Anna" is accepted rather than refused for characters the server would
 * have folded anyway.
 */
function normalizePseudo(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase();
}

function resetJoinDraft(): void {
  joinDraft.email = '';
  joinDraft.password = '';
  joinDraft.pseudo = '';
  joinDraft.city = '';
}

function readableError(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    const response = error as {
      response?: { message?: string; data?: Record<string, { message?: string }> };
      message?: string;
    };
    const fieldError = response.response?.data
      ? Object.values(response.response.data).find((value) => value?.message)?.message
      : undefined;
    return fieldError || response.response?.message || response.message || fallback;
  }
  return fallback;
}

/**
 * The place a submission collided with, or null when the failure was something else.
 *
 * The refusal itself is a 409 and carries no facts: PocketBase rewrites an
 * ApiError's `data` into a validation-error map, so anything put there arrives as
 * {code:'validation_invalid_value'} and is worse than nothing. The place is
 * fetched separately instead.
 *
 * Returns null unless a real entry comes back, so a failed lookup falls through to
 * the ordinary error notice rather than posing a question with no answer behind
 * it — "that's the one" resolves by entry id, and without one it cannot.
 */
export async function placeCollisionFor(
  error: unknown,
  asked: { venueName: string; city: string; disambiguator?: string }
): Promise<PlaceCollision | null> {
  if (!error || typeof error !== 'object') return null;
  if ((error as { status?: number }).status !== 409) return null;
  try {
    const found = (await pb.send('/api/detour/place-identity', {
      method: 'GET',
      query: {
        name: asked.venueName,
        city: asked.city,
        disambiguator: asked.disambiguator || '',
      },
      requestKey: null,
    })) as Partial<PlaceCollision> | null;
    if (!found || typeof found.entry !== 'string' || !found.entry) return null;
    return {
      entry: found.entry,
      venue_name: String(found.venue_name || asked.venueName),
      city: String(found.city || asked.city),
      address: String(found.address || ''),
      disambiguator: String(found.disambiguator || ''),
      published: found.published === true,
    };
  } catch {
    return null;
  }
}

/**
 * Moves focus to the same-place question — to the field when one is being asked
 * for, otherwise to the heading, since `autofocus` does not fire on markup that
 * was injected rather than parsed.
 */
function focusCollision(root: HTMLElement): void {
  window.requestAnimationFrame(() => {
    const field = root.querySelector<HTMLInputElement>('[data-collision-distinct-form] input[name="disambiguator"]');
    const target = field || root.querySelector<HTMLElement>('#community-collision-title');
    target?.scrollIntoView({
      block: 'center',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
    target?.focus({ preventScroll: true });
  });
}

function cleanCount(value: unknown, maximum?: number): number {
  const count = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return typeof maximum === 'number' ? Math.min(count, maximum) : count;
}

/** The client half of the server's note rule, shared with the new-member flow. */
export function meaningfulRecommendation(note: string): boolean {
  const cleaned = note.trim().replace(/\s+/g, ' ');
  const words = cleaned
    .split(' ')
    .map((word) => word.replace(/[.,!?;:'"()\[\]{}<>/\\|`~@#$%^&*+=_-]+/g, ''))
    .filter((word) => word.length >= 2);
  return cleaned.length >= 24 && words.length >= 5;
}

/**
 * The place's public links, plus the photo the member attaches to their own
 * recommendation.
 *
 * The website and Instagram describe the place and are shared with everyone who
 * recommends it. The photo is not: it goes on this member's recommendation,
 * appears above their note, and replaces only their own previous photo. Nobody
 * else's picture is overwritten, and the place's own cover is never touched.
 */
function placeLinkFields(values?: {
  officialUrl?: string;
  instagramUrl?: string;
}, options?: { replaceImage?: boolean }): string {
  return `<label>Website<input name="official_url" value="${esc(values?.officialUrl)}" maxlength="300" inputmode="url" autocomplete="off" spellcheck="false" placeholder="restaurant.example"></label>
    <label>Instagram<input name="instagram_url" value="${esc(values?.instagramUrl)}" maxlength="300" autocomplete="off" spellcheck="false" placeholder="@restaurant or instagram.com/restaurant"></label>
    ${photoField({ replacing: options?.replaceImage === true })}`;
}

/** Server ceiling on an upload, mirrored so an oversized file is caught before it is sent. */
const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
/** Longest edge kept when the browser re-encodes a chosen photo. */
const PHOTO_MAX_EDGE = 1600;

/**
 * The photo control: a file picker, not a URL box.
 *
 * Asking for a "direct link to a photo you took" asked for something almost
 * nobody can produce from the device the photo is on. The picker is the whole
 * point of the field working at all.
 */
function photoField(options?: { replacing?: boolean }): string {
  const replacing = options?.replacing === true;
  return `<label class="community-photo-field">${replacing ? 'Replace your photo' : 'Your photo'} <span class="community-optional">Optional — reviewed before it appears</span>
      <input name="photo" type="file" accept="image/jpeg,image/png,image/webp">
    </label>
    <p class="community-form-note">Your photo appears with your note${replacing ? ' and replaces the one you added before' : ''}. It never becomes the place's own image, and it goes when your recommendation does.</p>`;
}

/** The chosen file from a form's photo picker, or null when none was chosen. */
function chosenPhoto(form: HTMLFormElement): File | null {
  const input = form.querySelector<HTMLInputElement>('input[name="photo"]');
  const file = input?.files?.[0];
  return file || null;
}

/**
 * Re-encodes a chosen photo down to PHOTO_MAX_EDGE on its longest side.
 *
 * A phone photo is several megabytes and far larger than any surface here
 * renders, and the server has to inline the bytes as base64 to screen them.
 * Shrinking in the browser makes the upload quick on a phone connection and
 * keeps screening cheap. Any failure returns the original file: a slow upload is
 * a much better outcome than a lost photo.
 */
async function preparePhoto(file: File): Promise<Blob> {
  if (typeof createImageBitmap !== 'function') return file;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const longestEdge = Math.max(bitmap.width, bitmap.height);
    if (longestEdge <= PHOTO_MAX_EDGE && file.size <= 1_500_000) return file;
    const scale = Math.min(1, PHOTO_MAX_EDGE / longestEdge);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const encoded = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.82);
    });
    return encoded && encoded.size < file.size ? encoded : file;
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}

/** A filename the server can infer a type from, since a re-encode loses the original's. */
function photoFileName(prepared: Blob, original: File): string {
  const type = prepared.type || original.type;
  const extension = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
  return `recommendation.${extension}`;
}

function noticeMarkup(): string {
  if (!notice) return '';
  const role = notice.kind === 'error' ? 'alert' : 'status';
  return `<p class="community-notice community-notice-${notice.kind}" role="${role}" tabindex="-1">${esc(notice.text)}</p>`;
}

function deleteRecommendationDialogMarkup(): string {
  const pending = pendingRecommendationDeletion;
  if (!pending) return '';
  // A photo lives on the recommendation, so deleting one takes the other. The
  // place keeps its own cover either way — that was never the member's photo.
  const consequence = pending.published
    ? 'The place will stay live, but your note, your photo and your attribution will be removed.'
    : 'Your note, your photo and your attribution will be removed.';
  return `<dialog class="community-confirm-dialog" data-community-delete-dialog aria-labelledby="delete-recommendation-title" aria-describedby="delete-recommendation-description">
    <div class="community-confirm-sheet">
      <p class="community-confirm-kicker">Remove from your detours</p>
      <h2 id="delete-recommendation-title" tabindex="-1">Delete recommendation?</h2>
      <p id="delete-recommendation-description">Delete your recommendation for <strong>${esc(pending.placeName)}</strong>? ${esc(consequence)} This cannot be undone.</p>
      <div class="community-confirm-actions">
        <button class="secondary-button" type="button" data-community-delete-cancel>Keep it</button>
        <button class="community-danger" type="button" data-community-delete-confirm>Delete</button>
      </div>
    </div>
  </dialog>`;
}

function labelForOption(options: readonly (readonly [string, string])[], value: string | undefined): string {
  return options.find(([key]) => key === value)?.[1] || '';
}

function openInvites(): InviteRecord[] {
  return invites.filter((invite) => !invite.claimed_by);
}

function invitationLink(code: string): string {
  const url = new URL(window.location.origin);
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

function clearInvitationRoute(): void {
  invitationCodePrefill = '';
  routedInvitationCode = null;
  const url = new URL(window.location.href);
  if (!url.searchParams.has('invite')) return;
  url.searchParams.delete('invite');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

function directoryState(key: string): DirectoryState {
  let state = directories.get(key);
  if (!state) {
    state = { query: '', selected: null, items: [], loading: false, error: '', activeIndex: -1, timer: null };
    directories.set(key, state);
  }
  return state;
}

function directoryListId(key: string): string {
  return `member-directory-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

/** Pseudos read as plain handles on screen — no decorative @ in front. The
 *  leading-@ strip only guards against a typist's @ surviving into storage. */
function pseudoLabel(pseudo: string | undefined, fallback = 'A Detour member'): string {
  const cleaned = pseudo?.trim().replace(/^@+/, '');
  return cleaned || fallback;
}

function directoryResultsMarkup(key: string): string {
  const state = directoryState(key);
  if (state.selected) {
    return `<p class="member-directory-selected"><span>Selected</span><strong>${esc(pseudoLabel(state.selected.pseudo))}</strong></p>`;
  }
  if (state.query.trim().length < 2) {
    return '<p class="member-directory-hint">Type a pseudo, such as detour-anna — at least two characters.</p>';
  }
  if (state.loading) return '<p class="member-directory-hint" role="status">Searching members…</p>';
  if (state.error) return `<p class="member-directory-error" role="alert">${esc(state.error)}</p>`;
  if (!state.items.length) return '<p class="member-directory-hint">No matching members.</p>';
  return `<ul class="member-directory-results" role="listbox">${state.items
    .map(
      (item, index) =>
        `<li><button type="button" role="option" id="${directoryListId(key)}-option-${index}" aria-selected="${state.activeIndex === index}" data-member-choice="${index}">${esc(pseudoLabel(item.pseudo))}</button></li>`
    )
    .join('')}</ul>`;
}

function directoryMarkup(key: string, label: string): string {
  const state = directoryState(key);
  const listId = directoryListId(key);
  return `<div class="member-directory" data-member-directory="${esc(key)}">
    <label>${esc(label)}
      <input type="search" value="${esc(state.query)}" autocomplete="off" spellcheck="false" placeholder="detour-anna" role="combobox" aria-autocomplete="list" aria-expanded="${state.items.length > 0}" aria-controls="${listId}" ${state.activeIndex >= 0 ? `aria-activedescendant="${listId}-option-${state.activeIndex}"` : ''} data-member-search>
    </label>
    <div id="${listId}" class="member-directory-output" data-member-results>${directoryResultsMarkup(key)}</div>
  </div>`;
}

function signedOutPanel(): string {
  const isJoin = mode === 'join';
  return `<section class="community-panel community-panel-auth" aria-label="Detour membership">
    <div class="community-panel-intro">
      <p class="community-kicker">The detourist circle</p>
      <h2>${isJoin ? 'Join with your personal invitation.' : 'Return to your Detour.'}</h2>
      <p>${isJoin ? 'Everything your account needs, on one card. Then the first place you would send someone to.' : 'Sign in to your member account.'}</p>
    </div>
    <div class="community-form-wrap">
      <div class="community-tabs" role="tablist" aria-label="Membership options">
        <button class="community-tab ${!isJoin ? 'is-active' : ''}" type="button" role="tab" aria-selected="${!isJoin}" data-community-mode="sign-in">Sign in</button>
        <button class="community-tab ${isJoin ? 'is-active' : ''}" type="button" role="tab" aria-selected="${isJoin}" data-community-mode="join">Use an invitation</button>
      </div>
      ${noticeMarkup()}
      ${
        isJoin
          ? `<form class="community-form" data-community-join>
              <label>Email address<input name="email" type="email" value="${esc(joinDraft.email)}" autocomplete="email" required ${submitting ? 'disabled' : ''}></label>
              <label>Password<input name="password" type="password" autocomplete="new-password" minlength="8" required ${submitting ? 'disabled' : ''}></label>
              <p class="community-form-note">Eight characters or more. This is how you sign in from now on.</p>
              <label>Your pseudo<input name="pseudo" value="${esc(joinDraft.pseudo)}" autocomplete="off" spellcheck="false" minlength="3" maxlength="30"
                pattern="@?[a-zA-Z0-9][a-zA-Z0-9-]{1,28}[a-zA-Z0-9]" title="3-30 characters: letters, digits, and hyphens"
                required placeholder="detour-anna" ${submitting ? 'disabled' : ''}></label>
              <label>Where you live<input name="home_city" value="${esc(joinDraft.city)}" autocomplete="address-level2" minlength="2" maxlength="120"
                required placeholder="San Francisco" ${submitting ? 'disabled' : ''}></label>
              <p class="community-form-note">Your pseudo is your name on Detour. Your city is where the circle sees you recommending from.</p>
              <label>Invitation code<input name="invite_code" value="${esc(invitationCodePrefill)}" autocomplete="off" spellcheck="false" maxlength="80" placeholder="DTR-…" required ${submitting ? 'disabled' : ''}></label>
              <button class="primary-button" type="submit" ${submitting ? 'disabled' : ''}>${submitting ? 'Joining…' : 'Join Detour'}</button>
              <p class="community-form-note">Next: the first place you would send someone to.</p>
            </form>`
          : `<form class="community-form" data-community-sign-in>
              <label>Email address<input name="email" type="email" autocomplete="email" required></label>
              <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
              <button class="primary-button" type="submit" ${submitting ? 'disabled' : ''}>${submitting ? 'Signing in…' : 'Sign in'}</button>
              <p class="community-form-note">New here? A personal invitation is all you need to join.</p>
            </form>`
      }
    </div>
  </section>`;
}

function incomingShares(): ShareRecord[] {
  const id = member()?.id;
  return shares.filter((share) => Boolean(id && share.recipient === id) && !share.archived);
}

function recommendationForEntry(entryId: string): RecommendationRecord | undefined {
  return recommendations.find((rec) => rec.waitlist === entryId);
}

function placeIdentity(name: string | undefined, city: string | undefined): string {
  const normalize = (value: string | undefined) => (value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  return `${normalize(name)}\u0000${normalize(city)}`;
}

function publishedVenueForEntry(entry: WaitlistEntry): Venue | undefined {
  const publishedId = entry.published_venue?.trim();
  if (publishedId) {
    const directMatch = knownVenues.find((venue) => venue.id === publishedId);
    if (directMatch) return directMatch;
  }
  const identity = placeIdentity(entry.venue_name, entry.city);
  if (!identity || identity === '\u0000') return undefined;
  const matches = knownVenues.filter((venue) => placeIdentity(venue.name, venue.city) === identity);
  return matches.length === 1 ? matches[0] : undefined;
}

function entryForVenue(venue: Venue): WaitlistEntry | undefined {
  const direct = waitlistEntries.find((entry) => entry.published_venue?.trim() === venue.id);
  if (direct) return direct;
  const identity = placeIdentity(venue.name, venue.city);
  const matches = waitlistEntries.filter(
    (entry) => placeIdentity(entry.venue_name, entry.city) === identity
  );
  return matches.length === 1 ? matches[0] : undefined;
}

/** Canonical URL of a published place's own page — the same route the cards use. */
function discoveryHref(venue: Venue): string {
  const url = new URL(window.location.href);
  url.pathname = '/';
  url.searchParams.delete('city');
  url.searchParams.delete('view');
  url.searchParams.delete('invite');
  url.searchParams.set('d', venueCitySlug(venue));
  url.searchParams.set('p', venuePlaceSlug(venue, knownVenues));
  url.hash = '';
  return `${url.pathname}${url.search}`;
}

function entryPlaceLocked(entry: WaitlistEntry): boolean {
  return lockedEntryIds.has(entry.id);
}

function entryEditMarkup(entry: WaitlistEntry): string {
  // Website and Instagram only. A place has no member-supplied photo of its own
  // any more — a photo belongs to a recommendation — so the entry's legacy
  // `image_url` is not offered here as though it were the place's picture.
  const links = [
    entry.official_url ? `<a href="${esc(entry.official_url)}" target="_blank" rel="noopener noreferrer">Website</a>` : '',
    entry.instagram_url ? `<a href="${esc(entry.instagram_url)}" target="_blank" rel="noopener noreferrer">Instagram</a>` : '',
  ].filter(Boolean);
  const hasLinks = links.length > 0;
  const rec = recommendationForEntry(entry.id);
  const selectedCategory = entry.category || '';
  const selectedOccasions = entry.occasions || [];
  const placeLocked = entryPlaceLocked(entry);
  const lockedAttribute = placeLocked ? ' readonly aria-readonly="true"' : '';
  const editPromise = entry.status === 'published'
    ? 'Your edits carry through to the public page right away.'
    : rec
      ? 'Your edits will carry through if this place becomes live.'
      : 'These details stay with this private entry until it has a recommendation note.';
  return `${hasLinks ? `<p class="community-place-links" aria-label="Destination links">${links.join('<span aria-hidden="true"> · </span>')}</p>` : ''}
      <form class="community-form community-links-form" data-community-edit data-waitlist="${esc(entry.id)}"${rec ? ` data-recommendation="${esc(rec.id)}"` : ''}>
        <label>Food-and-drink destination name<input name="venue_name" value="${esc(entry.venue_name || '')}" maxlength="200" required placeholder="A restaurant, café, bar, or other food-and-drink destination"${lockedAttribute}></label>
        <label>Address <span class="community-optional">${placeLocked ? 'Verified and locked' : 'Optional'}</span><input name="address" value="${esc(entry.address || '')}" maxlength="300" placeholder="Street and number"${lockedAttribute}></label>
        <div class="community-form-grid community-place-grid">
          <label>City or locality<input name="city" value="${esc(entry.city || '')}" maxlength="120" required placeholder="City or locality"${lockedAttribute}></label>
          <label>Country <span class="community-optional">Optional — we look it up</span><input name="country" value="${esc(entry.country || '')}" maxlength="120" placeholder="Country"${lockedAttribute}></label>
        </div>
        <label>Which one <span class="community-optional">Optional — only if another place shares this name and city</span><input name="disambiguator" value="${esc(entry.disambiguator || '')}" maxlength="120" placeholder="Street or neighbourhood"${lockedAttribute}></label>
        <label>Category <span class="community-optional">Optional</span><select name="category"><option value=""${selectedCategory ? '' : ' selected'}>Choose one</option>${CATEGORY_OPTIONS.map(([value, label]) => `<option value="${value}"${value === selectedCategory ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
        <fieldset class="community-choice-fieldset">
          <legend>Good for <span class="community-optional">Optional — choose any that fit</span></legend>
          <div class="community-choice-grid">${OCCASION_OPTIONS.map(([value, label]) => `<label><input type="checkbox" name="occasions" value="${value}"${selectedOccasions.indexOf(value) !== -1 ? ' checked' : ''}><span>${label}</span></label>`).join('')}</div>
        </fieldset>
        ${rec ? `<label>My recommendation<textarea name="note" rows="5" maxlength="2400" minlength="24" required placeholder="What makes this food-and-drink destination worth a deliberate detour?">${esc(rec.note || '')}</textarea></label>` : ''}
        ${placeLinkFields({
          officialUrl: entry.official_url,
          instagramUrl: entry.instagram_url,
        }, { replaceImage: true })}
        ${placeLocked ? '<p class="community-form-note">This place has confirmed coordinates. Its identity and address are locked; contact Detour for an exceptional correction.</p>' : ''}
        <p class="community-form-note">${esc(editPromise)}</p>
        <button class="primary-button" type="submit" ${submitting ? 'disabled' : ''}>${submitting && !deletingRecommendationId ? 'Saving…' : 'Save changes'}</button>
      </form>`;
}

/**
 * One recommendation, one line: the name, the Edit disclosure that opens the
 * whole entry underneath it, and Open for a place that is live. Everything
 * else — publication state, facts, links, the private-share form — waits
 * inside the expanded line rather than stacking a card per entry.
 */
function waitlistRow(entry: WaitlistEntry): string {
  const rec = recommendationForEntry(entry.id);
  const published = entry.status === 'published';
  const publishedVenue = published ? publishedVenueForEntry(entry) : undefined;
  // Seconding is read from the caller's own scoped catalogue, never from the
  // entry's server-side signal count. That count is global: it includes members
  // in circles the caller cannot see, and printing it here would report their
  // existence and their number — the one thing scoped visibility is for.
  //
  // Split by reason, for the same purpose the badge is: a founding member who
  // seconded the place is not "in your circle", and saying so would invent a
  // relationship. Only graph-matched members earn that phrase.
  const circleSeconders = publishedVenue ? cleanCount(publishedVenue.circleCount) : 0;
  const founderSeconders = publishedVenue ? cleanCount(publishedVenue.founderCount) : 0;
  const otherSeconders = Math.max(0, circleSeconders - (rec ? 1 : 0));
  const secondingParts: string[] = [];
  if (otherSeconders > 0) {
    secondingParts.push(
      otherSeconders === 1
        ? '1 other member in your circle'
        : `${otherSeconders} other members in your circle`
    );
  }
  if (founderSeconders > 0) {
    secondingParts.push(
      founderSeconders === 1 ? '1 founding member' : `${founderSeconders} founding members`
    );
  }
  const secondingCopy = secondingParts.length
    ? `Seconded by ${secondingParts.join(' and ')}.`
    : 'No one else has seconded this place yet.';
  const statusLabel = published ? 'Live' : rec ? 'Not live' : 'Needs recommendation';
  const statusClass = published ? 'published' : rec ? 'unpublished' : 'incomplete';
  const directoryKey = `share-${entry.id}`;
  const category = labelForOption(CATEGORY_OPTIONS, entry.category);
  const occasions = (entry.occasions || []).map((occasion) => labelForOption(OCCASION_OPTIONS, occasion)).filter(Boolean);
  const name = entry.venue_name || 'Unnamed food-and-drink destination';
  const where = [entry.address, entry.city, entry.country].filter(Boolean).join(', ');
  // A just-saved or just-deleted entry is marked and focused, never expanded:
  // opening its pre-filled Edit form would read as an edit the member did not
  // ask for.
  const highlighted = highlightedWaitlistId === entry.id;
  // A live place ends its line with Open; anything else ends it with the
  // reason it has no page yet, so the collapsed list still tells the truth.
  const openOrStatus = publishedVenue
    ? `<a class="community-queue-open" href="${esc(discoveryHref(publishedVenue))}" data-place="${esc(publishedVenue.id)}" aria-label="Open the ${esc(publishedVenue.name)} place page">Open</a>`
    : `<span class="community-queue-status is-${statusClass}">${statusLabel}</span>`;
  const deleteAction = rec
    ? `<button class="community-queue-delete" type="button" data-community-delete-recommendation="${esc(rec.id)}" data-waitlist="${esc(entry.id)}" data-place-name="${esc(entry.venue_name || '')}" data-published="${published ? 'true' : 'false'}" ${submitting ? 'disabled' : ''}>${deletingRecommendationId === rec.id ? 'Deleting…' : 'Delete'}</button>`
    : '';
  const trailing = `<div class="community-queue-actions">${deleteAction}${openOrStatus}</div>`;
  const publicationNote = published
    ? publishedVenue
      ? ''
      : '<p class="community-queue-context">Not available to open in discovery yet.</p>'
    : rec
      ? '<p class="community-queue-context">Your recommendation is saved, but this place is not live yet.</p>'
      : '<p class="community-queue-context">This entry has no recommendation note, so it is not publishable yet.</p>';
  return `<li class="community-queue-row${highlighted ? ' is-highlighted' : ''}" id="waitlist-${esc(entry.id)}" tabindex="-1">
    <details class="community-queue-entry">
      <summary class="community-queue-line">
        <span class="community-queue-name">${esc(name)}</span>
        ${where ? `<span class="community-queue-where">${esc(where)}</span>` : ''}
        <span class="community-queue-edit">Edit</span>
      </summary>
      <div class="community-queue-body">
        ${publicationNote}
        ${category || occasions.length ? `<dl class="community-place-facts">${category ? `<div><dt>Category</dt><dd>${esc(category)}</dd></div>` : ''}${occasions.length ? `<div><dt>Good for</dt><dd>${esc(occasions.join(' · '))}</dd></div>` : ''}</dl>` : ''}
        ${rec ? `<p class="community-seconding">${esc(secondingCopy)}</p>` : ''}
        ${entryEditMarkup(entry)}
        ${
          !published
            ? `<details class="community-share-disclosure">
                <summary>Share with a member</summary>
                <form class="community-form community-share-form" data-community-share data-waitlist="${esc(entry.id)}">
                  ${directoryMarkup(directoryKey, 'Share with a member')}
                  <label>Personal note<textarea name="personal_note" rows="3" maxlength="1200" minlength="8" required placeholder="Why you thought of them for this food-and-drink destination"></textarea></label>
                  <button class="secondary-button" type="submit" ${submitting ? 'disabled' : ''}>${submitting ? 'Sharing…' : 'Share privately'}</button>
                </form>
              </details>`
            : ''
        }
      </div>
    </details>
    ${trailing}
  </li>`;
}

/**
 * The "is this the same place?" question.
 *
 * Two members recommending one restaurant is the common case and the entire
 * point of seconding, so a name and city that are already taken almost always
 * mean the member is about to agree with someone. Almost always is not always,
 * and the two cases used to be indistinguishable: the second submission was
 * quietly folded into the first entry, and a note about one place appeared on
 * another place's page with nothing said. Asking costs one tap in the case where
 * the answer was already going to be yes, and it is the only way the other case
 * can be told apart at all.
 *
 * What the place is is shown; how many members stand behind it is not. That count
 * is global — it includes members in circles this one cannot see — so printing it
 * would disclose their existence and their number.
 */
function collisionMarkup(pending: PendingCollision): string {
  const { collision } = pending;
  const locator = [collision.address || collision.disambiguator, collision.city]
    .filter(Boolean)
    .join(', ');
  const answer = pending.distinguishing
    ? `<form class="community-form community-collision-form" data-collision-distinct-form>
        <label>Which one is yours? <span class="community-optional">The street or the neighbourhood</span><input name="disambiguator" maxlength="120" required autofocus placeholder="e.g. Calle de la Palma" ${submitting ? 'disabled' : ''}></label>
        <p class="community-form-note">This is only used to tell the two apart. It shows next to the name wherever both could be confused.</p>
        <div class="community-form-actions">
          <button class="primary-button" type="submit" ${submitting ? 'disabled' : ''}>${submitting ? 'Adding…' : 'Add as a separate place'}</button>
          <button class="secondary-button" type="button" data-collision-back ${submitting ? 'disabled' : ''}>Back</button>
        </div>
      </form>`
    : `<div class="community-form-actions community-collision-actions">
        <button class="primary-button" type="button" data-collision-second ${submitting ? 'disabled' : ''}>${submitting ? 'Adding…' : "That's the one — add my note"}</button>
        <button class="secondary-button" type="button" data-collision-distinct ${submitting ? 'disabled' : ''}>A different place with the same name</button>
        <button class="secondary-button" type="button" data-collision-cancel ${submitting ? 'disabled' : ''}>Cancel</button>
      </div>`;
  return `<div class="community-collision" role="group" aria-labelledby="community-collision-title">
    <h4 id="community-collision-title" tabindex="-1">Is this the same place?</h4>
    <div class="community-prefilled-place" aria-label="The place already on the list">
      <strong>${esc(collision.venue_name)}</strong>
      ${locator ? `<span>${esc(locator)}</span>` : ''}
    </div>
    <p class="community-collision-copy">${
      collision.published
        ? 'This place is already on the list. If it is the one you mean, your note joins the others on its page.'
        : 'This place is already on the list. If it is the one you mean, your note joins it.'
    }</p>
    ${answer}
  </div>`;
}

function recommendationPanel(): string {
  const draft = recommendationDraft;
  if (draft && recommendationIntent === 'edit') {
    const entry = entryForVenue(draft);
    const recommendation = entry ? recommendationForEntry(entry.id) : undefined;
    const editor =
      loadingCommunity || !communityLoaded
        ? '<p class="community-loading" role="status">Loading your recommendation…</p>'
        : entry && recommendation
          ? `<div class="community-direct-editor" id="waitlist-${esc(entry.id)}" tabindex="-1">
              ${entryEditMarkup(entry)}
            </div>`
          : '<p class="community-empty">Your recommendation could not be matched to this place. Open all recommendations to find it.</p>';
    return `<section class="community-ledger-section community-direct-edit" aria-labelledby="community-waitlist-title">
      <div class="community-section-heading">
        <div><h3 id="community-waitlist-title">Edit my recommendation for ${esc(draft.name)}</h3></div>
        <p>Update your note or correct the place details. Saved changes appear on the place page.</p>
      </div>
      ${editor}
      <button class="secondary-button community-view-all-recommendations" type="button" data-view-all-recommendations>View all recommendations</button>
    </section>`;
  }
  const placeSummary = draft
    ? [draft.address, draft.city, draft.country].filter(Boolean).join(', ')
    : '';
  // Submit and Cancel sit on one row inside the form: leaving the place is one
  // decision with two answers, not a second block below the button.
  const cancelButton = `<button class="secondary-button community-recommend-cancel" type="button" data-recommend-close ${submitting ? 'disabled' : ''}>Cancel</button>`;
  const form = draft
    ? `<form class="community-form community-same-place-form" data-community-recommendation>
        <div class="community-prefilled-place" aria-label="Place being recommended">
          <strong>${esc(draft.name)}</strong>
          ${placeSummary ? `<span>${esc(placeSummary)}</span>` : ''}
        </div>
        <input type="hidden" name="venue_name" value="${esc(draft.name)}">
        <input type="hidden" name="address" value="${esc(draft.address)}">
        <input type="hidden" name="city" value="${esc(draft.city)}">
        <input type="hidden" name="country" value="${esc(draft.country)}">
        <input type="hidden" name="disambiguator" value="${esc(draft.neighborhood)}">
        <!-- Arriving from a place page is the answer to "which place?", so this
             form never asks it again. -->
        <input type="hidden" name="place_intent" value="second">
        <label>My recommendation<textarea id="recommendation-note" name="note" rows="5" maxlength="2400" minlength="24" required autofocus placeholder="What should another Detourist know about this place?"></textarea></label>
        ${placeLinkFields({
          officialUrl: draft.officialUrl,
          instagramUrl: draft.instagramUrl,
        })}
        <div class="community-form-actions">
          <button class="primary-button" type="submit" ${submitting ? 'disabled' : ''}>${submitting ? 'Adding…' : 'Recommend this place'}</button>
          ${cancelButton}
        </div>
      </form>`
    : pendingCollision
      ? collisionMarkup(pendingCollision)
      : // A name, a city, your words, and your photo. Everything else about a
        // place — its street, its country, its coordinates, its website and its
        // Instagram — is found by the enrichment passes from exactly these two
        // facts, so asking a member to type any of it only asked them to do work
        // the server was going to redo anyway. Category and what it is good for
        // stay available on the entry's own line, where correcting them is one
        // click and does not stand between having something to say and saying it.
        `<form class="community-form" data-community-recommendation>
        <label>Food-and-drink destination name<input name="venue_name" maxlength="200" required placeholder="A restaurant, café, bar, or other food-and-drink destination"></label>
        <label>City or locality<input name="city" maxlength="120" required placeholder="City or locality"></label>
        <label>My recommendation<textarea name="note" rows="5" maxlength="2400" minlength="24" required placeholder="What makes this food-and-drink destination worth a deliberate detour?"></textarea></label>
        ${photoField()}
        <div class="community-form-actions">
          <button class="primary-button" type="submit" ${submitting ? 'disabled' : ''}>${submitting ? 'Adding…' : 'Recommend'}</button>
          ${cancelButton}
        </div>
      </form>`;
  // The ledger comes first: the panel opens on what the member has already
  // recommended, and the form is the deliberate second step behind Add new. A
  // draft carried in from a place page is that deliberate step already, so it
  // opens the form on arrival.
  const formOpen = Boolean(draft) || recommendationFormOpen;
  return `<section class="community-ledger-section" aria-labelledby="your-community-queue-title">
    <div class="community-queue" aria-labelledby="your-community-queue-title">
      <div class="community-subheading">
        <h4 id="your-community-queue-title">My recommendations</h4>
        ${communityLoaded && !loadingCommunity && waitlistEntries.length ? `<p class="community-queue-count">${waitlistEntries.length} ${waitlistEntries.length === 1 ? 'entry' : 'entries'}</p>` : ''}
      </div>
      <p class="community-form-note">Places I have recommended, newest first — each line shows whether it is live.</p>
      ${
        loadingCommunity || !communityLoaded
          ? '<p class="community-loading" role="status">Loading…</p>'
          : waitlistEntries.length
            ? queueListMarkup()
            : '<p class="community-empty">Nothing here yet.</p>'
      }
    </div>
    ${
      formOpen
        ? `<div class="community-recommend-new" id="community-recommend-new">
            <div class="community-section-heading">
              <div><h3 id="community-waitlist-title">${draft ? `Recommend ${esc(draft.name)}` : 'Recommend a destination'}</h3></div>
              <p>${
                draft
                  ? 'You are recommending this exact place. Add your own note; its existing details stay attached.'
                  : `As a verified member, you can recommend a restaurant, café, bar, or other food-and-drink destination anywhere in the world. It becomes visible to ${
                      foundingMember ? 'every member of Detour' : 'the members whose circles you appear in'
                    }.`
              }</p>
            </div>
            <div class="community-action-grid community-recommend-action">
              ${form}
            </div>
          </div>`
        : `<button class="primary-button community-recommend-open" type="button" data-recommend-open>Add new</button>`
    }
  </section>`;
}

// The newest entries first (the ledger is loaded newest-updated first), with
// the rest a click away.
function queueListMarkup(): string {
  const shown = queueExpanded ? waitlistEntries : waitlistEntries.slice(0, QUEUE_PREVIEW_LIMIT);
  const hidden = waitlistEntries.length - shown.length;
  const toggle =
    hidden > 0
      ? `<button type="button" class="secondary-button community-queue-more" data-queue-toggle aria-expanded="false" aria-controls="community-queue-list">Show ${hidden} more</button>`
      : '';
  return `<ul class="community-queue-list" id="community-queue-list">${shown.map(waitlistRow).join('')}</ul>${toggle}`;
}

function formatDate(value: string | undefined): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(parsed);
}

function matchVenue(placeInput: string, city: string): Venue | undefined {
  const norm = (value: string) => value.trim().toLowerCase();
  const input = norm(placeInput);
  if (!input) return undefined;
  const byCombo = knownVenues.find((venue) => norm(`${venue.name} — ${venue.city}`) === input);
  if (byCombo) return byCombo;
  const byName = knownVenues.filter((venue) => norm(venue.name) === input);
  if (byName.length === 1) return byName[0];
  if (city) return byName.find((venue) => norm(venue.city) === norm(city));
  return undefined;
}

function sharePlaceForm(): string {
  return `<form class="community-form community-share-place-form" data-community-share-place>
    ${directoryMarkup('share-place', 'Share with a member')}
    <label>Food-and-drink destination<input name="place" list="community-share-place-options" autocomplete="off" maxlength="200" required placeholder="Pick from the list or add a restaurant, café, bar, or other destination"></label>
    <datalist id="community-share-place-options">${knownVenues
      .map((venue) => `<option value="${esc(`${venue.name} — ${venue.city}`)}"></option>`)
      .join('')}</datalist>
    <label>Address<input name="address" maxlength="300" placeholder="Street and number — needed for a destination not in the list"></label>
    <div class="community-form-grid community-place-grid">
      <label>City<input name="city" maxlength="120" placeholder="Madrid"></label>
      <label>Country<input name="country" maxlength="120" placeholder="Spain"></label>
    </div>
    <label>Personal note<textarea name="personal_note" rows="3" maxlength="1200" minlength="8" required placeholder="Why you thought of them for this food-and-drink destination"></textarea></label>
    <div class="community-form-actions">
      <button class="primary-button" type="submit" ${submitting ? 'disabled' : ''}>${submitting ? 'Sharing…' : 'Share destination'}</button>
      <button class="secondary-button community-share-cancel" type="button" data-share-close ${submitting ? 'disabled' : ''}>Cancel</button>
    </div>
  </form>`;
}

// Private share is the deck of shares the member already sent and received —
// the deck itself lives in network.ts, where the share payload, its replies,
// and its cassette flip are already modelled — followed by Share new, which
// reveals the sending form. Reading your shares comes before writing one.
function sharesPanel(): string {
  return `${memberSharesMarkup()}
  ${
    shareFormOpen
      ? `<section class="community-ledger-section community-share-new is-open" id="community-share-new" aria-labelledby="private-shares-title">
          <div class="community-section-heading">
            <div><h3 id="private-shares-title">Share a food-and-drink destination</h3></div>
            <p>Send a restaurant, café, bar, or other food-and-drink destination to a member with a note — from the list, or one of your own.</p>
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
 * The mark that tells one of the Founder's invitations from another, on the two
 * lists below. Shown only to the member who can make the distinction, because
 * every invitation anyone else holds is ordinary and a badge saying so on all of
 * them would be noise.
 */
function foundingInviteTag(invite: InviteRecord): string {
  if (!canGrantFounding || !invite.grants_founding) return '';
  return '<span class="community-invite-founding-tag">Founding seat</span>';
}

function invitesPanel(): string {
  const unclaimed = openInvites();
  const claimed = invites.filter((invite) => invite.claimed_by);
  const available = Math.max(0, invitationLimit - unclaimed.length);
  const allowanceKnown = invitesLoaded && !loadingInvites;
  const atLimit = allowanceKnown && available === 0;
  // Nothing is reserved until someone joins, so a seat count of zero does not
  // block issuing a marked invitation — it warns that the fifty are taken and
  // whoever redeems it will join as an ordinary member.
  const seatsGone = foundingSeatsRemaining === 0;
  return `<section class="community-tab-panel community-invitation-panel" id="member-panel-invitations" role="tabpanel" aria-labelledby="member-tab-invitations" tabindex="0">
    <div class="community-invite-actions">
      <p class="community-invite-explainer">Detour grows by personal invitation only — create a personal invitation link and send it to someone you trust so they can join as a member.</p>
      ${
        canGrantFounding
          ? `<label class="community-switch community-invite-founding">
              <input type="checkbox" data-invite-founding ${inviteGrantsFounding ? 'checked' : ''} ${submitting ? 'disabled' : ''}>
              <span class="community-switch-track" aria-hidden="true"></span>
              <span class="community-switch-copy"><strong>Offer a founding seat</strong><small>${
                inviteGrantsFounding
                  ? seatsGone
                    ? 'All fifty seats are taken — whoever redeems this joins as a regular member'
                    : `The next invitation you create joins the founding circle${
                        foundingSeatsRemaining === null ? '' : ` — ${foundingSeatsRemaining} of fifty ${foundingSeatsRemaining === 1 ? 'seat' : 'seats'} left`
                      }`
                  : 'The next invitation you create joins as a regular member'
              }</small></span>
            </label>`
          : ''
      }
      <div class="community-invite-bar">
        <button class="secondary-button" type="button" data-community-invite ${submitting || !allowanceKnown || atLimit ? 'disabled' : ''}>${submitting ? 'Preparing…' : atLimit ? 'Invitation limit reached' : inviteGrantsFounding ? 'New founding invitation' : 'New invitation'}</button>
        <p class="community-invite-allowance" aria-live="polite"><strong>${allowanceKnown ? available : '—'}</strong> ${allowanceKnown ? (available === 1 ? 'invitation left' : 'invitations left') : 'checking…'}</p>
      </div>
      ${
        loadingInvites || !invitesLoaded
          ? '<p class="community-loading" role="status">Loading…</p>'
          : unclaimed.length
            ? `<div class="community-invite-list"><h4>Unclaimed invitations</h4><ul class="community-invite-codes" aria-label="Your unclaimed invitation links">${unclaimed
                .map(
                  (invite) =>
                    `<li><code>${esc(invite.code || '')}</code>${foundingInviteTag(invite)}<div class="community-invite-row-actions"><button class="secondary-button community-invite-copy" type="button" data-copy-invite="${esc(invite.code || '')}" aria-live="polite" aria-label="Copy invitation link for ${esc(invite.code || '')}">Copy link</button>${invite.code ? inviteShareMarkup(invitationLink(invite.code), true) : ''}</div></li>`
                )
                .join('')}</ul></div>`
            : '<p class="community-empty">No unclaimed invitations. Create one to invite someone.</p>'
      }
      ${
        allowanceKnown && claimed.length
          ? `<div class="community-invite-list community-invite-claimed"><h4>Claimed invitations</h4><ul class="community-invite-codes" aria-label="Your claimed invitation codes">${claimed
              .map((invite) => {
                const when = formatDate(invite.claimed_at);
                return `<li><code>${esc(invite.code || '')}</code>${foundingInviteTag(invite)}<span>Claimed${when ? ` ${esc(when)}` : ''}</span></li>`;
              })
              .join('')}</ul></div>`
          : ''
      }
    </div>
  </section>`;
}

function curationImageUrl(item: ImageCurationItem): string {
  return pb.files.getURL(
    {
      id: item.id,
      collectionId: item.collection_id,
      collectionName: 'community_place_images',
    } as RecordModel,
    item.snapshot,
    // the `f` suffix fits the image inside the box; plain WxH center-crops it,
    // which hid parts of the frame the reviewer has to judge
    { thumb: '720x540f' }
  );
}

function curationPanel(): string {
  return `<section class="community-tab-panel community-curation-panel" id="member-panel-curation" role="tabpanel" aria-labelledby="member-tab-curation" tabindex="0">
    <div class="community-section-heading">
      <div><p class="community-kicker">Founding circle</p><h3>Photo review</h3></div>
      <p class="community-form-note">Approving a photo publishes it with the member's own recommendation. It does not become the place's image, and it replaces no one else's photo.</p>
    </div>
    ${
      loadingCuration || !curationLoaded
        ? '<p class="community-loading" role="status">Loading the review queue…</p>'
        : curationItems.length
          ? `<div class="community-curation-grid">${curationItems.map((item) => {
              const where = [item.city, item.country].filter(Boolean).join(', ');
              const submitter = item.submitted_by ? `@${item.submitted_by.replace(/^@+/, '')}` : 'a member';
              const screeningUnavailable = item.screening_status === 'screening_failed';
              return `<article class="community-curation-card">
                <img src="${esc(curationImageUrl(item))}" alt="Submitted image for ${esc(item.place_name)}" loading="lazy" decoding="async">
                <div class="community-curation-copy">
                  <p class="community-curation-status${screeningUnavailable ? ' is-unscreened' : ''}">${screeningUnavailable
                    ? 'Unscreened · Manual safety review required'
                    : `Safety passed · Relevance: ${esc(item.relevance)}`}</p>
                  <h4>${esc(item.place_name)}</h4>
                  ${where ? `<p>${esc(where)}</p>` : ''}
                  <p class="community-form-note">Submitted by ${esc(submitter)}. ${esc(item.ai_note || 'Founder judgment required.')}</p>
                  <form class="community-curation-form" data-image-curation="${esc(item.id)}">
                    <label>Review note <span class="community-optional">Optional</span><textarea name="note" rows="2" maxlength="1200" placeholder="Reason for approving or rejecting"></textarea></label>
                    <div class="community-curation-actions">
                      <button class="secondary-button" type="submit" name="decision" value="reject" ${curationSavingId ? 'disabled' : ''}>${curationSavingId === item.id ? 'Saving…' : 'Reject'}</button>
                      <button class="primary-button" type="submit" name="decision" value="approve" ${curationSavingId ? 'disabled' : ''}>${curationSavingId === item.id ? 'Saving…' : 'Approve photo'}</button>
                    </div>
                  </form>
                </div>
              </article>`;
            }).join('')}</div>`
          : '<p class="community-empty">No photos are waiting for review.</p>'
    }
    ${coverlessMarkup()}
  </section>`;
}

/**
 * Places the automatic passes could not find a photograph for.
 *
 * A worklist rather than a review queue: there is nothing here to approve or
 * reject, because there is no photo. Look again re-runs the same passes the
 * sweeps run, which is worth a click for a place that has gained a website since
 * it published. A place with no website and no Instagram has exhausted them, and
 * is marked so, because the only thing left is for someone to go and take a
 * picture — and a photo belongs to a recommendation, so that someone has to be a
 * member who recommends it.
 */
function coverlessMarkup(): string {
  const count = coverlessPlaces.length;
  return `<div class="community-coverless">
    <div class="community-subheading">
      <h4 id="community-coverless-title">Places with no photo</h4>
      ${coverlessLoaded && !loadingCoverless && count ? `<p class="community-queue-count">${count} ${count === 1 ? 'place' : 'places'}</p>` : ''}
    </div>
    <p class="community-form-note">Live with neither a found cover nor a member's photo. They show a monogram until one arrives.</p>
    ${
      loadingCoverless || !coverlessLoaded
        ? '<p class="community-loading" role="status">Loading…</p>'
        : count
          ? `<ul class="community-coverless-list" aria-labelledby="community-coverless-title">${coverlessPlaces
              .map((place) => {
                const where = [place.disambiguator, place.city, place.country].filter(Boolean).join(', ');
                const links = [
                  place.official_url ? `<a href="${esc(place.official_url)}" target="_blank" rel="noopener noreferrer">Website</a>` : '',
                  place.instagram_url ? `<a href="${esc(place.instagram_url)}" target="_blank" rel="noopener noreferrer">Instagram</a>` : '',
                ].filter(Boolean);
                const busy = refreshingCoverlessId === place.id;
                const uploading = coverUploadingId === place.id;
                const anyBusy = Boolean(refreshingCoverlessId || coverUploadingId);
                return `<li class="community-coverless-row">
                  <div class="community-coverless-place">
                    <span class="community-coverless-name">${esc(place.place_name)}</span>
                    ${where ? `<span class="community-coverless-where">${esc(where)}</span>` : ''}
                    <span class="community-coverless-links">${
                      links.length
                        ? links.join('<span aria-hidden="true"> · </span>')
                        : '<span class="community-coverless-exhausted">Nowhere left to look — no website or Instagram</span>'
                    }</span>
                  </div>
                  <form class="community-coverless-form" data-coverless-cover="${esc(place.id)}">
                    <div class="community-coverless-inputs">
                      <label>Upload a photo<input name="photo" type="file" accept="image/jpeg,image/png,image/webp" ${anyBusy ? 'disabled' : ''}></label>
                      <label>Or paste a link to one<input name="source_url" type="url" inputmode="url" autocomplete="off" spellcheck="false" maxlength="2048" placeholder="https://…/photo.jpg" ${anyBusy ? 'disabled' : ''}></label>
                    </div>
                    <div class="community-coverless-buttons">
                      <button class="primary-button" type="submit" ${anyBusy ? 'disabled' : ''}>${uploading ? 'Saving…' : 'Set as cover'}</button>
                      <button class="secondary-button" type="button" data-coverless-refresh="${esc(place.id)}" ${anyBusy ? 'disabled' : ''}>${busy ? 'Looking…' : 'Look again'}</button>
                    </div>
                  </form>
                </li>`;
              })
              .join('')}</ul>`
          : '<p class="community-empty">Every live place has a photo.</p>'
    }
  </div>`;
}

function detoursPanel(): string {
  const unseen = unseenShareCount();
  const tabs: { id: DetourTab; label: string }[] = [
    { id: 'recommendations', label: 'Recommendations' },
    { id: 'shares', label: 'Private shares' },
  ];
  return `<div class="community-tab-panel community-detours-panel" id="member-panel-detours" role="tabpanel" aria-labelledby="member-tab-detours" tabindex="0">
    <div class="community-tabs community-detour-tabs" role="tablist" aria-label="My detours sections">
      ${tabs
        .map(
          (tab) =>
            `<button class="community-tab ${detourTab === tab.id ? 'is-active' : ''}" type="button" role="tab" id="detour-tab-${tab.id}" aria-selected="${detourTab === tab.id}" aria-controls="detour-panel-${tab.id}" tabindex="${detourTab === tab.id ? '0' : '-1'}" data-detour-tab="${tab.id}">${tab.label}${tab.id === 'shares' && unseen ? `<span class="community-tab-badge" aria-label="${unseen} new shares">${unseen}</span>` : ''}</button>`
        )
        .join('')}
    </div>
    ${
      detourTab === 'recommendations'
        ? `<div class="community-detour-body" id="detour-panel-recommendations" role="tabpanel" aria-labelledby="detour-tab-recommendations">${recommendationPanel()}</div>`
        : `<div class="community-detour-body" id="detour-panel-shares" role="tabpanel" aria-labelledby="detour-tab-shares">${sharesPanel()}</div>`
    }
  </div>`;
}

function settingsPanel(record: MemberRecord): string {
  const keepPrivate = visibilityPending ?? record.discovery_visible === false;
  return `<section class="community-tab-panel community-settings-panel" id="member-panel-settings" role="tabpanel" aria-labelledby="member-tab-settings" tabindex="0">
    <div class="community-session-row">
      <p class="community-session-note">Signed in as <strong>${esc(record.email || memberName(record))}</strong></p>
      ${foundingMember ? '<span class="community-founder-badge">Founding member</span>' : ''}
      <button class="secondary-button community-session-signout" type="button" data-community-sign-out>Sign out</button>
    </div>
    <div class="community-pseudo-row">
      <form class="community-form community-pseudo-form" data-community-pseudo>
        <label>My pseudo<input name="pseudo" value="${esc(record.pseudo || '')}" autocomplete="off" spellcheck="false" minlength="3" maxlength="30" pattern="@?[a-zA-Z0-9][a-zA-Z0-9-]{1,28}[a-zA-Z0-9]" title="3-30 characters: letters, digits, and hyphens" required></label>
        <button class="secondary-button" type="submit" ${submitting ? 'disabled' : ''}>${submitting ? 'Saving…' : 'Save pseudo'}</button>
      </form>
      <p class="community-form-note">Your unique handle — other members search for it to share food-and-drink destinations with you.</p>
    </div>
    <div class="community-pseudo-row">
      <form class="community-form community-pseudo-form" data-community-home-city>
        <label>Where do you live?<input name="home_city" value="${esc(record.home_city || '')}" autocomplete="address-level2" minlength="2" maxlength="120" required placeholder="City — e.g. San Francisco"></label>
        <button class="secondary-button" type="submit" ${submitting ? 'disabled' : ''}>${submitting ? 'Saving…' : 'Save city'}</button>
      </form>
      <p class="community-form-note">Signup asks every member where they live; this is where members who joined before it was asked can answer.</p>
    </div>
    <div class="community-visibility-row">
      <div class="community-visibility-copy">
        <h3>Food-and-drink discovery</h3>
        <p class="community-form-note">${
          foundingMember
            ? 'As a founding member, your food-and-drink recommendations reach every member of Detour.'
            : 'Your food-and-drink recommendations reach the members whose circles you appear in: the person who invited you, the people you invited, the others they invited, and the person who invited your inviter. Nobody further out sees them.'
        } Private shares and replies stay private.</p>
      </div>
      <label class="community-switch">
        <input type="checkbox" data-community-visibility ${keepPrivate ? 'checked' : ''} ${visibilitySaving ? 'disabled' : ''}>
        <span class="community-switch-track" aria-hidden="true"></span>
        <span class="community-switch-copy"><strong>Keep recommendations private</strong><small>${visibilitySaving ? 'Saving…' : keepPrivate ? 'Hidden from your circle' : 'Discoverable by your circle'}</small></span>
      </label>
    </div>
    <div class="community-danger-row">
      <p class="community-danger-note">Removing your account deletes your recommendations, shares, and invitations. This cannot be undone.</p>
      <button class="community-danger" type="button" data-community-remove-account ${submitting ? 'disabled' : ''}>${submitting ? 'Removing…' : 'Remove account'}</button>
    </div>
  </section>`;
}

function unseenShareCount(): number {
  return incomingShares().filter((share) => !share.seen).length;
}

function memberTabsMarkup(): string {
  const unseen = unseenShareCount();
  const tabs = memberTabs();
  return `<div class="community-member-bar">
    <div class="community-member-tabs" role="tablist" aria-label="Member areas">
      ${tabs.map(
        (tab) =>
          `<button class="community-member-tab${memberTab === tab ? ' is-active' : ''}" type="button" role="tab" id="member-tab-${tab}" aria-selected="${memberTab === tab}" aria-controls="member-panel-${tab}" tabindex="${memberTab === tab ? '0' : '-1'}" data-member-tab="${tab}">${MEMBER_TAB_LABELS[tab]}${
            tab === 'detours' && unseen ? `<span class="community-tab-badge" aria-label="${unseen} new shares">${unseen}</span>` : ''
          }${tab === 'curation' && imageCurationCount ? `<span class="community-tab-badge" aria-label="${imageCurationCount} photos awaiting review">${imageCurationCount}</span>` : ''}</button>`
      ).join('')}
    </div>
  </div>`;
}

function signedInPanel(): string {
  const record = member();
  if (!record) return signedOutPanel();
  const panel =
    memberTab === 'invitations'
      ? invitesPanel()
      : memberTab === 'detours'
        ? detoursPanel()
        : memberTab === 'curation' && foundingMember
          ? curationPanel()
          : settingsPanel(record);
  return `<section class="community-panel community-panel-member" aria-label="Detour member area">
    ${memberTabsMarkup()}
    ${noticeMarkup()}
    ${panel}
    ${deleteRecommendationDialogMarkup()}
  </section>`;
}

/** Apply invitation-link route state before the member area renders. */
export function applyInvitationRoute(code: string | null): void {
  const nextCode = code?.trim() || null;
  if (nextCode === routedInvitationCode) return;
  const leavingInvitationRoute = routedInvitationCode !== null && nextCode === null;
  routedInvitationCode = nextCode;
  invitationCodePrefill = nextCode || '';
  if (nextCode) mode = 'join';
  else if (leavingInvitationRoute) mode = 'sign-in';
}

/**
 * Point the member area at the Share a place form (My detours → Shares) before it
 * renders. A pseudo names who the share is for — My Circle sends one, since a row
 * there is already a specific person — and the recipient picker resolves it to
 * that member on the next bind. Only the pseudo travels: the circle payload
 * carries no member ids, and the directory is the one place allowed to turn a
 * pseudo into an id.
 */
export function openSharePlace(recipientPseudo?: string): void {
  memberTab = 'detours';
  detourTab = 'shares';
  // Arriving via "Share privately" is an explicit ask for the form.
  shareFormOpen = true;
  pendingFormReveal = 'share';
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
 * Turns the pseudo a deep link arrived with into the picker's selected member.
 * An exact pseudo match selects itself; anything else is left as search results
 * for the member to choose from, so a renamed or ambiguous handle degrades into
 * the ordinary lookup rather than sending to the wrong person.
 */
async function resolveShareRecipient(render: () => void): Promise<void> {
  const pseudo = pendingShareRecipient;
  pendingShareRecipient = null;
  if (!pseudo) return;
  const state = directoryState('share-place');
  state.loading = true;
  render();
  try {
    const response = await pb.send<{ items: DirectoryMember[] }>(
      `/api/detour/member-directory?q=${encodeURIComponent(pseudo)}`,
      { requestKey: null }
    );
    const ownId = member()?.id;
    const items = (response.items || []).filter((item) => item.id !== ownId && item.pseudo?.trim());
    const exact = items.find(
      (item) => pseudoLabel(item.pseudo).toLowerCase() === pseudo.toLowerCase()
    );
    if (exact) {
      state.selected = exact;
      state.query = pseudoLabel(exact.pseudo);
      state.items = [];
    } else {
      state.items = items;
    }
    state.error = '';
  } catch (error) {
    state.items = [];
    state.error = readableError(error, 'Member search is unavailable. Please try again.');
  } finally {
    state.loading = false;
    state.activeIndex = -1;
    render();
  }
}

/** Point the member area at the Recommend form, optionally fixed to one published place. */
export function openRecommendPlace(venue?: Venue): void {
  memberTab = 'detours';
  detourTab = 'recommendations';
  recommendationDraft = venue || null;
  recommendationIntent = 'add';
  // "Recommend" from the feed or a place page is an explicit ask for the form,
  // with or without a place attached.
  recommendationFormOpen = true;
  pendingCollision = null;
  pendingFormReveal = 'recommendation';
}

/** Open the current member's editor for one published place. */
export function openEditRecommendation(venue: Venue): void {
  memberTab = 'detours';
  detourTab = 'recommendations';
  recommendationDraft = venue;
  recommendationIntent = 'edit';
  recommendationFormOpen = false;
  pendingCollision = null;
  pendingFormReveal = null;
}

export function communityControl(href: string, current = false): string {
  const record = member();
  // Signed out, the control is a plain link into the sign-in / join panel.
  if (!record) {
    return `<a class="community-toggle${current ? ' is-current' : ''}" href="${esc(href)}" data-community-route${current ? ' aria-current="page"' : ''}>Members<span${current ? '' : ' class="nav-arrow nav-arrow-external"'} aria-hidden="true">${current ? '•' : '&#x2197;&#xFE0E;'}</span></a>`;
  }
  const items = memberTabs().map((tab) => {
    const active = current && memberTab === tab;
    return `<a class="community-menu-item${active ? ' is-current' : ''}" role="menuitem" href="${esc(href)}" data-community-route="${tab}"${
      active ? ' aria-current="true"' : ''
    }>${MEMBER_TAB_LABELS[tab]}</a>`;
  }).join('');
  return `<div class="community-menu" data-community-menu>
    <button class="community-toggle${current ? ' is-current' : ''}" type="button" data-community-menu-toggle
      aria-haspopup="true" aria-expanded="false" aria-controls="community-menu-items">
      <span class="community-toggle-label"><span class="community-toggle-prefix">Member: </span>${esc(memberName(record))}</span><span aria-hidden="true">▾</span>
    </button>
    <div class="community-menu-items" id="community-menu-items" role="menu" aria-label="Member menu" hidden>
      ${items}
      <button class="community-menu-item community-menu-signout" role="menuitem" type="button" data-community-sign-out>Sign out</button>
    </div>
  </div>`;
}

/** Point the member area at one of its tabs (used by the masthead member menu). */
export function openMemberArea(tab: string): boolean {
  if (!memberTabs().includes(tab as MemberTab)) return false;
  memberTab = tab as MemberTab;
  return true;
}

/** Drop the session. Callers re-render; the masthead falls back to "Members". */
export function signOutMember(): void {
  pb.authStore.clear();
  resetCommunityState();
  notice = { kind: 'info', text: 'You have signed out of Detour.' };
}

export function communityPanel(venues: Venue[]): string {
  knownVenues = venues;
  return `<div id="community-area" class="community-area">${member() ? signedInPanel() : signedOutPanel()}</div>`;
}

function resetCommunityState(): void {
  memberTab = 'detours';
  detourTab = 'recommendations';
  recommendationDraft = null;
  recommendationIntent = 'add';
  recommendationFormOpen = false;
  pendingCollision = null;
  shareFormOpen = false;
  pendingFormReveal = null;
  pendingShareRecipient = null;
  waitlistEntries = [];
  recommendations = [];
  shares = [];
  lockedEntryIds = new Set<string>();
  communityLoaded = false;
  loadingCommunity = false;
  invites = [];
  invitesLoaded = false;
  loadingInvites = false;
  // A signed-out shell must not keep the previous member's allowance.
  invitationLimit = BASELINE_INVITATION_LIMIT;
  deletingRecommendationId = '';
  pendingRecommendationDeletion = null;
  highlightedWaitlistId = '';
  queueExpanded = false;
  visibilitySaving = false;
  visibilityPending = null;
  memberRefreshed = false;
  refreshingMember = false;
  foundingMember = false;
  // A new session reads its own standing; the in-flight request for the previous
  // one is abandoned rather than allowed to answer for this member.
  memberFlagsLoaded = false;
  memberFlagsRequest = null;
  // Attendance belongs to the member who was signed in, never to the next one.
  memberVisitCount = 0;
  memberDaysAway = null;
  memberNewSession = false;
  canGrantFounding = false;
  foundingSeatsRemaining = null;
  inviteGrantsFounding = false;
  imageCurationCount = 0;
  curationItems = [];
  curationLoaded = false;
  loadingCuration = false;
  curationSavingId = '';
  coverlessPlaces = [];
  coverlessLoaded = false;
  loadingCoverless = false;
  refreshingCoverlessId = '';
  coverUploadingId = '';
  directories.forEach((state) => {
    if (state.timer !== null) window.clearTimeout(state.timer);
  });
  directories.clear();
}

async function loadCommunity(render: () => void): Promise<void> {
  if (!member() || loadingCommunity) return;
  loadingCommunity = true;
  render();
  const results = await Promise.allSettled([
    pb.collection('community_waitlist_entries').getFullList<WaitlistEntry>({ sort: '-updated', requestKey: null }),
    pb.collection('community_shares').getFullList<ShareRecord>({ sort: '-created', requestKey: null }),
    pb.collection('community_recommendations').getFullList<RecommendationRecord>({ sort: '-created', requestKey: null }),
    pb.send<{ ids?: string[] }>('/api/detour/community/place-locks', { requestKey: null }),
  ]);

  if (results[0].status === 'fulfilled') waitlistEntries = results[0].value;
  if (results[1].status === 'fulfilled') shares = results[1].value;
  if (results[2].status === 'fulfilled') recommendations = results[2].value;
  if (results[3].status === 'fulfilled') {
    lockedEntryIds = new Set(
      Array.isArray(results[3].value.ids)
        ? results[3].value.ids.filter((id): id is string => typeof id === 'string')
        : []
    );
  }

  const failure = results.find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') {
    notice = { kind: 'error', text: readableError(failure.reason, 'Some community details could not be loaded. Please try again.') };
  }
  communityLoaded = true;
  loadingCommunity = false;
  render();
}

/**
 * Read this member's standing once per session: founding status, the invitation
 * allowance, and the depth of the curation queue. Every masthead calls this, so
 * it is safe to call on any render — the answer is fetched at most once, and a
 * failed read leaves the flags untouched so a later surface can try again.
 */
export function ensureMemberFlags(render: () => void): Promise<void> {
  const signedInAs = member()?.id;
  if (!signedInAs || memberFlagsLoaded) return Promise.resolve();
  if (!memberFlagsRequest) {
    const request = loadMemberFlags(signedInAs, render).finally(() => {
      // A sign-out mid-flight has already cleared the handle on behalf of the
      // next session, so only the current request retires itself.
      if (memberFlagsRequest === request) memberFlagsRequest = null;
    });
    memberFlagsRequest = request;
  }
  return memberFlagsRequest;
}

/**
 * This member's attendance for the current session: how many visits the server
 * has counted, how many whole days they were away beforehand (null when that is
 * unknown — a first visit, or a ping that failed), and whether this document load
 * opened the session.
 *
 * `visits` is the stable one, fixed for as long as the session lasts, so a
 * surface that rotates something per return should key on it. `isNewSession` is
 * true only on the load that opened the visit, which makes it the signal for a
 * moment that should happen once rather than on every page.
 *
 * Zeroes until `ensureMemberFlags` has answered, so a caller reading it on the
 * first frame sees "no visits counted yet", not a wrong number.
 */
export function memberSession(): { visits: number; daysAway: number | null; isNewSession: boolean } {
  return { visits: memberVisitCount, daysAway: memberDaysAway, isNewSession: memberNewSession };
}

async function loadMemberFlags(signedInAs: string, render: () => void): Promise<void> {
  const me = await pb
    .send<{
      member?: {
        invitation_limit?: unknown;
        founding_member?: unknown;
        can_grant_founding?: unknown;
        founding_seats_remaining?: unknown;
        image_curation_count?: unknown;
        visit_count?: unknown;
        days_away?: unknown;
        new_session?: unknown;
      };
    }>('/api/detour/community/me', { requestKey: null })
    .catch(() => null);
  // A read that failed states nothing: the flags keep their current values and
  // stay open to a retry. A session that changed hands while the read was in
  // flight is answered for by its own request, never by this one.
  if (!me || member()?.id !== signedInAs) return;
  const wasFounding = foundingMember;
  const reported = Number(me.member?.invitation_limit);
  // A backend without the field, or a nonsense value, leaves the baseline in
  // place rather than granting or removing an allowance the server did not state.
  invitationLimit =
    Number.isFinite(reported) && reported >= BASELINE_INVITATION_LIMIT
      ? Math.floor(reported)
      : BASELINE_INVITATION_LIMIT;
  foundingMember = me.member?.founding_member === true;
  canGrantFounding = me.member?.can_grant_founding === true;
  // A backend that does not report the figure leaves it unknown rather than
  // zero: the toggle stays offerable, and the server is the one that decides
  // whether a redeemed invitation actually finds a seat.
  const seats = Number(me.member?.founding_seats_remaining);
  foundingSeatsRemaining = canGrantFounding && Number.isFinite(seats) ? Math.max(0, Math.floor(seats)) : null;
  if (!canGrantFounding) inviteGrantsFounding = false;
  imageCurationCount = foundingMember ? cleanCount(me.member?.image_curation_count) : 0;
  if (!foundingMember && memberTab === 'curation') memberTab = 'settings';
  memberVisitCount = cleanCount(me.member?.visit_count);
  // A gap the server could not measure — a first visit, or a failed ping — stays
  // unknown rather than becoming a confident zero days.
  const away = Number(me.member?.days_away);
  memberDaysAway = Number.isFinite(away) && away >= 0 ? Math.floor(away) : null;
  memberNewSession = me.member?.new_session === true;
  memberFlagsLoaded = true;
  // Outside the member area, the founding markers change exactly one thing —
  // whether Curation sits in the masthead menu — so only a member who curates
  // costs a redraw. The member area renders on its own loaders regardless, and
  // an ordinary member's home map is left alone.
  if (foundingMember !== wasFounding) render();
}

async function loadInvites(render: () => void): Promise<void> {
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
    notice = { kind: 'error', text: readableError(error, 'Your invitations could not be loaded. Please try again.') };
  } finally {
    loadingInvites = false;
    render();
  }
}

async function loadCuration(render: () => void): Promise<void> {
  if (!member() || !foundingMember || loadingCuration) return;
  loadingCuration = true;
  render();
  try {
    const response = await pb.send<{ items?: ImageCurationItem[] }>(
      '/api/detour/curation/images',
      { requestKey: null }
    );
    curationItems = Array.isArray(response.items) ? response.items : [];
    imageCurationCount = curationItems.length;
    curationLoaded = true;
  } catch (error) {
    notice = {
      kind: 'error',
      text: readableError(error, 'The image review queue could not be loaded. Please try again.'),
    };
  } finally {
    loadingCuration = false;
    render();
  }
}

async function loadCoverless(render: () => void): Promise<void> {
  if (!member() || !foundingMember || loadingCoverless) return;
  loadingCoverless = true;
  render();
  try {
    const response = await pb.send<{ items?: CoverlessPlace[] }>(
      '/api/detour/curation/coverless',
      { requestKey: null }
    );
    coverlessPlaces = Array.isArray(response.items) ? response.items : [];
    coverlessLoaded = true;
  } catch (error) {
    notice = {
      kind: 'error',
      text: readableError(error, 'The list of places without photos could not be loaded. Please try again.'),
    };
  } finally {
    loadingCoverless = false;
    render();
  }
}

function updateDirectoryResults(root: HTMLElement, key: string): void {
  const container = Array.from(root.querySelectorAll<HTMLElement>('[data-member-directory]')).find(
    (item) => item.dataset.memberDirectory === key
  );
  if (!container) return;
  const output = container.querySelector<HTMLElement>('[data-member-results]');
  const input = container.querySelector<HTMLInputElement>('[data-member-search]');
  const state = directoryState(key);
  if (output) output.innerHTML = directoryResultsMarkup(key);
  if (input) {
    input.setAttribute('aria-expanded', String(state.items.length > 0 && !state.selected));
    if (state.activeIndex >= 0) input.setAttribute('aria-activedescendant', `${directoryListId(key)}-option-${state.activeIndex}`);
    else input.removeAttribute('aria-activedescendant');
  }
}

function selectDirectoryMember(root: HTMLElement, key: string, index: number): void {
  const state = directoryState(key);
  const selected = state.items[index];
  if (!selected) return;
  state.selected = selected;
  state.query = pseudoLabel(selected.pseudo);
  state.items = [];
  state.activeIndex = -1;
  const container = Array.from(root.querySelectorAll<HTMLElement>('[data-member-directory]')).find(
    (item) => item.dataset.memberDirectory === key
  );
  const input = container?.querySelector<HTMLInputElement>('[data-member-search]');
  if (input) input.value = pseudoLabel(selected.pseudo);
  updateDirectoryResults(root, key);
}

function bindDirectories(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('[data-member-directory]').forEach((container) => {
    const key = container.dataset.memberDirectory || '';
    const input = container.querySelector<HTMLInputElement>('[data-member-search]');
    const output = container.querySelector<HTMLElement>('[data-member-results]');
    if (!key || !input || !output) return;

    input.addEventListener('input', () => {
      const state = directoryState(key);
      state.query = input.value;
      state.selected = null;
      state.items = [];
      state.error = '';
      state.activeIndex = -1;
      if (state.timer !== null) window.clearTimeout(state.timer);
      if (state.query.trim().length < 2) {
        state.loading = false;
        updateDirectoryResults(root, key);
        return;
      }
      state.loading = true;
      updateDirectoryResults(root, key);
      const requestedQuery = state.query.trim();
      state.timer = window.setTimeout(async () => {
        try {
          const response = await pb.send<{ items: DirectoryMember[] }>(
            `/api/detour/member-directory?q=${encodeURIComponent(requestedQuery)}`,
            { requestKey: null }
          );
          if (directoryState(key).query.trim() !== requestedQuery) return;
          const ownId = member()?.id;
          state.items = (response.items || []).filter((item) => item.id !== ownId && item.pseudo?.trim());
          state.error = '';
        } catch (error) {
          if (directoryState(key).query.trim() !== requestedQuery) return;
          state.items = [];
          state.error = readableError(error, 'Member search is unavailable. Please try again.');
        } finally {
          if (directoryState(key).query.trim() === requestedQuery) {
            state.loading = false;
            state.activeIndex = -1;
            updateDirectoryResults(root, key);
          }
        }
      }, 220);
    });

    input.addEventListener('keydown', (event) => {
      const state = directoryState(key);
      if (!state.items.length) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        state.activeIndex = (state.activeIndex + 1) % state.items.length;
        updateDirectoryResults(root, key);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        state.activeIndex = state.activeIndex <= 0 ? state.items.length - 1 : state.activeIndex - 1;
        updateDirectoryResults(root, key);
      } else if (event.key === 'Enter' && state.activeIndex >= 0) {
        event.preventDefault();
        selectDirectoryMember(root, key, state.activeIndex);
      } else if (event.key === 'Escape') {
        state.items = [];
        state.activeIndex = -1;
        updateDirectoryResults(root, key);
      }
    });

    output.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-member-choice]');
      if (!button) return;
      selectDirectoryMember(root, key, Number(button.dataset.memberChoice));
      input.focus();
    });
  });
}

function focusWaitlistEntry(id: string): void {
  if (!id) return;
  window.requestAnimationFrame(() => {
    const target = document.getElementById(`waitlist-${id}`);
    target?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    target?.focus({ preventScroll: true });
  });
}

function focusNotice(root: HTMLElement): void {
  window.requestAnimationFrame(() => {
    const target = root.querySelector<HTMLElement>('.community-notice');
    target?.scrollIntoView({
      block: 'start',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
    target?.focus({ preventScroll: true });
  });
}

/**
 * Queues the member's photo for screening and founder review. The server
 * attaches it to the caller's own recommendation for this place — it is never
 * applied to the place itself, and never touches another member's photo.
 */
async function submitImageForReview(waitlistId: string, photo: File): Promise<void> {
  if (!waitlistId || !photo) return;
  const prepared = await preparePhoto(photo);
  if (prepared.size > PHOTO_MAX_BYTES) {
    throw new Error('That photo is larger than 8 MB even after resizing. Choose a smaller one.');
  }
  // Multipart, so the bytes go to the server rather than a link to them. pb.send
  // passes FormData through untouched and sets no JSON content type.
  const body = new FormData();
  body.set('waitlist', waitlistId);
  body.set('photo', prepared, photoFileName(prepared, photo));
  await pb.send('/api/detour/curation/images', { method: 'POST', body, requestKey: null });
}

// Marks the recipient's new shares as seen once the inbox is on screen. Local
// state is updated without re-rendering so the "New" markers stay visible
// until the next render; the tab badge clears then too.
async function markIncomingSharesSeen(): Promise<void> {
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

export function bindCommunity(
  root: HTMLElement,
  venues: Venue[],
  render: () => void,
  onAuthed: () => void,
  onPlaceContributed: () => void,
  refreshCatalogue: () => Promise<Venue[]>,
  /** A joined-and-signed-in member: opens the new-member flow at its first place. */
  onJoined: () => void
): void {
  knownVenues = venues;
  if (memberTab === 'settings') void refreshMemberRecord(render);
  // The private-share deck is rendered by network.ts, so its own module binds
  // the flip, the archive buttons, and the reply threads — and loads the share
  // payload when the member area is opened directly on this tab.
  if (member() && memberTab === 'detours' && detourTab === 'shares') {
    bindMemberShares(root, render, (shareId) => {
      shares = shares.filter((share) => share.id !== shareId);
    });
    if (pendingShareRecipient) void resolveShareRecipient(render);
  }
  root.querySelectorAll<HTMLButtonElement>('[data-community-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      mode = button.dataset.communityMode === 'join' ? 'join' : 'sign-in';
      if (mode === 'sign-in') clearInvitationRoute();
      notice = null;
      render();
    });
  });

  // The invitation card's five answers survive the render that a refusal causes —
  // see `joinDraft`. The password is put back by hand rather than through the
  // markup, so it is never written into a value attribute.
  const joinForm = root.querySelector<HTMLFormElement>('[data-community-join]');
  if (joinForm) {
    const passwordField = joinForm.querySelector<HTMLInputElement>('input[name="password"]');
    if (passwordField && joinDraft.password) passwordField.value = joinDraft.password;
    joinForm.querySelectorAll<HTMLInputElement>('input').forEach((field) => {
      field.addEventListener('input', () => {
        if (field.name === 'email') joinDraft.email = field.value;
        else if (field.name === 'password') joinDraft.password = field.value;
        else if (field.name === 'pseudo') joinDraft.pseudo = field.value;
        else if (field.name === 'home_city') joinDraft.city = field.value;
        else if (field.name === 'invite_code') invitationCodePrefill = field.value;
      });
    });
  }

  root.querySelector<HTMLButtonElement>('[data-view-all-recommendations]')?.addEventListener('click', () => {
    recommendationDraft = null;
    recommendationIntent = 'add';
    recommendationFormOpen = false;
    pendingCollision = null;
    render();
  });

  root.querySelector<HTMLButtonElement>('[data-recommend-open]')?.addEventListener('click', () => {
    recommendationFormOpen = true;
    pendingCollision = null;
    notice = null;
    render();
    // The form is below the ledger, so opening it moves focus into the first
    // field rather than leaving the cursor on a button that no longer exists.
    window.requestAnimationFrame(() => {
      const form = document.querySelector<HTMLElement>('[data-community-recommendation]');
      form?.scrollIntoView({ block: 'nearest' });
      form?.querySelector<HTMLElement>('input, textarea')?.focus({ preventScroll: true });
    });
  });

  root.querySelector<HTMLButtonElement>('[data-recommend-close]')?.addEventListener('click', () => {
    recommendationFormOpen = false;
    pendingCollision = null;
    pendingFormReveal = null;
    recommendationDraft = null;
    render();
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>('[data-recommend-open]')?.focus({ preventScroll: true });
    });
  });

  root.querySelector<HTMLButtonElement>('[data-share-open]')?.addEventListener('click', () => {
    shareFormOpen = true;
    notice = null;
    render();
    window.requestAnimationFrame(() => {
      const form = document.querySelector<HTMLElement>('[data-community-share-place]');
      form?.scrollIntoView({ block: 'nearest' });
      form?.querySelector<HTMLElement>('input, textarea')?.focus({ preventScroll: true });
    });
  });

  root.querySelector<HTMLButtonElement>('[data-share-close]')?.addEventListener('click', () => {
    shareFormOpen = false;
    pendingFormReveal = null;
    // A half-filled recipient lookup must not survive a cancelled share.
    directories.delete('share-place');
    render();
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>('[data-share-open]')?.focus({ preventScroll: true });
    });
  });

  const activateDetourTab = (nextTab: DetourTab, focusTab: boolean) => {
    if (detourTab === nextTab) return;
    detourTab = nextTab;
    if (nextTab === 'shares' && communityLoaded) void markIncomingSharesSeen();
    render();
    if (focusTab) {
      window.requestAnimationFrame(() => {
        root.querySelector<HTMLButtonElement>(`[data-detour-tab="${nextTab}"]`)?.focus({ preventScroll: true });
      });
    }
  };

  root.querySelector<HTMLButtonElement>('[data-queue-toggle]')?.addEventListener('click', (event) => {
    event.preventDefault();
    if (queueExpanded) return;
    const firstRevealedId = waitlistEntries[QUEUE_PREVIEW_LIMIT]?.id || '';
    queueExpanded = true;
    render();
    if (firstRevealedId) {
      window.requestAnimationFrame(() => {
        const firstRevealed = document.getElementById(`waitlist-${firstRevealedId}`);
        firstRevealed?.scrollIntoView({ block: 'nearest' });
        firstRevealed?.focus({ preventScroll: true });
      });
    }
  });

  const detourTabButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-detour-tab]'));
  detourTabButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const nextTab = button.dataset.detourTab as DetourTab | undefined;
      if (nextTab) activateDetourTab(nextTab, true);
    });
    button.addEventListener('keydown', (event) => {
      const currentIndex = detourTabButtons.indexOf(button);
      if (currentIndex < 0) return;
      let nextIndex = currentIndex;
      if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % detourTabButtons.length;
      else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + detourTabButtons.length) % detourTabButtons.length;
      else if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = detourTabButtons.length - 1;
      else return;
      event.preventDefault();
      const nextTab = detourTabButtons[nextIndex]?.dataset.detourTab as DetourTab | undefined;
      if (nextTab) activateDetourTab(nextTab, true);
    });
  });

  const activateMemberTab = (nextTab: MemberTab, focusTab: boolean) => {
    if (memberTab === nextTab) return;
    memberTab = nextTab;
    if (nextTab === 'detours' && detourTab === 'shares' && communityLoaded) void markIncomingSharesSeen();
    if (nextTab === 'curation') {
      curationLoaded = false;
      coverlessLoaded = false;
      void loadCuration(render);
      void loadCoverless(render);
    }
    render();
    if (focusTab) {
      window.requestAnimationFrame(() => {
        root.querySelector<HTMLButtonElement>(`[data-member-tab="${nextTab}"]`)?.focus({ preventScroll: true });
      });
    }
  };

  root.querySelectorAll<HTMLButtonElement>('[data-member-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextTab = button.dataset.memberTab as MemberTab | undefined;
      if (nextTab && memberTabs().includes(nextTab)) activateMemberTab(nextTab, true);
    });
    button.addEventListener('keydown', (event) => {
      const currentTab = button.dataset.memberTab as MemberTab | undefined;
      const tabs = memberTabs();
      const currentIndex = currentTab ? tabs.indexOf(currentTab) : -1;
      if (currentIndex < 0) return;
      let nextIndex = currentIndex;
      if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = tabs.length - 1;
      else return;
      event.preventDefault();
      activateMemberTab(tabs[nextIndex], true);
    });
  });

  root.querySelectorAll<HTMLFormElement>('[data-image-curation]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const imageId = form.dataset.imageCuration || '';
      const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | null;
      const decision = submitter?.value === 'approve' ? 'approve' : 'reject';
      if (!imageId || !foundingMember || curationSavingId) return;
      const values = new FormData(form);
      curationSavingId = imageId;
      notice = null;
      render();
      try {
        await pb.send(`/api/detour/curation/images/${encodeURIComponent(imageId)}/${decision}`, {
          method: 'POST',
          body: { note: String(values.get('note') || '').trim() },
          requestKey: null,
        });
        curationItems = curationItems.filter((item) => item.id !== imageId);
        imageCurationCount = curationItems.length;
        notice = {
          kind: 'success',
          text:
            decision === 'approve'
              ? 'Photo approved. It now appears with that member’s recommendation.'
              : 'Photo rejected.',
        };
        if (decision === 'approve') {
          // Only the circle feed changes: photos live on recommendations, so an
          // approval leaves the venue catalogue exactly as it was.
          resetNetworkDiscovery();
        }
      } catch (error) {
        notice = {
          kind: 'error',
          text: readableError(error, `The image could not be ${decision === 'approve' ? 'approved' : 'rejected'}.`),
        };
      } finally {
        curationSavingId = '';
        render();
        focusNotice(root);
      }
    });
  });

  root.querySelectorAll<HTMLFormElement>('[data-coverless-cover]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const venueId = form.dataset.coverlessCover || '';
      if (!venueId || !foundingMember || coverUploadingId || refreshingCoverlessId) return;
      const photo = chosenPhoto(form);
      const sourceUrl = String(new FormData(form).get('source_url') || '').trim();
      if (!photo && !sourceUrl) {
        notice = { kind: 'error', text: 'Choose a photo, or paste a link to one.' };
        render();
        return;
      }
      coverUploadingId = venueId;
      notice = null;
      render();
      try {
        let body: FormData | { source_url: string };
        if (photo) {
          // An upload wins when both are given: choosing a file is the more
          // deliberate of the two actions. It gets the same browser-side
          // downscale members' photos get — a phone photo is far larger than any
          // surface renders it.
          const prepared = await preparePhoto(photo);
          if (prepared.size > PHOTO_MAX_BYTES) {
            throw new Error('That photo is larger than 8 MB even after resizing. Choose a smaller one.');
          }
          const form_ = new FormData();
          form_.set('photo', prepared, photoFileName(prepared, photo));
          body = form_;
        } else {
          // The server fetches it, confirms it really serves an image, and stores
          // its own copy — so the cover cannot break later because someone else's
          // host stopped serving it.
          body = { source_url: sourceUrl };
        }
        await pb.send(`/api/detour/curation/places/${encodeURIComponent(venueId)}/cover`, {
          method: 'POST',
          body,
          requestKey: null,
        });
        coverlessPlaces = coverlessPlaces.filter((place) => place.id !== venueId);
        notice = { kind: 'success', text: 'Cover set. It is live on the place now.' };
        // The catalogue holds the old coverless venue, and the feed holds cards
        // built from it, so both have to be re-read for the cover to appear.
        resetNetworkDiscovery();
        void refreshCatalogue()
          .then((venues) => {
            knownVenues = venues;
          })
          .catch(() => {
            // The cover is saved either way; the next load will show it.
          });
      } catch (error) {
        notice = { kind: 'error', text: readableError(error, 'That cover could not be saved.') };
      } finally {
        coverUploadingId = '';
        render();
      }
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-coverless-refresh]').forEach((button) => {
    button.addEventListener('click', async () => {
      const venueId = button.dataset.coverlessRefresh || '';
      if (!venueId || !foundingMember || refreshingCoverlessId) return;
      refreshingCoverlessId = venueId;
      notice = null;
      render();
      try {
        const result = await pb.send<{ image_url?: string; official_url?: string; instagram_url?: string }>(
          `/api/detour/curation/coverless/${encodeURIComponent(venueId)}/refresh`,
          { method: 'POST', requestKey: null }
        );
        if (result.image_url) {
          // Found one: the place leaves the worklist, and the catalogue has to be
          // re-read for the cover to appear on its card.
          coverlessPlaces = coverlessPlaces.filter((place) => place.id !== venueId);
          notice = { kind: 'success', text: 'Found a photo. It is live on the place now.' };
          resetNetworkDiscovery();
        } else {
          // Links the pass may have discovered even without a cover are worth
          // showing: they are where a person would look next.
          coverlessPlaces = coverlessPlaces.map((place) =>
            place.id === venueId
              ? {
                  ...place,
                  official_url: result.official_url || place.official_url,
                  instagram_url: result.instagram_url || place.instagram_url,
                }
              : place
          );
          notice = { kind: 'info', text: 'Still no photo for that place.' };
        }
      } catch (error) {
        notice = { kind: 'error', text: readableError(error, 'That place could not be checked again.') };
      } finally {
        refreshingCoverlessId = '';
        render();
      }
    });
  });

  // The invitation card is the whole account: the server requires a pseudo and a
  // home city on every public signup, and asking for them here rather than on a
  // second screen means one form holds everything one create call needs. What
  // src/onboarding.ts is left with is the part that is not the account — the first
  // place — which is why this hands over a session rather than a set of answers.
  root.querySelector<HTMLFormElement>('[data-community-join]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
    const values = new FormData(event.currentTarget as HTMLFormElement);
    const email = String(values.get('email') || '').trim();
    const password = String(values.get('password') || '');
    const inviteCode = String(values.get('invite_code') || '').trim().toUpperCase();
    const pseudo = normalizePseudo(String(values.get('pseudo') || ''));
    const city = String(values.get('home_city') || '').trim();
    joinDraft.email = email;
    joinDraft.password = password;
    joinDraft.pseudo = pseudo;
    joinDraft.city = city;
    invitationCodePrefill = inviteCode;
    if (!email || !inviteCode) {
      notice = { kind: 'error', text: 'Your email address and your invitation code are both needed.' };
      render();
      return;
    }
    if (password.length < 8) {
      notice = { kind: 'error', text: 'Use a password of at least eight characters.' };
      render();
      return;
    }
    if (pseudo.length < 3) {
      notice = { kind: 'error', text: 'Pick a pseudo of at least three characters.' };
      render();
      return;
    }
    // The input's `pattern` is advisory only — a browser that runs it refuses
    // before this handler, and one that does not would otherwise send a pseudo
    // with a space or a dot to the server and get back a 400 from the same catch
    // that reports a spent invitation, so the refusal would read as an
    // invitation problem. Applying the server's own rule states the real one.
    if (!/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(pseudo)) {
      notice = {
        kind: 'error',
        text: 'A pseudo is letters, digits and hyphens only — no spaces — starting and ending with a letter or digit.',
      };
      render();
      return;
    }
    // `required` lets a space through, and the city is asked for real.
    if (city.length < 2) {
      notice = { kind: 'error', text: 'Tell us the city you live in.' };
      render();
      return;
    }
    submitting = true;
    notice = null;
    render();
    try {
      await pb.collection('members').create({
        pseudo,
        email,
        password,
        passwordConfirm: password,
        home_city: city,
        invite_code: inviteCode,
      });
    } catch (error) {
      // The invitation is spent here, so an invalid or already-claimed code
      // surfaces here too. Saying which of the five values the server refused is
      // the whole of the recovery: every one of them can be corrected in place.
      submitting = false;
      notice = {
        kind: 'error',
        text: readableError(
          error,
          'That invitation could not be accepted. Check the code on your invitation and try again.'
        ),
      };
      render();
      return;
    }
    try {
      await pb.collection('members').authWithPassword(email, password);
    } catch {
      // The account exists; only the session does not. The sign-in tab is the
      // shortest way to one, and the invitation has been spent, so there is
      // nothing left on this card to come back to.
      submitting = false;
      mode = 'sign-in';
      resetJoinDraft();
      clearInvitationRoute();
      notice = {
        kind: 'error',
        text: 'Your account was created, but signing in did not go through. Sign in with the email and password you just chose.',
      };
      render();
      return;
    }
    submitting = false;
    resetJoinDraft();
    clearInvitationRoute();
    notice = null;
    resetCommunityState();
    onJoined();
  });

  root.querySelector<HTMLFormElement>('[data-community-sign-in]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget as HTMLFormElement);
    submitting = true;
    notice = null;
    render();
    try {
      await pb.collection('members').authWithPassword(String(values.get('email') || '').trim(), String(values.get('password') || ''));
      submitting = false;
      resetCommunityState();
      notice = null;
      onAuthed();
    } catch (error) {
      submitting = false;
      notice = { kind: 'error', text: readableError(error, 'Those sign-in details were not recognised.') };
      render();
    }
  });

  root.querySelector<HTMLFormElement>('[data-community-pseudo]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const record = member();
    if (!record || submitting) return;
    const values = new FormData(event.currentTarget as HTMLFormElement);
    const pseudo = String(values.get('pseudo') || '').trim().replace(/^@+/, '').toLowerCase();
    if (!pseudo || pseudo === (record.pseudo || '')) return;
    submitting = true;
    notice = null;
    render();
    try {
      const updated = await pb.collection('members').update<MemberRecord>(record.id, { pseudo }, { requestKey: null });
      if (!syncMemberRecord(record, updated)) return;
      notice = { kind: 'success', text: `Your pseudo is now ${pseudo}.` };
    } catch (error) {
      notice = { kind: 'error', text: readableError(error, 'Your pseudo could not be updated. Please try again.') };
    } finally {
      submitting = false;
      render();
    }
  });

  root.querySelector<HTMLFormElement>('[data-community-home-city]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const record = member();
    if (!record || submitting) return;
    const values = new FormData(event.currentTarget as HTMLFormElement);
    const homeCity = String(values.get('home_city') || '').trim();
    if (homeCity === (record.home_city || '')) return;
    if (homeCity.length < 2) {
      notice = { kind: 'error', text: 'Tell us where you live — the city you live in.' };
      render();
      return;
    }
    submitting = true;
    notice = null;
    render();
    try {
      const updated = await pb.collection('members').update<MemberRecord>(record.id, { home_city: homeCity }, { requestKey: null });
      if (!syncMemberRecord(record, updated)) return;
      notice = { kind: 'success', text: `Your circle now sees you in ${updated.home_city || homeCity}.` };
    } catch (error) {
      notice = { kind: 'error', text: readableError(error, 'Your city could not be updated. Please try again.') };
    } finally {
      submitting = false;
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
    notice = null;
    render();
    try {
      const updated = await pb.collection('members').update<MemberRecord>(record.id, { discovery_visible: discoveryVisible }, { requestKey: null });
      if (!syncMemberRecord(record, updated)) return;
      notice = {
        kind: 'success',
        text: keepPrivate
          ? 'Your recommendations are now private and hidden from your circle.'
          : foundingMember
            ? 'Your recommendations are now discoverable by every member of Detour.'
            : 'Your recommendations are now discoverable by the members whose circles you appear in.',
      };
    } catch (error) {
      if (member()?.id !== record.id) return;
      notice = { kind: 'error', text: readableError(error, 'That recommendation privacy setting could not be saved. Please try again.') };
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
    if (!record || submitting) return;
    if (!window.confirm('Remove your account? Your recommendations, shares, and invitations will be deleted. This cannot be undone.')) return;
    submitting = true;
    notice = null;
    render();
    try {
      await pb.collection('members').delete(record.id);
      pb.authStore.clear();
      resetCommunityState();
      mode = 'sign-in';
      notice = { kind: 'info', text: 'Your account has been removed.' };
    } catch (error) {
      notice = { kind: 'error', text: readableError(error, 'Your account could not be removed. Please try again.') };
    } finally {
      submitting = false;
      render();
    }
  });

  root.querySelector<HTMLInputElement>('[data-invite-founding]')?.addEventListener('change', (event) => {
    if (!canGrantFounding) return;
    inviteGrantsFounding = (event.currentTarget as HTMLInputElement).checked;
    render();
  });

  root.querySelector<HTMLButtonElement>('[data-community-invite]')?.addEventListener('click', async () => {
    if (!member() || !invitesLoaded || loadingInvites || openInvites().length >= invitationLimit) return;
    // The server decides this too, and forces it off for anyone but the Founder.
    const grantsFounding = canGrantFounding && inviteGrantsFounding;
    submitting = true;
    notice = null;
    render();
    try {
      await pb.collection('invites').create(grantsFounding ? { grants_founding: true } : {});
      invitesLoaded = false;
      // Back to an ordinary invitation: the choice is made per invitation, and a
      // seat should never be spent because the toggle was still on from last time.
      inviteGrantsFounding = false;
      notice = {
        kind: 'success',
        text: grantsFounding
          ? 'Your founding invitation link is ready.'
          : 'Your invitation link is ready.',
      };
      await loadInvites(render);
    } catch (error) {
      notice = { kind: 'error', text: readableError(error, 'That invitation could not be prepared. Please try again.') };
    } finally {
      submitting = false;
      render();
    }
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
        notice = { kind: 'error', text: 'The invitation link could not be copied automatically. Please try again.' };
        render();
      }
    });
  });

  /**
   * Sends one recommendation, then either lands it or holds it at the same-place
   * question.
   *
   * `held` is what the member typed. It is kept so a 409 can ask which place they
   * mean without losing their words or their photo: answering re-renders the
   * panel, and a file input cannot be repopulated from markup, so the File has to
   * outlive the form it was chosen in.
   */
  const sendRecommendation = async (
    payload: Record<string, string | string[]>,
    photo: File | null,
    held: { venueName: string; city: string; note: string }
  ): Promise<void> => {
    submitting = true;
    notice = null;
    render();
    try {
      const created = await pb
        .collection('community_recommendations')
        .create<RecommendationRecord>(payload);
      pendingCollision = null;
      let photoQueued = false;
      let photoError = '';
      if (photo && created.waitlist) {
        try {
          await submitImageForReview(created.waitlist, photo);
          photoQueued = true;
        } catch (error) {
          photoError = readableError(
            error,
            'The recommendation was saved, but its photo could not be submitted for review.'
          );
        }
      }
      recommendationDraft = null;
      // Saved: the panel returns to the ledger, where the new line is waiting.
      recommendationFormOpen = false;
      highlightedWaitlistId = created.waitlist || '';
      notice = { kind: 'success', text: 'Recommendation saved.' };
      onPlaceContributed();
      communityLoaded = false;
      const catalogueRefresh = refreshCatalogue()
        .then((venues) => {
          knownVenues = venues;
        })
        .catch(() => {
          // The card remains truthful when discovery data is temporarily unavailable.
        });
      await Promise.all([loadCommunity(render), catalogueRefresh]);
      const createdEntry = waitlistEntries.find((entry) => entry.id === highlightedWaitlistId);
      notice = createdEntry?.status === 'published'
        ? { kind: 'success', text: 'Your recommendation is live.' }
        : createdEntry
          ? { kind: 'info', text: 'Your recommendation is saved. Its line shows whether the place is live.' }
          : notice;
      // Category and what a place is good for are no longer asked before the note
      // is written, so the ledger line is where they get added. Worth saying once
      // here, because the occasion filters on discovery are what they feed.
      if (notice && createdEntry) {
        notice.text += ' Open its line to say what it is good for.';
      }
      if (notice && photoQueued) {
        notice.text += ' Your photo is awaiting review and will appear with your note.';
      } else if (photoError) {
        notice = { kind: 'info', text: `${notice?.text || 'Recommendation saved.'} ${photoError}` };
      }
      focusWaitlistEntry(highlightedWaitlistId);
    } catch (error) {
      const askedFor = String(payload.disambiguator || '');
      const collision = await placeCollisionFor(error, { ...held, disambiguator: askedFor });
      if (collision) {
        // Not an error: a question. The form is replaced by it rather than sitting
        // beneath a red notice about something the member has not done wrong.
        //
        // A collision on a qualifier the member just supplied means that qualifier
        // is taken too, so the field stays open for them to give another rather
        // than dropping them back to a choice they have already made.
        pendingCollision = { collision, ...held, photo, distinguishing: Boolean(askedFor) };
        notice = askedFor
          ? { kind: 'info', text: 'A place with that name and street is already on the list. Try a different street or neighbourhood.' }
          : null;
      } else {
        notice = {
          kind: 'error',
          text: readableError(
            error,
            'That recommendation could not be added. Check the name, the city and your note, then try again.'
          ),
        };
      }
    } finally {
      submitting = false;
      render();
      if (pendingCollision) focusCollision(root);
    }
  };

  root.querySelector<HTMLFormElement>('[data-community-recommendation]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const values = new FormData(form);
    const note = String(values.get('note') || '').trim();
    if (!meaningfulRecommendation(note)) {
      notice = { kind: 'error', text: 'Add a meaningful recommendation of at least 24 characters and five words.' };
      render();
      return;
    }
    const category = String(values.get('category') || '').trim();
    const occasions = values.getAll('occasions').map((value) => String(value));
    const payload: Record<string, string | string[]> = {
      venue_name: String(values.get('venue_name') || '').trim(),
      city: String(values.get('city') || '').trim(),
      note,
    };
    // The prefilled "recommend this exact place" form carries the place's known
    // facts; the cold form carries a name and a city and nothing else.
    for (const field of ['address', 'country', 'disambiguator', 'official_url', 'instagram_url'] as const) {
      const value = String(values.get(field) || '').trim();
      if (value) payload[field] = value;
    }
    if (category) payload.category = category;
    if (occasions.length) payload.occasions = occasions;
    // The cold form asks which place when the name is taken; the prefilled one
    // states that the question is already answered.
    payload.place_intent = String(values.get('place_intent') || 'ask');
    await sendRecommendation(payload, chosenPhoto(form), {
      venueName: String(payload.venue_name),
      city: String(payload.city),
      note,
    });
  });

  root.querySelector<HTMLButtonElement>('[data-collision-second]')?.addEventListener('click', async () => {
    const pending = pendingCollision;
    if (!pending || submitting) return;
    // Resolved by entry id, which is the path a private share and the ledger's
    // own edit already take. The name and city ride along so the server can still
    // check they describe the entry being joined.
    await sendRecommendation(
      {
        waitlist: pending.collision.entry,
        venue_name: pending.venueName,
        city: pending.city,
        note: pending.note,
      },
      pending.photo,
      pending
    );
  });

  root.querySelector<HTMLButtonElement>('[data-collision-distinct]')?.addEventListener('click', () => {
    if (!pendingCollision || submitting) return;
    pendingCollision = { ...pendingCollision, distinguishing: true };
    render();
  });

  root.querySelector<HTMLButtonElement>('[data-collision-back]')?.addEventListener('click', () => {
    if (!pendingCollision || submitting) return;
    pendingCollision = { ...pendingCollision, distinguishing: false };
    render();
  });

  root.querySelector<HTMLButtonElement>('[data-collision-cancel]')?.addEventListener('click', () => {
    if (submitting) return;
    pendingCollision = null;
    notice = null;
    render();
  });

  root.querySelector<HTMLFormElement>('[data-collision-distinct-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const pending = pendingCollision;
    if (!pending || submitting) return;
    const disambiguator = String(new FormData(event.currentTarget as HTMLFormElement).get('disambiguator') || '').trim();
    if (!disambiguator) return;
    await sendRecommendation(
      {
        venue_name: pending.venueName,
        city: pending.city,
        note: pending.note,
        disambiguator,
        place_intent: 'distinct',
      },
      pending.photo,
      pending
    );
  });

  root.querySelectorAll<HTMLFormElement>('[data-community-edit]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const entryId = form.dataset.waitlist || '';
      if (!entryId || submitting) return;
      const values = new FormData(form);
      const recommendationId = form.dataset.recommendation || '';
      const category = String(values.get('category') || '').trim();
      const occasions = values.getAll('occasions').map((value) => String(value));
      const proposedPhoto = chosenPhoto(form);
      submitting = true;
      notice = null;
      render();
      let saved = false;
      try {
        // The shared place first, so the recommendation hook re-syncs its
        // display mirrors from the freshly corrected entry.
        await pb.collection('community_waitlist_entries').update(entryId, {
          venue_name: String(values.get('venue_name') || '').trim(),
          address: String(values.get('address') || '').trim(),
          city: String(values.get('city') || '').trim(),
          country: String(values.get('country') || '').trim(),
          disambiguator: String(values.get('disambiguator') || '').trim(),
          category,
          occasions,
          official_url: String(values.get('official_url') || '').trim(),
          instagram_url: String(values.get('instagram_url') || '').trim(),
        });
        if (recommendationId) {
          await pb.collection('community_recommendations').update(recommendationId, {
            note: String(values.get('note') || '').trim(),
            category,
            occasions,
          });
        }
        resetNetworkDiscovery();
        notice = { kind: 'success', text: 'Recommendation updated.' };
        if (proposedPhoto) {
          try {
            await submitImageForReview(entryId, proposedPhoto);
            notice.text += ' Your photo is awaiting review and will appear with your note.';
          } catch (error) {
            notice = {
              kind: 'info',
              text: `Recommendation updated. ${readableError(
                error,
                'The photo could not be submitted for review.'
              )}`,
            };
          }
        }
        communityLoaded = false;
        await loadCommunity(render);
        highlightedWaitlistId = '';
        recommendationDraft = null;
        recommendationIntent = 'add';
        recommendationFormOpen = false;
        saved = true;
      } catch (error) {
        notice = { kind: 'error', text: readableError(error, 'Those changes could not be saved. Check the details and try again.') };
      } finally {
        submitting = false;
        render();
        if (saved) focusNotice(root);
      }
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-community-delete-recommendation]').forEach((button) => {
    button.addEventListener('click', () => {
      const recommendationId = button.dataset.communityDeleteRecommendation || '';
      const entryId = button.dataset.waitlist || '';
      if (!recommendationId || !entryId || submitting) return;
      pendingRecommendationDeletion = {
        recommendationId,
        entryId,
        placeName: button.dataset.placeName?.trim() || 'this place',
        published: button.dataset.published === 'true',
      };
      render();
    });
  });

  const deleteDialog = root.querySelector<HTMLDialogElement>('[data-community-delete-dialog]');
  if (deleteDialog && pendingRecommendationDeletion) {
    const cancelDeletion = () => {
      pendingRecommendationDeletion = null;
      if (deleteDialog.open) deleteDialog.close();
      render();
    };
    deleteDialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      cancelDeletion();
    });
    deleteDialog.addEventListener('click', (event) => {
      if (event.target === deleteDialog) cancelDeletion();
    });
    deleteDialog.querySelector<HTMLButtonElement>('[data-community-delete-cancel]')?.addEventListener('click', cancelDeletion);
    deleteDialog.querySelector<HTMLButtonElement>('[data-community-delete-confirm]')?.addEventListener('click', async () => {
      const pending = pendingRecommendationDeletion;
      if (!pending || submitting) return;
      const { recommendationId, entryId, published } = pending;
      pendingRecommendationDeletion = null;
      submitting = true;
      deletingRecommendationId = recommendationId;
      highlightedWaitlistId = entryId;
      notice = null;
      render();
      try {
        await pb.collection('community_recommendations').delete(recommendationId);
        recommendations = recommendations.filter((recommendation) => recommendation.id !== recommendationId);
        communityLoaded = false;
        const catalogueRefresh = refreshCatalogue()
          .then((venues) => {
            knownVenues = venues;
          })
          .catch(() => {
            // The member ledger can still reflect the deletion while discovery
            // data is temporarily unavailable.
          });
        await Promise.all([loadCommunity(render), catalogueRefresh]);
        notice = {
          kind: 'success',
          text: published
            ? 'Your recommendation was deleted. The place remains live without your note, photo or attribution.'
            : 'Your recommendation was deleted.',
        };
        focusWaitlistEntry(entryId);
      } catch (error) {
        notice = { kind: 'error', text: readableError(error, 'Your recommendation could not be deleted. Please try again.') };
      } finally {
        submitting = false;
        deletingRecommendationId = '';
        render();
      }
    });
    if (!deleteDialog.open) {
      deleteDialog.showModal();
      deleteDialog.querySelector<HTMLElement>('#delete-recommendation-title')?.focus({ preventScroll: true });
    }
  }

  root.querySelectorAll<HTMLFormElement>('[data-community-share]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const waitlist = form.dataset.waitlist || '';
      const selected = directoryState(`share-${waitlist}`).selected;
      if (!selected) {
        notice = { kind: 'error', text: 'Search for a member and choose their pseudo before sharing this food-and-drink destination.' };
        render();
        return;
      }
      const values = new FormData(form);
      submitting = true;
      notice = null;
      render();
      try {
        await pb.collection('community_shares').create({
          waitlist,
          recipient: selected.id,
          personal_note: String(values.get('personal_note') || '').trim(),
        });
        directories.delete(`share-${waitlist}`);
        notice = { kind: 'success', text: `Shared with ${pseudoLabel(selected.pseudo)}.` };
        communityLoaded = false;
        await loadCommunity(render);
      } catch (error) {
        notice = { kind: 'error', text: readableError(error, 'That share could not be sent. Check the recipient and note, then try again.') };
      } finally {
        submitting = false;
        render();
      }
    });
  });

  root.querySelector<HTMLFormElement>('[data-community-share-place]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const selected = directoryState('share-place').selected;
    if (!selected) {
      notice = { kind: 'error', text: 'Search for a member and choose their pseudo before sharing a food-and-drink destination.' };
      render();
      return;
    }
    const values = new FormData(event.currentTarget as HTMLFormElement);
    const place = String(values.get('place') || '').trim();
    const city = String(values.get('city') || '').trim();
    const country = String(values.get('country') || '').trim();
    const address = String(values.get('address') || '').trim();
    const note = String(values.get('personal_note') || '').trim();
    const venue = matchVenue(place, city);
    if (!venue && (!city || !country || !address)) {
      notice = { kind: 'error', text: 'That food-and-drink destination is not in the list yet — add its address, city, and country to share it.' };
      render();
      return;
    }
    submitting = true;
    notice = null;
    render();
    try {
      await pb.collection('community_shares').create(
        venue
          ? { venue: venue.id, recipient: selected.id, personal_note: note }
          : { venue_name: place, address, city, country, recipient: selected.id, personal_note: note }
      );
      directories.delete('share-place');
      // Sent: the panel returns to the deck, where the new share is listed.
      shareFormOpen = false;
      notice = { kind: 'success', text: `Shared with ${pseudoLabel(selected.pseudo)}.` };
      communityLoaded = false;
      await loadCommunity(render);
    } catch (error) {
      notice = { kind: 'error', text: readableError(error, 'That share could not be sent. Check the details and try again.') };
    } finally {
      submitting = false;
      render();
    }
  });

  bindDirectories(root);

  // A CTA that says Recommend or Share privately has to land on the form, not
  // merely on the tab that holds it. The form is below the ledger, so the first
  // settled render after such a route scrolls to it and puts the cursor in it.
  // It waits for the ledger to finish loading, because that render replaces the
  // panel and would drop the focus again.
  if (pendingFormReveal && member() && communityLoaded && !loadingCommunity) {
    const selector =
      pendingFormReveal === 'share' ? '[data-community-share-place]' : '[data-community-recommendation]';
    pendingFormReveal = null;
    window.requestAnimationFrame(() => {
      const form = document.querySelector<HTMLElement>(selector);
      if (!form) return;
      form.scrollIntoView({ block: 'center' });
      form.querySelector<HTMLElement>('input, textarea')?.focus({ preventScroll: true });
    });
  }

  if (member() && !communityLoaded && !loadingCommunity) {
    void loadCommunity(render).then(() => {
      if (memberTab === 'detours' && detourTab === 'shares') void markIncomingSharesSeen();
      if (recommendationIntent === 'edit' && recommendationDraft) {
        const entry = entryForVenue(recommendationDraft);
        if (entry) focusWaitlistEntry(entry.id);
      }
    });
  }
  if (member() && !invitesLoaded && !loadingInvites) void loadInvites(render);
  if (member() && foundingMember && memberTab === 'curation' && !curationLoaded && !loadingCuration) {
    void loadCuration(render);
  }
  if (member() && foundingMember && memberTab === 'curation' && !coverlessLoaded && !loadingCoverless) {
    void loadCoverless(render);
  }
}
