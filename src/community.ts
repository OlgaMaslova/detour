import { pb } from './pocketbase';
import type { Venue } from './data';

type CommunityMode = 'sign-in' | 'join';
type NoticeKind = 'success' | 'error' | 'info';
type CommunityStatus = 'unverified' | 'verified';

interface MemberRecord {
  id: string;
  email?: string;
  display_name?: string;
  community_status?: CommunityStatus;
}

interface CommunitySnapshot {
  member: {
    id: string;
    display_name?: string;
    community_status: CommunityStatus;
  };
  endorsements: {
    qualifying_count: number;
    outgoing_active_count: number;
    limit: number;
  };
}

interface InviteRecord {
  id: string;
  code?: string;
  claimed_by?: string;
  claimed_at?: string;
  created?: string;
}

interface WaitlistEntry {
  id: string;
  venue_name?: string;
  city?: string;
  country?: string;
  status?: 'pending' | 'published';
  signal_count?: number;
  created?: string;
  updated?: string;
}

interface RecommendationRecord {
  id: string;
  waitlist?: string;
  note?: string;
  venue_name?: string;
  city?: string;
  country?: string;
  created?: string;
}

interface ShareRecord {
  id: string;
  sender?: string;
  recipient?: string;
  waitlist?: string;
  personal_note?: string;
  venue_name?: string;
  city?: string;
  country?: string;
  created?: string;
}

interface DirectoryMember {
  id: string;
  display_name: string;
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

let mode: CommunityMode = 'sign-in';
let notice: Notice | null = null;
let snapshot: CommunitySnapshot | null = null;
let waitlistEntries: WaitlistEntry[] = [];
let recommendations: RecommendationRecord[] = [];
let shares: ShareRecord[] = [];
let communityLoaded = false;
let loadingCommunity = false;
let invites: InviteRecord[] = [];
let invitesLoaded = false;
let loadingInvites = false;
let submitting = false;
let highlightedWaitlistId = '';
const directories = new Map<string, DirectoryState>();

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

function currentStatus(): CommunityStatus {
  return snapshot?.member.community_status || member()?.community_status || 'unverified';
}

function memberName(record: MemberRecord): string {
  return snapshot?.member.display_name?.trim() || record.display_name?.trim() || record.email?.split('@')[0] || 'Member';
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

function cleanCount(value: unknown, maximum?: number): number {
  const count = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return typeof maximum === 'number' ? Math.min(count, maximum) : count;
}

function meaningfulRecommendation(note: string): boolean {
  const cleaned = note.trim().replace(/\s+/g, ' ');
  const words = cleaned
    .split(' ')
    .map((word) => word.replace(/[.,!?;:'"()\[\]{}<>/\\|`~@#$%^&*+=_-]+/g, ''))
    .filter((word) => word.length >= 2);
  return cleaned.length >= 24 && words.length >= 5;
}

function noticeMarkup(): string {
  if (!notice) return '';
  const role = notice.kind === 'error' ? 'alert' : 'status';
  return `<p class="community-notice community-notice-${notice.kind}" role="${role}">${esc(notice.text)}</p>`;
}

function openInvites(): InviteRecord[] {
  return invites.filter((invite) => !invite.claimed_by);
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

function directoryResultsMarkup(key: string): string {
  const state = directoryState(key);
  if (state.selected) {
    return `<p class="member-directory-selected"><span>Selected</span><strong>${esc(state.selected.display_name)}</strong></p>`;
  }
  if (state.query.trim().length < 2) {
    return '<p class="member-directory-hint">Type at least two characters. Results show names only.</p>';
  }
  if (state.loading) return '<p class="member-directory-hint" role="status">Searching member names…</p>';
  if (state.error) return `<p class="member-directory-error" role="alert">${esc(state.error)}</p>`;
  if (!state.items.length) return '<p class="member-directory-hint">No matching member names.</p>';
  return `<ul class="member-directory-results" role="listbox">${state.items
    .map(
      (item, index) =>
        `<li><button type="button" role="option" id="${directoryListId(key)}-option-${index}" aria-selected="${state.activeIndex === index}" data-member-choice="${index}">${esc(item.display_name)}</button></li>`
    )
    .join('')}</ul>`;
}

function directoryMarkup(key: string, label: string, help: string): string {
  const state = directoryState(key);
  const listId = directoryListId(key);
  return `<div class="member-directory" data-member-directory="${esc(key)}">
    <label>${esc(label)}
      <input type="search" value="${esc(state.query)}" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="${state.items.length > 0}" aria-controls="${listId}" ${state.activeIndex >= 0 ? `aria-activedescendant="${listId}-option-${state.activeIndex}"` : ''} data-member-search>
    </label>
    <p class="community-field-help">${esc(help)}</p>
    <div id="${listId}" class="member-directory-output" data-member-results>${directoryResultsMarkup(key)}</div>
  </div>`;
}

function signedOutPanel(): string {
  const isJoin = mode === 'join';
  return `<section class="community-panel community-panel-auth" aria-label="Detour membership">
    <div class="community-panel-intro">
      <p class="community-kicker">The detourist circle</p>
      <h2>${isJoin ? 'Join through a trusted introduction.' : 'Return to your Detour.'}</h2>
      <p>${
        isJoin
          ? 'Membership begins with a personal invitation from an existing detourist.'
          : 'Sign in to see trusted introductions, private place shares, and the shared waiting list.'
      }</p>
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
              <label>How should we know you?<input name="display_name" autocomplete="name" maxlength="100" required></label>
              <label>Email address<input name="email" type="email" autocomplete="email" required></label>
              <div class="community-form-grid">
                <label>Password<input name="password" type="password" autocomplete="new-password" minlength="8" required></label>
                <label>Confirm password<input name="passwordConfirm" type="password" autocomplete="new-password" minlength="8" required></label>
              </div>
              <label>Invitation code<input name="invite_code" autocomplete="off" spellcheck="false" maxlength="80" placeholder="DTR-…" required></label>
              <p class="community-form-note">Every invitation is personal and can be used once.</p>
              <button class="community-primary" type="submit" ${submitting ? 'disabled' : ''}>${submitting ? 'Joining…' : 'Join Detour'}</button>
            </form>`
          : `<form class="community-form" data-community-sign-in>
              <label>Email address<input name="email" type="email" autocomplete="email" required></label>
              <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
              <button class="community-primary" type="submit" ${submitting ? 'disabled' : ''}>${submitting ? 'Signing in…' : 'Sign in'}</button>
              <p class="community-form-note">New here? You’ll need a personal invitation to join.</p>
            </form>`
      }
    </div>
  </section>`;
}

function verificationPanel(): string {
  const status = currentStatus();
  const verified = status === 'verified';
  const qualifying = cleanCount(snapshot?.endorsements.qualifying_count, 2);
  const outgoing = cleanCount(snapshot?.endorsements.outgoing_active_count, 3);
  const limit = snapshot?.endorsements.limit || 3;

  return `<section class="community-status-ledger" aria-labelledby="community-status-title">
    <div class="community-status-copy">
      <p class="community-kicker">Community standing</p>
      <h3 id="community-status-title">${verified ? 'Verified member' : 'Endorsement progress'}</h3>
      <p>${
        verified
          ? 'Your community membership is active. You can recommend places, share pending entries privately, and endorse other members.'
          : 'Recommendations and private sharing unlock after two active endorsements from verified members.'
      }</p>
      <p class="community-trust-note">Olga curates founding members. After the founding circle, verification comes from two active endorsements by verified members. Email confirmation only secures account access; it is not community trust.</p>
    </div>
    <div class="community-status-metrics">
      <div class="community-progress" aria-label="Qualifying endorsement progress">
        <p class="community-progress-label">Qualifying endorsements</p>
        <p class="community-progress-count"><strong>${snapshot ? qualifying : '—'}</strong><span>/2</span></p>
        <div class="community-progress-track" aria-hidden="true"><span style="width: ${snapshot ? (qualifying / 2) * 100 : 0}%"></span></div>
        <p>${snapshot ? (verified ? (qualifying >= 2 ? 'Endorsement threshold met' : 'Founding verification active') : `${2 - qualifying} more needed`) : 'Checking your community status…'}</p>
      </div>
      ${
        verified
          ? `<div class="community-allowance" aria-label="Outgoing endorsement allowance">
              <p class="community-progress-label">Active endorsements given</p>
              <p class="community-allowance-count"><strong>${snapshot ? outgoing : '—'}</strong><span>of ${limit}</span></p>
              <p>${snapshot ? `${Math.max(0, limit - outgoing)} endorsement ${Math.max(0, limit - outgoing) === 1 ? 'place' : 'places'} available.` : 'Checking your allowance…'}</p>
            </div>`
          : ''
      }
    </div>
  </section>`;
}

function endorsementPanel(): string {
  if (currentStatus() !== 'verified') return '';
  const outgoing = cleanCount(snapshot?.endorsements.outgoing_active_count, 3);
  const limit = snapshot?.endorsements.limit || 3;
  const atCap = outgoing >= limit;
  return `<section class="community-ledger-section" aria-labelledby="endorse-member-title">
    <div class="community-section-heading">
      <div><p class="community-kicker">Trusted introductions</p><h3 id="endorse-member-title">Endorse a member</h3></div>
      <p>An endorsement is an active vote of confidence, not a public profile signal.</p>
    </div>
    <div class="community-action-grid">
      <form class="community-form community-endorsement-form" data-community-endorsement>
        ${directoryMarkup('endorsement', 'Find a member by name', 'Search is private and returns display names only.')}
        <button class="community-primary" type="submit" ${submitting || atCap ? 'disabled' : ''}>${atCap ? 'Allowance reached' : submitting ? 'Endorsing…' : 'Create endorsement'}</button>
      </form>
      <div class="community-guidance ${atCap ? 'is-warning' : ''}">
        <strong>${atCap ? 'Three active endorsements reached' : `${Math.max(0, limit - outgoing)} of ${limit} available`}</strong>
        <p>${atCap ? 'The server will prevent another active endorsement until your allowance changes.' : 'Only the member you choose and the private community system can use this endorsement. No trust graph is shown here.'}</p>
      </div>
    </div>
  </section>`;
}

function recommendationFor(waitlistId: string): RecommendationRecord | undefined {
  return recommendations.find((item) => item.waitlist === waitlistId);
}

function incomingShares(): ShareRecord[] {
  const id = member()?.id;
  return shares.filter((share) => Boolean(id && share.recipient === id));
}

function outgoingShares(): ShareRecord[] {
  const id = member()?.id;
  return shares.filter((share) => Boolean(id && share.sender === id));
}

function waitlistCard(entry: WaitlistEntry): string {
  const verified = currentStatus() === 'verified';
  const progress = cleanCount(entry.signal_count, 3);
  const published = entry.status === 'published';
  const ownRecommendation = recommendationFor(entry.id);
  const incoming = incomingShares().some((share) => share.waitlist === entry.id);
  const directoryKey = `share-${entry.id}`;
  return `<article class="community-queue-card${highlightedWaitlistId === entry.id ? ' is-highlighted' : ''}" id="waitlist-${esc(entry.id)}" tabindex="-1">
    <div class="community-queue-head">
      <div><h4>${esc(entry.venue_name || 'Unnamed place')}</h4><p>${esc([entry.city, entry.country].filter(Boolean).join(', '))}</p></div>
      <span class="community-queue-status is-${published ? 'published' : 'pending'}">${published ? 'Published' : 'Waiting list'}</span>
    </div>
    <div class="community-signal" aria-label="${progress} of 3 independent recommendations">
      <div class="community-signal-label"><span>Independent signals</span><strong>${progress}/3</strong></div>
      <div class="community-signal-track" aria-hidden="true"><span style="width: ${(progress / 3) * 100}%"></span></div>
    </div>
    <p class="community-queue-context">${
      published
        ? 'Three independent recommendations brought this place into the shared Detour selection.'
        : ownRecommendation
          ? 'Your recommendation is counted here. Other members’ identities and notes remain private.'
          : incoming
            ? 'This place was shared with you privately. Add your own recommendation from the share below.'
            : 'You can see this entry because you are a private participant.'
    }</p>
    ${
      verified && !published
        ? `<details class="community-share-disclosure">
            <summary>Share this pending place privately</summary>
            <form class="community-form community-share-form" data-community-share data-waitlist="${esc(entry.id)}">
              ${directoryMarkup(directoryKey, 'Share with a member', 'Only the recipient sees your note. Search results show names only.')}
              <label>Personal note<textarea name="personal_note" rows="3" maxlength="1200" minlength="8" required placeholder="Why you thought of them for this place"></textarea></label>
              <button class="community-secondary" type="submit" ${submitting ? 'disabled' : ''}>${submitting ? 'Sharing…' : 'Share privately'}</button>
            </form>
          </details>`
        : ''
    }
  </article>`;
}

function recommendationPanel(): string {
  const verified = currentStatus() === 'verified';
  return `<section class="community-ledger-section" aria-labelledby="community-waitlist-title">
    <div class="community-section-heading">
      <div><p class="community-kicker">Shared publishing</p><h3 id="community-waitlist-title">Community waiting list</h3></div>
      <p>Three independent member recommendations publish a place into the shared selection.</p>
    </div>
    ${
      verified
        ? `<div class="community-action-grid community-recommend-action">
            <form class="community-form" data-community-recommendation>
              <label>Place name<input name="venue_name" maxlength="200" required placeholder="The place you would send someone"></label>
              <div class="community-form-grid community-place-grid">
                <label>City<input name="city" maxlength="120" required placeholder="Madrid"></label>
                <label>Country<input name="country" maxlength="120" required placeholder="Spain"></label>
              </div>
              <label>Your recommendation<textarea name="note" rows="5" maxlength="2400" minlength="24" required placeholder="What makes this place worth a deliberate detour?"></textarea></label>
              <p class="community-field-help">Use at least 24 characters and five meaningful words. Your note stays private.</p>
              <button class="community-primary" type="submit" ${submitting ? 'disabled' : ''}>${submitting ? 'Adding…' : 'Add to the waiting list'}</button>
            </form>
            <div class="community-guidance"><strong>Recommend, then share</strong><p>Your recommendation creates or updates the matching waiting-list entry. To involve someone else, return to its queue card and share that pending entry privately.</p></div>
          </div>`
        : `<div class="community-locked">
            <p class="community-kicker">Unlocks at two endorsements</p>
            <h4>Recommendations and private sharing are not active yet.</h4>
            <p>Your qualifying endorsement progress appears above. Once two active endorsements from verified members are in place, you can add places and privately share pending entries.</p>
          </div>`
    }
    <div class="community-queue" aria-labelledby="your-community-queue-title">
      <div class="community-subheading"><h4 id="your-community-queue-title">Your private queue</h4><p>Only entries you participate in appear here.</p></div>
      ${
        loadingCommunity || !communityLoaded
          ? '<p class="community-loading" role="status">Loading your waiting-list entries…</p>'
          : waitlistEntries.length
            ? `<div class="community-queue-list">${waitlistEntries.map(waitlistCard).join('')}</div>`
            : '<p class="community-empty">No waiting-list entries yet. A recommendation or private share will place one here.</p>'
      }
    </div>
  </section>`;
}

function incomingShareCard(share: ShareRecord): string {
  const entry = waitlistEntries.find((item) => item.id === share.waitlist);
  const waitlistId = share.waitlist || '';
  const ownRecommendation = waitlistId ? recommendationFor(waitlistId) : undefined;
  const published = entry?.status === 'published';
  const verified = currentStatus() === 'verified';
  return `<article class="community-share-card">
    <div class="community-share-heading"><div><h4>${esc(share.venue_name || entry?.venue_name || 'Shared place')}</h4><p>${esc([share.city || entry?.city, share.country || entry?.country].filter(Boolean).join(', '))}</p></div><span>Shared with you</span></div>
    <blockquote><p>${esc(share.personal_note || '')}</p></blockquote>
    ${
      published
        ? '<p class="community-share-state is-success">This place is now published in the shared selection.</p>'
        : ownRecommendation
          ? '<p class="community-share-state is-success">Your independent recommendation is already counted.</p>'
          : verified && waitlistId
            ? `<form class="community-form community-recipient-form" data-community-recipient-recommendation>
                <input type="hidden" name="waitlist" value="${esc(waitlistId)}">
                <label>Add your independent recommendation<textarea name="note" rows="4" maxlength="2400" minlength="24" required placeholder="Add your own reason for recommending this place"></textarea></label>
                <p class="community-field-help">At least 24 characters and five meaningful words. Your note is private and separate from the note above.</p>
                <button class="community-primary" type="submit" ${submitting ? 'disabled' : ''}>${submitting ? 'Adding…' : 'Add my recommendation'}</button>
              </form>`
            : '<p class="community-share-state">Your recommendation form unlocks when you reach two qualifying endorsements.</p>'
    }
  </article>`;
}

function outgoingShareCard(share: ShareRecord): string {
  return `<article class="community-share-card community-share-card-sent">
    <div class="community-share-heading"><div><h4>${esc(share.venue_name || 'Shared place')}</h4><p>${esc([share.city, share.country].filter(Boolean).join(', '))}</p></div><span>Privately shared</span></div>
    <blockquote><p>${esc(share.personal_note || '')}</p></blockquote>
    <p class="community-share-state">Your note is visible only to the recipient. Their identity and any recommendation remain private.</p>
  </article>`;
}

function sharesPanel(): string {
  const incoming = incomingShares();
  const outgoing = outgoingShares();
  return `<section class="community-ledger-section" aria-labelledby="private-shares-title">
    <div class="community-section-heading">
      <div><p class="community-kicker">Private handoff</p><h3 id="private-shares-title">Place shares</h3></div>
      <p>Shares invite a personal recommendation; they never count as a signal on their own.</p>
    </div>
    ${
      loadingCommunity || !communityLoaded
        ? '<p class="community-loading" role="status">Loading your private shares…</p>'
        : incoming.length || outgoing.length
          ? `<div class="community-shares-grid">
              <div class="community-share-column"><div class="community-subheading"><h4>Received</h4><p>Private notes sent directly to you.</p></div>${incoming.length ? incoming.map(incomingShareCard).join('') : '<p class="community-empty">No private shares received.</p>'}</div>
              <div class="community-share-column"><div class="community-subheading"><h4>Sent</h4><p>Your private handoffs, without recipient profiles.</p></div>${outgoing.length ? outgoing.map(outgoingShareCard).join('') : '<p class="community-empty">No private shares sent.</p>'}</div>
            </div>`
          : '<p class="community-empty">No private shares yet. Verified members can share a pending place from its waiting-list card.</p>'
    }
  </section>`;
}

function invitesPanel(): string {
  return `<section class="community-invites" aria-labelledby="community-invites-title">
    <div>
      <p class="community-kicker">Personal invitations</p>
      <h3 id="community-invites-title">Invite a detourist</h3>
      <p>Each code is personal and works once. An invitation opens an account; community verification still follows the endorsement model above.</p>
    </div>
    <div class="community-invite-actions">
      <button class="community-secondary" type="button" data-community-invite ${submitting ? 'disabled' : ''}>${submitting ? 'Preparing…' : 'Issue a personal invitation'}</button>
      ${
        loadingInvites || !invitesLoaded
          ? '<p class="community-loading" role="status">Checking your invitations…</p>'
          : openInvites().length
            ? `<ul class="community-invite-codes" aria-label="Your unclaimed invitation codes">${openInvites()
                .map((invite) => `<li><code>${esc(invite.code || '')}</code><span>Unclaimed</span></li>`)
                .join('')}</ul>`
            : '<p class="community-empty">No unclaimed invitations yet.</p>'
      }
    </div>
  </section>`;
}

function signedInPanel(): string {
  const record = member();
  if (!record) return signedOutPanel();
  const verified = currentStatus() === 'verified';
  return `<section class="community-panel community-panel-member" aria-label="Your Detour membership">
    <div class="community-member-head">
      <div>
        <p class="community-kicker">Your community account</p>
        <h2>${esc(memberName(record))}</h2>
        <p class="community-status ${verified ? 'is-verified' : ''}"><span aria-hidden="true"></span>${verified ? 'Verified member' : 'Awaiting endorsements'}</p>
      </div>
      <button class="community-signout" type="button" data-community-sign-out>Sign out</button>
    </div>
    ${noticeMarkup()}
    ${verificationPanel()}
    ${endorsementPanel()}
    ${recommendationPanel()}
    ${sharesPanel()}
    ${invitesPanel()}
  </section>`;
}

export function communityControl(href: string, current = false): string {
  const record = member();
  const label = record ? `Member: ${memberName(record)}` : 'Members';
  return `<a class="community-toggle${current ? ' is-current' : ''}" href="${esc(href)}" data-community-route${current ? ' aria-current="page"' : ''}>${esc(label)}<span aria-hidden="true">${current ? '•' : '↗'}</span></a>`;
}

export function communityPanel(_venues: Venue[]): string {
  return `<div id="community-area" class="community-area">${member() ? signedInPanel() : signedOutPanel()}</div>`;
}

function resetCommunityState(): void {
  snapshot = null;
  waitlistEntries = [];
  recommendations = [];
  shares = [];
  communityLoaded = false;
  loadingCommunity = false;
  invites = [];
  invitesLoaded = false;
  loadingInvites = false;
  highlightedWaitlistId = '';
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
    pb.send<CommunitySnapshot>('/api/detour/community/me', { requestKey: null }),
    pb.collection('community_waitlist_entries').getFullList<WaitlistEntry>({ sort: '-updated', requestKey: null }),
    pb.collection('community_recommendations').getFullList<RecommendationRecord>({ sort: '-created', requestKey: null }),
    pb.collection('community_shares').getFullList<ShareRecord>({ sort: '-created', requestKey: null }),
  ]);

  if (results[0].status === 'fulfilled') snapshot = results[0].value;
  if (results[1].status === 'fulfilled') waitlistEntries = results[1].value;
  if (results[2].status === 'fulfilled') recommendations = results[2].value;
  if (results[3].status === 'fulfilled') shares = results[3].value;

  const failure = results.find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') {
    notice = { kind: 'error', text: readableError(failure.reason, 'Some community details could not be loaded. Please try again.') };
  }
  communityLoaded = true;
  loadingCommunity = false;
  render();
}

async function loadInvites(render: () => void): Promise<void> {
  if (!member() || loadingInvites) return;
  loadingInvites = true;
  render();
  try {
    invites = await pb.collection('invites').getFullList<InviteRecord>({ sort: '-created', requestKey: null });
    invitesLoaded = true;
  } catch (error) {
    notice = { kind: 'error', text: readableError(error, 'Your invitations could not be loaded. Please try again.') };
  } finally {
    loadingInvites = false;
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
  state.query = selected.display_name;
  state.items = [];
  state.activeIndex = -1;
  const container = Array.from(root.querySelectorAll<HTMLElement>('[data-member-directory]')).find(
    (item) => item.dataset.memberDirectory === key
  );
  const input = container?.querySelector<HTMLInputElement>('[data-member-search]');
  if (input) input.value = selected.display_name;
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
          state.items = (response.items || []).filter((item) => item.id !== ownId && item.display_name?.trim());
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

export function bindCommunity(root: HTMLElement, _venues: Venue[], render: () => void): void {
  root.querySelectorAll<HTMLButtonElement>('[data-community-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      mode = button.dataset.communityMode === 'join' ? 'join' : 'sign-in';
      notice = null;
      render();
    });
  });

  root.querySelector<HTMLFormElement>('[data-community-join]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget as HTMLFormElement);
    const password = String(values.get('password') || '');
    const passwordConfirm = String(values.get('passwordConfirm') || '');
    if (password !== passwordConfirm) {
      notice = { kind: 'error', text: 'The two passwords do not match.' };
      render();
      return;
    }
    submitting = true;
    notice = null;
    render();
    try {
      await pb.collection('members').create({
        display_name: String(values.get('display_name') || '').trim(),
        email: String(values.get('email') || '').trim(),
        password,
        passwordConfirm,
        invite_code: String(values.get('invite_code') || '').trim().toUpperCase(),
      });
      mode = 'sign-in';
      notice = { kind: 'success', text: 'Your membership is ready. Sign in to see your endorsement progress and community queue.' };
    } catch (error) {
      notice = { kind: 'error', text: readableError(error, 'That invitation could not be accepted. Check the code and try again.') };
    } finally {
      submitting = false;
      render();
    }
  });

  root.querySelector<HTMLFormElement>('[data-community-sign-in]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget as HTMLFormElement);
    submitting = true;
    notice = null;
    render();
    try {
      await pb.collection('members').authWithPassword(String(values.get('email') || '').trim(), String(values.get('password') || ''));
      resetCommunityState();
      notice = { kind: 'success', text: 'Welcome back. Your private community account is ready.' };
    } catch (error) {
      notice = { kind: 'error', text: readableError(error, 'Those sign-in details were not recognised.') };
    } finally {
      submitting = false;
      render();
    }
  });

  root.querySelector<HTMLButtonElement>('[data-community-sign-out]')?.addEventListener('click', () => {
    pb.authStore.clear();
    resetCommunityState();
    notice = { kind: 'info', text: 'You have signed out of Detour.' };
    render();
  });

  root.querySelector<HTMLButtonElement>('[data-community-invite]')?.addEventListener('click', async () => {
    if (!member()) return;
    submitting = true;
    notice = null;
    render();
    try {
      await pb.collection('invites').create({});
      invitesLoaded = false;
      notice = { kind: 'success', text: 'A personal invitation is ready to share.' };
      await loadInvites(render);
    } catch (error) {
      notice = { kind: 'error', text: readableError(error, 'That invitation could not be prepared. Please try again.') };
    } finally {
      submitting = false;
      render();
    }
  });

  root.querySelector<HTMLFormElement>('[data-community-endorsement]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const selected = directoryState('endorsement').selected;
    if (!selected) {
      notice = { kind: 'error', text: 'Search for a member and choose their name before creating an endorsement.' };
      render();
      return;
    }
    submitting = true;
    notice = null;
    render();
    try {
      await pb.collection('endorsements').create({ endorsee: selected.id });
      directories.delete('endorsement');
      notice = { kind: 'success', text: `Your endorsement of ${selected.display_name} is active.` };
      communityLoaded = false;
      await loadCommunity(render);
    } catch (error) {
      notice = { kind: 'error', text: readableError(error, 'That endorsement could not be created. Please check your allowance and try again.') };
    } finally {
      submitting = false;
      render();
    }
  });

  root.querySelector<HTMLFormElement>('[data-community-recommendation]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget as HTMLFormElement);
    const note = String(values.get('note') || '').trim();
    if (!meaningfulRecommendation(note)) {
      notice = { kind: 'error', text: 'Add a meaningful recommendation of at least 24 characters and five words.' };
      render();
      return;
    }
    submitting = true;
    notice = null;
    render();
    try {
      const created = await pb.collection('community_recommendations').create<RecommendationRecord>({
        venue_name: String(values.get('venue_name') || '').trim(),
        city: String(values.get('city') || '').trim(),
        country: String(values.get('country') || '').trim(),
        note,
      });
      highlightedWaitlistId = created.waitlist || '';
      notice = { kind: 'success', text: 'Your recommendation entered or updated the shared waiting list. Its private queue card is highlighted below.' };
      communityLoaded = false;
      await loadCommunity(render);
      focusWaitlistEntry(highlightedWaitlistId);
    } catch (error) {
      notice = { kind: 'error', text: readableError(error, 'That recommendation could not be added. Check the place details and note, then try again.') };
    } finally {
      submitting = false;
      render();
    }
  });

  root.querySelectorAll<HTMLFormElement>('[data-community-share]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const waitlist = form.dataset.waitlist || '';
      const selected = directoryState(`share-${waitlist}`).selected;
      if (!selected) {
        notice = { kind: 'error', text: 'Search for a member and choose their name before sharing this place.' };
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
        notice = { kind: 'success', text: `This waiting-list entry was shared privately with ${selected.display_name}. The share itself did not add a signal.` };
        communityLoaded = false;
        await loadCommunity(render);
      } catch (error) {
        notice = { kind: 'error', text: readableError(error, 'That private share could not be sent. Check the recipient and note, then try again.') };
      } finally {
        submitting = false;
        render();
      }
    });
  });

  root.querySelectorAll<HTMLFormElement>('[data-community-recipient-recommendation]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const values = new FormData(form);
      const waitlist = String(values.get('waitlist') || '');
      const note = String(values.get('note') || '').trim();
      if (!meaningfulRecommendation(note)) {
        notice = { kind: 'error', text: 'Add your own recommendation using at least 24 characters and five meaningful words.' };
        render();
        return;
      }
      submitting = true;
      notice = null;
      render();
      try {
        await pb.collection('community_recommendations').create({ waitlist, note });
        highlightedWaitlistId = waitlist;
        notice = { kind: 'success', text: 'Your independent recommendation is now counted. The matching queue card shows the refreshed signal progress.' };
        communityLoaded = false;
        await loadCommunity(render);
        focusWaitlistEntry(waitlist);
      } catch (error) {
        notice = { kind: 'error', text: readableError(error, 'Your recommendation could not be added. Check your note and try again.') };
      } finally {
        submitting = false;
        render();
      }
    });
  });

  bindDirectories(root);

  if (member() && !communityLoaded && !loadingCommunity) void loadCommunity(render);
  if (member() && !invitesLoaded && !loadingInvites) void loadInvites(render);
}
