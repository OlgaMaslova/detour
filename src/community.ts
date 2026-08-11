import { pb } from './pocketbase';
import {
  bindMemberShares,
  groupedRecommendationCardMarkup,
  markNetworkSharesSeen,
  memberSharesMarkup,
  networkPlaceNotes,
  recommendationColumnCount,
  resetNetworkDiscovery,
} from './network';
import type { DiscoveryRecommendation, NetworkPlaceResolver } from './network';
// Type only, deliberately: circle.ts imports this module, and a value import back
// would close the loop. The circle's own data arrives through the setter below,
// pushed by main.ts, which is where cross-module wiring lives.
import type { CircleRecipientGroup } from './circle';
import type { PlacePrompt } from './place-prompt';
import { adoptFollowUpCard, readFollowUpCard, resetFollowUp } from './follow-up';
import { adoptTriageCard, readTriageCard, resetTriage } from './triage';
import type { Venue } from './data';
import { OCCASION_OPTIONS } from './occasions';
import { citySlug } from './slugs';
import { ENDORSE_LABEL } from './signal';
import { bindInviteShare, inviteShareMenuMarkup } from './share';
import { siteOrigin } from './site';
import {
  ensureSavedPlaces,
  refreshSavedPlaces,
  resetSavedPlaces,
  isSavedPlace,
  savedPlaces,
  savedPlacesLoaded,
  savePlaceFailure,
  savingPlace,
  toggleSavedPlace,
} from './saved';
import {
  cancelImport,
  closeImportDialog,
  ensureGuides,
  importDialogOpen,
  importDraft,
  importFailure,
  importKeeping,
  importReading,
  guides,
  guidesLoaded,
  allImportedPlaces,
  destinationBoardHref,
  importedCoverHref,
  guideHref,
  importedPlaceSourceLabel,
  guideAuthorLabel,
  importedVenueIds,
  keepImportDraft,
  openImportDialog,
  privatePlaceHref,
  readListLink,
  removeGuide,
  removeImportedPlace,
  removingImported,
  resetGuides,
  setAllDraftPlaces,
  setDraftCity,
  setDraftTitle,
  toggleDraftPlace,
} from './guides';
import type { ImportDraft, Guide, ImportedPlace } from './guides';
import { getTokenPayload, isTokenExpired } from 'pocketbase';
import type { RecordModel } from 'pocketbase';

/**
 * The three doors into Detour.
 *
 * `sign-in` for an account that exists. `sign-up` is the open one — no code, no
 * queue, and it starts a circle rather than joining one. `join` spends an
 * invitation and puts the new member inside the issuer's circle.
 *
 * The two signup doors differ in exactly one field, and it is the one that
 * matters: the invitation code, which is the graph edge. Everything else about
 * the account is identical, which is why one submit path serves both.
 *
 * `forgot` and `reset` are the two halves of the way back in when the password is
 * gone: the first asks for the email and sends the link, the second is what that
 * link opens. They are modes of the same card rather than pages of their own
 * because a member who cannot get in is looking at this card already, and the way
 * out of either one is the sign-in tab that is right there.
 */
type CommunityMode = 'sign-in' | 'sign-up' | 'join' | 'forgot' | 'reset';
/**
 * The member area's own tabs. My detours is NOT among them: it is the signed-in
 * landing now (docs/landing-spec.md), so listing it here too would give one
 * surface two homes and a member two places to look for their own places.
 * Everything left is account business — who they can invite, how they appear,
 * and the founding circle's review queue.
 */
type MemberTab = 'invitations' | 'settings' | 'curation';
type DetourTab = 'recommendations' | 'saved' | 'endorsements' | 'shares';
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
  /** The issuer's own note on who this was sent to — never read server-side. */
  hint?: string;
  /** Snapshot of the claiming member's pseudo, taken at redemption. */
  claimed_pseudo?: string;
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
  /**
   * Whether the cursor is in the field. The suggestions — the circle, the search
   * results, the hint — are a dropdown, so they exist only while it is, and they
   * overlay the form rather than pushing the note and the send button down the
   * page every time somebody clicks the recipient box.
   */
  focused: boolean;
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
  /** The kind of place they picked, '' when they left it unanswered. */
  category: string;
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
/**
 * How many places the ledger shows before "Show N more".
 *
 * Two full rows, whatever width the member picked — the same rule the feed
 * applies to its own preview. A flat number left the grid ending on a ragged
 * row: five cards at three-up is a row of three and a row of two with a hole in
 * it, which reads as something failing to load.
 */
function queuePreviewLimit(): number {
  return recommendationColumnCount() * 2;
}
const CATEGORY_OPTIONS = [
  ['restaurant', 'Restaurant'],
  ['ethnic_cuisine', 'Ethnic cuisine'],
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
/**
 * The email address on the sign-in card, kept for the same reason joinDraft is:
 * a refused sign-in renders a notice, and the render would otherwise wipe the
 * address along with the password the member got wrong.
 *
 * It is also the handover to the Forgot card. Somebody whose password has just
 * been refused has already typed the address the reset link has to go to, and
 * asking for it a second line down would read as a different question.
 */
let signInEmailDraft = '';
/**
 * The password-reset token from the emailed link, or null when this visit did not
 * arrive on one. Set from the route before the panel renders, like an invitation
 * code, and dropped from the URL as soon as it is spent or abandoned — it is a
 * credential, and it has no business in browser history or a shared link.
 */
let routedResetToken: string | null = null;
/**
 * Whether the reset email has just been sent. The Forgot card is done at that
 * point: the next step is in the member's inbox, and leaving the form up invites
 * a second send that only mints a second token and buys nothing.
 */
let resetEmailSent = false;
let memberTab: MemberTab = 'invitations';
let detourTab: DetourTab = 'recommendations';
// Whether the landing has already picked a tab, or the member has picked one
// themselves. Either way the landing stops choosing — see settleLandingTab.
let detourTabChosen = false;
/**
 * Which place's edit form is open, if any. One at a time.
 *
 * Explicit state rather than a <details> holding it in the DOM. Editing takes
 * the whole card over — the form is full width and the Edit/Delete strip goes
 * away while it is up — and a disclosure cannot express that: its summary is the
 * control, so hiding the control would hide the way back out. This also means an
 * open form survives a re-render, which the disclosure never did.
 */
let editingEntryId = '';
/**
 * The place whose mark is being withdrawn, and the server's sentence if it
 * refused. One at a time, like the recommendation deletion beside it.
 */
let withdrawingEndorsementId = '';
let endorsementFailure = new Map<string, string>();
// How a place name becomes a link to its own page. Owned by main.ts, which holds
// the catalogue; passed in rather than rebuilt here so a card in My detours
// resolves exactly as the same card does in the feed.
//
// SET EVERY RENDER, from main.ts — see `setPlaceResolver`. It used to be set only
// by `landingPanel`, so whether a card was a link depended on whether the member
// had passed through My detours earlier in the session: the city page's cards
// opened fine after a click through home and were dead text on a cold load of
// the same address, which is not a state any page should be able to be in.
let landingPlaceResolver: NetworkPlaceResolver | undefined;
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
// The member's circle, offered by the share pickers as somewhere to send it.
// Pushed in rather than read, so this module never imports circle.ts back.
let circleRecipients: CircleRecipientGroup[] = [];
let circleRecipientsLoading = false;
// The place a route intent already named — a place page's Share item. Held
// as the string the form's own matcher understands rather than an id, because the
// field is a free-text one: a member may still edit it into somewhere off the
// list, and prefilling it must not take that away.
let sharePlacePrefill = '';
/**
 * A name and city carried into the empty recommendation form.
 *
 * The place-page path uses `recommendationDraft`, which is a catalogue `Venue`
 * and carries an id, an address and a published row behind it. A private
 * imported place has none of those — it is two strings — so it prefills the
 * free-form fields instead and everything else is typed as usual. Cleared
 * whenever the form closes, so a second visit to Add new is empty.
 */
const newPlacePrefill = { name: '', city: '' };
let notice: Notice | null = null;
let knownVenues: Venue[] = [];
let waitlistEntries: WaitlistEntry[] = [];
let recommendations: RecommendationRecord[] = [];
let waitlistEntriesLoaded = false;
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
/**
 * The list a member has asked to remove, held while they answer for its places.
 *
 * Wanna go's own Remove takes no confirmation and should not — it is one
 * bookmark. This is up to a hundred places in one tap and is not undoable, and
 * "Remove guide" honestly reads two ways: drop the whole thing, or drop the
 * heading and keep what was under it. Both are things a member might mean, so
 * both are offered rather than one being guessed at.
 */
let pendingGuideRemoval: { id: string; title: string; total: number; shared: number } | null = null;
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
// Which rung of the first-place ask this member is due, and the facts it needs,
// as the server settled them. Null when there is nothing to ask — which is the
// normal case: it wants a member who came back and has never added a place.
let memberPlacePromptState: PlacePrompt | null = null;
// Whether this member may offer one of the fifty founding seats with an
// invitation. The Founder alone, as the server decides it — every other member's
// invitations are ordinary, and they are never shown the choice.
let canGrantFounding = false;
// Whether the next invitation created here offers a founding seat. Deliberately
// resets to off after every issue: a founding invitation is the exception, and a
// toggle left on would spend the fifty by inattention.
let inviteGrantsFounding = false;
// Who the next invitation is for, in the issuer's own words. Held here rather
// than only in the DOM because loadInvites can re-render this panel — see
// joinDraft above — while a member is still typing it.
let inviteHintDraft = '';
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
    ? ['invitations', 'curation', 'settings']
    : ['invitations', 'settings'];
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

/**
 * Only what the server itself said. The SDK writes its own placeholder into
 * `error.message` when nothing answered at all — "Something went wrong." — which
 * says less than the fallback and does not tell anyone to try again.
 */
function readableError(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    const response = error as {
      response?: { message?: string; data?: Record<string, { message?: string }> };
    };
    const fieldError = response.response?.data
      ? Object.values(response.response.data).find((value) => value?.message)?.message
      : undefined;
    return fieldError || response.response?.message || fallback;
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

export interface PlaceLinkReading {
  resolved?: boolean;
  name?: string;
  city?: string;
  country?: string;
  address?: string;
  lat?: number | null;
  lng?: number | null;
}

/**
 * What the server could read out of a pasted map link.
 *
 * Shared by both places a recommendation gets written — the onboarding question
 * and the recommend form — so there is one description of what a link means. An
 * unreadable link is not an error here either: the route answers 200 with
 * `resolved: false` and this returns null, which every caller treats as "leave
 * what they typed alone".
 */
export async function readPlaceLink(url: string): Promise<PlaceLinkReading | null> {
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const result = (await pb.send('/api/detour/place-link', {
      method: 'POST',
      body: { url: trimmed },
      requestKey: null,
    })) as PlaceLinkReading;
    if (!result?.resolved) return null;
    if (!result.name && !result.city) return null;
    return result;
  } catch {
    return null;
  }
}

/**
 * The optional link field, above the two fields it fills.
 *
 * It sits first because it is the shortcut past them, and it is labelled
 * optional in the same voice as the photo picker because ignoring it costs
 * nothing — the fields below work exactly as they always have.
 */
function mapLinkField(): string {
  // The street and country ride along hidden, because they are facts about the
  // place rather than answers the member owes: the create hook already accepts
  // both and hands them to the geocoder that validates them. Asking for them
  // would be asking someone to type what their phone just told us.
  return `<label class="community-link-field">Paste a map link <span class="community-optional">Optional — fills in the name and city</span>
      <input name="map_link" type="url" inputmode="url" autocomplete="off" spellcheck="false" maxlength="2048" placeholder="Share from Maps and paste it here">
    </label>
    <input type="hidden" name="address" value="">
    <input type="hidden" name="country" value="">
    <p class="community-form-note" data-map-link-status role="status"></p>`;
}

/**
 * Wires the link field to the name and city inputs beside it.
 *
 * Writes to the DOM rather than through a render, because this form holds its
 * values in the DOM and is not re-rendered while it is being filled in — going
 * through state would wipe the note mid-sentence. Nothing here can block the
 * form: the failure path writes a sentence into the status line and stops.
 */
function bindMapLinkField(form: HTMLElement): void {
  const field = form.querySelector<HTMLInputElement>('input[name="map_link"]');
  if (!field) return;
  const status = form.querySelector<HTMLElement>('[data-map-link-status]');
  const nameInput = form.querySelector<HTMLInputElement>('input[name="venue_name"]');
  const cityInput = form.querySelector<HTMLInputElement>('input[name="city"]');
  let reading = false;
  let lastRead = '';

  const say = (text: string): void => {
    if (status) status.textContent = text;
  };

  const read = async (): Promise<void> => {
    const url = field.value.trim();
    if (!url || reading || url === lastRead) return;
    reading = true;
    lastRead = url;
    field.disabled = true;
    say('Reading the link…');
    const result = await readPlaceLink(url);
    field.disabled = false;
    reading = false;
    if (!result) {
      say('That link did not name a place. Type the name instead — it works just as well.');
      field.focus();
      return;
    }
    const previousName = nameInput?.value.trim() || '';
    if (result.name && nameInput) nameInput.value = result.name;
    if (result.city && cityInput) cityInput.value = result.city;
    // Hidden facts are replaced wholesale, including being cleared: a second
    // link must never leave the first place's street attached to this one.
    const hidden = (name: string): HTMLInputElement | null =>
      form.querySelector<HTMLInputElement>(`input[type="hidden"][name="${name}"]`);
    const addressInput = hidden('address');
    const countryInput = hidden('country');
    if (addressInput) addressInput.value = result.address || '';
    if (countryInput) countryInput.value = result.country || '';
    const filled = [nameInput?.value || '', cityInput?.value || ''].filter(Boolean).join(', ');
    say(
      previousName && result.name && previousName !== result.name
        ? `From the link: ${filled}. It replaced "${previousName}" — change it back if that was the right one.`
        : `From the link: ${filled}. Change either if it is not what you call it.`
    );
    field.value = '';
    // The note is the only thing left that nobody else can write.
    form.querySelector<HTMLTextAreaElement>('textarea[name="note"]')?.focus();
  };

  field.addEventListener('paste', (event) => {
    const pasted = event.clipboardData?.getData('text') || '';
    if (!pasted.trim()) return;
    field.value = pasted.trim();
    event.preventDefault();
    void read();
  });
  field.addEventListener('change', () => void read());
  field.addEventListener('blur', () => void read());
  // Enter reads the link rather than submitting a form whose note is still empty.
  field.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void read();
  });
}

/**
 * The category select, shared by the recommend form and the entry's own edit
 * form so both offer the same list in the same words.
 *
 * Optional in both. A member with nothing to pick is never held up, and the
 * enrichment passes still fill a blank one from the place itself — the field is
 * here because the member standing in the place is the one who knows, not
 * because the record needs them to answer.
 */
function categoryField(selected = ''): string {
  const options = CATEGORY_OPTIONS.map(
    ([value, label]) => `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`
  ).join('');
  return `<label>Category <span class="community-optional">Optional</span><select name="category"><option value=""${
    selected ? '' : ' selected'
  }>Choose one</option>${options}</select></label>`;
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

/**
 * Removing a list: what happens to the places that came in on it.
 *
 * Three outs rather than two, because "Remove guide" is genuinely ambiguous and
 * the destructive reading is the one a mis-tap would take. Places another list
 * still names are counted out of both answers — they survive either way, and
 * saying so stops the numbers looking like they disagree.
 */
function removeGuideDialogMarkup(): string {
  const pending = pendingGuideRemoval;
  if (!pending) return '';
  const exclusive = Math.max(0, pending.total - pending.shared);
  const busy = removingImported(pending.id);
  return `<dialog class="community-confirm-dialog" data-guide-remove-dialog aria-labelledby="remove-guide-title" aria-describedby="remove-guide-description">
    <div class="community-confirm-sheet">
      <p class="community-confirm-kicker">Remove a guide</p>
      <h2 id="remove-guide-title" tabindex="-1">Remove “${esc(pending.title)}”?</h2>
      <p id="remove-guide-description">${
        exclusive
          ? `${exclusive} place${exclusive === 1 ? '' : 's'} came in with this guide. You can drop them too, or keep them on your wishlist without the heading.`
          : 'Nothing came in with this guide that is not also on another one, so nothing will be lost.'
      }${
        pending.shared
          ? ` ${pending.shared} ${pending.shared === 1 ? 'is' : 'are'} also on another guide and will be kept either way.`
          : ''
      }</p>
      <div class="community-confirm-actions">
        <button class="secondary-button" type="button" data-guide-remove-cancel ${busy ? 'disabled' : ''}>Cancel</button>
        ${
          exclusive
            ? `<button class="secondary-button" type="button" data-guide-remove-keep ${busy ? 'disabled' : ''}>Keep the places</button>`
            : ''
        }
        <button class="community-danger" type="button" data-guide-remove-confirm ${busy ? 'disabled' : ''}>${
          busy ? 'Removing…' : exclusive ? 'Remove guide and places' : 'Remove guide'
        }</button>
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

function clearInvitationRoute(): void {
  invitationCodePrefill = '';
  routedInvitationCode = null;
  const url = new URL(window.location.href);
  if (!url.searchParams.has('invite')) return;
  url.searchParams.delete('invite');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

/**
 * Forget the reset token, and take it off the address bar.
 *
 * Called when the token has been spent and when the member walks away from the
 * card, which are the same requirement: a token in the URL is a credential
 * sitting in history, in the tab title's share sheet, and in whatever the member
 * pastes next. It stays exactly as long as the card that needs it.
 */
function clearPasswordResetRoute(): void {
  routedResetToken = null;
  const url = new URL(window.location.href);
  if (!url.searchParams.has('reset')) return;
  url.searchParams.delete('reset');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

/**
 * The address a reset token was minted for, or '' when the token does not say.
 *
 * PocketBase's confirm call hands back no session — it only changes the password —
 * so signing the member in afterwards needs an identity, and the only one on hand
 * is the claim inside the token they arrived with. Read defensively: a token this
 * function cannot make sense of costs the automatic sign-in, not the reset.
 */
function emailFromResetToken(token: string): string {
  try {
    const email = getTokenPayload(token).email;
    return typeof email === 'string' ? email.trim() : '';
  } catch {
    return '';
  }
}

function directoryState(key: string): DirectoryState {
  let state = directories.get(key);
  if (!state) {
    state = { query: '', selected: null, items: [], loading: false, error: '', activeIndex: -1, timer: null, focused: false };
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

/**
 * The circle, in the slot the search results will occupy.
 *
 * What the field offers before anything is typed. It used to be the sentence
 * "Type a pseudo, such as anna-lisboa" — accurate, and useless: a member knows who
 * they want to send a place to as a person, not as a handle they can spell. Nearly
 * every share goes to somebody in here, so the people come first and the search
 * stays for everyone else.
 *
 * Not a popup. The input is a combobox with a listbox of its own for search
 * results, and a second overlay opening from the same field would fight it — so
 * this list sits in that same slot and is simply what is there first. Bands are
 * named on the rows rather than as headings, because "your inviter" is usually one
 * person and three headings over four names is furniture.
 *
 * Plain buttons, not options: these are shortcuts into a search, not the
 * combobox's own popup, and each still resolves through the directory when
 * pressed. Giving them listbox semantics would put two listboxes on one
 * aria-controls and break the activedescendant contract the arrow keys rely on.
 */
function circleRecipientsMarkup(): string {
  const hint = 'Or type any member’s pseudo, such as anna-lisboa.';
  if (!circleRecipients.length) {
    return `<p class="member-directory-hint">${
      circleRecipientsLoading
        ? 'Reading your circle… meanwhile, type a pseudo, such as anna-lisboa.'
        : 'Type a pseudo, such as anna-lisboa — at least two characters.'
    }</p>`;
  }
  const rows = circleRecipients
    .map((group) =>
      group.names
        // The label form travels in the attribute as well, so the exact-match test
        // in lookupPseudo compares the same string the row shows.
        .map((name) => pseudoLabel(name))
        .map(
          (name) =>
            `<li><button type="button" data-circle-recipient="${esc(name)}" aria-label="${esc(
              `Share with ${pseudoLabel(name)} — ${group.label.toLowerCase()}`
            )}"><span class="member-directory-circle-name">${esc(
              pseudoLabel(name)
            )}</span><span class="member-directory-circle-band">${esc(group.label)}</span></button></li>`
        )
        .join('')
    )
    .join('');
  return `<div class="member-directory-circle">
    <p class="member-directory-circle-label" aria-hidden="true">Your circle</p>
    <ul class="member-directory-circle-list" aria-label="Your circle">${rows}</ul>
    <p class="member-directory-hint">${hint}</p>
  </div>`;
}

/**
 * What sits under the recipient field.
 *
 * Two different things, and the difference is what stays put. A chosen member is
 * the field's answer, so it is stated in the flow and stays there — leaving the
 * field must never quietly withdraw the sentence naming who the share is going
 * to. Everything else is a suggestion, and suggestions are a dropdown: they open
 * on focus, close when the cursor leaves, and overlay the form rather than
 * shoving the note field down the page each time the box is clicked.
 */
function directoryResultsMarkup(key: string): string {
  const state = directoryState(key);
  if (state.selected) {
    return `<p class="member-directory-selected"><span>Selected</span><strong>${esc(pseudoLabel(state.selected.pseudo))}</strong></p>`;
  }
  if (!state.focused) return '';
  return `<div class="member-directory-panel">${directorySuggestionsMarkup(key)}</div>`;
}

function directorySuggestionsMarkup(key: string): string {
  const state = directoryState(key);
  if (state.query.trim().length < 2) return circleRecipientsMarkup();
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
      <input type="search" value="${esc(state.query)}" autocomplete="off" spellcheck="false" placeholder="anna-lisboa" role="combobox" aria-autocomplete="list" aria-expanded="${state.items.length > 0}" aria-controls="${listId}" ${state.activeIndex >= 0 ? `aria-activedescendant="${listId}-option-${state.activeIndex}"` : ''} data-member-search>
    </label>
    <div id="${listId}" class="member-directory-output" data-member-results>${directoryResultsMarkup(key)}</div>
  </div>`;
}

/**
 * The account fields both signup doors ask for, in the same order and with the
 * same rules. Written once so the open form and the invitation card cannot drift
 * into asking for a pseudo two different ways.
 */
function accountFieldsMarkup(): string {
  return `<label>Email address<input name="email" type="email" value="${esc(joinDraft.email)}" autocomplete="email" required ${submitting ? 'disabled' : ''}></label>
    <label>Password<input name="password" type="password" autocomplete="new-password" minlength="8" required ${submitting ? 'disabled' : ''}></label>
    <p class="community-form-note">Eight characters or more. This is how you sign in from now on.</p>
    <label>Your pseudo<input name="pseudo" value="${esc(joinDraft.pseudo)}" autocomplete="off" spellcheck="false" minlength="3" maxlength="30"
      pattern="@?[a-zA-Z0-9][a-zA-Z0-9-]{1,28}[a-zA-Z0-9]" title="3-30 characters: letters, digits, and hyphens"
      required placeholder="anna-lisboa" ${submitting ? 'disabled' : ''}></label>
    <label>Where you live<input name="home_city" value="${esc(joinDraft.city)}" autocomplete="address-level2" minlength="2" maxlength="120"
      required placeholder="San Francisco" ${submitting ? 'disabled' : ''}></label>
    <p class="community-form-note">Your pseudo is your name on Detour. Your city is where the circle sees you recommending from.</p>`;
}

function signedOutPanel(): string {
  const isJoin = mode === 'join';
  const isSignUp = mode === 'sign-up';
  const isForgot = mode === 'forgot';
  const isReset = mode === 'reset';
  // A token that is missing, malformed or past its half hour cannot be spent, and
  // saying so before the member types a new password twice is the whole
  // difference between one wasted minute and two.
  const resetTokenUsable = Boolean(routedResetToken) && !isTokenExpired(routedResetToken || '');
  const heading = isJoin
    ? 'Join with your personal invitation.'
    : isSignUp
      ? 'Start your circle.'
      : isForgot
        ? 'Forgotten your password?'
        : isReset
          ? 'Choose a new password.'
          : 'Return to your Detour.';
  const lead = isJoin
    ? 'Everything your account needs, on one card. Then the first place you would send someone to.'
    : isSignUp
      ? 'Four things, no invitation, no waiting. You start with the founding members’ places, and the circle you build from there is your own.'
      : isForgot
        ? 'Give us the address you signed up with and we will email you a link to set a new one.'
        : isReset
          ? 'Eight characters or more, and it signs you in as soon as it is saved.'
          : 'Sign in to your member account.';
  const tab = (value: CommunityMode, label: string): string =>
    `<button class="community-tab ${mode === value ? 'is-active' : ''}" type="button" role="tab" aria-selected="${
      mode === value
    }" data-community-mode="${value}">${label}</button>`;
  return `<section class="community-panel community-panel-auth" aria-label="Detour membership">
    <div class="community-panel-intro">
      <p class="community-kicker">The detourist circle</p>
      <h2>${heading}</h2>
      <p>${lead}</p>
    </div>
    <div class="community-form-wrap">
      <div class="community-tabs" role="tablist" aria-label="Membership options">
        ${tab('sign-in', 'Sign in')}${tab('sign-up', 'Start your circle')}${tab('join', 'Use an invitation')}
      </div>
      ${noticeMarkup()}
      ${
        isJoin
          ? `<form class="community-form" data-community-join>
              ${accountFieldsMarkup()}
              <label>Invitation code<input name="invite_code" value="${esc(invitationCodePrefill)}" autocomplete="off" spellcheck="false" maxlength="80" placeholder="DTR-…" required ${submitting ? 'disabled' : ''}></label>
              <button class="primary-button" type="submit" ${submitting ? 'disabled' : ''}>${submitting ? 'Joining…' : 'Join Detour'}</button>
              <p class="community-form-note">Next: the first place you would send someone to.</p>
            </form>`
          : isSignUp
            ? `<form class="community-form" data-community-sign-up>
              ${accountFieldsMarkup()}
              <button class="primary-button" type="submit" ${submitting ? 'disabled' : ''}>${submitting ? 'Creating your account…' : 'Start your circle'}</button>
              <p class="community-form-note">You read Detour's founding members from the start. Everything you write reaches the people you invite — nobody else.</p>
              <p class="community-form-note">Next: the first place you would send someone to.</p>
            </form>`
          : isForgot
            ? resetEmailSent
              // The form has done its job, and the next step is in the member's
              // inbox. The same button again would be the wrong offer as well as a
              // redundant one: the server sends nothing at all for two minutes
              // after a link goes out, and a form that answers "sent!" while
              // sending nothing is worse than no form.
              ? `<div class="community-form">
              <p class="community-form-note">The link is good for thirty minutes. If it has not arrived, check the spam folder — a second attempt in the next couple of minutes sends nothing.</p>
              <button class="secondary-button" type="button" data-community-mode="sign-in">Back to sign in</button>
            </div>`
              : `<form class="community-form" data-community-forgot>
              <label>Email address<input name="email" type="email" value="${esc(signInEmailDraft)}" autocomplete="email" required ${submitting ? 'disabled' : ''}></label>
              <button class="primary-button" type="submit" ${submitting ? 'disabled' : ''}>${submitting ? 'Sending…' : 'Email me a reset link'}</button>
              <p class="community-form-note">The link lets you choose a new password. It is good for thirty minutes, and nothing changes until you use it.</p>
            </form>`
          : isReset
            ? resetTokenUsable
              ? `<form class="community-form" data-community-reset>
              <label>New password<input name="password" type="password" autocomplete="new-password" minlength="8" required ${submitting ? 'disabled' : ''}></label>
              <label>Repeat it<input name="passwordConfirm" type="password" autocomplete="new-password" minlength="8" required ${submitting ? 'disabled' : ''}></label>
              <button class="primary-button" type="submit" ${submitting ? 'disabled' : ''}>${submitting ? 'Saving…' : 'Set my new password'}</button>
              <p class="community-form-note">Saving it signs you in here and signs out anywhere else you were still signed in.</p>
            </form>`
              : `<div class="community-form">
              <p class="community-form-note">That reset link has expired or been used already. Links last thirty minutes; asking for another takes a moment.</p>
              <button class="secondary-button" type="button" data-community-mode="forgot">Ask for a new link</button>
            </div>`
          : `<form class="community-form" data-community-sign-in>
              <label>Email address<input name="email" type="email" value="${esc(signInEmailDraft)}" autocomplete="email" required></label>
              <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
              <button class="primary-button" type="submit" ${submitting ? 'disabled' : ''}>${submitting ? 'Signing in…' : 'Sign in'}</button>
              <p class="community-form-note">Forgotten it? <button class="community-form-link" type="button" data-community-mode="forgot">Email me a reset link</button></p>
              <p class="community-form-note">New here? Start your circle, or use an invitation if somebody sent you one.</p>
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
        ${categoryField(selectedCategory)}
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
        <div class="community-form-actions">
          <button class="primary-button" type="submit" ${submitting ? 'disabled' : ''}>${submitting && !deletingRecommendationId ? 'Saving…' : 'Save changes'}</button>
          <!-- Leaving the form is one decision with two answers, so Cancel sits
               on the same row as Save rather than below it. It closes the
               disclosure and nothing else: the fields keep whatever was typed
               until the next render, and no edit is written. -->
          <button class="secondary-button" type="button" data-entry-edit-cancel="${esc(entry.id)}" ${submitting ? 'disabled' : ''}>Cancel</button>
        </div>
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
  // The name and the address are the card's to state now, not the row's.
  // A just-saved or just-deleted entry is marked and focused, never expanded:
  // opening its pre-filled Edit form would read as an edit the member did not
  // ask for.
  const highlighted = highlightedWaitlistId === entry.id;
  // NO OPEN CONTROL. The card's own title is the link to the place page, the
  // same anchor every other card in the app carries, so a second one underneath
  // would be two ways to do one thing sitting a centimetre apart. A place with
  // no page yet says so instead — the strip still tells the truth about what is
  // live, which is the half of the old control that was carrying weight.
  const status = publishedVenue
    ? ''
    : `<span class="community-queue-status is-${statusClass}">${statusLabel}</span>`;
  const deleteAction = rec
    ? `<button class="community-queue-delete" type="button" data-community-delete-recommendation="${esc(rec.id)}" data-waitlist="${esc(entry.id)}" data-place-name="${esc(entry.venue_name || '')}" data-published="${published ? 'true' : 'false'}" ${submitting ? 'disabled' : ''}>${deletingRecommendationId === rec.id ? 'Deleting…' : 'Delete'}</button>`
    : '';
  const trailing = `<div class="community-queue-actions">${deleteAction}${status}</div>`;
  const publicationNote = published
    ? publishedVenue
      ? ''
      : '<p class="community-queue-context">Not available to open in discovery yet.</p>'
    : rec
      ? '<p class="community-queue-context">Your recommendation is saved, but this place is not live yet.</p>'
      : '<p class="community-queue-context">This entry has no recommendation note, so it is not publishable yet.</p>';
  // Editing takes the card over. The strip is the card's footer while the place
  // is just sitting there; the moment the member opens the form it is replaced
  // by the form, full width, because Edit and Delete are then two ways to leave
  // a job half done next to the Save and Cancel that actually finish it.
  const editing = activeEditEntryId() === entry.id;
  const strip = `<div class="community-queue-bar">
      <button class="community-queue-edit" type="button" data-entry-edit="${esc(entry.id)}" aria-expanded="false" ${submitting ? 'disabled' : ''}>Edit</button>
      ${trailing}
    </div>`;
  const body = `<div class="community-queue-bar community-queue-bar-editing">
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
    </div>`;
  return `<li class="community-queue-row${highlighted ? ' is-highlighted' : ''}${editing ? ' is-editing' : ''}" id="waitlist-${esc(entry.id)}" tabindex="-1">
    ${entryCardMarkup(entry, rec)}
    ${editing ? body : strip}
  </li>`;
}

/**
 * One of the member's own places, as the same card the feed shows.
 *
 * Through `groupedRecommendationCardMarkup`, not a renderer of its own:
 * `AGENTS.md` fixes what a card is — one place, one representative note, one
 * byline, with the place page owning the complete list — and My detours showing
 * a member's own place in a different shape from everybody else's would make
 * their own list the odd one out on the one screen they open on.
 *
 * The card is built from what the member's own ledger holds rather than from the
 * circle feed, because this list includes places that have not published yet and
 * so are in no feed at all. Those render with everything the entry knows and the
 * status line beneath says why there is no page to open.
 */
function entryCardMarkup(entry: WaitlistEntry, rec: RecommendationRecord | undefined): string {
  return placeCardMarkup({
    name: entry.venue_name || 'Unnamed food-and-drink destination',
    city: entry.city || '',
    country: entry.country || '',
    // Reached only by an entry with no published note yet — nothing is in the
    // feed for it, because there is nothing for anybody else to see.
    fallback: {
      id: rec?.id || entry.id,
      is_own: true,
      founding_member: foundingMember,
      note: rec?.note || '',
      address: entry.address || '',
      // The entry's own `created` is deliberately not on WaitlistEntry, so an
      // entry with no note yet carries no date — and the card simply omits one
      // rather than inventing the day it was typed.
      created: rec?.created || '',
    },
    emptyNote: 'Not live yet, so nobody can see this one but you.',
  });
}

/**
 * ONE CARD BUILDER, FOR EVERY TAB.
 *
 * Recommendations, Been & loved and Wanna go are three lists of places, and a
 * place has to look the same on all of them — and the same as it does in the
 * feed, on a destination list and in Explore. There used to be two builders here
 * and it showed: one assembled a card out of the member's own ledger rows, which
 * carry no photo, while the other read the circle feed, which does. Same place,
 * two different cards, depending on which tab you were standing on.
 *
 * So every card is built the same way: find what the feed holds for this place
 * and hand it to `groupedRecommendationCardMarkup` — the one renderer `AGENTS.md`
 * allows — which then picks the fronting note, the byline and the cover exactly
 * as it does everywhere else. The place's photograph comes from a member's
 * recommendation rather than from the venue row, which is why a card built
 * without the feed had no picture on it while the place page had one.
 *
 * The fallback is for a place the feed has nothing visible on: an entry that has
 * not published, or a place saved from a private share whose recommender is
 * outside this member's circle. It names nobody and says what the card is.
 */
function placeCardMarkup(place: {
  name: string;
  city: string;
  country: string;
  fallback?: Partial<DiscoveryRecommendation>;
  emptyNote: string;
  /** An imported place's own private page, when it has one. */
  fallbackHref?: string;
  /** An imported place's hotlinked cover, used only if nothing better exists. */
  fallbackCoverHref?: string;
  /**
   * The publication to credit the fallback note to.
   *
   * DELIBERATELY NOT PASSED ON THE NOTES BRANCH. If a member has written about
   * this place, the words in the card are theirs and the byline is theirs — a
   * publication's name over a member's sentence would be a misattribution, and
   * the one that matters most.
   */
  fallbackByline?: string;
  /** Where the provenance chip leads — the guide this place came in on. */
  fallbackBylineHref?: string;
  /** Which door it came through, for the chip's own treatment. */
  fallbackBylineKind?: 'guide' | 'feed' | 'manual';
}): string {
  const options = {
    fallbackHref: place.fallbackHref,
    fallbackCoverHref: place.fallbackCoverHref,
  };
  // A place with visible notes is a catalogue place: it links to its own page and
  // wears a photograph somebody on Detour took, so the imported fallbacks are
  // handed over but will lose to both.
  const notes = notesForPlace(place.name, place.city);
  if (notes.length) return groupedRecommendationCardMarkup(notes, landingPlaceResolver, options);
  return groupedRecommendationCardMarkup(
    [
      {
        venue_name: place.name,
        city: place.city,
        country: place.country,
        note: '',
        ...(place.fallback || {}),
      },
    ],
    landingPlaceResolver,
    {
      ...options,
      emptyNote: place.emptyNote,
      byline: place.fallbackByline,
      bylineHref: place.fallbackBylineHref,
      bylineKind: place.fallbackBylineKind,
    }
  );
}

/**
 * Every visible note on one place, matched the way the place page matches them.
 *
 * By normalised name and city, because the circle feed does not carry a venue id
 * — see `projectRecommendation` in pb_hooks/main.pb.js. The normalisation has to
 * be the same one main.ts uses to resolve a place, or a card and its own place
 * page disagree about which rows belong to it.
 */
function notesForPlace(name: string, city: string): DiscoveryRecommendation[] {
  const wantedName = normalizePlaceText(name);
  const wantedCity = normalizePlaceText(city);
  if (!wantedName) return [];
  return networkPlaceNotes().filter((item) => {
    const note = item.note?.trim();
    const recommender = item.recommender_pseudo?.trim().replace(/^@+/, '');
    if (!note || (!item.is_own && !recommender)) return false;
    if (normalizePlaceText(item.venue_name || '') !== wantedName) return false;
    const itemCity = normalizePlaceText(item.city || '');
    return !itemCity || !wantedCity || itemCity === wantedCity;
  });
}

/** The same normalisation `normalizePlacePart` applies in main.ts. */
function normalizePlaceText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\u2019'`\u00b4]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[\u2010-\u2015]/g, ' ')
    .replace(/[.,/#!$%^*;:{}=\-_~()\[\]"?<>\\|+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

/**
 * Which place's edit form is open — the member's own list, and the pending
 * instruction from an Edit pressed somewhere else, resolved to the same thing.
 *
 * ONE EDIT SURFACE. "Edit" on a place page used to open a screen of its own: a
 * heading, a lead paragraph and a "View all recommendations" button, with no
 * Cancel — a second editor that looked nothing like the one on the member's own
 * card and could not be backed out of the same way. Now it points at the card,
 * which already knows how to open, save and cancel.
 *
 * Resolved here rather than written into state when the link is pressed, because
 * the link is pressed before the ledger has loaded: the venue is known and the
 * entry it belongs to is not. Read-only, so no render mutates state on the way
 * past.
 */
function activeEditEntryId(): string {
  if (editingEntryId) return editingEntryId;
  if (recommendationIntent !== 'edit' || !recommendationDraft) return '';
  return entryForVenue(recommendationDraft)?.id || '';
}

function recommendationPanel(): string {
  const draft = recommendationIntent === 'edit' ? null : recommendationDraft;
  // The ledger is still loading, so the place cannot be matched to a row yet.
  if (recommendationIntent === 'edit' && (loadingCommunity || !communityLoaded)) {
    return '<p class="community-loading" role="status">Loading your recommendation…</p>';
  }
  if (recommendationIntent === 'edit' && recommendationDraft && !activeEditEntryId()) {
    return `<p class="community-empty">Your recommendation for ${esc(
      recommendationDraft.name
    )} could not be matched to a place on your list.</p>`;
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
      : // A name, a city, what kind of place it is, your words, and your photo.
        // Everything else about a place — its street, its country, its
        // coordinates, its website and its Instagram — is found by the
        // enrichment passes from the name and the city alone, so asking a member
        // to type any of it only asked them to do work the server was going to
        // redo anyway. Category is the exception: it is one tap, the member
        // standing in the place is the one who knows, and it is what the lists
        // sort by. It stays optional, and what it is good for stays on the
        // entry's own line, where correcting it is one click and does not stand
        // between having something to say and saying it.
        `<form class="community-form" data-community-recommendation>
        ${mapLinkField()}
        <label>Food-and-drink destination name<input name="venue_name" maxlength="200" value="${esc(
          newPlacePrefill.name
        )}" required placeholder="A restaurant, café, bar, or other food-and-drink destination"></label>
        <label>City or locality<input name="city" maxlength="120" value="${esc(
          newPlacePrefill.city
        )}" required placeholder="City or locality"></label>
        ${categoryField()}
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
  // An empty ledger does NOT open the form. It shows the by-heart question and
  // Add new, the same control a full ledger shows — a form unrolled under a
  // question the member has not answered yet is a page of fields where a
  // sentence should be, and the answer slot above has already offered Add place.
  // The form opens when somebody asks for it: Add new, or a place carried in.
  const formOpen = Boolean(draft) || recommendationFormOpen;
  // No heading and no count above the cards. The tab is already labelled
  // "Recommendations" a few pixels up, so a second title said the same word
  // twice — and none of the sibling tabs carries one, so this was the odd tab
  // out. The count went with it: a landing that states how many places a member
  // has is a scoreboard, which is the one thing this screen must never become.
  return `<section class="community-ledger-section" aria-label="My recommendations">
    <div class="community-queue">
      <p class="community-form-note">Places you put your name behind.</p>
      ${
        loadingCommunity || !communityLoaded
          ? '<p class="community-loading" role="status">Loading…</p>'
          : waitlistEntries.length
            ? queueListMarkup()
            // Empty, this tab asks the question rather than describing the
            // absence — and it is the by-heart one the new-member flow opens
            // with, because it is the question people can actually answer. Add
            // new sits under it, unopened: the question comes first and the
            // fields only once the member has decided to answer.
            : '<p class="community-empty">Where do you keep going back to? Not the best one — the one you actually return to.</p>'
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
  const shown = queueExpanded ? waitlistEntries : waitlistEntries.slice(0, queuePreviewLimit());
  const hidden = waitlistEntries.length - shown.length;
  const toggle =
    hidden > 0
      ? `<button type="button" class="secondary-button community-queue-more" data-queue-toggle aria-expanded="false" aria-controls="community-queue-list">Show ${hidden} more</button>`
      : '';
  // A stack of cards, not a ruled list. `AGENTS.md` fixes what a card is and My
  // detours shows the member's own places in exactly that shape — the same one
  // the feed, the destination lists and Explore use — so their own list is not
  // the odd one out on the screen they open on. The container is a plain grid:
  // the cards carry the chrome, and a bordered box around bordered boxes reads
  // as a card inside a card.
  // The feed's own grid classes, and the feed's own column count: the member
  // picked 2 or 3 there and it is remembered, so their places lay out the same
  // way on both surfaces instead of the app holding two opinions about how wide
  // a card should be.
  const columns = recommendationColumnCount();
  return `<ul class="community-queue-cards network-entry-list network-recommendation-grid network-recommendation-grid-${columns}" id="community-queue-list">${shown
    .map(waitlistRow)
    .join('')}</ul>${toggle}`;
}

function formatDate(value: string | undefined): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(parsed);
}

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
  const byCombo = knownVenues.find((venue) => norm(`${venue.name} — ${venue.city}`) === input);
  if (byCombo) return byCombo;
  const byName = knownVenues.filter((venue) => norm(venue.name) === input);
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
    <datalist id="community-share-place-options">${knownVenues
      .map((venue) => `<option value="${esc(`${venue.name} — ${venue.city}`)}"></option>`)
      .join('')}</datalist>
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
  return `<section class="community-tab-panel community-invitation-panel" id="member-panel-invitations" role="tabpanel" aria-labelledby="member-tab-invitations" tabindex="0">
    <div class="community-invite-actions">
      <p class="community-invite-explainer">Your circle grows by personal invitation — create a link and send it to someone you trust. Whoever redeems it joins inside your circle, which is what an open signup cannot do for itself.</p>
      <div class="community-invite-row">
        <label class="community-invite-hint-field"><span>Who's this for? <small>(optional, just for you)</small></span><input type="text" data-invite-hint value="${esc(inviteHintDraft)}" maxlength="120" placeholder="e.g. Jane" ${submitting ? 'disabled' : ''}></label>
        ${
          canGrantFounding
            ? `<label class="community-switch community-invite-founding">
                <input type="checkbox" data-invite-founding ${inviteGrantsFounding ? 'checked' : ''} ${submitting ? 'disabled' : ''}>
                <span class="community-switch-track" aria-hidden="true"></span>
                <span class="community-switch-copy"><strong>Offer a founding seat</strong></span>
              </label>`
            : ''
        }
        <button class="secondary-button" type="button" data-community-invite ${submitting || !allowanceKnown || atLimit ? 'disabled' : ''}>${submitting ? 'Preparing…' : atLimit ? 'Invitation limit reached' : inviteGrantsFounding ? 'New founding invitation' : 'New invitation'}</button>
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
function endorsementsPanel(): string {
  const marked = knownVenues
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

/**
 * A grid of places, in the same cards the feed runs.
 *
 * Been & loved and Wanna go are lists of places, not of notes: neither rung has
 * the member write anything. They still belong in cards — a member's own screen
 * should not show a place in a different shape from every other surface in the
 * app — so they go through the shared renderer with a line saying what the card
 * is where a quote would otherwise sit.
 *
 * Private shares are the exception and stay a deck: a share is a message from a
 * named person with a reply thread on it, which is a correspondence rather than
 * a place, and the cassette deck already models it.
 */
function placeCardGrid(
  items: {
    venue?: Venue;
    name?: string;
    city?: string;
    country?: string;
    emptyNote: string;
    footer?: string;
    fallback?: Partial<DiscoveryRecommendation>;
    /** All four only ever set for imported places — see placeCardMarkup. */
    fallbackHref?: string;
    fallbackCoverHref?: string;
    fallbackByline?: string;
    fallbackBylineHref?: string;
    fallbackBylineKind?: 'guide' | 'feed' | 'manual';
    /** A state on the row around the card — dimming a skipped place, and no more. */
    rowClass?: string;
  }[]
): string {
  if (!items.length) return '';
  const columns = recommendationColumnCount();
  return `<ul class="community-queue-cards network-entry-list network-recommendation-grid network-recommendation-grid-${columns}">
    ${items
      .map(
        (item) => `<li class="community-queue-row${item.rowClass ? ` ${item.rowClass}` : ''}">
          ${placeCardMarkup({
            name: item.venue?.name || item.name || 'A place',
            city: item.venue?.city || item.city || '',
            country: item.venue?.country || item.country || '',
            emptyNote: item.emptyNote,
            fallback: item.fallback,
            fallbackHref: item.fallbackHref,
            fallbackCoverHref: item.fallbackCoverHref,
            fallbackByline: item.fallbackByline,
            fallbackBylineHref: item.fallbackBylineHref,
            fallbackBylineKind: item.fallbackBylineKind,
          })}
          ${item.footer || ''}
        </li>`
      )
      .join('')}
  </ul>`;
}

/**
 * Wanna go — the member's planning space, grouped into the cities it is about.
 *
 * NOT A FLAT LIST ANY MORE. It was one, and at two imported guides it became a
 * dump of fifty cards in no order a traveller could use. A wishlist is answered
 * city by city — that is the unit somebody plans in — so this is an index of
 * destinations and the places live on each destination's own page.
 *
 * Its own request, unlike Been & loved beside it, and for a reason that is the
 * whole feature: a mark can be read off the scoped catalogue payload because it
 * is scoped-public, and a save cannot, because nothing computed for anybody else
 * knows it exists. saved.ts holds what /api/detour/places/saved answered.
 *
 * Removal is offered here and takes no confirmation. This is the private,
 * reversible rung — a dialogue asking a member whether they are sure about a
 * bookmark is an insult, and the tab is where their own list is theirs to tidy.
 *
 * Newest first, deliberately, and nothing is ever aged out on the member's
 * behalf. A list that only grows risks becoming a graveyard, and sinking the dead
 * weight is a better answer than deleting somebody's intentions for them.
 */
/** Which door a place came through. `provenance.type` from the model. */
type WannaGoSource = 'all' | 'guide' | 'feed' | 'manual';

/** How many cards a destination shows while every city is on screen. */
const WANNA_GO_PREVIEW = 3;

/** The active destination filter: a slug, or 'all'. */
let wannaGoCity = 'all';
/** The active source filter. */
let wannaGoSource: WannaGoSource = 'all';
/** Destinations the member has expanded past the preview cap. */
const wannaGoShowAll = new Set<string>();

/** One city a member has places in, and how many. */
export interface WannaGoDestination {
  /** The city as first written, for display. */
  name: string;
  /** Route slug, and the grouping key everything else compares by. */
  slug: string;
  places: number;
  /** Guides that put at least one place in this city. */
  guides: Guide[];
}

/** The grouping key. One definition, so every surface agrees what a city is. */
function destinationSlugOf(city: string): string {
  return citySlug(city.trim() || 'Unplaced') || 'unplaced';
}

/**
 * The member's wishlist, grouped into the cities it is actually about.
 *
 * A DESTINATION IS DERIVED, NEVER DECLARED. There is no destination record and
 * no way to make one: a city appears because it holds a place and vanishes when
 * it holds none. Renaming one ("NYC trip in May") needs somewhere to keep the
 * name, and that is deliberately not built yet.
 *
 * BOTH DOORS, ONE GROUPING. An imported place and a place the member pressed
 * Wanna go on are the same kind of thing standing in the same city, so they are
 * counted together. Which door a place came through is a property of the place —
 * its provenance chip — not a reason to file it somewhere else.
 *
 * A place whose city is unknown groups under "Unplaced" rather than being
 * dropped: it is on the wishlist, and a member who cannot find it would
 * reasonably conclude the import lost it.
 */
/**
 * Tell this module how to turn a place's name into a link to its own page.
 *
 * Called by main.ts at the top of every render, because a card is a link on every
 * surface or it is a bug on one of them: the resolver needs the catalogue and the
 * routes, both of which live there, and a card's own markup cannot ask for it.
 */
export function setPlaceResolver(resolve: NetworkPlaceResolver | undefined): void {
  landingPlaceResolver = resolve;
}

export function wannaGoDestinations(): WannaGoDestination[] {
  const byKey = new Map<string, WannaGoDestination>();
  const add = (rawCity: string, guide?: Guide) => {
    const name = rawCity.trim() || 'Unplaced';
    const slug = destinationSlugOf(name);
    const found: WannaGoDestination =
      byKey.get(slug) || { name, slug, places: 0, guides: [] };
    found.places += 1;
    if (guide && !found.guides.some((entry) => entry.id === guide.id)) found.guides.push(guide);
    byKey.set(slug, found);
  };

  const guideOf = guideByPlaceId();
  for (const place of allImportedPlaces()) add(place.city, guideOf.get(place.id));

  // A save on a place an imported row already covers is the same place twice.
  const covered = importedVenueIds();
  for (const save of savedPlaces()) {
    if (covered.has(save.venue_id)) continue;
    add(save.city);
  }

  return [...byKey.values()].sort(
    (a, b) => b.places - a.places || a.name.localeCompare(b.name)
  );
}

/** The guide each imported place arrived on, when one still names it. */
function guideByPlaceId(): Map<string, Guide> {
  const guideOf = new Map<string, Guide>();
  for (const guide of guides()) {
    for (const place of guide.places) if (!guideOf.has(place.id)) guideOf.set(place.id, guide);
  }
  return guideOf;
}

/**
 * Where a place came from, as the chip states it.
 *
 * Three kinds and no fourth. A guide names the publication and links back to the
 * piece; the feed names the member whose note the place was read on; manual is
 * the member's own hand. An imported place whose guides have all been removed is
 * still guide-sourced — the piece wrote it, and losing the guide does not change
 * who did.
 */
function provenanceOf(
  place: { name: string; city: string },
  imported?: ImportedPlace,
  guide?: Guide
): { kind: 'guide' | 'feed' | 'manual'; label: string; href: string } {
  if (imported) {
    return guide
      ? { kind: 'guide', label: `Guide · ${guideAuthorLabel(guide)}`, href: guideHref(guide.id) }
      : { kind: 'guide', label: `Guide · ${importedPlaceSourceLabel(imported)}`, href: '' };
  }
  const author = notesForPlace(place.name, place.city).find(
    (note) => !note.is_own && note.recommender_pseudo?.trim()
  );
  if (author) {
    return {
      kind: 'feed',
      label: `Feed · via ${pseudoLabel(author.recommender_pseudo || '')}`,
      href: '',
    };
  }
  return { kind: 'manual', label: 'Added by you', href: '' };
}

/**
 * One destination's cards — imported and saved together, each wearing its own
 * provenance and filtered by the active source.
 *
 * The whole point of the model: an imported place and a place the member pressed
 * Wanna go on are the same kind of thing standing in the same city, so they sit
 * in one grid rather than in two sections divided by which door they came
 * through.
 */
function wannaGoDestinationCards(slug: string) {
  const guideOf = guideByPlaceId();
  const wanted = (kind: 'guide' | 'feed' | 'manual') =>
    wannaGoSource === 'all' || wannaGoSource === kind;

  const imported = wannaGoDestinationPlaces(slug)
    .map((place) => ({ place, provenance: provenanceOf(place, place, guideOf.get(place.id)) }))
    .filter((entry) => wanted(entry.provenance.kind))
    .map((entry) => importedPlaceCard(entry.place, entry.provenance));

  const covered = importedVenueIds();
  const saves = savedPlaces()
    .filter((place) => !covered.has(place.venue_id) && destinationSlugOf(place.city) === slug)
    .map((place) => {
      const venue = knownVenues.find((item) => item.id === place.venue_id);
      const name = place.venue_name || venue?.name || 'A place you saved';
      return { place, venue, name, provenance: provenanceOf({ name, city: place.city }) };
    })
    .filter((entry) => wanted(entry.provenance.kind))
    .map(({ place, venue, name, provenance }) => {
      const failure = savePlaceFailure(place.venue_id);
      const busy = savingPlace(place.venue_id);
      return {
        venue,
        name,
        city: place.city,
        country: place.country,
        emptyNote: 'On your wishlist. Nobody else can see it.',
        fallbackByline: provenance.label,
        fallbackBylineKind: provenance.kind,
        footer: `<div class="community-queue-bar community-queue-bar-single">
          <button class="community-queue-delete" type="button" data-saved-drop="${esc(
            place.venue_id
          )}" ${busy ? 'disabled' : ''} aria-label="${esc(
            `Remove ${name} from your wishlist`
          )}">${busy ? 'Removing…' : 'Remove'}</button>
          ${failure ? `<p class="community-form-error" role="alert">${esc(failure)}</p>` : ''}
        </div>`,
      };
    });

  return [...imported, ...saves];
}

// NO `wannaGoDestinationCardsMarkup`. The destination board used to be this
// tab's card grid on a page of its own; it is now a numbered list tied to a map
// — see `renderCity` and `wannaGoBoardPlaces`. The grid stays here,
// where the tab still shows a preview per city.

function savedPanel(): string {
  const loading = !savedPlacesLoaded() || !guidesLoaded();
  const destinations = wannaGoDestinations();
  if (loading) {
    return `<div class="community-saved-list">
      ${wannaGoIntroMarkup(destinations)}
      <p class="community-loading" role="status">Loading…</p>
    </div>`;
  }
  if (!destinations.length) {
    return `<div class="community-saved-list">
      ${wannaGoIntroMarkup(destinations)}
      <p class="community-empty">Nothing here yet. Open a place you mean to get to and press “Wanna go”, or paste a link to a guide you have been reading — nobody but you ever sees this.</p>
    </div>`;
  }

  // The destination filter narrows to one city; the source filter narrows by
  // which door a place came through. Both are views of the same set, never
  // different data.
  const shown = destinations.filter(
    (destination) => wannaGoCity === 'all' || destination.slug === wannaGoCity
  );
  const sections = shown
    .map((destination) => wannaGoSectionMarkup(destination, shown.length === 1))
    .filter(Boolean);

  return `<div class="community-saved-list">
    ${wannaGoIntroMarkup(destinations)}
    ${
      sections.length
        ? sections.join('')
        : '<p class="community-empty">Nothing on your wishlist matches that filter.</p>'
    }
  </div>`;
}

/**
 * The note, the filters, and the one way in.
 *
 * The chips are the whole navigation of this tab: a destination narrows the page
 * to one city, and the source filter answers "what did I import?" without giving
 * guides rows of their own. Counts are on the chips because a filter that does
 * not say how much it holds makes a member press it to find out.
 */
function wannaGoIntroMarkup(destinations: WannaGoDestination[]): string {
  const total = destinations.reduce((sum, destination) => sum + destination.places, 0);
  const cityChip = (slug: string, label: string, count: number) =>
    `<button class="wanna-chip${wannaGoCity === slug ? ' is-active' : ''}" type="button"
      data-wanna-city="${esc(slug)}" aria-pressed="${wannaGoCity === slug}">${esc(
      label
    )} <span aria-hidden="true">·</span> ${esc(String(count))}</button>`;
  return `<div class="wanna-intro">
    <p class="community-form-note">Your private planning space. Nobody else sees this.</p>
    <div class="wanna-controls">
      <div class="wanna-chips" role="group" aria-label="Filter your wishlist">
        ${cityChip('all', 'All', total)}
        ${destinations
          .map((destination) => cityChip(destination.slug, destination.name, destination.places))
          .join('')}
        <label class="wanna-source">
          <span class="visually-hidden">Filter by where a place came from</span>
          <select data-wanna-source>
            ${SOURCE_FILTERS.map(
              ([value, label]) =>
                `<option value="${esc(value)}"${
                  wannaGoSource === value ? ' selected' : ''
                }>${esc(label)}</option>`
            ).join('')}
          </select>
        </label>
      </div>
      <button class="primary-button wanna-add" type="button" data-import-open>Import Guide</button>
    </div>
  </div>`;
}

/** The source filter's options. `provenance.type`, plus the everything case. */
const SOURCE_FILTERS: readonly (readonly [WannaGoSource, string])[] = [
  ['all', 'Source: all'],
  ['guide', 'Source: guides'],
  ['feed', 'Source: the feed'],
  ['manual', 'Source: added by me'],
];

/**
 * One destination, inline: its heading, the guides that fed it, and its places.
 *
 * Capped while every city is on screen and uncapped once one is chosen, because
 * the two views answer different questions — "where am I going?" wants a glance
 * per city, "what is in New York?" wants the list. `Open map` leads to the
 * destination's own page, which is where the map lives; a map per section would
 * be four map instances on one tab — and, since Google bills per instance, four
 * charges for a screen nobody asked to see a map on.
 */
function wannaGoSectionMarkup(destination: WannaGoDestination, expanded: boolean): string {
  const cards = wannaGoDestinationCards(destination.slug);
  if (!cards.length) return '';
  const shown = expanded || wannaGoShowAll.has(destination.slug)
    ? cards
    : cards.slice(0, WANNA_GO_PREVIEW);
  const hidden = cards.length - shown.length;
  return `<section class="wanna-section" aria-labelledby="wanna-dest-${esc(destination.slug)}">
    <header class="wanna-section-head">
      <h3 id="wanna-dest-${esc(destination.slug)}">${esc(destination.name)}</h3>
      <p class="wanna-section-meta">${esc(String(destination.places))} place${
        destination.places === 1 ? '' : 's'
      }${
        destination.guides.length
          ? ` · ${esc(String(destination.guides.length))} guide${
              destination.guides.length === 1 ? '' : 's'
            }`
          : ''
      }</p>
      <a class="wanna-section-map" href="${esc(
        destinationBoardHref(destination.slug)
      )}" data-wanna-destination="${esc(destination.slug)}">Open the city</a>
    </header>
    ${
      destination.guides.length
        ? `<div class="wanna-guides">
      <span class="wanna-guides-label">Guides here</span>
      ${destination.guides
        .map(
          (guide) => `<a class="wanna-guide-chip" href="${esc(guideHref(guide.id))}" data-guide>${esc(
            guideAuthorLabel(guide)
          )} <span>${esc(String(guide.places.length))} place${
            guide.places.length === 1 ? '' : 's'
          }</span></a>`
        )
        .join('')}
    </div>`
        : ''
    }
    ${placeCardGrid(shown)}
    ${
      hidden > 0
        ? `<p class="wanna-section-more"><button type="button" data-wanna-show-all="${esc(
            destination.slug
          )}">+ ${esc(String(hidden))} more in ${esc(destination.name)} — show all</button></p>`
        : ''
    }
  </section>`;
}

/** Every imported place the member holds in one destination. */
export function wannaGoDestinationPlaces(slug: string): ImportedPlace[] {
  return allImportedPlaces().filter((place) => destinationSlugOf(place.city) === slug);
}

/**
 * One row on a destination board: a place this member holds in this city.
 *
 * The board is the planning surface, so the row is deliberately flat — a name, a
 * quarter, one line of why, which door it came through, and whether they have
 * been. Everything the board needs to filter, number, plot and link is on it, so
 * neither the list nor the map has to go looking a second time and find a
 * different answer.
 */
export interface BoardPlace {
  /** The row's identity: the venue id where there is one, the imported row's id
   *  otherwise. Ties a list row to its pin. */
  key: string;
  name: string;
  /** The catalogue record, when Detour has one for this place. */
  venue?: Venue;
  /** The imported row, when the member holds this place through a guide. */
  imported?: ImportedPlace;
  /** The quarter — the only locating fact most imported places carry. */
  area: string;
  category: string;
  /** One line of why: a member's recommendation, or the publication's sentence. */
  quote: string;
  /**
   * Who wrote that line: a member's pseudonym, "You", or the publication.
   *
   * NOT "via". A member's note is that member's recommendation — they are its
   * author, not the route it travelled — and "via @marta" credited her the way
   * you credit whoever forwarded you an article. The word belongs to provenance
   * ("Feed · via @marta" on a card, where the question is which door), never to
   * a byline over somebody's own sentence.
   */
  quoteBy: string;
  /**
   * Who stands behind the place, for the card's foot: the publication that
   * printed it, or the member who recommended it. '' when neither — a place the
   * member added by hand has nobody's name on it but their own.
   */
  sourceName: string;
  provenance: { kind: 'guide' | 'feed' | 'manual'; label: string; href: string };
  /** Every guide of the member's that names this place, for the source chips. */
  guideIds: string[];
  /** They have been and said so — the top rung, and a filter of its own. */
  been: boolean;
  /** It is on their wishlist. Always true on their own lens; a fact on the other. */
  saved: boolean;
  /**
   * The member said "not this one" about a place their guide named. False
   * everywhere but a guide page, which is the only surface that still shows it.
   */
  skipped: boolean;
  lat: number | null;
  lng: number | null;
}

/**
 * The city page's card reading, through the one card renderer this app has.
 *
 * NOT A CARD OF ITS OWN. `groupedRecommendationCardMarkup` renders every
 * recommendation card on every surface — home, the city page, Explore — and the
 * rule is in AGENTS.md: extend the shared renderer when the treatment changes,
 * never add a second one. A city page that drew its own cards would drift from
 * the feed's within a release, and a member would be looking at two things that
 * are the same thing.
 *
 * The rows come in already filtered, ordered and cut by the page; all this does
 * is hand each one to the renderer in the shape it takes, with the imported
 * fallbacks — private href, hotlinked cover, the publication's byline — set for
 * the places that have no catalogue record behind them.
 */
export function boardCardsMarkup(
  rows: BoardPlace[],
  /** What to print under one card, when the surface has something to offer there. */
  footerFor: (row: BoardPlace) => string = () => ''
): string {
  return placeCardGrid(
    rows.map((row) => {
      const extras = {
        footer: footerFor(row),
        rowClass: row.skipped ? 'is-skipped' : '',
      };
      if (row.imported && !row.venue) {
        return { ...importedPlaceCard(row.imported, row.provenance), ...extras };
      }
      return {
        ...extras,
        venue: row.venue,
        name: row.name,
        city: row.venue?.city || row.imported?.city || '',
        country: row.venue?.country || row.imported?.country || '',
        // Reached only when nobody this reader can see has written about the
        // place — on their own lens that is the ordinary state of a save.
        emptyNote: row.saved
          ? 'On your wishlist. Nobody else can see that.'
          : 'No note you can read yet.',
      };
    })
  );
}

/**
 * The city as everybody reads it: the places members recommend there.
 *
 * The other lens on the same page — see `wannaGoBoardPlaces`, which answers the
 * same question about the member's own holdings. One row shape for both, because
 * they are one page: the list, the map, the numbering and the controls are
 * identical and only the set of places differs.
 *
 * Every one of these is published, which means a member recommended it, so the
 * provenance is the feed and the quote is whoever's note this reader can see.
 */
export function cityPickPlaces(venues: Venue[]): BoardPlace[] {
  return venues.map((venue) => {
    const quoted = newestNoteFor(venue.name, venue.city);
    return {
      key: venue.id,
      name: venue.name,
      venue,
      area: venue.neighborhood || '',
      category: venue.category || '',
      ...quoted,
      provenance: provenanceOf({ name: venue.name, city: venue.city }),
      guideIds: [],
      been: beenThere(venue, venue.name, venue.city),
      saved: isSavedPlace(venue.id),
      skipped: false,
      lat: venue.lat,
      lng: venue.lng,
    };
  });
}

/**
 * Everything the member holds in one city, from all three doors at once.
 *
 * A DESTINATION IS THE UNIT OF PLANNING, so this is the whole of it: places kept
 * off a guide, places saved one at a time, and places already been to. The last
 * of those is new here — the board used to be the wishlist alone, and a city you
 * have half-eaten your way through showed only the half you had not. A member
 * planning a return trip wants both, which is why the board counts them together
 * and offers *Been* as a filter rather than as a separate page.
 *
 * The catalogue comes in as an argument rather than off `knownVenues`: the board
 * has its own route and can be loaded cold, before any panel that would have
 * warmed that cache has rendered.
 */
/**
 * The one note a row or a card quotes: the newest one this reader can see, and
 * their own when they wrote it.
 *
 * DELIBERATELY THE NEWEST, and deliberately stated. It used to be whichever note
 * the feed payload happened to list first, which is an order nothing promises —
 * two members writing about the same place would swap places on the city page
 * for no reason a reader could name. Newest-first is the rule the cards already
 * sort by, so one place reads the same wherever it appears; ties break on the
 * recommendation id so the answer never flickers between renders.
 *
 * A member's own note wins outright. On their own city page, the sentence they
 * wrote is the one they will recognise.
 */
function newestNoteFor(name: string, city: string): {
  quote: string;
  quoteBy: string;
  sourceName: string;
} {
  const notes = [...notesForPlace(name, city)].sort(
    (a, b) =>
      Date.parse(b.created || '') - Date.parse(a.created || '') ||
      (b.id || '').localeCompare(a.id || '')
  );
  const note = notes.find((entry) => entry.is_own) || notes[0];
  const said = note?.note?.trim() || '';
  if (!said) return { quote: '', quoteBy: '', sourceName: '' };
  const who = note?.is_own ? 'You' : pseudoLabel(note?.recommender_pseudo || '');
  return { quote: said, quoteBy: who, sourceName: who };
}

/**
 * Have they been — the question the To try / Been split actually asks.
 *
 * TWO ANSWERS COUNT, not one. The Been & loved mark is the explicit one, but a
 * member's own recommendation is the rung above it: the place page hides both
 * *Been* and *Wanna go* once somebody has written here, on the grounds that a
 * note says more than a mark can. A board that read only the mark left those
 * places sitting under *To try* with no control left anywhere that could move
 * them — a member looking at a city they had written about was told they still
 * meant to get there.
 *
 * The ladder runs forward only, and this is what keeps it running: wishlist,
 * mark, note, each one standing for everything below it.
 */
function beenThere(venue: Venue | undefined, name: string, city: string): boolean {
  if (venue?.endorsedByCaller === true) return true;
  return notesForPlace(name, city).some((item) => item.is_own && Boolean(item.note?.trim()));
}

/** An imported place's category as a word, from the closed set's own labels. */
function importedCategoryLabel(value: string): string {
  const found = CATEGORY_OPTIONS.find(([option]) => option === value);
  return found ? found[1] : '';
}

/**
 * One imported place as a row, wherever it is being read.
 *
 * The city page and the guide page show the same object under two headings, so
 * they build it here rather than each shaping its own — two spellings of one row
 * is how a place ends up quoting the publication in one place and a member in
 * the other.
 */
function importedBoardPlace(
  place: ImportedPlace,
  guide: Guide | undefined,
  venue: Venue | undefined
): BoardPlace {
  const fromFeed = venue
    ? newestNoteFor(venue.name, venue.city)
    : { quote: '', quoteBy: '', sourceName: '' };
  const located = Number.isFinite(place.lat) && (place.lat !== 0 || place.lng !== 0);
  const said = place.excerpt.trim();
  return {
    key: venue?.id || place.id,
    name: place.name,
    venue,
    imported: place,
    area: place.area || venue?.neighborhood || '',
    // A matched catalogue place keeps the category a member chose; the
    // publication's own answer stands in only where Detour has none. Its word
    // for the cuisine beats the bare label — a row saying "Georgian" tells a
    // planner what "Ethnic cuisine" does not.
    category: venue?.category || place.cuisine || importedCategoryLabel(place.category),
    // The publication's sentence is why this place is on the list at all, so it
    // leads; a member's note stands in when the piece said nothing quotable.
    quote: said || fromFeed.quote,
    quoteBy: said ? '' : fromFeed.quoteBy,
    sourceName: said
      ? guide
        ? guideAuthorLabel(guide)
        : importedPlaceSourceLabel(place)
      : fromFeed.sourceName,
    provenance: provenanceOf(place, place, guide),
    guideIds: place.guides,
    been: beenThere(venue, venue?.name || place.name, venue?.city || place.city),
    saved: !place.skipped,
    skipped: place.skipped,
    lat: venue?.lat ?? (located ? place.lat : null),
    lng: venue?.lng ?? (located ? place.lng : null),
  };
}

/**
 * One guide's places as rows — skipped ones included, because this is the only
 * page that still shows them. Everywhere else they are gone; see `skipped` on
 * `ImportedPlace`.
 */
export function guideBoardPlaces(guide: Guide, venues: Venue[]): BoardPlace[] {
  const catalogue = venues.length ? venues : knownVenues;
  const byId = new Map(catalogue.map((venue) => [venue.id, venue]));
  return guide.places.map((place) =>
    importedBoardPlace(place, guide, place.matched_venue ? byId.get(place.matched_venue) : undefined)
  );
}

export function wannaGoBoardPlaces(slug: string, venues: Venue[]): BoardPlace[] {
  const catalogue = venues.length ? venues : knownVenues;
  const byId = new Map(catalogue.map((venue) => [venue.id, venue]));
  const guideOf = guideByPlaceId();
  const rows: BoardPlace[] = [];
  const claimed = new Set<string>();


  for (const place of wannaGoDestinationPlaces(slug)) {
    const venue = place.matched_venue ? byId.get(place.matched_venue) : undefined;
    if (venue) claimed.add(venue.id);
    rows.push(importedBoardPlace(place, guideOf.get(place.id), venue));
  }

  const covered = importedVenueIds();
  for (const save of savedPlaces()) {
    if (destinationSlugOf(save.city) !== slug) continue;
    if (covered.has(save.venue_id) || claimed.has(save.venue_id)) continue;
    claimed.add(save.venue_id);
    const venue = byId.get(save.venue_id);
    const name = save.venue_name || venue?.name || 'A place you saved';
    rows.push({
      key: save.venue_id,
      name,
      venue,
      area: venue?.neighborhood || '',
      category: venue?.category || '',
      ...newestNoteFor(name, save.city),
      provenance: provenanceOf({ name, city: save.city }),
      guideIds: [],
      been: beenThere(venue, name, save.city),
      saved: true,
      skipped: false,
      lat: venue?.lat ?? null,
      lng: venue?.lng ?? null,
    });
  }

  // Been & loved in this city, however it got there — the mark, or a
  // recommendation of their own, which stands for it. A place they marked or
  // wrote about without ever saving belongs on the board too: it is one of their
  // places in this city, and the board is the answer to "what do I have in New
  // York".
  for (const venue of catalogue) {
    if (claimed.has(venue.id)) continue;
    if (!beenThere(venue, venue.name, venue.city)) continue;
    if (destinationSlugOf(venue.city) !== slug) continue;
    claimed.add(venue.id);
    rows.push({
      key: venue.id,
      name: venue.name,
      venue,
      area: venue.neighborhood || '',
      category: venue.category || '',
      ...newestNoteFor(venue.name, venue.city),
      provenance: provenanceOf({ name: venue.name, city: venue.city }),
      guideIds: [],
      been: true,
      // Been but never saved — the mark is the reason it is on this board.
      saved: false,
      skipped: false,
      lat: venue.lat,
      lng: venue.lng,
    });
  }

  return rows;
}

// NO `bindWannaGoCards`. It wired Remove on the destination board back when that
// board was this tab's card grid on another page. The board is its own surface
// now and offers no removal: a member tidies their own list on My detours and
// nowhere else, which is the rule Wanna go has always run on.


/**
 * The import dialogue: paste, then review, in one modal.
 *
 * Two states rather than two dialogues, because the twenty seconds a long page
 * takes to read happen between them, and a member who has waited that long must
 * not have the answer appear somewhere other than where they were looking.
 *
 * Rendered only while open, and `showModal()` is called from the bind step — the
 * same shape as the delete-recommendation dialogue, and for the same reason: the
 * whole panel re-renders on every state change, so the element is recreated each
 * time and has to be re-opened rather than kept.
 */
function importDialogMarkup(): string {
  if (!importDialogOpen()) return '';
  const draft = importDraft();
  const failure = importFailure();
  return `<dialog class="community-import-dialog" data-import-dialog aria-labelledby="import-dialog-title">
    <div class="community-import-sheet">
      ${draft ? importReviewMarkup(draft, failure) : importReadMarkup(failure)}
    </div>
  </dialog>`;
}

/** The dialogue's first state: the field, and what the last attempt said. */
function importReadMarkup(failure: string): string {
  const reading = importReading();
  return `<form class="community-form community-import-form" data-import-read>
    <p class="community-confirm-kicker">Add to your wishlist</p>
    <h2 id="import-dialog-title" tabindex="-1">Save a guide you have been reading.</h2>
    <label>Link to the guide<input name="url" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="Paste the link — e.g. a city’s best-of guide" ${
      reading ? 'disabled' : ''
    } required></label>
    <p class="community-form-note">${
      reading
        ? 'Reading the page...'
        : 'We read the page and show you what is on it. Nothing is kept until you say so.'
    }</p>
    ${failure ? `<p class="community-form-error" role="alert">${esc(failure)}</p>` : ''}
    <div class="community-import-bar">
      <button class="secondary-button" type="submit" ${reading ? 'disabled' : ''}>${
        reading ? 'Reading…' : 'Read the guide'
      }</button>
      <button class="community-queue-delete" type="button" data-import-cancel ${
        reading ? 'disabled' : ''
      }>Cancel</button>
    </div>
  </form>`;
}

/**
 * What the link turned out to hold, and the member's answer to it.
 *
 * Everything is checked except what they already have, because the honest
 * default on a list somebody chose to paste is yes. The name is theirs to change
 * before it is kept — the article's headline is a headline, and "NYC trip,
 * October" is what the list is actually for.
 *
 * The city field is the one piece of work asked of the member, and it is asked
 * because it is the only thing that decides whether a place already on Detour is
 * recognised as the same place. It is prefilled from the page whenever the page
 * said.
 */
function importReviewMarkup(draft: ImportDraft, failure: string): string {
  const keeping = importKeeping();
  const chosen = draft.places.filter((place) => place.keep).length;
  const matched = draft.places.filter((place) => place.matched).length;
  const held = draft.places.filter((place) => place.already_have).length;
  return `<form class="community-form community-import-review" data-import-keep>
    <div class="community-import-head">
      <p class="community-confirm-kicker">Add to your wishlist</p>
      <h2 id="import-dialog-title" tabindex="-1">${esc(String(draft.places.length))} place${
        draft.places.length === 1 ? '' : 's'
      } on this guide</h2>
      <p class="community-form-note">${esc(draft.source || 'From the page you pasted')}${
        draft.knownListTitle
          ? ` · you have kept this link before, as “${esc(draft.knownListTitle)}” — keeping again refreshes it`
          : ''
      }</p>
    </div>
    <label>List name<input name="title" value="${esc(draft.title)}" maxlength="200" ${
      keeping ? 'disabled' : ''
    } required></label>
    <label>City<input name="city" value="${esc(draft.city)}" maxlength="120" placeholder="e.g. New York" ${
      keeping ? 'disabled' : ''
    }></label>
    <p class="community-form-note">The city is how we tell whether a place is already on Detour.${
      matched ? ` ${matched} of these already ${matched === 1 ? 'is' : 'are'}.` : ''
    }${held ? ` ${held} ${held === 1 ? 'is' : 'are'} already on your list.` : ''}</p>
    <div class="community-import-actions">
      <button class="community-import-bulk" type="button" data-import-all="1" ${keeping ? 'disabled' : ''}>Check all</button>
      <button class="community-import-bulk" type="button" data-import-all="" ${keeping ? 'disabled' : ''}>Clear all</button>
    </div>
    <ul class="community-import-list">
      ${draft.places
        .map((place, index) => {
          const where = [place.area, place.address].filter(Boolean).join(' · ');
          return `<li class="community-import-row${place.already_have ? ' is-held' : ''}">
        <label>
          <input type="checkbox" data-import-place="${index}" ${place.keep ? 'checked' : ''} ${
            keeping ? 'disabled' : ''
          }>
          <span class="community-import-name">${esc(place.name)}</span>
          ${where ? `<span class="community-import-where">${esc(where)}</span>` : ''}
          ${
            place.already_have
              ? '<span class="community-import-flag">Already on your list</span>'
              : place.matched
                ? '<span class="community-import-flag is-matched">On Detour</span>'
                : ''
          }
        </label>
      </li>`;
        })
        .join('')}
    </ul>
    ${failure ? `<p class="community-form-error" role="alert">${esc(failure)}</p>` : ''}
    <div class="community-import-bar">
      <button class="secondary-button" type="submit" ${keeping || !chosen ? 'disabled' : ''}>${
        keeping ? 'Keeping…' : `Add ${chosen} to Wanna go`
      }</button>
      <button class="community-queue-delete" type="button" data-import-cancel ${keeping ? 'disabled' : ''}>Cancel</button>
    </div>
  </form>`;
}


/**
 * ONE BUILDER FOR AN IMPORTED PLACE'S CARD, wherever it is standing.
 *
 * Under its guide heading, or under "Not from a guide" once that heading is gone —
 * the card is the same either way, because the place is. Splitting these would
 * be the same mistake `placeCardMarkup` exists to prevent one level up: a place
 * that looks different depending on which part of the tab it is on.
 */
function importedPlaceCard(
  place: ImportedPlace,
  provenance: { kind: 'guide' | 'feed' | 'manual'; label: string; href: string }
) {
  const busy = removingImported(place.id);
  return {
    name: place.name,
    // The area is the only locating fact most of these carry, and
    // on a card it belongs where the city goes — "Astoria, New
    // York" is what the member needs to place it.
    city: [place.area, place.city].filter(Boolean).join(', ') || place.city,
    country: place.country,
    // The publication's own sentence, in the quote a member's note
    // would occupy — it is why the place was kept, and reading the
    // card without it says nothing at all. It carries the
    // publication's byline rather than a member's, so the card is
    // never mistakable for somebody's recommendation. Only the
    // fallback branch takes this: see placeCardMarkup.
    fallback: place.excerpt ? { note: place.excerpt } : undefined,
    fallbackByline: provenance.label,
    fallbackBylineKind: provenance.kind,
    // The chip is the way back to the piece — and now that guides are sources
    // rather than containers, the only way in.
    fallbackBylineHref: provenance.href,
    // Reached only when the piece said nothing quotable about it.
    emptyNote: `${provenance.label}. Only you can see this.`,
    fallbackHref: privatePlaceHref(place.id),
    fallbackCoverHref: importedCoverHref(place.image_url),
    footer: `<div class="community-queue-bar community-queue-bar-single">
      <button class="community-queue-delete" type="button" data-imported-drop="${esc(place.id)}" ${
        busy ? 'disabled' : ''
      } aria-label="${esc(`Remove ${place.name} from your wishlist`)}">${
        busy ? 'Removing…' : 'Remove'
      }</button>
    </div>`,
  };
}

// NO `guideCardsMarkup`. The guide page renders through `boardCardsMarkup` like
// every other city surface — same rows, same card, same shell — so there is one
// place where a card's contents are decided.


/**
 * The import flow's own wiring: the paste, the review screen, and removal.
 *
 * ONE DELIBERATE DEPARTURE FROM RENDER-EVERYTHING. Ticking a checkbox does not
 * re-render. The rest of this module redraws the whole panel on every state
 * change, which is right for a form with four fields and wrong for a list of
 * thirty-eight: a redraw per tick throws away the scroll position, so a member
 * unchecking the places they do not want would be sent back to the top of the
 * list after each one. The draft is updated and the one thing that changed — the
 * count on the submit button — is patched in place instead. Same reason the
 * name and city fields update the draft on input without redrawing.
 */
/**
 * Where the member was inside the import dialogue, kept across its rebuilds.
 *
 * The dialogue is thrown away and rebuilt on every render, so without this the
 * browser has nothing to give focus back to and the code below hands it to the
 * heading — which took the caret out of the name field every time anything else
 * on the review screen moved. The member typing a name is the person we are
 * least entitled to interrupt: the name is the only part of a kept guide they
 * author.
 *
 * `stage` is read/review. Focus is placed by us exactly once per stage — on the
 * first open, and again when the read finishes and the review takes over, which
 * is a wait long enough that the answer has to arrive under the member's eyes.
 * Every other rebuild restores what they had.
 */
let importFocusStage = '';
let importFocusKey = '';
let importFocusCaret = -1;
let importListScroll = 0;

/** A selector that survives the rebuild, for the controls worth returning to. */
function importFocusKeyFor(element: Element | null): string {
  if (!(element instanceof HTMLElement)) return '';
  if (element instanceof HTMLInputElement && element.name) {
    return `input[name="${element.name}"]`;
  }
  const place = element.dataset.importPlace;
  if (place) return `[data-import-place="${place}"]`;
  const all = element.dataset.importAll;
  if (all !== undefined) return `[data-import-all="${all}"]`;
  if (element.hasAttribute('data-import-cancel')) return '[data-import-cancel]';
  if (element instanceof HTMLButtonElement && element.type === 'submit') {
    return '[data-import-keep] button[type="submit"]';
  }
  return '';
}

function bindGuides(root: HTMLElement, render: () => void): void {
  root.querySelector<HTMLButtonElement>('[data-import-open]')?.addEventListener('click', () => {
    openImportDialog(render);
  });

  const dialog = root.querySelector<HTMLDialogElement>('[data-import-dialog]');
  if (!dialog) {
    // Closed, so there is nothing to come back to. Cleared here rather than in
    // each of the three ways it closes.
    importFocusStage = '';
    importFocusKey = '';
    importFocusCaret = -1;
    importListScroll = 0;
  }
  if (dialog) {
    // Escape, and the backdrop click the browser turns into a cancel. Both mean
    // the same thing here and both are safe: nothing has been written, because
    // reading and keeping are separate calls.
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeImportDialog(render);
    });
    // One Cancel, bound on the dialogue rather than on either form: the button
    // appears in both states and means the same thing in both.
    dialog.querySelector<HTMLButtonElement>('[data-import-cancel]')?.addEventListener('click', () => {
      cancelImport(render);
    });
    // Remembered so the rebuild can put it back — see `importFocusKey`.
    dialog.addEventListener('focusin', () => {
      const key = importFocusKeyFor(document.activeElement);
      if (!key) return;
      importFocusKey = key;
      importFocusCaret = -1;
    });

    // The list is the only scroller in the sheet, and a rebuild would otherwise
    // send a member who was forty places down back to the top.
    const list = dialog.querySelector<HTMLElement>('.community-import-list');
    if (list) {
      if (importListScroll) list.scrollTop = importListScroll;
      list.addEventListener('scroll', () => {
        importListScroll = list.scrollTop;
      });
    }

    if (!dialog.open) {
      dialog.showModal();
      const stage = importDraft() ? 'review' : 'read';
      const held = importFocusKey
        ? dialog.querySelector<HTMLElement>(importFocusKey)
        : null;
      if (held) {
        held.focus({ preventScroll: true });
        if (importFocusCaret >= 0 && held instanceof HTMLInputElement) {
          held.setSelectionRange(importFocusCaret, importFocusCaret);
        }
      } else if (importFocusStage !== stage) {
        // Focus the field rather than the heading: the member pressed a button
        // called "Add a guide from a link" and the next thing they do is paste.
        // On the review screen there is no field to paste into, so the heading
        // takes it — the count of places is the answer they waited for.
        const field =
          dialog.querySelector<HTMLElement>('input[name="url"]') ||
          dialog.querySelector<HTMLElement>('#import-dialog-title');
        field?.focus({ preventScroll: true });
      }
      importFocusStage = stage;
    }
  }

  const readForm = root.querySelector<HTMLFormElement>('[data-import-read]');
  readForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const field = readForm.querySelector<HTMLInputElement>('input[name="url"]');
    const value = field?.value.trim() || '';
    if (!value) return;
    void readListLink(value, render);
  });

  const reviewForm = root.querySelector<HTMLFormElement>('[data-import-keep]');
  if (!reviewForm) return;

  const keepButton = reviewForm.querySelector<HTMLButtonElement>('button[type="submit"]');
  const syncKeepBar = (): void => {
    const draft = importDraft();
    if (!draft || !keepButton || importKeeping()) return;
    const chosen = draft.places.filter((place) => place.keep).length;
    keepButton.textContent = `Add ${chosen} to Wanna go`;
    keepButton.disabled = chosen === 0;
  };

  reviewForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void keepImportDraft(render);
  });

  // The caret rides along with the value: a rebuild mid-word must not drop the
  // member at the end of what they had already typed.
  reviewForm
    .querySelector<HTMLInputElement>('input[name="title"]')
    ?.addEventListener('input', (event) => {
      const field = event.currentTarget as HTMLInputElement;
      setDraftTitle(field.value);
      importFocusKey = 'input[name="title"]';
      importFocusCaret = field.selectionStart ?? -1;
    });
  reviewForm
    .querySelector<HTMLInputElement>('input[name="city"]')
    ?.addEventListener('input', (event) => {
      const field = event.currentTarget as HTMLInputElement;
      setDraftCity(field.value);
      importFocusKey = 'input[name="city"]';
      importFocusCaret = field.selectionStart ?? -1;
    });

  reviewForm.querySelectorAll<HTMLInputElement>('[data-import-place]').forEach((box) => {
    box.addEventListener('change', () => {
      const index = Number(box.dataset.importPlace);
      if (!Number.isInteger(index)) return;
      toggleDraftPlace(index, syncKeepBar);
    });
  });

  reviewForm.querySelectorAll<HTMLButtonElement>('[data-import-all]').forEach((button) => {
    button.addEventListener('click', () => {
      setAllDraftPlaces(Boolean(button.dataset.importAll), render);
    });
  });

}

/**
 * The remove-a-list dialogue, for a surface that renders it itself.
 *
 * The guide page is the only place that asks — it is the page about the list, so
 * it is where "remove this list" belongs — and it renders the same dialogue the
 * tab would, rather than a second one worded differently.
 */
export function guideRemovalDialogMarkup(): string {
  return removeGuideDialogMarkup();
}

/** Removal of a kept list, or of one place on one. Bound wherever they render. */
export function bindImportedRemoval(root: HTMLElement, render: () => void): void {
  root.querySelectorAll<HTMLButtonElement>('[data-guide-drop]').forEach((button) => {
    button.addEventListener('click', () => {
      // `data-guide-drop`, which is what the selector above matches. It read
      // `dataset.listDrop` — a name from an earlier spelling of this feature —
      // so every press found an empty id and returned silently.
      const id = button.dataset.guideDrop || '';
      if (!id || button.disabled) return;
      const list = guides().find((entry) => entry.id === id);
      if (!list) return;
      pendingGuideRemoval = {
        id,
        title: list.title,
        total: list.places.length,
        // Places another list also names survive whichever answer is given, so
        // the dialogue counts them out of the choice rather than into it.
        shared: list.places.filter((place) => place.guides.length > 1).length,
      };
      render();
    });
  });

  const listDialog = root.querySelector<HTMLDialogElement>('[data-guide-remove-dialog]');
  if (listDialog) {
    const close = () => {
      pendingGuideRemoval = null;
      render();
    };
    listDialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close();
    });
    listDialog.querySelector<HTMLButtonElement>('[data-guide-remove-cancel]')?.addEventListener('click', close);
    const answer = (places: 'keep' | 'remove') => () => {
      const pending = pendingGuideRemoval;
      if (!pending) return;
      void removeGuide(pending.id, places, () => {
        pendingGuideRemoval = null;
        render();
      });
    };
    listDialog
      .querySelector<HTMLButtonElement>('[data-guide-remove-keep]')
      ?.addEventListener('click', answer('keep'));
    listDialog
      .querySelector<HTMLButtonElement>('[data-guide-remove-confirm]')
      ?.addEventListener('click', answer('remove'));
    if (!listDialog.open) {
      listDialog.showModal();
      listDialog.querySelector<HTMLElement>('#remove-guide-title')?.focus({ preventScroll: true });
    }
  }
  root.querySelectorAll<HTMLButtonElement>('[data-imported-drop]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.importedDrop || '';
      if (!id || button.disabled) return;
      void removeImportedPlace(id, render);
    });
  });
}

function detoursPanel(): string {
  const unseen = unseenShareCount();
  // Down the ladder, then the inbox: what they wrote, where they have been, where
  // they mean to go, and what other people sent them.
  const tabs: { id: DetourTab; label: string }[] = [
    { id: 'recommendations', label: 'Recommendations' },
    { id: 'endorsements', label: 'Been &amp; loved' },
    { id: 'saved', label: 'Wanna go' },
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
        : detourTab === 'endorsements'
          ? `<div class="community-detour-body" id="detour-panel-endorsements" role="tabpanel" aria-labelledby="detour-tab-endorsements">${endorsementsPanel()}</div>`
          : detourTab === 'saved'
            ? `<div class="community-detour-body" id="detour-panel-saved" role="tabpanel" aria-labelledby="detour-tab-saved">${savedPanel()}</div>`
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
              : foundingMember
                ? 'Public — readable by anyone'
                : 'Discoverable by your circle'
        }</small></span>
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
  const tabs = memberTabs();
  return `<div class="community-member-bar">
    <div class="community-member-tabs" role="tablist" aria-label="Member areas">
      ${tabs.map(
        (tab) =>
          `<button class="community-member-tab${memberTab === tab ? ' is-active' : ''}" type="button" role="tab" id="member-tab-${tab}" aria-selected="${memberTab === tab}" aria-controls="member-panel-${tab}" tabindex="${memberTab === tab ? '0' : '-1'}" data-member-tab="${tab}">${MEMBER_TAB_LABELS[tab]}${
            tab === 'curation' && imageCurationCount ? `<span class="community-tab-badge" aria-label="${imageCurationCount} photos awaiting review">${imageCurationCount}</span>` : ''}</button>`
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
      : memberTab === 'curation' && foundingMember
        ? curationPanel()
        : settingsPanel(record);
  return `<section class="community-panel community-panel-member" aria-label="Detour member area">
    ${memberTabsMarkup()}
    ${noticeMarkup()}
    ${panel}
    ${deleteRecommendationDialogMarkup()}
    ${importDialogMarkup()}
    ${removeGuideDialogMarkup()}
  </section>`;
}

/**
 * My detours as the signed-in landing: the tabs and nothing else.
 *
 * The same panel the member area holds, mounted as the thing an invitation and a
 * return visit both land on. See docs/landing-spec.md — a feed promises something
 * new on every load, and at a few places a week that promise fails on most
 * visits, teaching the member not to come back. A member's own record is never
 * empty once they have done one thing, and the answer slot above this does not
 * depend on supply at all.
 *
 * The answer slot is main.ts's, not this module's: it holds the triage card and
 * the prompt ladder, which are not member-area furniture. Everything below it is.
 *
 * Deliberately without the member-area tab bar. The landing is one surface, not a
 * panel inside four; Invitations, Settings and Curation stay where they are and
 * are reached through the masthead.
 */
export function landingPanel(venues: Venue[], resolvePlace?: NetworkPlaceResolver): string {
  knownVenues = venues;
  // Still accepted here, since this panel is handed the catalogue anyway, but no
  // longer the only setter: `setPlaceResolver` runs on every render.
  if (resolvePlace) landingPlaceResolver = resolvePlace;
  if (!member()) return '';
  // No `community-area` id or class here, deliberately: that is the member
  // area's skip-link target and its own 1080px column, and the landing already
  // sits on that column through `.landing`. Two elements claiming the id would
  // make the account page's skip link ambiguous.
  return `<section class="community-panel community-panel-landing" aria-label="My detours">
    ${noticeMarkup()}
    ${detoursPanel()}
    ${deleteRecommendationDialogMarkup()}
    ${importDialogMarkup()}
    ${removeGuideDialogMarkup()}
  </section>`;
}

/**
 * The community strip is a day-one scaffold, not permanent landing content.
 * Use the exact list that renders the Recommendations tab, and wait for it to
 * load successfully before deciding it is empty. A slow or failed request must
 * not flash the strip for a returning member who already has cards there.
 */
export function shouldShowLandingCommunityStrip(): boolean {
  return Boolean(member()) && communityLoaded && waitlistEntriesLoaded && waitlistEntries.length === 0;
}

/** The compact Feed route replaces the full day-one strip once this list exists. */
export function shouldShowLandingFeedCta(): boolean {
  return Boolean(member()) && communityLoaded && waitlistEntriesLoaded && waitlistEntries.length > 0;
}

/**
 * Which tab the landing opens on.
 *
 * Recommendations by default, because it is the most committed rung and the one a
 * member is most likely to have something in. A member with none opens on
 * whichever tab does have something, so the first thing they see is a list rather
 * than an empty state — and if nothing has anything, Recommendations stands,
 * because its empty state is the by-heart question and that is the right thing to
 * open on.
 *
 * Runs once, and never against the member's own choice: the moment they touch a
 * tab, the landing stops picking for them.
 */
function settleLandingTab(): void {
  if (detourTabChosen) return;
  detourTabChosen = true;
  if (waitlistEntries.length) return;
  if (savedPlacesLoaded() && savedPlaces().length) {
    detourTab = 'saved';
    return;
  }
  // A member whose only places are ones they imported opens on the tab holding
  // them, for the same reason as above: the first thing they see should be a
  // list rather than an empty state.
  if (guidesLoaded() && guides().length) {
    detourTab = 'saved';
    return;
  }
  if (unseenShareCount() || shares.length) {
    detourTab = 'shares';
    return;
  }
  const marked = knownVenues.some((venue) => venue.endorsedByCaller);
  if (marked) detourTab = 'endorsements';
}

/**
 * A place has just landed on this member's own list.
 *
 * The landing picks its opening tab once, from what the member has; a place added
 * during the visit arrives after that decision and would otherwise leave them
 * looking at the tab that was empty when they got here.
 */
export function markDetoursHaveContent(): void {
  detourTabChosen = true;
  detourTab = 'recommendations';
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
 * Apply reset-link route state before the panel renders.
 *
 * The token is the only thing that opens the reset card, so the route sets the
 * mode as well — a member arriving from their inbox has one thing to do and
 * should not have to find the card that does it. Leaving the route puts them back
 * on sign-in, the same way an abandoned invitation does.
 */
export function applyPasswordResetRoute(token: string | null): void {
  const nextToken = token?.trim() || null;
  if (nextToken === routedResetToken) return;
  const leavingResetRoute = routedResetToken !== null && nextToken === null;
  routedResetToken = nextToken;
  if (nextToken) {
    mode = 'reset';
    // A fresh link supersedes whatever the Forgot card was last saying, including
    // its "check your inbox" state — the inbox has been checked.
    resetEmailSent = false;
    notice = null;
  } else if (leavingResetRoute) {
    mode = 'sign-in';
  }
}

/**
 * Whether this visit is here to set a password. The reset card belongs to the
 * signed-out panel, and a member who still has a valid session in this browser
 * would otherwise be shown the member area and never see it — clicking a reset
 * link is a clear statement that the password needs changing, session or not.
 */
export function passwordResetRouted(): boolean {
  return routedResetToken !== null;
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
  detourTab = 'shares';
  // Arriving via a Share CTA is an explicit ask for the form.
  shareFormOpen = true;
  pendingFormReveal = 'share';
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

/**
 * One pseudo, asked of the directory. The name a circle row or a deep link carries
 * is a name, and only this route may turn one into the id a share is addressed to
 * — so both go through here and get the same answer to the same question.
 */
async function lookupPseudo(
  pseudo: string
): Promise<{ items: DirectoryMember[]; exact: DirectoryMember | null; error: string }> {
  try {
    const response = await pb.send<{ items: DirectoryMember[] }>(
      `/api/detour/member-directory?q=${encodeURIComponent(pseudo)}`,
      { requestKey: null }
    );
    const ownId = member()?.id;
    const items = (response.items || []).filter((item) => item.id !== ownId && item.pseudo?.trim());
    return {
      items,
      exact:
        items.find((item) => pseudoLabel(item.pseudo).toLowerCase() === pseudo.toLowerCase()) ??
        null,
      error: '',
    };
  } catch (error) {
    return {
      items: [],
      exact: null,
      error: readableError(error, 'Member search is unavailable. Please try again.'),
    };
  }
}

/**
 * An exact pseudo selects itself; anything else is left as search results for the
 * member to choose from. So a renamed handle, or one that now matches two members,
 * degrades into the ordinary lookup rather than addressing the share to the wrong
 * person on the strength of a stale name.
 */
function applyPseudoLookup(
  state: DirectoryState,
  pseudo: string,
  result: { items: DirectoryMember[]; exact: DirectoryMember | null; error: string }
): void {
  if (result.exact) {
    state.selected = result.exact;
    state.query = pseudoLabel(result.exact.pseudo);
    state.items = [];
  } else {
    state.items = result.items;
    state.query = pseudo;
  }
  state.error = result.error;
  state.loading = false;
  state.activeIndex = -1;
}

/** Point the member area at the Recommend form, optionally fixed to one published place. */
export function openRecommendPlace(venue?: Venue): void {
  detourTab = 'recommendations';
  detourTabChosen = false;
  editingEntryId = '';
  withdrawingEndorsementId = '';
  endorsementFailure = new Map<string, string>();
  newPlacePrefill.name = '';
  newPlacePrefill.city = '';
  recommendationDraft = venue || null;
  recommendationIntent = 'add';
  // "Recommend" from the feed or a place page is an explicit ask for the form,
  // with or without a place attached.
  recommendationFormOpen = true;
  pendingCollision = null;
  pendingFormReveal = 'recommendation';
}

/**
 * Open the empty recommendation form with a name and city already in it.
 *
 * The way off a private place page: a member who has been somewhere they
 * imported can say so, and saying so is what puts the place on Detour for
 * everybody else. It is the ordinary recommendation path — same form, same
 * `place_intent` collision question, same publication rule — with two fields
 * filled. Deliberately not a separate submission path, and deliberately not
 * carrying the publication's copy into the note: the note has to be the
 * member's own words or it is not a recommendation.
 */
export function openRecommendNewPlace(name: string, city: string): void {
  openRecommendPlace();
  newPlacePrefill.name = name;
  newPlacePrefill.city = city;
}

/** Open the current member's editor for one published place. */
export function openEditRecommendation(venue: Venue): void {
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

/**
 * Point My detours at one of its four lists — Recommendations, Been & loved,
 * Wanna go, Private shares.
 *
 * The crumb roots need it: a place page whose trail begins BEEN & LOVED has to
 * land on that list rather than on whichever tab the landing picked. Counts as
 * the member choosing a tab, so `settleLandingTab` stops guessing for them —
 * being sent to a list is a choice about which list to be on.
 */
export function openDetoursTab(tab: string): boolean {
  const known: DetourTab[] = ['recommendations', 'endorsements', 'saved', 'shares'];
  if (!known.includes(tab as DetourTab)) return false;
  detourTab = tab as DetourTab;
  detourTabChosen = true;
  return true;
}

/** Point the member area at one of its tabs (used by the masthead member menu). */
export function openMemberArea(tab: string): boolean {
  if (!memberTabs().includes(tab as MemberTab)) return false;
  memberTab = tab as MemberTab;
  return true;
}

/**
 * Open the account page on the open-signup card, for the "Start your circle"
 * calls to action a visitor meets around the app.
 *
 * A no-op for somebody already signed in: the signed-out panel is not what they
 * would be looking at, and setting a mode behind a page they cannot see would
 * decide which card greets them the next time they sign out.
 */
export function openSignUp(): void {
  if (member()) return;
  mode = 'sign-up';
  clearInvitationRoute();
  notice = null;
}

/** Drop the session. Callers re-render; the masthead falls back to "Members". */
export function signOutMember(): void {
  pb.authStore.clear();
  resetCommunityState();
  notice = { kind: 'info', text: 'You have signed out of Detour.' };
}

/**
 * The same drop, when the server rather than the member decided it.
 *
 * A token the API refuses is not a session, and a browser holding one is a
 * visitor that thinks it is a member — which is the worst of both: the masthead
 * names them, and every member-scoped request behind it fails. Ending it here
 * turns them into the visitor they already are, so the public surfaces work.
 *
 * Separate from `signOutMember` for one word of honesty: they did not sign out,
 * and being told they did while a place page sits in front of them explains
 * nothing about why their circle went missing.
 */
export function expireMemberSession(): void {
  pb.authStore.clear();
  resetCommunityState();
  notice = {
    kind: 'info',
    text: 'Your session expired, so you have been signed out. Sign in again to see your circle.',
  };
}

/**
 * Hand the share pickers the member's circle. Called on every render of a surface
 * that holds one, so the list appears as soon as the payload lands rather than on
 * the next thing the member happens to click.
 */
export function adoptCircleRecipients(groups: CircleRecipientGroup[], loading: boolean): void {
  circleRecipients = groups;
  circleRecipientsLoading = loading;
}

export function communityPanel(venues: Venue[]): string {
  knownVenues = venues;
  // A routed reset token outranks a live session — see passwordResetRouted.
  const signedOut = !member() || routedResetToken !== null;
  return `<div id="community-area" class="community-area">${signedOut ? signedOutPanel() : signedInPanel()}</div>`;
}

function resetCommunityState(): void {
  memberTab = 'invitations';
  detourTab = 'recommendations';
  recommendationDraft = null;
  recommendationIntent = 'add';
  recommendationFormOpen = false;
  pendingCollision = null;
  shareFormOpen = false;
  pendingFormReveal = null;
  pendingShareRecipient = null;
  sharePlacePrefill = '';
  waitlistEntries = [];
  recommendations = [];
  waitlistEntriesLoaded = false;
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
  memberPlacePromptState = null;
  // The answer slot belongs to the member who was signed in: their card, their
  // three-per-session cap, and the places they have already passed on.
  resetTriage();
  // And their follow-up, which names a place off their own private list — the one
  // thing in the slot that would leak something if it outlived the session.
  resetFollowUp();
  // The Wanna go list is the most private thing the client holds. A signed-out
  // shell must not keep the previous member's, and the next member reads their
  // own rather than inheriting a stale one.
  resetSavedPlaces();
  // Kept lists sit on the same tab and are the same kind of secret, including
  // the half-finished draft of a link somebody pasted and did not keep.
  resetGuides();
  wannaGoCity = 'all';
  wannaGoSource = 'all';
  wannaGoShowAll.clear();
  canGrantFounding = false;
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
  waitlistEntriesLoaded = false;
  render();
  const results = await Promise.allSettled([
    pb.collection('community_waitlist_entries').getFullList<WaitlistEntry>({ sort: '-updated', requestKey: null }),
    pb.collection('community_shares').getFullList<ShareRecord>({ sort: '-created', requestKey: null }),
    pb.collection('community_recommendations').getFullList<RecommendationRecord>({ sort: '-created', requestKey: null }),
    pb.send<{ ids?: string[] }>('/api/detour/community/place-locks', { requestKey: null }),
  ]);

  waitlistEntriesLoaded = results[0].status === 'fulfilled';
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
  // Writing a place hides any save the member had on it, and deleting the note
  // brings that save back — the row is never destroyed on the way up the ladder.
  // This reload is what every recommendation write ends with, so it is where the
  // Wanna go list catches up.
  void refreshSavedPlaces(render);
  // Now that there is something to look at, the landing can tell whether
  // Recommendations is the right tab to be on.
  settleLandingTab();
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

/**
 * The first-place ask for this member, or null when there is nothing to ask —
 * which is most members most of the time. Fixed for the session, because the
 * server settles the rung once per visit.
 */
export function memberPlacePrompt(): PlacePrompt | null {
  return memberPlacePromptState;
}

/**
 * A prompt is only worth rendering if it names a rung and a city. Anything else
 * the copy layer can do without, so a backend that reports a partial prompt costs
 * a word rather than an empty sentence.
 */
function readPlacePrompt(value: unknown): PlacePrompt | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const rung = Number(raw.rung);
  const city = typeof raw.city === 'string' ? raw.city.trim() : '';
  if (!Number.isFinite(rung) || rung < 1 || !city) return null;
  const text = (key: string): string => (typeof raw[key] === 'string' ? (raw[key] as string) : '');
  return {
    rung: Math.floor(rung),
    city,
    city_place_count: cleanCount(raw.city_place_count),
    recommender: text('recommender'),
    place_name: text('place_name'),
    place_occasion: text('place_occasion'),
    occasion: text('occasion'),
    other_occasion: text('other_occasion'),
  };
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
        place_prompt?: unknown;
        triage_card?: unknown;
        follow_up?: unknown;
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
  if (!canGrantFounding) inviteGrantsFounding = false;
  imageCurationCount = foundingMember ? cleanCount(me.member?.image_curation_count) : 0;
  if (!foundingMember && memberTab === 'curation') memberTab = 'settings';
  memberVisitCount = cleanCount(me.member?.visit_count);
  // A gap the server could not measure — a first visit, or a failed ping — stays
  // unknown rather than becoming a confident zero days.
  const away = Number(me.member?.days_away);
  memberDaysAway = Number.isFinite(away) && away >= 0 ? Math.floor(away) : null;
  memberNewSession = me.member?.new_session === true;
  memberPlacePromptState = readPlacePrompt(me.member?.place_prompt);
  // The first card of the visit. The server returns at most one of these three —
  // the answer slot holds one thing or nothing, and its precedence is settled
  // server-side — so adopting all of them is safe.
  const triage = readTriageCard(me.member?.triage_card);
  adoptTriageCard(triage);
  const followUp = readFollowUpCard(me.member?.follow_up);
  adoptFollowUpCard(followUp);
  memberFlagsLoaded = true;
  // Three things here change what a page outside the member area shows: whether
  // Curation sits in the masthead menu, whether there is a place to ask for, and
  // whether the landing has a card in its answer slot. None is the common case, so
  // most members' sessions still cost no redraw — and an ordinary member's home
  // map is left alone.
  if (foundingMember !== wasFounding || memberPlacePromptState || triage || followUp) render();
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
    // The popup is open whenever the dropdown is on screen, which is what the
    // attribute is for — it used to describe only the search results, and read
    // "collapsed" over an open list of the member's circle.
    input.setAttribute(
      'aria-expanded',
      String(state.focused && !state.selected)
    );
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

    // A full render replaced this field, so whatever focus it had is gone with it:
    // the flag is re-read from the document rather than trusted across the
    // rebuild, or a dropdown open when the circle payload landed would stay open
    // over an input the browser is no longer in.
    const bound = directoryState(key);
    if (bound.focused !== (document.activeElement === input)) {
      bound.focused = document.activeElement === input;
      updateDirectoryResults(root, key);
    }

    // Open on focus, close when focus leaves the field for good. `focusout` fires
    // with the incoming element, so focus moving to something inside the dropdown
    // is not focus leaving — otherwise the panel would close under a row on its
    // way to being pressed.
    container.addEventListener('focusin', () => {
      const state = directoryState(key);
      if (state.focused) return;
      state.focused = true;
      updateDirectoryResults(root, key);
    });
    container.addEventListener('focusout', (event) => {
      const next = event.relatedTarget;
      if (next instanceof Node && container.contains(next)) return;
      const state = directoryState(key);
      if (!state.focused) return;
      state.focused = false;
      state.activeIndex = -1;
      updateDirectoryResults(root, key);
    });
    // Safari does not focus a button when it is clicked, so a press inside the
    // panel would read as focus leaving the field — closing the dropdown, and
    // taking the row out of the DOM before its click could land. Refusing the
    // mousedown's default keeps the cursor in the input; the click still fires.
    output.addEventListener('mousedown', (event) => event.preventDefault());

    input.addEventListener('input', () => {
      const state = directoryState(key);
      // A dropdown dismissed with Escape reopens as soon as the member types
      // rather than staying shut over the results of what they are typing.
      state.focused = true;
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
      // Escape closes the dropdown itself, results or circle, and does it before
      // the guard below — there is nothing in `items` to walk when what is open is
      // the circle, and Escape has to work over that too.
      if (event.key === 'Escape' && state.focused) {
        state.items = [];
        state.activeIndex = -1;
        state.focused = false;
        updateDirectoryResults(root, key);
        return;
      }
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
      }
    });

    output.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const choice = target.closest<HTMLButtonElement>('[data-member-choice]');
      if (choice) {
        selectDirectoryMember(root, key, Number(choice.dataset.memberChoice));
        input.focus();
        return;
      }
      // A circle row names a person, so it still has to be looked up: the name
      // becomes the query and the directory turns it into the id the share is
      // addressed to. Everything refreshes through updateDirectoryResults rather
      // than a panel render, so a note already typed below survives the pick.
      const circleRow = target.closest<HTMLButtonElement>('[data-circle-recipient]');
      if (!circleRow) return;
      const pseudo = circleRow.dataset.circleRecipient || '';
      if (!pseudo) return;
      const state = directoryState(key);
      state.query = pseudo;
      state.selected = null;
      state.items = [];
      state.error = '';
      state.activeIndex = -1;
      state.loading = true;
      if (state.timer !== null) window.clearTimeout(state.timer);
      input.value = pseudo;
      updateDirectoryResults(root, key);
      input.focus();
      void lookupPseudo(pseudo).then((result) => {
        // The member may have started typing somebody else while this was in
        // flight; their query wins over the row they pressed.
        if (directoryState(key).query !== pseudo) return;
        applyPseudoLookup(state, pseudo, result);
        if (state.selected) input.value = pseudoLabel(state.selected.pseudo);
        updateDirectoryResults(root, key);
      });
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
  // Mounted where the panel actually is, rather than where the member-area tab
  // says it should be: the same panel is now the signed-in landing, which has no
  // member-area tab behind it.
  const detoursMounted = Boolean(root.querySelector('.community-detours-panel'));
  if (member() && detoursMounted && detourTab === 'shares') {
    bindMemberShares(root, render, (shareId) => {
      shares = shares.filter((share) => share.id !== shareId);
    });
    if (pendingShareRecipient) void resolveShareRecipient(render);
  }
  root.querySelectorAll<HTMLButtonElement>('[data-community-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      const requested = button.dataset.communityMode;
      mode =
        requested === 'join'
          ? 'join'
          : requested === 'sign-up'
            ? 'sign-up'
            : requested === 'forgot'
              ? 'forgot'
              : 'sign-in';
      // Leaving the invitation card drops the code with it. A code left prefilled
      // behind the open form would be spent by a member who chose not to use it.
      if (mode !== 'join') clearInvitationRoute();
      // Same rule for the reset token, which is a credential rather than a
      // prefill — and unconditional, because no tab on this strip is the reset
      // card: the emailed link is the only thing that opens it, so every one of
      // these buttons is a member walking away from it.
      clearPasswordResetRoute();
      // Asked for afresh, the Forgot card is a form again rather than the "check
      // your inbox" note the last send left behind.
      if (mode === 'forgot') resetEmailSent = false;
      notice = null;
      render();
    });
  });

  // Both signup cards keep their answers through the render a refusal causes —
  // see `joinDraft`. The password is put back by hand rather than through the
  // markup, so it is never written into a value attribute.
  const signupForm = root.querySelector<HTMLFormElement>(
    '[data-community-join], [data-community-sign-up]'
  );
  if (signupForm) {
    const passwordField = signupForm.querySelector<HTMLInputElement>('input[name="password"]');
    if (passwordField && joinDraft.password) passwordField.value = joinDraft.password;
    signupForm.querySelectorAll<HTMLInputElement>('input').forEach((field) => {
      field.addEventListener('input', () => {
        if (field.name === 'email') joinDraft.email = field.value;
        else if (field.name === 'password') joinDraft.password = field.value;
        else if (field.name === 'pseudo') joinDraft.pseudo = field.value;
        else if (field.name === 'home_city') joinDraft.city = field.value;
        else if (field.name === 'invite_code') invitationCodePrefill = field.value;
      });
    });
  }

  // The sign-in card and the Forgot card ask for the same address, and a member
  // who has just been refused is about to be asked for it again. Held as it is
  // typed so the handover between the two cards carries it either way round.
  root
    .querySelector<HTMLInputElement>(
      '[data-community-sign-in] input[name="email"], [data-community-forgot] input[name="email"]'
    )
    ?.addEventListener('input', (event) => {
      signInEmailDraft = (event.currentTarget as HTMLInputElement).value;
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
    // Share new is a blank form: a place named by an earlier route intent has
    // nothing to do with the share the member is starting here.
    sharePlacePrefill = '';
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
    sharePlacePrefill = '';
    // A half-filled recipient lookup must not survive a cancelled share.
    directories.delete('share-place');
    render();
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>('[data-share-open]')?.focus({ preventScroll: true });
    });
  });

  const activateDetourTab = (nextTab: DetourTab, focusTab: boolean) => {
    if (detourTab === nextTab) return;
    // The member has said which tab they want. The landing does not get to
    // second-guess that later in the session.
    detourTabChosen = true;
    detourTab = nextTab;
    if (nextTab === 'shares' && communityLoaded) void markIncomingSharesSeen();
    if (nextTab === 'saved') {
      void ensureSavedPlaces(render);
      void ensureGuides(render);
    }
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
    const firstRevealedId = waitlistEntries[queuePreviewLimit()]?.id || '';
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

  // Arriving from a place page's Edit, the card being edited is somewhere down a
  // grid of them. Put the member in front of it rather than at the top of a list
  // they now have to search.
  const pendingEditRow = recommendationIntent === 'edit' ? activeEditEntryId() : '';
  if (pendingEditRow) {
    window.requestAnimationFrame(() => {
      const row = document.getElementById(`waitlist-${pendingEditRow}`);
      row?.scrollIntoView({ block: 'center' });
    });
  }

  // Open the form for one place. Only one at a time: two half-finished edits on
  // one screen is a way to save the wrong one.
  root.querySelectorAll<HTMLButtonElement>('[data-entry-edit]').forEach((button) => {
    button.addEventListener('click', () => {
      const entryId = button.dataset.entryEdit || '';
      if (!entryId || submitting) return;
      editingEntryId = entryId;
      render();
      window.requestAnimationFrame(() => {
        const row = document.getElementById(`waitlist-${entryId}`);
        row?.scrollIntoView({ block: 'nearest' });
        row?.querySelector<HTMLElement>('input, textarea, select')?.focus({ preventScroll: true });
      });
    });
  });

  // Cancel closes the form and does nothing else. No confirmation, and nothing
  // written: an edit is only an edit once Save is pressed, so backing out of one
  // has nothing to undo.
  root.querySelectorAll<HTMLButtonElement>('[data-entry-edit-cancel]').forEach((button) => {
    button.addEventListener('click', () => {
      const entryId = button.dataset.entryEditCancel || '';
      if (submitting) return;
      editingEntryId = '';
      // An Edit pressed on a place page arrives as a draft rather than an id, so
      // Cancel has to drop that too or the form reopens on the next render.
      recommendationDraft = null;
      recommendationIntent = 'add';
      render();
      // Back to the control that opened it, rather than leaving focus nowhere.
      window.requestAnimationFrame(() => {
        const row = entryId ? document.getElementById(`waitlist-${entryId}`) : null;
        row?.querySelector<HTMLElement>('[data-entry-edit]')?.focus({ preventScroll: true });
      });
    });
  });

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
        const venue = knownVenues.find((item) => item.id === venueId);
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
        await refreshSavedPlaces(render);
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

  // Removal from the member's own Wanna go list. No confirmation, in keeping
  // with the rest of the rung: it is private, reversible, and one tap put it
  // there in the first place.
  root.querySelectorAll<HTMLButtonElement>('[data-saved-drop]').forEach((button) => {
    button.addEventListener('click', () => {
      const venueId = button.dataset.savedDrop || '';
      if (!venueId || button.disabled) return;
      void toggleSavedPlace(venueId, 'place_page', render);
    });
  });

  bindGuides(root, render);
  // The tab's own navigation: destination and source filters, and the per-city
  // expand. All three are view state — they never touch what the member holds.
  root.querySelectorAll<HTMLButtonElement>('[data-wanna-city]').forEach((button) => {
    button.addEventListener('click', () => {
      const slug = button.dataset.wannaCity || 'all';
      if (wannaGoCity === slug) return;
      wannaGoCity = slug;
      // A city chosen on purpose shows everything in it; the cap is only for the
      // all-cities glance.
      wannaGoShowAll.clear();
      render();
    });
  });
  root.querySelector<HTMLSelectElement>('[data-wanna-source]')?.addEventListener('change', (event) => {
    const value = (event.currentTarget as HTMLSelectElement).value as WannaGoSource;
    wannaGoSource = SOURCE_FILTERS.some(([option]) => option === value) ? value : 'all';
    render();
  });
  root.querySelectorAll<HTMLButtonElement>('[data-wanna-show-all]').forEach((button) => {
    button.addEventListener('click', () => {
      const slug = button.dataset.wannaShowAll || '';
      if (!slug) return;
      wannaGoShowAll.add(slug);
      render();
    });
  });
  bindImportedRemoval(root, render);

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

  // Either signup card is the whole account: the server requires a pseudo and a
  // home city on every public signup, and asking for them here rather than on a
  // second screen means one form holds everything one create call needs. What
  // src/onboarding.ts is left with is the part that is not the account — the first
  // place — which is why this hands over a session rather than a set of answers.
  //
  // ONE HANDLER FOR BOTH DOORS. The open card and the invitation card differ by a
  // single field, and it is the graph edge: with a code the new member lands
  // inside the issuer's circle, without one they start their own. Everything else
  // — the validation, the create call, the sign-in that follows, the recovery when
  // one of those fails — is identical, and a second copy of it would be the place
  // the two quietly stopped agreeing about what a pseudo is.
  const submitSignup = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();
    if (submitting) return;
    const form = event.currentTarget as HTMLFormElement;
    const withInvitation = form.hasAttribute('data-community-join');
    const values = new FormData(form);
    const email = String(values.get('email') || '').trim();
    const password = String(values.get('password') || '');
    const inviteCode = String(values.get('invite_code') || '').trim().toUpperCase();
    const pseudo = normalizePseudo(String(values.get('pseudo') || ''));
    const city = String(values.get('home_city') || '').trim();
    joinDraft.email = email;
    joinDraft.password = password;
    joinDraft.pseudo = pseudo;
    joinDraft.city = city;
    if (withInvitation) invitationCodePrefill = inviteCode;
    if (!email || (withInvitation && !inviteCode)) {
      notice = {
        kind: 'error',
        text: withInvitation
          ? 'Your email address and your invitation code are both needed.'
          : 'Your email address is needed.',
      };
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
        // Absent on the open card, and the server reads that absence as "start a
        // circle" rather than as a missing field.
        invite_code: withInvitation ? inviteCode : '',
      });
    } catch (error) {
      // The invitation is spent here, so an invalid or already-claimed code
      // surfaces here too. Saying which of the values the server refused is the
      // whole of the recovery: every one of them can be corrected in place.
      submitting = false;
      notice = {
        kind: 'error',
        text: readableError(
          error,
          withInvitation
            ? 'That invitation could not be accepted. Check the code on your invitation and try again.'
            : 'That account could not be created. Check the details above and try again.'
        ),
      };
      render();
      return;
    }
    try {
      await pb.collection('members').authWithPassword(email, password);
    } catch {
      // The account exists; only the session does not. The sign-in tab is the
      // shortest way to one, and an invitation given here has been spent, so
      // there is nothing left on this card to come back to.
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
  };

  root.querySelector<HTMLFormElement>('[data-community-join]')?.addEventListener('submit', submitSignup);
  root
    .querySelector<HTMLFormElement>('[data-community-sign-up]')
    ?.addEventListener('submit', submitSignup);

  root.querySelector<HTMLFormElement>('[data-community-sign-in]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget as HTMLFormElement);
    const email = String(values.get('email') || '').trim();
    // Kept before the attempt, so the refusal's own render puts the address back —
    // and so the Forgot card opens with it already filled in.
    signInEmailDraft = email;
    submitting = true;
    notice = null;
    render();
    try {
      await pb.collection('members').authWithPassword(email, String(values.get('password') || ''));
      submitting = false;
      signInEmailDraft = '';
      resetCommunityState();
      notice = null;
      onAuthed();
    } catch (error) {
      submitting = false;
      notice = { kind: 'error', text: readableError(error, 'Those sign-in details were not recognised.') };
      render();
    }
  });

  // Nothing here says whether the address has an account: PocketBase answers this
  // call the same way either way, and repeating that on the card is the point —
  // the form must not become a way to ask Detour who is a member.
  root.querySelector<HTMLFormElement>('[data-community-forgot]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
    const values = new FormData(event.currentTarget as HTMLFormElement);
    const email = String(values.get('email') || '').trim();
    signInEmailDraft = email;
    if (!email) {
      notice = { kind: 'error', text: 'Your email address is needed.' };
      render();
      return;
    }
    submitting = true;
    notice = null;
    render();
    try {
      await pb.collection('members').requestPasswordReset(email);
    } catch (error) {
      // A refusal here is about the request, not the account: an address the
      // server will not accept as one, or the network. The send itself happens
      // after the answer and cannot fail this call, which is also why a member
      // whose address has no account is told exactly what one who has is told.
      submitting = false;
      notice = {
        kind: 'error',
        text: readableError(error, 'That link could not be sent just now. Please try again in a minute.'),
      };
      render();
      return;
    }
    submitting = false;
    resetEmailSent = true;
    notice = { kind: 'success', text: `If ${email} has a Detour account, a reset link is on its way to it.` };
    render();
  });

  root.querySelector<HTMLFormElement>('[data-community-reset]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
    const token = routedResetToken || '';
    const values = new FormData(event.currentTarget as HTMLFormElement);
    const password = String(values.get('password') || '');
    const passwordConfirm = String(values.get('passwordConfirm') || '');
    if (!token) {
      // Only reachable if the token went away between render and submit. There is
      // nothing on this card to correct, so it hands over to the card that mints
      // a new link rather than leaving a dead form up.
      mode = 'forgot';
      resetEmailSent = false;
      notice = { kind: 'error', text: 'That reset link is no longer open. Ask for a new one and try again.' };
      render();
      return;
    }
    if (password.length < 8) {
      notice = { kind: 'error', text: 'Use a password of at least eight characters.' };
      render();
      return;
    }
    // Checked here as well as by the server, because the server's answer to this
    // one is a 400 that reads like a problem with the link.
    if (password !== passwordConfirm) {
      notice = { kind: 'error', text: 'Those two passwords are not the same.' };
      render();
      return;
    }
    submitting = true;
    notice = null;
    render();
    try {
      await pb.collection('members').confirmPasswordReset(token, password, passwordConfirm);
    } catch (error) {
      submitting = false;
      // The server refuses a spent or expired token as a problem with the `token`
      // field, which is nothing the form can fix. Dropping it turns the card into
      // its own dead-end state — the same one an expired link lands on, with the
      // button that mints a fresh one — rather than leaving a password form up in
      // front of a link that will refuse it again.
      const tokenRefused = Boolean(
        (error as { response?: { data?: { token?: unknown } } })?.response?.data?.token
      );
      if (tokenRefused) clearPasswordResetRoute();
      notice = {
        kind: 'error',
        text: tokenRefused
          ? 'That reset link has expired or been used already. Ask for a new one and try again.'
          : readableError(error, 'That password could not be saved. Please try again.'),
      };
      render();
      return;
    }
    // The password has changed, which spends the token and kills every session
    // that predates it — including one this browser may still be holding. Both go
    // before anything else: what follows either mints a new session or shows the
    // sign-in card, and neither may run with the old one still in the store.
    //
    // The card becomes the sign-in card first, and on purpose. Clearing the store
    // renders synchronously (main.ts watches the auth store), and a reset card
    // whose token has just gone would draw that frame as "this link has expired" —
    // the one thing that did not happen.
    const email = emailFromResetToken(token);
    mode = 'sign-in';
    signInEmailDraft = email;
    clearPasswordResetRoute();
    resetCommunityState();
    pb.authStore.clear();
    try {
      // The token names who it was for, so the member does not have to type the
      // address again to use the password they just chose.
      if (!email) throw new Error('The reset link does not say which account it is for.');
      await pb.collection('members').authWithPassword(email, password);
    } catch {
      // The password is changed either way — this is only the session. The
      // sign-in card is the shortest way to one, with the address already in it.
      submitting = false;
      notice = { kind: 'success', text: 'Your new password is saved. Sign in with it.' };
      render();
      return;
    }
    submitting = false;
    signInEmailDraft = '';
    notice = null;
    onAuthed();
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

  root.querySelector<HTMLInputElement>('[data-invite-hint]')?.addEventListener('input', (event) => {
    inviteHintDraft = (event.currentTarget as HTMLInputElement).value;
  });

  root.querySelector<HTMLButtonElement>('[data-community-invite]')?.addEventListener('click', async () => {
    if (!member() || !invitesLoaded || loadingInvites || openInvites().length >= invitationLimit) return;
    // The server decides this too, and forces it off for anyone but the Founder.
    const grantsFounding = canGrantFounding && inviteGrantsFounding;
    const hint = inviteHintDraft.trim();
    submitting = true;
    notice = null;
    render();
    try {
      await pb.collection('invites').create({
        ...(grantsFounding ? { grants_founding: true } : {}),
        ...(hint ? { hint } : {}),
      });
      invitesLoaded = false;
      // Back to an ordinary invitation: the choice is made per invitation, and a
      // seat should never be spent because the toggle was still on from last time.
      inviteGrantsFounding = false;
      inviteHintDraft = '';
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

  root.querySelectorAll<HTMLButtonElement>('[data-remove-invite]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.removeInvite || '';
      if (!id || submitting) return;
      if (!window.confirm('Remove this invitation? The link will stop working.')) return;
      submitting = true;
      notice = null;
      render();
      try {
        await pb.collection('invites').delete(id);
        invites = invites.filter((invite) => invite.id !== id);
        notice = { kind: 'info', text: 'Invitation removed.' };
      } catch (error) {
        notice = { kind: 'error', text: readableError(error, 'That invitation could not be removed. Please try again.') };
      } finally {
        submitting = false;
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
   * mean without losing their words, their photo or the kind of place they said
   * it was: answering re-renders the panel, and a file input cannot be
   * repopulated from markup, so the File has to outlive the form it was chosen
   * in.
   */
  const sendRecommendation = async (
    payload: Record<string, string | string[]>,
    photo: File | null,
    held: { venueName: string; city: string; note: string; category?: string }
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
      // What a place is good for is still not asked before the note is written —
      // it is a list of checkboxes, not one tap like the category — so the ledger
      // line is where it gets added. Worth saying once here, because the occasion
      // filters on discovery are what it feeds.
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
        pendingCollision = {
          collision,
          ...held,
          category: held.category || '',
          photo,
          distinguishing: Boolean(askedFor),
        };
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

  const recommendationForm = root.querySelector<HTMLFormElement>('[data-community-recommendation]');
  if (recommendationForm) bindMapLinkField(recommendationForm);

  recommendationForm?.addEventListener('submit', async (event) => {
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
      category,
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
        // Joining an existing place carries the category too: the create hook
        // fills a blank one and never overwrites what the first member said, so
        // this can only add a fact the place was missing.
        ...(pending.category ? { category: pending.category } : {}),
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
        ...(pending.category ? { category: pending.category } : {}),
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
        // Saved is finished: the card comes back with its strip, rather than
        // leaving the form up as though there were more to do.
        editingEntryId = '';
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
    const note = String(values.get('personal_note') || '').trim();
    const venue = matchVenue(place);
    // Only a place already on Detour can be sent. A name the catalogue does not
    // know is not a share with a missing address any more — it is a place nobody
    // has recommended, and recommending is how one arrives.
    if (!venue) {
      notice = {
        kind: 'error',
        text: 'Pick a food-and-drink destination from the list. To send somewhere that is not there yet, recommend it first.',
      };
      render();
      return;
    }
    submitting = true;
    notice = null;
    render();
    try {
      await pb.collection('community_shares').create({
        venue: venue.id,
        recipient: selected.id,
        personal_note: note,
      });
      directories.delete('share-place');
      // Sent: the panel returns to the deck, where the new share is listed.
      shareFormOpen = false;
      sharePlacePrefill = '';
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

  // A CTA that says Recommend or Share has to land on the form, not
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
      if (detourTab === 'shares') void markIncomingSharesSeen();
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
