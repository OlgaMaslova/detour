import { pb } from './pocketbase';
import type { Venue } from './data';
import { OCCASION_OPTIONS } from './occasions';

type CommunityMode = 'sign-in' | 'join';
type MemberTab = 'invitations' | 'detours' | 'settings';
type DetourTab = 'recommendations' | 'shares';
type NoticeKind = 'success' | 'error' | 'info';

interface MemberRecord {
  id: string;
  email?: string;
  display_name?: string;
  pseudo?: string;
  community_status?: string;
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
  address?: string;
  category?: string;
  occasions?: string[];
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
  venue?: string;
  sender_name?: string;
  recipient_name?: string;
  sender_pseudo?: string;
  recipient_pseudo?: string;
  seen?: boolean;
  personal_note?: string;
  venue_name?: string;
  city?: string;
  country?: string;
  address?: string;
  created?: string;
}

interface DirectoryMember {
  id: string;
  display_name: string;
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

const MEMBER_TABS: MemberTab[] = ['invitations', 'detours', 'settings'];
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
let memberTab: MemberTab = 'invitations';
let detourTab: DetourTab = 'recommendations';
let notice: Notice | null = null;
let knownVenues: Venue[] = [];
let waitlistEntries: WaitlistEntry[] = [];
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

function memberName(record: MemberRecord): string {
  return record.display_name?.trim() || record.email?.split('@')[0] || 'Member';
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

function labelForOption(options: readonly (readonly [string, string])[], value: string | undefined): string {
  return options.find(([key]) => key === value)?.[1] || '';
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

function pseudoMarkup(pseudo: string | undefined): string {
  return pseudo ? `<span class="member-pseudo">@${esc(pseudo)}</span>` : '';
}

function directoryResultsMarkup(key: string): string {
  const state = directoryState(key);
  if (state.selected) {
    return `<p class="member-directory-selected"><span>Selected</span><strong>${esc(state.selected.display_name)}</strong>${pseudoMarkup(state.selected.pseudo)}</p>`;
  }
  if (state.query.trim().length < 2) {
    return '<p class="member-directory-hint">Type a name or @pseudo — at least two characters.</p>';
  }
  if (state.loading) return '<p class="member-directory-hint" role="status">Searching members…</p>';
  if (state.error) return `<p class="member-directory-error" role="alert">${esc(state.error)}</p>`;
  if (!state.items.length) return '<p class="member-directory-hint">No matching members.</p>';
  return `<ul class="member-directory-results" role="listbox">${state.items
    .map(
      (item, index) =>
        `<li><button type="button" role="option" id="${directoryListId(key)}-option-${index}" aria-selected="${state.activeIndex === index}" data-member-choice="${index}">${esc(item.display_name)}${pseudoMarkup(item.pseudo)}</button></li>`
    )
    .join('')}</ul>`;
}

function directoryMarkup(key: string, label: string): string {
  const state = directoryState(key);
  const listId = directoryListId(key);
  return `<div class="member-directory" data-member-directory="${esc(key)}">
    <label>${esc(label)}
      <input type="search" value="${esc(state.query)}" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="${state.items.length > 0}" aria-controls="${listId}" ${state.activeIndex >= 0 ? `aria-activedescendant="${listId}-option-${state.activeIndex}"` : ''} data-member-search>
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
      <p>${isJoin ? 'Enter your invitation code to become a member.' : 'Sign in to your member account.'}</p>
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
              <label>Pick a pseudo<input name="pseudo" autocomplete="off" spellcheck="false" minlength="3" maxlength="30" pattern="@?[a-zA-Z0-9][a-zA-Z0-9-]{1,28}[a-zA-Z0-9]" title="3-30 characters: letters, digits, and hyphens" required placeholder="e.g. detour-anna"></label>
              <p class="community-form-note">Your pseudo is your unique handle — it is how other members find you to share places.</p>
              <label>Email address<input name="email" type="email" autocomplete="email" required></label>
              <div class="community-form-grid">
                <label>Password<input name="password" type="password" autocomplete="new-password" minlength="8" required></label>
                <label>Confirm password<input name="passwordConfirm" type="password" autocomplete="new-password" minlength="8" required></label>
              </div>
              <label>Invitation code<input name="invite_code" autocomplete="off" spellcheck="false" maxlength="80" placeholder="DTR-…" required></label>
              <button class="community-primary" type="submit" ${submitting ? 'disabled' : ''}>${submitting ? 'Joining…' : 'Join Detour'}</button>
            </form>`
          : `<form class="community-form" data-community-sign-in>
              <label>Email address<input name="email" type="email" autocomplete="email" required></label>
              <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
              <button class="community-primary" type="submit" ${submitting ? 'disabled' : ''}>${submitting ? 'Signing in…' : 'Sign in'}</button>
              <p class="community-form-note">New here? A personal invitation is all you need to join.</p>
            </form>`
      }
    </div>
  </section>`;
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
  const progress = cleanCount(entry.signal_count, 3);
  const published = entry.status === 'published';
  const directoryKey = `share-${entry.id}`;
  const category = labelForOption(CATEGORY_OPTIONS, entry.category);
  const occasions = (entry.occasions || []).map((occasion) => labelForOption(OCCASION_OPTIONS, occasion)).filter(Boolean);
  return `<article class="community-queue-card${highlightedWaitlistId === entry.id ? ' is-highlighted' : ''}" id="waitlist-${esc(entry.id)}" tabindex="-1">
    <div class="community-queue-head">
      <div><h4>${esc(entry.venue_name || 'Unnamed place')}</h4><p>${esc([entry.address, entry.city, entry.country].filter(Boolean).join(', '))}</p></div>
      <span class="community-queue-status is-${published ? 'published' : 'pending'}">${published ? 'Published' : 'Pending'}</span>
    </div>
    ${category || occasions.length ? `<dl class="community-place-facts">${category ? `<div><dt>Category</dt><dd>${esc(category)}</dd></div>` : ''}${occasions.length ? `<div><dt>Good for</dt><dd>${esc(occasions.join(' · '))}</dd></div>` : ''}</dl>` : ''}
    <div class="community-signal" aria-label="${progress} of 3 recommendations">
      <div class="community-signal-label"><span>Recommendations</span><strong>${progress}/3</strong></div>
      <div class="community-signal-track" aria-hidden="true"><span style="width: ${(progress / 3) * 100}%"></span></div>
    </div>
    ${
      !published
        ? `<details class="community-share-disclosure">
            <summary>Share with a member</summary>
            <form class="community-form community-share-form" data-community-share data-waitlist="${esc(entry.id)}">
              ${directoryMarkup(directoryKey, 'Share with a member')}
              <label>Personal note<textarea name="personal_note" rows="3" maxlength="1200" minlength="8" required placeholder="Why you thought of them for this place"></textarea></label>
              <button class="community-secondary" type="submit" ${submitting ? 'disabled' : ''}>${submitting ? 'Sharing…' : 'Share privately'}</button>
            </form>
          </details>`
        : ''
    }
  </article>`;
}

function recommendationPanel(): string {
  return `<section class="community-ledger-section" aria-labelledby="community-waitlist-title">
    <div class="community-section-heading">
      <div><h3 id="community-waitlist-title">Recommend a place anywhere</h3></div>
      <p>As a verified member, you can recommend a place anywhere in the world. It is published on the Detourist List only after three independent members recommend it.</p>
    </div>
    <div class="community-action-grid community-recommend-action">
      <form class="community-form" data-community-recommendation>
        <label>Place name<input name="venue_name" maxlength="200" required placeholder="The place you would send someone"></label>
        <label>Address <span class="community-optional">Optional — we can look it up</span><input name="address" maxlength="300" placeholder="Street and number"></label>
        <div class="community-form-grid community-place-grid">
          <label>City or locality<input name="city" maxlength="120" required placeholder="City or locality"></label>
          <label>Country<input name="country" maxlength="120" required placeholder="Country"></label>
        </div>
        <label>Category <span class="community-optional">Optional</span><select name="category"><option value="">Choose one</option>${CATEGORY_OPTIONS.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>
        <fieldset class="community-choice-fieldset">
          <legend>Good for <span class="community-optional">Optional — choose any that fit</span></legend>
          <div class="community-choice-grid">${OCCASION_OPTIONS.map(([value, label]) => `<label><input type="checkbox" name="occasions" value="${value}"><span>${label}</span></label>`).join('')}</div>
        </fieldset>
        <label>Your recommendation<textarea name="note" rows="5" maxlength="2400" minlength="24" required placeholder="What makes this place worth a deliberate detour?"></textarea></label>
        <button class="community-primary" type="submit" ${submitting ? 'disabled' : ''}>${submitting ? 'Adding…' : 'Recommend'}</button>
      </form>
    </div>
    <div class="community-queue" aria-labelledby="your-community-queue-title">
      <div class="community-subheading"><h4 id="your-community-queue-title">Your recommendations</h4></div>
      ${
        loadingCommunity || !communityLoaded
          ? '<p class="community-loading" role="status">Loading…</p>'
          : waitlistEntries.length
            ? `<div class="community-queue-list">${waitlistEntries.map(waitlistCard).join('')}</div>`
            : '<p class="community-empty">Nothing here yet.</p>'
      }
    </div>
  </section>`;
}

function formatDate(value: string | undefined): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(parsed);
}

function incomingShareCard(share: ShareRecord): string {
  return `<article class="community-share-card${share.seen ? '' : ' is-new'}">
    <div class="community-share-heading"><div><h4>${esc(share.venue_name || 'Shared place')}</h4><p>${esc([share.address, share.city, share.country].filter(Boolean).join(', '))}</p></div><span>${share.seen ? 'Shared with you' : 'New'}</span></div>
    <p class="community-share-from"><strong>${esc(share.sender_name || 'A Detour member')}</strong>${pseudoMarkup(share.sender_pseudo)} shared this place with you.</p>
    <blockquote><p>${esc(share.personal_note || '')}</p></blockquote>
    ${share.venue ? '<p class="community-share-state is-success">In the Detour selection.</p>' : ''}
  </article>`;
}

function outgoingShareCard(share: ShareRecord): string {
  return `<article class="community-share-card community-share-card-sent">
    <div class="community-share-heading"><div><h4>${esc(share.venue_name || 'Shared place')}</h4><p>${esc([share.address, share.city, share.country].filter(Boolean).join(', '))}</p></div><span>Sent</span></div>
    <p class="community-share-from">Shared with <strong>${esc(share.recipient_name || 'a member')}</strong>${pseudoMarkup(share.recipient_pseudo)}.</p>
    <blockquote><p>${esc(share.personal_note || '')}</p></blockquote>
  </article>`;
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
    <label>Place<input name="place" list="community-share-place-options" autocomplete="off" maxlength="200" required placeholder="Pick from the list or type your own"></label>
    <datalist id="community-share-place-options">${knownVenues
      .map((venue) => `<option value="${esc(`${venue.name} — ${venue.city}`)}"></option>`)
      .join('')}</datalist>
    <label>Address<input name="address" maxlength="300" placeholder="Street and number — needed for a place not in the list"></label>
    <div class="community-form-grid community-place-grid">
      <label>City<input name="city" maxlength="120" placeholder="Madrid"></label>
      <label>Country<input name="country" maxlength="120" placeholder="Spain"></label>
    </div>
    <label>Personal note<textarea name="personal_note" rows="3" maxlength="1200" minlength="8" required placeholder="Why you thought of them for this place"></textarea></label>
    <button class="community-primary" type="submit" ${submitting ? 'disabled' : ''}>${submitting ? 'Sharing…' : 'Share place'}</button>
  </form>`;
}

function sharesPanel(): string {
  const incoming = incomingShares();
  const outgoing = outgoingShares();
  return `<section class="community-ledger-section" aria-labelledby="private-shares-title">
    <div class="community-section-heading">
      <div><h3 id="private-shares-title">Share a place</h3></div>
      <p>Send any place to a member with a note — from the list, or one of your own.</p>
    </div>
    <div class="community-action-grid community-share-place-action">
      ${sharePlaceForm()}
    </div>
    ${
      loadingCommunity || !communityLoaded
        ? '<p class="community-loading" role="status">Loading…</p>'
        : incoming.length || outgoing.length
          ? `<div class="community-shares-grid">
              <div class="community-share-column"><div class="community-subheading"><h4>Received</h4></div>${incoming.length ? incoming.map(incomingShareCard).join('') : '<p class="community-empty">No shares received.</p>'}</div>
              <div class="community-share-column"><div class="community-subheading"><h4>Sent</h4></div>${outgoing.length ? outgoing.map(outgoingShareCard).join('') : '<p class="community-empty">No shares sent.</p>'}</div>
            </div>`
          : '<p class="community-empty">No shares yet.</p>'
    }
  </section>`;
}

function invitesPanel(): string {
  const unclaimed = openInvites();
  const claimed = invites.filter((invite) => invite.claimed_by);
  const available = Math.max(0, 3 - unclaimed.length);
  const allowanceKnown = invitesLoaded && !loadingInvites;
  const atLimit = allowanceKnown && available === 0;
  return `<section class="community-tab-panel community-invitation-panel" id="member-panel-invitations" role="tabpanel" aria-labelledby="member-tab-invitations" tabindex="0">
    <div class="community-invite-actions">
      <p class="community-invite-explainer">Detour grows by personal invitation only — create a code and pass it to someone you trust so they can join as a member.</p>
      <div class="community-invite-bar">
        <button class="community-secondary" type="button" data-community-invite ${submitting || !allowanceKnown || atLimit ? 'disabled' : ''}>${submitting ? 'Preparing…' : atLimit ? 'Invitation limit reached' : 'New invitation'}</button>
        <p class="community-invite-allowance" aria-live="polite"><strong>${allowanceKnown ? available : '—'}</strong> ${allowanceKnown ? (available === 1 ? 'invitation left' : 'invitations left') : 'checking…'}</p>
      </div>
      ${
        loadingInvites || !invitesLoaded
          ? '<p class="community-loading" role="status">Loading…</p>'
          : unclaimed.length
            ? `<div class="community-invite-list"><h4>Unclaimed codes</h4><ul class="community-invite-codes" aria-label="Your unclaimed invitation codes">${unclaimed
                .map(
                  (invite) =>
                    `<li><code>${esc(invite.code || '')}</code><button class="community-invite-copy" type="button" data-copy-invite="${esc(invite.code || '')}" aria-live="polite" aria-label="Copy invitation code ${esc(invite.code || '')}">Copy</button></li>`
                )
                .join('')}</ul></div>`
            : '<p class="community-empty">No unclaimed codes. Create one to invite someone.</p>'
      }
      ${
        allowanceKnown && claimed.length
          ? `<div class="community-invite-list community-invite-claimed"><h4>Claimed invitations</h4><ul class="community-invite-codes" aria-label="Your claimed invitation codes">${claimed
              .map((invite) => {
                const when = formatDate(invite.claimed_at);
                return `<li><code>${esc(invite.code || '')}</code><span>Claimed${when ? ` ${esc(when)}` : ''}</span></li>`;
              })
              .join('')}</ul></div>`
          : ''
      }
    </div>
  </section>`;
}

function detoursPanel(): string {
  const unseen = unseenShareCount();
  const tabs: { id: DetourTab; label: string }[] = [
    { id: 'recommendations', label: 'Recommendations' },
    { id: 'shares', label: 'Shares' },
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
        ? `<div id="detour-panel-recommendations" role="tabpanel" aria-labelledby="detour-tab-recommendations">${recommendationPanel()}</div>`
        : `<div id="detour-panel-shares" role="tabpanel" aria-labelledby="detour-tab-shares">${sharesPanel()}</div>`
    }
  </div>`;
}

function settingsPanel(record: MemberRecord): string {
  return `<section class="community-tab-panel community-settings-panel" id="member-panel-settings" role="tabpanel" aria-labelledby="member-tab-settings" tabindex="0">
    <div class="community-session-row">
      <p>Signed in as <strong>${esc(record.email || memberName(record))}</strong></p>
      <button class="community-signout" type="button" data-community-sign-out>Sign out</button>
    </div>
    <div class="community-pseudo-row">
      <form class="community-form community-pseudo-form" data-community-pseudo>
        <label>Your pseudo<input name="pseudo" value="${esc(record.pseudo || '')}" autocomplete="off" spellcheck="false" minlength="3" maxlength="30" pattern="@?[a-zA-Z0-9][a-zA-Z0-9-]{1,28}[a-zA-Z0-9]" title="3-30 characters: letters, digits, and hyphens" required></label>
        <button class="community-secondary" type="submit" ${submitting ? 'disabled' : ''}>${submitting ? 'Saving…' : 'Save pseudo'}</button>
      </form>
      <p class="community-form-note">Your unique handle — other members search for it to share places with you.</p>
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
  const labels: Record<MemberTab, string> = {
    invitations: 'Invitations',
    detours: 'My detours',
    settings: 'Settings',
  };
  const unseen = unseenShareCount();
  return `<div class="community-member-tabs" role="tablist" aria-label="Member areas">
    ${MEMBER_TABS.map(
      (tab) =>
        `<button class="community-member-tab${memberTab === tab ? ' is-active' : ''}" type="button" role="tab" id="member-tab-${tab}" aria-selected="${memberTab === tab}" aria-controls="member-panel-${tab}" tabindex="${memberTab === tab ? '0' : '-1'}" data-member-tab="${tab}">${labels[tab]}${
          tab === 'detours' && unseen ? `<span class="community-tab-badge" aria-label="${unseen} new shares">${unseen}</span>` : ''
        }</button>`
    ).join('')}
  </div>`;
}

function signedInPanel(): string {
  const record = member();
  if (!record) return signedOutPanel();
  const panel = memberTab === 'invitations' ? invitesPanel() : memberTab === 'detours' ? detoursPanel() : settingsPanel(record);
  return `<section class="community-panel community-panel-member" aria-label="Detour member area">
    ${memberTabsMarkup()}
    ${noticeMarkup()}
    ${panel}
  </section>`;
}

export function communityControl(href: string, current = false): string {
  const record = member();
  const label = record ? `Member: ${memberName(record)}` : 'Members';
  return `<a class="community-toggle${current ? ' is-current' : ''}" href="${esc(href)}" data-community-route${current ? ' aria-current="page"' : ''}>${esc(label)}<span aria-hidden="true">${current ? '•' : '↗'}</span></a>`;
}

export function communityPanel(venues: Venue[]): string {
  knownVenues = venues;
  return `<div id="community-area" class="community-area">${member() ? signedInPanel() : signedOutPanel()}</div>`;
}

function resetCommunityState(): void {
  memberTab = 'invitations';
  detourTab = 'recommendations';
  waitlistEntries = [];
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
    pb.collection('community_waitlist_entries').getFullList<WaitlistEntry>({ sort: '-updated', requestKey: null }),
    pb.collection('community_shares').getFullList<ShareRecord>({ sort: '-created', requestKey: null }),
  ]);

  if (results[0].status === 'fulfilled') waitlistEntries = results[0].value;
  if (results[1].status === 'fulfilled') shares = results[1].value;

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
}

export function bindCommunity(root: HTMLElement, venues: Venue[], render: () => void): void {
  knownVenues = venues;
  root.querySelectorAll<HTMLButtonElement>('[data-community-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      mode = button.dataset.communityMode === 'join' ? 'join' : 'sign-in';
      notice = null;
      render();
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
      if (nextTab && MEMBER_TABS.includes(nextTab)) activateMemberTab(nextTab, true);
    });
    button.addEventListener('keydown', (event) => {
      const currentTab = button.dataset.memberTab as MemberTab | undefined;
      const currentIndex = currentTab ? MEMBER_TABS.indexOf(currentTab) : -1;
      if (currentIndex < 0) return;
      let nextIndex = currentIndex;
      if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % MEMBER_TABS.length;
      else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + MEMBER_TABS.length) % MEMBER_TABS.length;
      else if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = MEMBER_TABS.length - 1;
      else return;
      event.preventDefault();
      activateMemberTab(MEMBER_TABS[nextIndex], true);
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
        pseudo: String(values.get('pseudo') || '').trim(),
        email: String(values.get('email') || '').trim(),
        password,
        passwordConfirm,
        invite_code: String(values.get('invite_code') || '').trim().toUpperCase(),
      });
      mode = 'sign-in';
      notice = { kind: 'success', text: 'Your membership is ready. Sign in to continue.' };
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
      notice = null;
    } catch (error) {
      notice = { kind: 'error', text: readableError(error, 'Those sign-in details were not recognised.') };
    } finally {
      submitting = false;
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
      await pb.collection('members').update(record.id, { pseudo });
      notice = { kind: 'success', text: `Your pseudo is now @${pseudo}.` };
    } catch (error) {
      notice = { kind: 'error', text: readableError(error, 'Your pseudo could not be updated. Please try again.') };
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

  root.querySelector<HTMLButtonElement>('[data-community-invite]')?.addEventListener('click', async () => {
    if (!member() || !invitesLoaded || loadingInvites || openInvites().length >= 3) return;
    submitting = true;
    notice = null;
    render();
    try {
      await pb.collection('invites').create({});
      invitesLoaded = false;
      notice = { kind: 'success', text: 'Your invitation code is ready.' };
      await loadInvites(render);
    } catch (error) {
      notice = { kind: 'error', text: readableError(error, 'That invitation could not be prepared. Please try again.') };
    } finally {
      submitting = false;
      render();
    }
  });

  root.querySelectorAll<HTMLButtonElement>('[data-copy-invite]').forEach((button) => {
    button.addEventListener('click', async () => {
      const code = button.dataset.copyInvite || '';
      if (!code) return;
      try {
        await navigator.clipboard.writeText(code);
        button.textContent = 'Copied';
        window.setTimeout(() => {
          button.textContent = 'Copy';
        }, 1800);
      } catch {
        notice = { kind: 'error', text: 'The code could not be copied automatically. Select it and copy it manually.' };
        render();
      }
    });
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
      const category = String(values.get('category') || '').trim();
      const occasions = values.getAll('occasions').map((value) => String(value));
      const payload: Record<string, string | string[]> = {
        venue_name: String(values.get('venue_name') || '').trim(),
        address: String(values.get('address') || '').trim(),
        city: String(values.get('city') || '').trim(),
        country: String(values.get('country') || '').trim(),
        note,
      };
      if (category) payload.category = category;
      if (occasions.length) payload.occasions = occasions;
      const created = await pb.collection('community_recommendations').create<RecommendationRecord>(payload);
      highlightedWaitlistId = created.waitlist || '';
      notice = { kind: 'success', text: 'Recommendation added.' };
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
        notice = { kind: 'success', text: `Shared with ${selected.display_name}.` };
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
      notice = { kind: 'error', text: 'Search for a member and choose their name before sharing.' };
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
      notice = { kind: 'error', text: 'That place is not in the list yet — add its address, city, and country to share it.' };
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
      notice = { kind: 'success', text: `Shared with ${selected.display_name}.` };
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

  if (member() && !communityLoaded && !loadingCommunity) {
    void loadCommunity(render).then(() => {
      if (memberTab === 'detours' && detourTab === 'shares') void markIncomingSharesSeen();
    });
  }
  if (member() && !invitesLoaded && !loadingInvites) void loadInvites(render);
}
