import { pb } from './pocketbase';
import type { Venue } from './data';
import { OCCASION_OPTIONS } from './occasions';
import { countryOptions } from './countries';

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
}

interface WaitlistEntry {
  id: string;
  venue_name?: string;
  city?: string;
  country?: string;
  address?: string;
  category?: string;
  occasions?: string[];
  official_url?: string;
  instagram_url?: string;
  image_url?: string;
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

const MEMBER_TABS: MemberTab[] = ['invitations', 'detours', 'settings'];
const INVITATION_LIMIT = 10;
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
let routedInvitationCode: string | null = null;
let memberTab: MemberTab = 'invitations';
let detourTab: DetourTab = 'recommendations';
let notice: Notice | null = null;
let knownVenues: Venue[] = [];
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
let visibilitySaving = false;
let visibilityPending: boolean | null = null;
let memberRefreshed = false;
let refreshingMember = false;
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
  const pseudo = record.pseudo?.trim().replace(/^@+/, '');
  return pseudo ? `@${pseudo}` : record.display_name?.trim() || record.email?.split('@')[0] || 'Member';
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

function invitationLink(code: string): string {
  const url = new URL(window.location.origin);
  url.pathname = '/';
  url.searchParams.set('view', 'members');
  url.searchParams.set('invite', code);
  return url.href;
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

function pseudoLabel(pseudo: string | undefined, fallback = 'A Detour member'): string {
  const cleaned = pseudo?.trim().replace(/^@+/, '');
  return cleaned ? `@${cleaned}` : fallback;
}

function memberIdentityMarkup(pseudo: string | undefined, fallback?: string): string {
  return `<strong class="member-identity">${esc(pseudoLabel(pseudo, fallback))}</strong>`;
}

function directoryResultsMarkup(key: string): string {
  const state = directoryState(key);
  if (state.selected) {
    return `<p class="member-directory-selected"><span>Selected</span><strong>${esc(pseudoLabel(state.selected.pseudo))}</strong></p>`;
  }
  if (state.query.trim().length < 2) {
    return '<p class="member-directory-hint">Type a pseudo, such as @detour-anna — at least two characters.</p>';
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
      <input type="search" value="${esc(state.query)}" autocomplete="off" spellcheck="false" placeholder="@detour-anna" role="combobox" aria-autocomplete="list" aria-expanded="${state.items.length > 0}" aria-controls="${listId}" ${state.activeIndex >= 0 ? `aria-activedescendant="${listId}-option-${state.activeIndex}"` : ''} data-member-search>
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
              <p class="community-form-note">Your pseudo is your unique handle — it is how other members find you to share food-and-drink destinations.</p>
              <label>Email address<input name="email" type="email" autocomplete="email" required></label>
              <div class="community-form-grid">
                <label>Password<input name="password" type="password" autocomplete="new-password" minlength="8" required></label>
                <label>Confirm password<input name="passwordConfirm" type="password" autocomplete="new-password" minlength="8" required></label>
              </div>
              <div class="community-form-grid">
                <label>Where do you live?<input name="home_city" autocomplete="address-level2" maxlength="120" placeholder="City — e.g. San Francisco"></label>
                <label>Country<select name="home_country" autocomplete="country-name">${countryOptions()}</select></label>
              </div>
              <p class="community-form-note">Optional — it helps us understand where the Detour circle is growing.</p>
              <label>Invitation code<input name="invite_code" value="${esc(invitationCodePrefill)}" autocomplete="off" spellcheck="false" maxlength="80" placeholder="DTR-…" required></label>
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

function recommendationForEntry(entryId: string): RecommendationRecord | undefined {
  return recommendations.find((rec) => rec.waitlist === entryId);
}

function entryEditMarkup(entry: WaitlistEntry): string {
  const links = [
    entry.official_url ? `<a href="${esc(entry.official_url)}" target="_blank" rel="noopener noreferrer">Website</a>` : '',
    entry.instagram_url ? `<a href="${esc(entry.instagram_url)}" target="_blank" rel="noopener noreferrer">Instagram</a>` : '',
    entry.image_url ? `<a href="${esc(entry.image_url)}" target="_blank" rel="noopener noreferrer">Photo</a>` : '',
  ].filter(Boolean);
  const hasLinks = links.length > 0;
  const rec = recommendationForEntry(entry.id);
  const selectedCategory = entry.category || '';
  const selectedOccasions = entry.occasions || [];
  return `${hasLinks ? `<p class="community-place-links" aria-label="Destination links">${links.join('<span aria-hidden="true"> · </span>')}</p>` : ''}
    <details class="community-share-disclosure community-links-disclosure">
      <summary>Edit this recommendation</summary>
      <form class="community-form community-links-form" data-community-edit data-waitlist="${esc(entry.id)}"${rec ? ` data-recommendation="${esc(rec.id)}"` : ''}>
        <label>Food-and-drink destination name<input name="venue_name" value="${esc(entry.venue_name || '')}" maxlength="200" required placeholder="A restaurant, café, bar, or other food-and-drink destination"></label>
        <label>Address <span class="community-optional">Optional</span><input name="address" value="${esc(entry.address || '')}" maxlength="300" placeholder="Street and number"></label>
        <div class="community-form-grid community-place-grid">
          <label>City or locality<input name="city" value="${esc(entry.city || '')}" maxlength="120" required placeholder="City or locality"></label>
          <label>Country<input name="country" value="${esc(entry.country || '')}" maxlength="120" required placeholder="Country"></label>
        </div>
        <label>Category <span class="community-optional">Optional</span><select name="category"><option value=""${selectedCategory ? '' : ' selected'}>Choose one</option>${CATEGORY_OPTIONS.map(([value, label]) => `<option value="${value}"${value === selectedCategory ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
        <fieldset class="community-choice-fieldset">
          <legend>Good for <span class="community-optional">Optional — choose any that fit</span></legend>
          <div class="community-choice-grid">${OCCASION_OPTIONS.map(([value, label]) => `<label><input type="checkbox" name="occasions" value="${value}"${selectedOccasions.indexOf(value) !== -1 ? ' checked' : ''}><span>${label}</span></label>`).join('')}</div>
        </fieldset>
        ${rec ? `<label>Your recommendation<textarea name="note" rows="5" maxlength="2400" minlength="24" required placeholder="What makes this food-and-drink destination worth a deliberate detour?">${esc(rec.note || '')}</textarea></label>` : ''}
        <label>Website<input name="official_url" value="${esc(entry.official_url || '')}" maxlength="300" inputmode="url" autocomplete="off" spellcheck="false" placeholder="restaurant.example"></label>
        <label>Instagram<input name="instagram_url" value="${esc(entry.instagram_url || '')}" maxlength="300" autocomplete="off" spellcheck="false" placeholder="@restaurant or instagram.com/restaurant"></label>
        <label>Photo link<input name="image_url" value="${esc(entry.image_url || '')}" maxlength="2048" inputmode="url" autocomplete="off" spellcheck="false" placeholder="Direct link to a photo of the destination"></label>
        <p class="community-form-note">Your edits carry through to the public page${entry.status === 'published' ? ' right away' : ' when it publishes'}.</p>
        <button class="community-secondary" type="submit" ${submitting ? 'disabled' : ''}>${submitting ? 'Saving…' : 'Save changes'}</button>
      </form>
    </details>`;
}

function waitlistCard(entry: WaitlistEntry): string {
  const progress = cleanCount(entry.signal_count, 3);
  const published = entry.status === 'published';
  const directoryKey = `share-${entry.id}`;
  const category = labelForOption(CATEGORY_OPTIONS, entry.category);
  const occasions = (entry.occasions || []).map((occasion) => labelForOption(OCCASION_OPTIONS, occasion)).filter(Boolean);
  return `<article class="community-queue-card${highlightedWaitlistId === entry.id ? ' is-highlighted' : ''}" id="waitlist-${esc(entry.id)}" tabindex="-1">
    <div class="community-queue-head">
      <div><h4>${esc(entry.venue_name || 'Unnamed food-and-drink destination')}</h4><p>${esc([entry.address, entry.city, entry.country].filter(Boolean).join(', '))}</p></div>
      <span class="community-queue-status is-${published ? 'published' : 'pending'}">${published ? 'Published' : 'Pending'}</span>
    </div>
    ${category || occasions.length ? `<dl class="community-place-facts">${category ? `<div><dt>Category</dt><dd>${esc(category)}</dd></div>` : ''}${occasions.length ? `<div><dt>Good for</dt><dd>${esc(occasions.join(' · '))}</dd></div>` : ''}</dl>` : ''}
    <div class="community-signal" aria-label="${progress} of 3 recommendations">
      <div class="community-signal-label"><span>Recommendations</span><strong>${progress}/3</strong></div>
      <div class="community-signal-track" aria-hidden="true"><span style="width: ${(progress / 3) * 100}%"></span></div>
    </div>
    ${entryEditMarkup(entry)}
    ${
      !published
        ? `<details class="community-share-disclosure">
            <summary>Share with a member</summary>
            <form class="community-form community-share-form" data-community-share data-waitlist="${esc(entry.id)}">
              ${directoryMarkup(directoryKey, 'Share with a member')}
              <label>Personal note<textarea name="personal_note" rows="3" maxlength="1200" minlength="8" required placeholder="Why you thought of them for this food-and-drink destination"></textarea></label>
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
      <div><h3 id="community-waitlist-title">Recommend a destination</h3></div>
      <p>As a verified member, you can recommend a restaurant, café, bar, or other food-and-drink destination anywhere in the world. It will be published on the Detourist List.</p>
    </div>
    <div class="community-action-grid community-recommend-action">
      <form class="community-form" data-community-recommendation>
        <label>Food-and-drink destination name<input name="venue_name" maxlength="200" required placeholder="A restaurant, café, bar, or other food-and-drink destination"></label>
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
        <label>Your recommendation<textarea name="note" rows="5" maxlength="2400" minlength="24" required placeholder="What makes this food-and-drink destination worth a deliberate detour?"></textarea></label>
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
    <div class="community-share-heading"><div><h4>${esc(share.venue_name || 'Shared food-and-drink destination')}</h4><p>${esc([share.address, share.city, share.country].filter(Boolean).join(', '))}</p></div><span>${share.seen ? 'Shared with you' : 'New'}</span></div>
    <p class="community-share-from">${memberIdentityMarkup(share.sender_pseudo)} shared this food-and-drink destination with you.</p>
    <blockquote><p>${esc(share.personal_note || '')}</p></blockquote>
    ${share.venue ? '<p class="community-share-state is-success">In the Detour selection.</p>' : ''}
  </article>`;
}

function outgoingShareCard(share: ShareRecord): string {
  return `<article class="community-share-card community-share-card-sent">
    <div class="community-share-heading"><div><h4>${esc(share.venue_name || 'Shared food-and-drink destination')}</h4><p>${esc([share.address, share.city, share.country].filter(Boolean).join(', '))}</p></div><span>Sent</span></div>
    <p class="community-share-from">Shared with ${memberIdentityMarkup(share.recipient_pseudo, 'a Detour member')}.</p>
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
    <button class="community-primary" type="submit" ${submitting ? 'disabled' : ''}>${submitting ? 'Sharing…' : 'Share destination'}</button>
  </form>`;
}

function sharesPanel(): string {
  const incoming = incomingShares();
  const outgoing = outgoingShares();
  return `<section class="community-ledger-section" aria-labelledby="private-shares-title">
    <div class="community-section-heading">
      <div><h3 id="private-shares-title">Share a food-and-drink destination</h3></div>
      <p>Send a restaurant, café, bar, or other food-and-drink destination to a member with a note — from the list, or one of your own.</p>
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
  const available = Math.max(0, INVITATION_LIMIT - unclaimed.length);
  const allowanceKnown = invitesLoaded && !loadingInvites;
  const atLimit = allowanceKnown && available === 0;
  return `<section class="community-tab-panel community-invitation-panel" id="member-panel-invitations" role="tabpanel" aria-labelledby="member-tab-invitations" tabindex="0">
    <div class="community-invite-actions">
      <p class="community-invite-explainer">Detour grows by personal invitation only — create a personal invitation link and send it to someone you trust so they can join as a member.</p>
      <div class="community-invite-bar">
        <button class="community-secondary" type="button" data-community-invite ${submitting || !allowanceKnown || atLimit ? 'disabled' : ''}>${submitting ? 'Preparing…' : atLimit ? 'Invitation limit reached' : 'New invitation'}</button>
        <p class="community-invite-allowance" aria-live="polite"><strong>${allowanceKnown ? available : '—'}</strong> ${allowanceKnown ? (available === 1 ? 'invitation left' : 'invitations left') : 'checking…'}</p>
      </div>
      ${
        loadingInvites || !invitesLoaded
          ? '<p class="community-loading" role="status">Loading…</p>'
          : unclaimed.length
            ? `<div class="community-invite-list"><h4>Unclaimed invitations</h4><ul class="community-invite-codes" aria-label="Your unclaimed invitation links">${unclaimed
                .map(
                  (invite) =>
                    `<li><code>${esc(invite.code || '')}</code><button class="community-invite-copy" type="button" data-copy-invite="${esc(invite.code || '')}" aria-live="polite" aria-label="Copy invitation link for ${esc(invite.code || '')}">Copy link</button></li>`
                )
                .join('')}</ul></div>`
            : '<p class="community-empty">No unclaimed invitations. Create one to invite someone.</p>'
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
  const keepPrivate = visibilityPending ?? record.discovery_visible === false;
  return `<section class="community-tab-panel community-settings-panel" id="member-panel-settings" role="tabpanel" aria-labelledby="member-tab-settings" tabindex="0">
    <p class="community-session-note">Signed in as <strong>${esc(record.email || memberName(record))}</strong></p>
    <div class="community-pseudo-row">
      <form class="community-form community-pseudo-form" data-community-pseudo>
        <label>Your pseudo<input name="pseudo" value="${esc(record.pseudo || '')}" autocomplete="off" spellcheck="false" minlength="3" maxlength="30" pattern="@?[a-zA-Z0-9][a-zA-Z0-9-]{1,28}[a-zA-Z0-9]" title="3-30 characters: letters, digits, and hyphens" required></label>
        <button class="community-secondary" type="submit" ${submitting ? 'disabled' : ''}>${submitting ? 'Saving…' : 'Save pseudo'}</button>
      </form>
      <p class="community-form-note">Your unique handle — other members search for it to share food-and-drink destinations with you.</p>
    </div>
    <div class="community-visibility-row">
      <div class="community-visibility-copy">
        <h3>Food-and-drink discovery</h3>
        <p class="community-form-note">Your food-and-drink recommendations are discoverable by the full invite-only Detour circle by default. Private shares and replies stay private.</p>
      </div>
      <label class="community-switch">
        <input type="checkbox" data-community-visibility ${keepPrivate ? 'checked' : ''} ${visibilitySaving ? 'disabled' : ''}>
        <span class="community-switch-track" aria-hidden="true"></span>
        <span class="community-switch-copy"><strong>Keep recommendations private</strong><small>${visibilitySaving ? 'Saving…' : keepPrivate ? 'Hidden from the circle' : 'Discoverable by the circle'}</small></span>
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
  const labels: Record<MemberTab, string> = {
    invitations: 'Invitations',
    detours: 'My detours',
    settings: 'Settings',
  };
  const unseen = unseenShareCount();
  return `<div class="community-member-bar">
    <div class="community-member-tabs" role="tablist" aria-label="Member areas">
      ${MEMBER_TABS.map(
        (tab) =>
          `<button class="community-member-tab${memberTab === tab ? ' is-active' : ''}" type="button" role="tab" id="member-tab-${tab}" aria-selected="${memberTab === tab}" aria-controls="member-panel-${tab}" tabindex="${memberTab === tab ? '0' : '-1'}" data-member-tab="${tab}">${labels[tab]}${
            tab === 'detours' && unseen ? `<span class="community-tab-badge" aria-label="${unseen} new shares">${unseen}</span>` : ''
          }</button>`
      ).join('')}
    </div>
    <button class="community-tab-signout" type="button" data-community-sign-out>Sign out</button>
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

/** Point the member area at the Share a place form (My detours → Shares) before it renders. */
export function openSharePlace(): void {
  memberTab = 'detours';
  detourTab = 'shares';
}

/** Point the member area at the Recommend a place form (My detours → Recommendations) before it renders. */
export function openRecommendPlace(): void {
  memberTab = 'detours';
  detourTab = 'recommendations';
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
  recommendations = [];
  shares = [];
  communityLoaded = false;
  loadingCommunity = false;
  invites = [];
  invitesLoaded = false;
  loadingInvites = false;
  highlightedWaitlistId = '';
  visibilitySaving = false;
  visibilityPending = null;
  memberRefreshed = false;
  refreshingMember = false;
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
  ]);

  if (results[0].status === 'fulfilled') waitlistEntries = results[0].value;
  if (results[1].status === 'fulfilled') shares = results[1].value;
  if (results[2].status === 'fulfilled') recommendations = results[2].value;

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
  onPlaceContributed: () => void
): void {
  knownVenues = venues;
  if (memberTab === 'settings') void refreshMemberRecord(render);
  root.querySelectorAll<HTMLButtonElement>('[data-community-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      mode = button.dataset.communityMode === 'join' ? 'join' : 'sign-in';
      if (mode === 'sign-in') clearInvitationRoute();
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
    const email = String(values.get('email') || '').trim();
    submitting = true;
    notice = null;
    render();
    try {
      await pb.collection('members').create({
        display_name: String(values.get('display_name') || '').trim(),
        pseudo: String(values.get('pseudo') || '').trim(),
        email,
        password,
        passwordConfirm,
        home_city: String(values.get('home_city') || '').trim(),
        home_country: String(values.get('home_country') || '').trim(),
        invite_code: String(values.get('invite_code') || '').trim().toUpperCase(),
      });
    } catch (error) {
      submitting = false;
      notice = { kind: 'error', text: readableError(error, 'That invitation could not be accepted. Check the code and try again.') };
      render();
      return;
    }
    try {
      await pb.collection('members').authWithPassword(email, password);
      submitting = false;
      resetCommunityState();
      notice = null;
      onAuthed();
    } catch {
      submitting = false;
      mode = 'sign-in';
      clearInvitationRoute();
      notice = { kind: 'success', text: 'Your membership is ready. Sign in to continue.' };
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
      await pb.collection('members').update(record.id, { pseudo });
      notice = { kind: 'success', text: `Your pseudo is now @${pseudo}.` };
    } catch (error) {
      notice = { kind: 'error', text: readableError(error, 'Your pseudo could not be updated. Please try again.') };
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
      if (member()?.id !== record.id) return;
      Object.assign(record, updated);
      notice = {
        kind: 'success',
        text: keepPrivate
          ? 'Your recommendations are now private and hidden from the Detour circle.'
          : 'Your recommendations are now discoverable by the full Detour circle.',
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

  root.querySelectorAll<HTMLButtonElement>('[data-community-sign-out]').forEach((button) =>
    button.addEventListener('click', () => {
      pb.authStore.clear();
      resetCommunityState();
      notice = { kind: 'info', text: 'You have signed out of Detour.' };
      render();
    })
  );

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
    if (!member() || !invitesLoaded || loadingInvites || openInvites().length >= INVITATION_LIMIT) return;
    submitting = true;
    notice = null;
    render();
    try {
      await pb.collection('invites').create({});
      invitesLoaded = false;
      notice = { kind: 'success', text: 'Your invitation link is ready.' };
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
      onPlaceContributed();
      communityLoaded = false;
      await loadCommunity(render);
      focusWaitlistEntry(highlightedWaitlistId);
    } catch (error) {
      notice = { kind: 'error', text: readableError(error, 'That recommendation could not be added. Check the food-and-drink destination details and note, then try again.') };
    } finally {
      submitting = false;
      render();
    }
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
      submitting = true;
      notice = null;
      render();
      try {
        // The shared place first, so the recommendation hook re-syncs its
        // display mirrors from the freshly corrected entry.
        await pb.collection('community_waitlist_entries').update(entryId, {
          venue_name: String(values.get('venue_name') || '').trim(),
          address: String(values.get('address') || '').trim(),
          city: String(values.get('city') || '').trim(),
          country: String(values.get('country') || '').trim(),
          category,
          occasions,
          official_url: String(values.get('official_url') || '').trim(),
          instagram_url: String(values.get('instagram_url') || '').trim(),
          image_url: String(values.get('image_url') || '').trim(),
        });
        if (recommendationId) {
          await pb.collection('community_recommendations').update(recommendationId, {
            note: String(values.get('note') || '').trim(),
            category,
            occasions,
          });
        }
        highlightedWaitlistId = entryId;
        notice = { kind: 'success', text: 'Recommendation updated.' };
        communityLoaded = false;
        await loadCommunity(render);
        focusWaitlistEntry(entryId);
      } catch (error) {
        notice = { kind: 'error', text: readableError(error, 'Those changes could not be saved. Check the details and try again.') };
      } finally {
        submitting = false;
        render();
      }
    });
  });

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

  if (member() && !communityLoaded && !loadingCommunity) {
    void loadCommunity(render).then(() => {
      if (memberTab === 'detours' && detourTab === 'shares') void markIncomingSharesSeen();
    });
  }
  if (member() && !invitesLoaded && !loadingInvites) void loadInvites(render);
}
