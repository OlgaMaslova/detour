/**
 * The community area's shared kernel.
 *
 * Everything mutable that more than one community module writes lives on
 * `store` — the member session, the ledger and shares every tab reads, the
 * catalogue handed in by main.ts, the member-standing flags, and the notice
 * line. State a single feature owns stays in that feature's own module; this
 * file also holds the community-wide data load and the session reset every
 * feature registers into.
 */
import { pb } from '../pocketbase';
import type { Venue } from '../data';
import type { NetworkPlaceResolver } from '../network';
import type { PlacePrompt } from '../place-prompt';
import { adoptFollowUpCard, readFollowUpCard, resetFollowUp } from '../follow-up';
import { adoptTriageCard, readTriageCard, resetTriage } from '../triage';
import {
  refreshSavedPlaces,
  resetSavedPlaces,
  savedPlaces,
  savedPlacesLoaded,
} from '../saved';
import { guides, guidesLoaded, resetGuides } from '../guides';
import type { RecordModel } from 'pocketbase';

/**
 * The member area's own tabs. My detours is NOT among them: it is the signed-in
 * landing now (docs/landing-spec.md), so listing it here too would give one
 * surface two homes and a member two places to look for their own places.
 * Everything left is account business — who they can invite, how they appear,
 * and the founding circle's review queue.
 */
export type MemberTab = 'invitations' | 'settings' | 'curation';
export type DetourTab = 'recommendations' | 'saved' | 'endorsements' | 'shares';
export type NoticeKind = 'success' | 'error' | 'info';

export interface MemberRecord extends RecordModel {
  email?: string;
  display_name?: string;
  pseudo?: string;
  community_status?: string;
  discovery_visible?: boolean;
  home_city?: string;
  home_country?: string;
}
export interface PlaceEntry {
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

export interface RecommendationRecord {
  id: string;
  entry?: string;
  note?: string;
  venue_name?: string;
  city?: string;
  country?: string;
  category?: string;
  occasions?: string[];
  created?: string;
}

export interface ShareRecord {
  id: string;
  sender?: string;
  recipient?: string;
  entry?: string;
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
export interface Notice {
  kind: NoticeKind;
  text: string;
}
// The invitation allowance is server policy: founding members keep more codes
// open at once than regular members. The server reports the member's computed
// limit (the founding markers themselves are hidden fields), so the panel shows
// the baseline until that arrives and never invents a larger allowance.
const BASELINE_INVITATION_LIMIT = 10;

/**
 * The state more than one community module writes.
 *
 * A single mutable object rather than module-level lets, because ES module
 * bindings are read-only from outside: a feature module can read an imported
 * `let` but never assign it, and nearly everything here is assigned from two
 * or more features. Fields a single feature owns do not belong here — they
 * stay private to that feature's module.
 */
export const store = {
  memberTab: 'invitations' as MemberTab,
  detourTab: 'recommendations' as DetourTab,
  // Whether the landing has already picked a tab, or the member has picked one
  // themselves. Either way the landing stops choosing — see settleLandingTab.
  detourTabChosen: false,
  notice: null as Notice | null,
  knownVenues: [] as Venue[],
  placeEntries: [] as PlaceEntry[],
  recommendations: [] as RecommendationRecord[],
  placeEntriesLoaded: false,
  shares: [] as ShareRecord[],
  lockedEntryIds: new Set<string>(),
  communityLoaded: false,
  loadingCommunity: false,
  submitting: false,
  invitationLimit: BASELINE_INVITATION_LIMIT,
  foundingMember: false,
  // Whether this member may offer one of the fifty founding seats with an
  // invitation. The Founder alone, as the server decides it — every other
  // member's invitations are ordinary, and they are never shown the choice.
  canGrantFounding: false,
  // Whether the next invitation created here offers a founding seat.
  // Deliberately resets to off after every issue: a founding invitation is the
  // exception, and a toggle left on would spend the fifty by inattention.
  inviteGrantsFounding: false,
  imageCurationCount: 0,
  // Set when a route intent — a landing CTA, a place page, a ?recommend= link —
  // opened the recommend or share form, so the render that follows can reveal it.
  pendingFormReveal: null as 'recommendation' | 'share' | null,
  // How a place name becomes a link to its own page. Owned by main.ts, which
  // holds the catalogue; passed in rather than rebuilt here so a card in My
  // detours resolves exactly as the same card does in the feed.
  //
  // SET EVERY RENDER, from main.ts — see `setPlaceResolver`.
  landingPlaceResolver: undefined as NetworkPlaceResolver | undefined,
};

// The member's own standing belongs to the session, not to the member area: the
// masthead menu on every surface asks whether this member curates, so the answer
// is fetched once as soon as a session is present and held until sign-out.
// Fetched-once bookkeeping that only this module touches, so plain lets.
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
/**
 * Whether a ledger read is in flight, as reentrancy bookkeeping.
 *
 * Separate from `store.loadingCommunity`, which is the *visible* flag the panel
 * turns into "Loading…". A background re-read — the live stream noticed a change,
 * or the tab came back to the front — must not put the member's own list behind a
 * loading line for nothing, but it still has to be prevented from racing another
 * read. So the guard and the announcement are two different things now.
 */
let communityInFlight = false;

/**
 * What each feature module does with its own state when the session ends.
 *
 * Registered rather than imported, because the dependency points the other way:
 * every feature imports this module, and a reset list written here as imports
 * would close that loop. Modules register at load time, and the community area
 * is only ever used through ./index, which loads them all.
 */
const featureResets: Array<() => void> = [];

export function onCommunityReset(reset: () => void): void {
  featureResets.push(reset);
}

export function resetCommunityState(): void {
  store.memberTab = 'invitations';
  store.detourTab = 'recommendations';
  store.pendingFormReveal = null;
  store.placeEntries = [];
  store.recommendations = [];
  store.placeEntriesLoaded = false;
  store.shares = [];
  store.lockedEntryIds = new Set<string>();
  store.communityLoaded = false;
  store.loadingCommunity = false;
  // A signed-out shell must not keep the previous member's allowance.
  store.invitationLimit = BASELINE_INVITATION_LIMIT;
  store.foundingMember = false;
  store.canGrantFounding = false;
  store.inviteGrantsFounding = false;
  store.imageCurationCount = 0;
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
  // Each feature's own state — form drafts, dialogue holds, view filters.
  for (const reset of featureResets) reset();
}
export function esc(value: string | undefined | null): string {
  return (value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function member(): MemberRecord | null {
  if (!pb.authStore.isValid || !pb.authStore.record) return null;
  return pb.authStore.record as unknown as MemberRecord;
}

/** Persist a profile update in the auth store as well as in PocketBase.
 * Record updates return the new member but do not refresh the SDK auth cache,
 * and member() reads that cache on every render. */
export function syncMemberRecord(original: MemberRecord, updated: MemberRecord): boolean {
  if (member()?.id !== original.id) return false;
  pb.authStore.save(pb.authStore.token, { ...original, ...updated });
  return true;
}

export function memberName(record: MemberRecord): string {
  const pseudo = record.pseudo?.trim().replace(/^@+/, '');
  return pseudo || record.display_name?.trim() || record.email?.split('@')[0] || 'Member';
}
/**
 * Only what the server itself said. The SDK writes its own placeholder into
 * `error.message` when nothing answered at all — "Something went wrong." — which
 * says less than the fallback and does not tell anyone to try again.
 */
export function readableError(error: unknown, fallback: string): string {
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
export function cleanCount(value: unknown, maximum?: number): number {
  const count = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return typeof maximum === 'number' ? Math.min(count, maximum) : count;
}
export function noticeMarkup(): string {
  if (!store.notice) return '';
  const role = store.notice.kind === 'error' ? 'alert' : 'status';
  return `<p class="community-notice community-notice-${store.notice.kind}" role="${role}" tabindex="-1">${esc(store.notice.text)}</p>`;
}
/** Pseudos read as plain handles on screen — no decorative @ in front. The
 *  leading-@ strip only guards against a typist's @ surviving into storage. */
export function pseudoLabel(pseudo: string | undefined, fallback = 'A Detour member'): string {
  const cleaned = pseudo?.trim().replace(/^@+/, '');
  return cleaned || fallback;
}
export function incomingShares(): ShareRecord[] {
  const id = member()?.id;
  return store.shares.filter((share) => Boolean(id && share.recipient === id) && !share.archived);
}
export function formatDate(value: string | undefined): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(parsed);
}
/**
 * Tell this module how to turn a place's name into a link to its own page.
 *
 * Called by main.ts at the top of every render, because a card is a link on every
 * surface or it is a bug on one of them: the resolver needs the catalogue and the
 * routes, both of which live there, and a card's own markup cannot ask for it.
 */
export function setPlaceResolver(resolve: NetworkPlaceResolver | undefined): void {
  store.landingPlaceResolver = resolve;
}
export function unseenShareCount(): number {
  return incomingShares().filter((share) => !share.seen).length;
}
/**
 * The community strip is a day-one scaffold, not permanent landing content.
 * Use the exact list that renders the Recommendations tab, and wait for it to
 * load successfully before deciding it is empty. A slow or failed request must
 * not flash the strip for a returning member who already has cards there.
 */
export function shouldShowLandingCommunityStrip(): boolean {
  return Boolean(member()) && store.communityLoaded && store.placeEntriesLoaded && store.placeEntries.length === 0;
}

/** The compact Feed route replaces the full day-one strip once this list exists. */
export function shouldShowLandingFeedCta(): boolean {
  return Boolean(member()) && store.communityLoaded && store.placeEntriesLoaded && store.placeEntries.length > 0;
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
  if (store.detourTabChosen) return;
  store.detourTabChosen = true;
  if (store.placeEntries.length) return;
  if (savedPlacesLoaded() && savedPlaces().length) {
    store.detourTab = 'saved';
    return;
  }
  // A member whose only places are ones they imported opens on the tab holding
  // them, for the same reason as above: the first thing they see should be a
  // list rather than an empty state.
  if (guidesLoaded() && guides().length) {
    store.detourTab = 'saved';
    return;
  }
  if (unseenShareCount() || store.shares.length) {
    store.detourTab = 'shares';
    return;
  }
  const marked = store.knownVenues.some((venue) => venue.endorsedByCaller);
  if (marked) store.detourTab = 'endorsements';
}

/**
 * A place has just landed on this member's own list.
 *
 * The landing picks its opening tab once, from what the member has; a place added
 * during the visit arrives after that decision and would otherwise leave them
 * looking at the tab that was empty when they got here.
 */
export function markDetoursHaveContent(): void {
  store.detourTabChosen = true;
  store.detourTab = 'recommendations';
}
/** Drop the session. Callers re-render; the masthead falls back to "Members". */
export function signOutMember(): void {
  pb.authStore.clear();
  resetCommunityState();
  store.notice = { kind: 'info', text: 'You have signed out of Detour.' };
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
  store.notice = {
    kind: 'info',
    text: 'Your session expired, so you have been signed out. Sign in again to see your circle.',
  };
}
/**
 * Read the member's own ledger: their places, their notes, their shares, and which
 * places the server has locked.
 *
 * `quiet` is for a re-read nobody asked for — the live stream saw a change, or the
 * tab came back after a while. It fetches exactly the same things and says nothing
 * while it does: the list already on screen is real, so replacing it with a loading
 * line would be a worse answer than the one it is holding. A read the member set
 * off themselves is not quiet, because they pressed something and the screen should
 * admit it is working.
 *
 * A failed read leaves every store as it was, quiet or not.
 */
export async function loadCommunity(
  render: () => void,
  options: { quiet?: boolean } = {}
): Promise<void> {
  const signedInAs = member()?.id;
  if (!signedInAs || communityInFlight) return;
  communityInFlight = true;
  if (!options.quiet) {
    store.loadingCommunity = true;
    store.placeEntriesLoaded = false;
    render();
  }
  const results = await Promise.allSettled([
    pb.collection('community_place_entries').getFullList<PlaceEntry>({ sort: '-updated', requestKey: null }),
    pb.collection('community_shares').getFullList<ShareRecord>({ sort: '-created', requestKey: null }),
    pb.collection('community_recommendations').getFullList<RecommendationRecord>({ sort: '-created', requestKey: null }),
    pb.send<{ ids?: string[] }>('/api/detour/community/place-locks', { requestKey: null }),
  ]);
  // Released the moment the requests are back: everything below this line is
  // synchronous, so nothing can interleave with it, and a throw in it must not be
  // able to leave the guard closed against every later read.
  communityInFlight = false;
  // A session that changed hands mid-flight is answered by its own read, never by
  // this one. Without this the previous member's ledger lands in a store that has
  // already been cleared for somebody else.
  if (member()?.id !== signedInAs) return;

  // A quiet re-read that failed keeps the list it already had and stays loaded: it
  // is the same rows the server last sent, and a background request nobody asked
  // for must not be able to empty the member's own screen.
  if (results[0].status === 'fulfilled' || !options.quiet) {
    store.placeEntriesLoaded = results[0].status === 'fulfilled';
  }
  if (results[0].status === 'fulfilled') store.placeEntries = results[0].value;
  if (results[1].status === 'fulfilled') store.shares = results[1].value;
  if (results[2].status === 'fulfilled') store.recommendations = results[2].value;
  if (results[3].status === 'fulfilled') {
    store.lockedEntryIds = new Set(
      Array.isArray(results[3].value.ids)
        ? results[3].value.ids.filter((id): id is string => typeof id === 'string')
        : []
    );
  }

  const failure = results.find((result) => result.status === 'rejected');
  // And it says nothing about it either. An error bar arriving over an untouched
  // screen, in answer to nothing the member did, reports a problem they cannot act
  // on — the next pass will either succeed or the read they do ask for will say so.
  if (failure?.status === 'rejected' && !options.quiet) {
    store.notice = { kind: 'error', text: readableError(failure.reason, 'Some community details could not be loaded. Please try again.') };
  }
  store.communityLoaded = true;
  store.loadingCommunity = false;
  // Writing a place hides any save the member had on it, and deleting the note
  // brings that save back — the row is never destroyed on the way up the ladder.
  // This reload is what every recommendation write ends with, so it is where the
  // Wanna go list catches up. A quiet pass skips it: that pass is part of a full
  // resync, which re-reads the saved list on its own account.
  if (!options.quiet) void refreshSavedPlaces(render);
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
  const wasFounding = store.foundingMember;
  const reported = Number(me.member?.invitation_limit);
  // A backend without the field, or a nonsense value, leaves the baseline in
  // place rather than granting or removing an allowance the server did not state.
  store.invitationLimit =
    Number.isFinite(reported) && reported >= BASELINE_INVITATION_LIMIT
      ? Math.floor(reported)
      : BASELINE_INVITATION_LIMIT;
  store.foundingMember = me.member?.founding_member === true;
  store.canGrantFounding = me.member?.can_grant_founding === true;
  if (!store.canGrantFounding) store.inviteGrantsFounding = false;
  store.imageCurationCount = store.foundingMember ? cleanCount(me.member?.image_curation_count) : 0;
  if (!store.foundingMember && store.memberTab === 'curation') store.memberTab = 'settings';
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
  if (store.foundingMember !== wasFounding || memberPlacePromptState || triage || followUp) render();
}
export function focusNotice(root: HTMLElement): void {
  window.requestAnimationFrame(() => {
    const target = root.querySelector<HTMLElement>('.community-notice');
    target?.scrollIntoView({
      block: 'start',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
    target?.focus({ preventScroll: true });
  });
}
