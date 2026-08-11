/**
 * The community area's shell — the member-area and My-detours panels, the
 * masthead control, and the one bind that wires every feature module to the
 * rendered markup. This file is also the module's public face: everything the
 * rest of the app uses is re-exported at the bottom, so importers keep saying
 * `from './community'` and never learn the layout inside.
 */
import type { Venue } from '../data';
import type { NetworkPlaceResolver } from '../network';
import { ensureSavedPlaces } from '../saved';
import { ensureGuides } from '../guides';
import { esc, loadCommunity, member, memberName, noticeMarkup, store, unseenShareCount } from './store';
import type { DetourTab, MemberTab } from './store';
import { bindAuth, passwordResetRouted, signedOutPanel } from './auth';
import {
  bindQueue,
  deleteRecommendationDialogMarkup,
  focusPendingEditEntry,
  recommendationPanel,
} from './queue';
import { bindShares, markIncomingSharesSeen, sharesPanel } from './shares';
import { bindInvites, invitesPanel } from './invites';
import { bindCuration, curationPanel, reloadCuration } from './curation';
import { bindEndorsements, endorsementsPanel } from './endorsements';
import { bindBoards, importDialogMarkup, removeGuideDialogMarkup, savedPanel } from './boards';
import { bindSettings, settingsPanel } from './settings';
import { bindDirectories } from './directory';

// One order, used by both the member-area tab strip and the masthead menu.
const MEMBER_TAB_LABELS: Record<MemberTab, string> = {
  invitations: 'Invitations',
  settings: 'Settings',
  curation: 'Curation',
};
function memberTabs(): MemberTab[] {
  return store.foundingMember
    ? ['invitations', 'curation', 'settings']
    : ['invitations', 'settings'];
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
            `<button class="community-tab ${store.detourTab === tab.id ? 'is-active' : ''}" type="button" role="tab" id="detour-tab-${tab.id}" aria-selected="${store.detourTab === tab.id}" aria-controls="detour-panel-${tab.id}" tabindex="${store.detourTab === tab.id ? '0' : '-1'}" data-detour-tab="${tab.id}">${tab.label}${tab.id === 'shares' && unseen ? `<span class="community-tab-badge" aria-label="${unseen} new shares">${unseen}</span>` : ''}</button>`
        )
        .join('')}
    </div>
    ${
      store.detourTab === 'recommendations'
        ? `<div class="community-detour-body" id="detour-panel-recommendations" role="tabpanel" aria-labelledby="detour-tab-recommendations">${recommendationPanel()}</div>`
        : store.detourTab === 'endorsements'
          ? `<div class="community-detour-body" id="detour-panel-endorsements" role="tabpanel" aria-labelledby="detour-tab-endorsements">${endorsementsPanel()}</div>`
          : store.detourTab === 'saved'
            ? `<div class="community-detour-body" id="detour-panel-saved" role="tabpanel" aria-labelledby="detour-tab-saved">${savedPanel()}</div>`
            : `<div class="community-detour-body" id="detour-panel-shares" role="tabpanel" aria-labelledby="detour-tab-shares">${sharesPanel()}</div>`
    }
  </div>`;
}
function memberTabsMarkup(): string {
  const tabs = memberTabs();
  return `<div class="community-member-bar">
    <div class="community-member-tabs" role="tablist" aria-label="Member areas">
      ${tabs.map(
        (tab) =>
          `<button class="community-member-tab${store.memberTab === tab ? ' is-active' : ''}" type="button" role="tab" id="member-tab-${tab}" aria-selected="${store.memberTab === tab}" aria-controls="member-panel-${tab}" tabindex="${store.memberTab === tab ? '0' : '-1'}" data-member-tab="${tab}">${MEMBER_TAB_LABELS[tab]}${
            tab === 'curation' && store.imageCurationCount ? `<span class="community-tab-badge" aria-label="${store.imageCurationCount} photos awaiting review">${store.imageCurationCount}</span>` : ''}</button>`
      ).join('')}
    </div>
  </div>`;
}
function signedInPanel(): string {
  const record = member();
  if (!record) return signedOutPanel();
  const panel =
    store.memberTab === 'invitations'
      ? invitesPanel()
      : store.memberTab === 'curation' && store.foundingMember
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
  store.knownVenues = venues;
  // Still accepted here, since this panel is handed the catalogue anyway, but no
  // longer the only setter: `setPlaceResolver` runs on every render.
  if (resolvePlace) store.landingPlaceResolver = resolvePlace;
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
export function communityControl(href: string, current = false): string {
  const record = member();
  // Signed out, the control is a plain link into the sign-in / join panel.
  if (!record) {
    return `<a class="community-toggle${current ? ' is-current' : ''}" href="${esc(href)}" data-community-route${current ? ' aria-current="page"' : ''}>Members<span${current ? '' : ' class="nav-arrow nav-arrow-external"'} aria-hidden="true">${current ? '•' : '&#x2197;&#xFE0E;'}</span></a>`;
  }
  const items = memberTabs().map((tab) => {
    const active = current && store.memberTab === tab;
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
  store.detourTab = tab as DetourTab;
  store.detourTabChosen = true;
  return true;
}

/** Point the member area at one of its tabs (used by the masthead member menu). */
export function openMemberArea(tab: string): boolean {
  if (!memberTabs().includes(tab as MemberTab)) return false;
  store.memberTab = tab as MemberTab;
  return true;
}
export function communityPanel(venues: Venue[]): string {
  store.knownVenues = venues;
  // A routed reset token outranks a live session — see passwordResetRouted.
  const signedOut = !member() || passwordResetRouted();
  return `<div id="community-area" class="community-area">${signedOut ? signedOutPanel() : signedInPanel()}</div>`;
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
  store.knownVenues = venues;
  bindSettings(root, render);
  bindShares(root, render);
  bindAuth(root, render, onAuthed, onJoined);
  bindQueue(root, render, onPlaceContributed, refreshCatalogue);
  bindEndorsements(root, render);
  bindBoards(root, render);

  const activateDetourTab = (nextTab: DetourTab, focusTab: boolean) => {
    if (store.detourTab === nextTab) return;
    // The member has said which tab they want. The landing does not get to
    // second-guess that later in the session.
    store.detourTabChosen = true;
    store.detourTab = nextTab;
    if (nextTab === 'shares' && store.communityLoaded) void markIncomingSharesSeen();
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
    if (store.memberTab === nextTab) return;
    store.memberTab = nextTab;
    if (nextTab === 'curation') reloadCuration(render);
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

  bindCuration(root, render, refreshCatalogue);
  bindInvites(root, render);
  bindDirectories(root);

  // A CTA that says Recommend or Share has to land on the form, not
  // merely on the tab that holds it. The form is below the ledger, so the first
  // settled render after such a route scrolls to it and puts the cursor in it.
  // It waits for the ledger to finish loading, because that render replaces the
  // panel and would drop the focus again.
  if (store.pendingFormReveal && member() && store.communityLoaded && !store.loadingCommunity) {
    const selector =
      store.pendingFormReveal === 'share' ? '[data-community-share-place]' : '[data-community-recommendation]';
    store.pendingFormReveal = null;
    window.requestAnimationFrame(() => {
      const form = document.querySelector<HTMLElement>(selector);
      if (!form) return;
      form.scrollIntoView({ block: 'center' });
      form.querySelector<HTMLElement>('input, textarea')?.focus({ preventScroll: true });
    });
  }

  if (member() && !store.communityLoaded && !store.loadingCommunity) {
    void loadCommunity(render).then(() => {
      if (store.detourTab === 'shares') void markIncomingSharesSeen();
      // An Edit carried in from a place page can only find its row now.
      focusPendingEditEntry();
    });
  }
}

// ---------------------------------------------------------------------------
// The public face. Importers say `from './community'` and get exactly what the
// old single-file module exported; where a thing lives inside is this folder's
// own business.
// ---------------------------------------------------------------------------
export {
  ensureMemberFlags,
  expireMemberSession,
  markDetoursHaveContent,
  memberPlacePrompt,
  memberSession,
  setPlaceResolver,
  shouldShowLandingCommunityStrip,
  shouldShowLandingFeedCta,
  signOutMember,
} from './store';
export { applyInvitationRoute, applyPasswordResetRoute, openSignUp } from './auth';
export { passwordResetRouted };
export { meaningfulRecommendation, placeCollisionFor, readPlaceLink } from './place-form';
export type { PlaceCollision, PlaceLinkReading } from './place-form';
export { openEditRecommendation, openRecommendNewPlace, openRecommendPlace } from './queue';
export { openSharePlace } from './shares';
export { ensureInvitationLink, openInvitationLink } from './invites';
export { adoptCircleRecipients } from './directory';
export {
  bindImportedRemoval,
  boardCardsMarkup,
  cityPickPlaces,
  guideBoardPlaces,
  guideRemovalDialogMarkup,
  wannaGoBoardPlaces,
  wannaGoDestinationPlaces,
  wannaGoDestinations,
} from './boards';
export type { BoardPlace, WannaGoDestination } from './boards';
