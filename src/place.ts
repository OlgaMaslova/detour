/**
 * The place page — one published place, its own route, the whole record.
 *
 * Reached from every card in the app and addressable on its own
 * (`?d=<city>&p=<place>`), so a place can be linked to and read in full: the
 * cover, why members put it on the list, every note they wrote, where it sits,
 * and how to get there.
 *
 * This module owns the page's markup only. Routing, state and the post-render
 * wiring stay in main.ts, which passes the chrome and the venue-formatting
 * helpers it already owns — the same split network.ts uses.
 */

import type { Venue } from './data';
import { ENDORSE_LABEL, detouristSignalBadge } from './signal';
import type { EndorsementSignal } from './signal';

/** One member's note about this place, as the circle feed reports it. */
export interface PlaceNote {
  note?: string;
  recommender_pseudo?: string;
  is_own?: boolean;
  founding_member?: boolean;
  created?: string;
  /**
   * The photo this member attached to this note, already resolved to a full URL
   * by main.ts; '' when they attached none. Inside a note block the attribution
   * is exact — this is only ever its own author's photo. The hero above is the
   * looser one: it shows the newest photo any visible recommender contributed,
   * which need not be the member quoted beneath it.
   */
  photoHref?: string;
}

/** Shell furniture — hrefs and fragments main.ts already renders elsewhere. */
export interface PlaceChrome {
  destinationName: string;
  destinationSlug: string;
  destinationHref: string;
  countryName: string;
  countrySlug: string;
  countryHref: string;
  exploreHref: string;
  /**
   * Whether this reader has an account. The gate on everything that writes, and
   * on the invitation offered to whoever does not.
   *
   * It replaced a `canExplore` that answered two questions at once — may this
   * reader browse, and may they act. Those stopped being the same question when
   * the catalogue opened to visitors: browsing is now everybody's, so the
   * breadcrumb and Copy link are unconditional, and this flag is only about
   * acting. A single flag would have handed a visitor a Recommend button that
   * cannot work.
   */
  isMember: boolean;
  /**
   * Whether this reader may mark this place as been & loved: a verified member,
   * looking at a place that is not their own. A member who has written about it
   * cannot — their note already is the endorsement, and one person must never
   * stand on a place twice.
   */
  canEndorse: boolean;
  /**
   * Whether this reader may put this place on their wishlist: the same gate
   * as `canEndorse`, and additionally not somewhere they have already been. The
   * ladder only runs forward — saving a place you have been to is meaningless.
   */
  canSave: boolean;
  /**
   * Whether this reader may send this place to another member privately. The
   * loosest gate of the three: any signed-in member, their own places included,
   * because a place somebody recommended is the most natural thing for them to
   * pass on to one person. It says nothing publicly and changes no figure.
   */
  canShare: boolean;
  /**
   * A reader whose own scope does not reach this place — a link they were sent.
   * The page states what publication made public and stops there: no figures, and
   * no note, because the recommendation behind this place belongs to somebody they
   * cannot see. True for a member outside the recommenders' circles and for a
   * visitor on a place no founding member has recommended, and the copy names
   * which of the two is reading.
   */
  outsideCircle: boolean;
  /**
   * Whether to stamp the place with its Detourist signal at all.
   *
   * True everywhere in the catalogue, including on a published place nobody has
   * recommended yet — there the bare mark says "no count on file", which is a
   * real thing to say about a place that could have one.
   *
   * False for a member's imported place, where it cannot. Nobody has stood
   * behind it and nobody can until somebody writes a recommendation, so the mark
   * reports an absence that was never a possibility — and the provenance band
   * directly beneath already says, in words, that nobody on Detour has
   * recommended it. Two statements of the same nothing, one of them cryptic.
   */
  showSignal?: boolean;
  /**
   * A mark stamped at the top of the hero's copy column, above the title, or ''.
   *
   * The one visual statement this page makes about a place's standing that is
   * not a count. Used by a member's imported place to say, without a sentence,
   * that it is theirs alone and not in the catalogue — the copy that said so
   * before was a muted line nobody read, which is a structural fact carried by
   * prose. It leads the page rather than sitting over the photograph: the
   * standing of the place is the first thing to know about it, and the
   * photograph is the publication's rather than ours to mark up. Rendered by the
   * template rather than injected, for the same reason as `afterHero`.
   */
  heroStamp?: string;
  /**
   * Markup to stand directly under the hero, or ''.
   *
   * One slot, for the one thing a place can carry that the catalogue has no
   * field for: where an imported place came from, and that nobody but its owner
   * can see it. A slot rather than a branch keeps this template ignorant of that
   * feature — and it replaced `insertAdjacentHTML` after render, which had been
   * anchored on a class this page does not have, so the content silently never
   * appeared and nothing threw or logged.
   */
  afterHero?: string;
  /** Whether it is already on their list. Their own row; nobody else can see it. */
  saved: boolean;
  /** A toggle in flight, so the control can say so rather than sit inert. */
  saving: boolean;
  /** The server's own sentence when the last attempt was refused; '' otherwise. */
  saveError: string;
  /**
   * The member-only primary nav, rendered by main.ts so this page cannot drift
   * from the masthead every other surface shows. It used to hardcode an Explore
   * link here, which is how the place page ended up as the one screen with no way
   * through to My Circle.
   */
  memberNav: string;
  homeHref: string;
  accountHref: string;
  /** The founding-seat request page, for a reader who wants one of fifty. */
  foundingHref: string;
  recommendHref(v: Venue): string;
  editRecommendationHref(v: Venue): string;
  sharePlaceHref(v: Venue): string;
  /**
   * This page's own address, absolute, for handing to somebody outside Detour.
   * Absolute because it is going into a chat rather than into this document, and
   * built by main.ts because that is where `window` lives.
   */
  placeLinkUrl(v: Venue): string;
  brandMark: string;
  communityControl: string;
  footerTagline: string;
  /** The footer's How it works link, rendered by main.ts so every footer carries it. */
  footerLinks: string;
  themeToggle: string;
}

/**
 * Venue formatting main.ts shares with the cards and the map preview, so the
 * page cannot drift from how the same facts read on every other surface.
 */
export interface PlaceHelpers {
  esc(value: string): string;
  safeExternalHref(value: string | undefined): string;
  /** The `place` cover variant, monogram fallback included. */
  cover(v: Venue): string;
  /** Operator and social links, already anchored; '' when the record has none. */
  visitLinks(v: Venue): string;
  directionsHref(v: Venue): string;
  occasionLabels(v: Venue): string[];
  notes(v: Venue): PlaceNote[];
  /** Loading/retry markup for the circle feed the notes come from. */
  notesStatus: string;
  shortDate(value: string | undefined): string;
}

/**
 * Every note members attached to this place, attribution and date intact —
 * each with its own author's photo when they added one.
 *
 * Deliberately not a gallery. Collecting the photos into a grid of their own
 * would separate each picture from the note that came with it, and would state
 * a count: a member who can see two recommendations would learn from a
 * five-photo grid that three more exist beyond their circle. Every photo here
 * sits inside a note block the caller was already shown.
 *
 * SCOPED, NOT GATED — and the difference is the whole of it. This section used to
 * be withheld from anyone without a session, because the feed behind `h.notes`
 * was the newest two dozen notes in the city from any member, so a shared place
 * showed a stranger member prose whenever it happened to fall inside that window
 * and bare facts when it did not. Which of those a visitor got was decided by how
 * recently somebody wrote about the place, which is no rule at all.
 *
 * The rule now is the one the rest of the app runs on: a reader is shown the
 * notes their own scope reaches, and a visitor's scope is the founding circle.
 * The server settles it — see /api/detour/public-recommendations — so nothing
 * here has to ask who is reading before printing a sentence.
 */
function notesSection(v: Venue, chrome: PlaceChrome, h: PlaceHelpers): string {
  // A reader who reached this place from outside their own scope. The notes are
  // real and they are not theirs to read, so the section says which of those two
  // facts applies rather than letting the ordinary empty state say the other: "no
  // member has attached a note" would be false, and this reader is the one person
  // likely to know it — they were sent the place by somebody who had read it.
  if (chrome.outsideCircle) {
    return `<section class="place-section place-notes" aria-labelledby="place-notes-title">
      <h2 id="place-notes-title">What members wrote</h2>
      <p class="place-empty">${
        chrome.isMember
          ? 'Nobody in your circle has recommended this place, so there is nothing here for you to read. Recommend it yourself and it goes on the list for everyone who can see you.'
          : 'This place was recommended by a member outside the founding circle, so what they wrote is inside Detour rather than out here.'
      }</p>
    </section>`;
  }
  const notes = h.notes(v).filter((item) => {
    const recommender = item.recommender_pseudo?.trim().replace(/^@+/, '');
    return Boolean(item.note?.trim() && (item.is_own || recommender));
  });
  const heading = '<h2 id="place-notes-title">What members wrote</h2>';
  if (notes.length === 0) {
    return `<section class="place-section place-notes" aria-labelledby="place-notes-title">
      ${heading}
      ${h.notesStatus || '<p class="place-empty">No member has attached a note to this place yet.</p>'}
    </section>`;
  }
  return `<section class="place-section place-notes" aria-labelledby="place-notes-title">
    <div class="place-notes-heading">
      ${heading}
      ${
        notes.length > 2
          ? `<div class="place-note-controls" aria-label="Recommendation carousel controls">
              <button type="button" class="secondary-button place-note-control" data-place-notes-prev aria-label="Previous recommendations">←</button>
              <button type="button" class="secondary-button place-note-control" data-place-notes-next aria-label="Next recommendations">→</button>
            </div>`
          : ''
      }
    </div>
    ${h.notesStatus}
    <div class="place-note-carousel" data-place-note-carousel tabindex="0" aria-label="Member recommendations">
      ${notes
        .map((item) => {
          const recommender = item.recommender_pseudo?.trim().replace(/^@+/, '');
          const memberLabel = item.is_own ? 'You' : recommender || '';
          const when = h.shortDate(item.created);
          const photoAlt = memberLabel
            ? `Photo by ${memberLabel}`
            : 'Photo from this recommendation';
          return `<blockquote class="detail-network-note place-note${item.photoHref ? ' has-photo' : ''}">
            ${
              item.photoHref
                ? `<figure class="place-note-photo"><img src="${h.esc(item.photoHref)}" alt="${h.esc(photoAlt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-place-note-photo></figure>`
                : ''
            }
            <p>${h.esc(item.note || '')}</p>
            <footer>
              <span class="place-note-author">Recommended by <strong class="network-pseudo">${h.esc(memberLabel)}</strong></span>${
              item.founding_member
                ? '<span class="place-founding-note"><span aria-hidden="true">★</span> Founding member</span>'
                : ''
            }${
              when
                ? `<time datetime="${h.esc(item.created || '')}">${h.esc(when)}</time>`
                : ''
            }${
              item.is_own
                ? `<a class="place-note-edit" href="${h.esc(chrome.editRecommendationHref(v))}" data-community-route="edit-recommendation" data-recommend-venue="${h.esc(v.id)}" aria-label="${h.esc(`Edit your recommendation for ${v.name}`)}">Edit</a>`
                : ''
            }</footer>
          </blockquote>`;
        })
        .join('')}
    </div>
  </section>`;
}

/**
 * Been & loved — the rung below writing a note, and the only one that costs the
 * member nothing.
 *
 * Under the notes on purpose: it is corroboration of what is written above it,
 * never a replacement for writing. The button appears only where a member could
 * honestly press it — not on their own place, where their note already is the
 * endorsement — and the names appear whenever there are any the reader may see,
 * because there are no anonymous signals in Detour.
 *
 * A reader who can see the place but none of its endorsers gets the figure and
 * no names. That is the designed outcome, not a degraded one: the count is a
 * global fact about the place, and naming somebody outside the reader's reach
 * would tell them that member exists.
 */
/** The place's marks, as the one stamp in the hero reports them. */
function endorsementSignal(v: Venue): EndorsementSignal {
  const endorsers = v.endorsements ?? [];
  return {
    total: v.endorsementTotal,
    circle: endorsers.filter((person) => person.inGraph).length,
    founders: endorsers.filter((person) => !person.inGraph).length,
    own: v.endorsedByCaller === true,
    // Everybody but the reader. The sentence already says "you" whenever they
    // are one of the endorsers, so naming them again turns "You have been and
    // loved it" into "You have been and loved it — You".
    names: endorsers.filter((person) => !person.isOwn).map((person) => person.name),
  };
}

/**
 * Everything a reader can do about this place, on one row in the hero.
 *
 * The row sits with the stamp rather than in a section of its own, and that is
 * the whole point: a member decides what they want to say in the same glance
 * that tells them who else has already said it. These used to be spread across
 * the page — the mark in the hero, a "Been here too?" panel at the very bottom
 * with a heading and a sentence of its own — which asked the reader to scroll
 * past the notes to find the one thing the notes might have made them want to do.
 *
 * IN LADDER ORDER, STRONGEST FIRST. Recommending is the whole product and it
 * leads, alone, and is the only thing here wearing the primary weight. Everything
 * else a reader can do — corroborate the notes, file it for later, send it to one
 * person — collapses behind a single quiet "More", because four buttons abreast
 * made the row a menu of equals and the strongest act had to compete with a
 * private bookmark for the same glance.
 *
 * The collapse is also what keeps Been & loved honest. Its whole risk is reading
 * as a substitute for writing; in a list under a fold it cannot, and the one
 * button in the open is the one that asks for a note.
 *
 * Each control disappears once its answer is given. A pressed button restating a
 * settled fact offers it as though it were still a decision.
 */
function placeActions(
  v: Venue,
  chrome: PlaceChrome,
  h: PlaceHelpers,
  alreadyRecommended: boolean
): string {
  // Never offered on a place the reader has already written about: their note is
  // there, and the edit link inside it is how they change it.
  const recommend =
    chrome.isMember && !alreadyRecommended
      ? `<a class="primary-button place-recommend-button" href="${h.esc(
          chrome.recommendHref(v)
        )}" data-community-route="recommend-place" data-recommend-venue="${h.esc(
          v.id
        )}" aria-label="${h.esc(`Recommend ${v.name}`)}">Recommend this place</a>`
      : '';
  const more = moreActions(v, chrome, h);
  if (!recommend && !more) return '';
  return `<div class="place-endorse-row">
    ${recommend}
    ${more}
    <p class="place-endorsement-status" role="status" data-endorse-status></p>
    ${
      chrome.saveError
        ? `<p class="place-save-status" role="alert">${h.esc(chrome.saveError)}</p>`
        : ''
    }
  </div>`;
}

/**
 * One control that has to read correctly in either housing — as a row inside the
 * menu, or as a plain button in the open when it is the only one left.
 */
type PlaceAction = (inMenu: boolean) => string;

/** What tells the two housings apart: a menu row is a menu row, not a button. */
function actionAttrs(inMenu: boolean): string {
  return inMenu ? ' role="menuitem" class="place-more-item"' : ' class="secondary-button"';
}

/**
 * The quiet acts, and how they are packaged.
 *
 * In descending order of what they tell Detour: the mark corroborates the notes,
 * the save says something to nobody but the member, the share says something to
 * one member, and the link says nothing to anybody here at all — it hands the
 * page to somebody outside, and Detour never learns that it happened.
 *
 * A dropdown holding one item is a joke at the reader's expense, and both marks
 * vanish once given — so the menu appears from two items up and a lone survivor
 * is rendered flat, as it was before any of this. That is why each control is a
 * function of where it is being rendered rather than a fixed string: the same
 * control has to read as a menu row in one place and a button in the other.
 *
 * "More" is deliberately incurious about its own contents. It was tempting to
 * name them — "Add or share" — but the label would then have to stay true as the
 * items disappear one by one, and a button reading "Add or share" over a menu
 * holding only Share is worse than one that promised nothing.
 *
 * Share carries no "privately" of its own. Everything in Detour is private, the
 * item sits between two controls nobody outside the circle can see, and the form
 * it opens says who it is going to — so the word was doing no work the
 * surroundings were not already doing.
 *
 * It does name where it goes: "Share in Detour", because Copy link sits directly
 * under it and that one leaves. Two rows both reading as sharing, one internal
 * and one not, is a choice the reader cannot make from the labels alone.
 */
function moreActions(v: Venue, chrome: PlaceChrome, h: PlaceHelpers): string {
  const endorse =
    chrome.canEndorse && v.endorsedByCaller !== true
      ? (inMenu: boolean) =>
          `<button type="button"${actionAttrs(inMenu)} data-endorse-place="${h.esc(
            v.id
          )}" aria-label="${h.esc(`${ENDORSE_LABEL} — ${v.name}`)}">${h.esc(ENDORSE_LABEL)}</button>`
      : null;
  const save = saveAction(v, chrome, h);
  const share = chrome.canShare
    ? (inMenu: boolean) =>
        `<a${actionAttrs(inMenu)} href="${h.esc(
          chrome.sharePlaceHref(v)
        )}" data-community-route="share-place" data-share-venue="${h.esc(
          v.id
        )}" aria-label="${h.esc(`Share in Detour — ${v.name}`)}">Share in Detour</a>`
    : null;
  // Last, and the only one that leaves Detour. A button rather than a link: the
  // URL is not somewhere this reader is going, it is something they are taking.
  // Offered to a visitor too — the page they are on is already public, and the
  // one act that costs nobody anything is passing it on.
  //
  // Withheld when there is no address to hand over. Every published place has
  // one; a member's imported place does not — its route resolves for that member
  // alone, so a copied link is a 400 for whoever it is pasted to.
  const shareableUrl = chrome.placeLinkUrl(v);
  const copyLink = shareableUrl
    ? (inMenu: boolean) =>
        `<button type="button"${actionAttrs(inMenu)} data-copy-place-link="${h.esc(
          shareableUrl
        )}" aria-label="${h.esc(`Copy a link to ${v.name}`)}">Copy link</button>`
    : null;
  const items = [endorse, save, share, copyLink].filter(
    (entry): entry is PlaceAction => entry !== null
  );
  if (items.length === 0) return '';
  if (items.length === 1) return items[0](false);
  return `<div class="place-more" data-place-more>
    <button type="button" class="secondary-button place-more-toggle" data-place-more-toggle
      aria-haspopup="true" aria-expanded="false" aria-controls="place-more-items"${
        chrome.saving ? ' disabled' : ''
      }>${chrome.saving ? 'Saving…' : 'More'}<span aria-hidden="true">▾</span></button>
    <div class="place-more-items" id="place-more-items" role="menu" aria-label="${h.esc(
      `More for ${v.name}`
    )}" hidden>
      ${items.map((entry) => entry(true)).join('')}
    </div>
  </div>`;
}

/**
 * Wanna go — the private rung, and deliberately the quiet one.
 *
 * Last in the menu, because it loses to everything above it: writing tells the
 * next reader something, the mark tells the member who wrote the note that they
 * were right, a share tells one person directly, and this tells nobody anything.
 * Someone who has been should press the item that says so, not the one that files
 * the place for later.
 *
 * Nothing here states a count, and there is nothing to state. No other member can
 * learn that this place is on anybody's list, including that anybody's list has
 * it — a visible tally would be a popularity ranking, which is the thing this
 * product exists in opposition to.
 *
 * Once saved there is no control here at all, which is the same treatment Been &
 * loved gets above it and for the same reason: the decision is made, and a
 * button reading "On your Wanna go list" states a settled fact while offering it
 * as though it were still a question. The stamp above the row carries the state
 * for both, which is what makes hiding them inside a menu safe.
 *
 * Removal lives on My detours → Wanna go, alongside the rest of the member's own
 * wishlist, which is where tidying a list belongs rather than on a public page.
 * Taking one off takes no confirmation when they get there: it is private and
 * reversible, and a confirmation dialogue on a bookmark is an insult.
 *
 * A refusal is reported by the row rather than beside the button, because the
 * button may be inside a closed menu by the time the server answers — and an
 * error nobody can see is not a report. In flight the trigger says "Saving…" for
 * the same reason: the menu shuts on the click, so that is the only place left
 * where the member can be told anything.
 */
function saveAction(v: Venue, chrome: PlaceChrome, h: PlaceHelpers): PlaceAction | null {
  if (!chrome.canSave || chrome.saved) return null;
  return (inMenu: boolean) =>
    `<button type="button"${actionAttrs(inMenu)} data-save-place="${h.esc(
      v.id
    )}" aria-label="${h.esc(`Wanna go — ${v.name}`)}"${
      chrome.saving ? ' disabled' : ''
    }>${chrome.saving ? 'Saving…' : 'Wanna go'}</button>`;
}

/** Position, address and the handoff to a maps app. */
function whereSection(v: Venue, h: PlaceHelpers): string {
  const located = v.lat !== null && v.lng !== null;
  const directions = h.directionsHref(v);
  const visitLinks = h.visitLinks(v);
  return `<section class="place-section place-where" aria-labelledby="place-where-title">
    <h2 id="place-where-title">Where it is</h2>
    <div class="place-where-body">
      ${
        located
          ? `<div id="${PLACE_MAP_ID}" class="detail-locator-map place-map" role="group" aria-label="${h.esc(`Map of ${v.name}${v.address ? `, ${v.address}` : ''} — zoom controls inside`)}"></div>`
          : ''
      }
      <div class="place-where-facts">
        <dl class="detail-facts">
          <div><dt>Address</dt><dd>${
            v.address ? h.esc(v.address) : '<span class="approx">Map position being refined</span>'
          }</dd></div>
          <div><dt>City</dt><dd>${h.esc([v.city, v.country].filter(Boolean).join(', '))}</dd></div>
        </dl>
        ${v.approxLocation && located ? '<p class="approx">Position is approximate — confirm before you set off.</p>' : ''}
        ${
          directions || visitLinks
            ? `<div class="detail-visit-links place-visit-links">
                ${directions ? `<a class="secondary-button" href="${h.esc(directions)}" target="_blank" rel="noopener noreferrer">Get directions <span class="nav-arrow nav-arrow-external" aria-hidden="true">&#x2197;&#xFE0E;</span></a>` : ''}
                ${visitLinks}
              </div>`
            : '<p class="place-empty">No address or links on file yet — ask the member who recommended it.</p>'
        }
      </div>
    </div>
  </section>`;
}

/**
 * What a visitor gets instead of the notes: the two ways in, and nothing above
 * them.
 *
 * It used to open with a heading and a paragraph explaining that a member put
 * their name behind this place and that nothing else gets in. By the time a
 * visitor reaches this section they have read the note, the name and the founding
 * badge attached to it — the paragraph restated in the abstract what the page had
 * just shown concretely, which is the shape of a pitch rather than a fact.
 *
 * The two options carry their own copy, and it is the copy only an account can
 * cash: the people you invite, the seats, what reaches whom. That is what a
 * stranger cannot be shown, and it is enough said.
 *
 * Labelled rather than headed, since there is no longer a heading to point at. A
 * visually hidden one would be a heading kept for the outline's sake, saying
 * something no reader was meant to read.
 *
 * The form it points at is the one on the home page, unchanged. A second
 * invitation form would be a second thing to keep honest.
 */
function visitorInvitation(chrome: PlaceChrome, h: PlaceHelpers): string {
  if (chrome.isMember) return '';
  return `<section class="place-section place-visitor" aria-label="Join Detour">
    <div class="place-visitor-actions">
      <div class="place-visitor-option">
        <a class="primary-button place-visitor-cta" href="${h.esc(
          chrome.accountHref
        )}" data-community-route="sign-up">Start your circle<span class="nav-arrow" aria-hidden="true">&#x2192;</span></a>
        <p>Sign up and you are in — no code, no queue. Everything you write reaches the people you invite.</p>
      </div>
      <div class="place-visitor-option">
        <a class="secondary-button place-visitor-cta-secondary" href="${h.esc(
          chrome.foundingHref
        )}" data-founding>Ask to become a founder<span class="nav-arrow" aria-hidden="true">&#x2192;</span></a>
        <p>One of fifty seats, free for life, whose places reach every member. We read every request and reply personally.</p>
      </div>
    </div>
  </section>`;
}

/**
 * Container the locator map mounts into. Shared with main.ts so the map is
 * always looked up by the id this markup actually renders.
 */
export const PLACE_MAP_ID = 'selected-place-map';

/** Whether this place has a verified coordinate to plot. */
export function placeIsLocated(v: Venue): boolean {
  return v.lat !== null && v.lng !== null;
}

/** The full page, ready to assign to the app root. */
export function placePageMarkup(v: Venue, chrome: PlaceChrome, h: PlaceHelpers): string {
  const meta = [v.category, v.neighborhood].filter(Boolean).join(' · ');
  const occasions = h.occasionLabels(v);
  const alreadyRecommended = h.notes(v).some((item) => item.is_own && Boolean(item.note?.trim()));
  return `
    <a class="skip-link" href="#place-title">Skip to this place</a>
    <header class="network-masthead">
      <a class="network-brand" href="${h.esc(chrome.homeHref)}" data-home>${chrome.brandMark}<span class="brand-word">Detour</span></a>
      ${
        chrome.memberNav
          ? `<nav class="network-primary-nav" aria-label="Primary navigation">${chrome.memberNav}</nav>`
          : ''
      }
      ${chrome.communityControl}
    </header>
    <nav class="place-back-row explore-breadcrumb" aria-label="Breadcrumb">
      <a href="${h.esc(chrome.exploreHref)}" data-explore>Explore</a>
      ${
        chrome.countryName
          ? `<span aria-hidden="true">/</span><a href="${h.esc(chrome.countryHref)}" data-country="${h.esc(
              chrome.countrySlug
            )}">${h.esc(chrome.countryName)}</a>`
          : ''
      }
      <span aria-hidden="true">/</span>
      <a href="${h.esc(chrome.destinationHref)}" data-open-destination="${h.esc(chrome.destinationSlug)}">${h.esc(
        chrome.destinationName
      )}</a>
      <span aria-hidden="true">/</span>
      <span aria-current="page">${h.esc(v.name)}</span>
    </nav>
    <article class="place-page">
      <header class="place-hero">
        <div class="place-hero-copy">
          ${chrome.heroStamp || ''}
          <p class="place-overline">${h.esc(`${chrome.destinationName}`)}</p>
          <h1 id="place-title" tabindex="-1">${h.esc(v.name)}</h1>
          <div class="place-hero-details">
            ${meta ? `<p class="place-meta">${h.esc(meta)}</p>` : ''}
            ${
              occasions.length
                ? `<p class="place-good-for">${h.esc(occasions.join(' · '))}</p>`
                : ''
            }
            ${
              chrome.showSignal === false
                ? ''
                : `<div class="place-signal-row">
              ${detouristSignalBadge(
                {
                  total: v.detouristTotal ?? v.detouristCount,
                  circle: v.circleCount,
                  founders: v.founderCount,
                  own: alreadyRecommended,
                },
                'plate',
                endorsementSignal(v),
                // The one thing on this stamp that is about the reader rather
                // than the place. The control disappears once a place is saved,
                // so without this mark there would be nothing at all telling a
                // member the place is already on their list — and they would
                // press it again wondering why nothing happened.
                chrome.saved
              )}
            </div>`
            }
            ${placeActions(v, chrome, h, alreadyRecommended)}
          </div>
        </div>
        ${h.cover(v)}
      </header>
      ${chrome.afterHero || ''}
      ${
        v.description
          ? `<section class="place-section place-about" aria-labelledby="place-about-title">
              <h2 id="place-about-title">About this place</h2>
              <p class="detail-description">${h.esc(v.description)}</p>
            </section>`
          : ''
      }
      ${notesSection(v, chrome, h)}
      ${whereSection(v, h)}
      ${visitorInvitation(chrome, h)}
    </article>
    <footer class="footer place-footer">
      <p>${chrome.footerTagline}</p>${chrome.footerLinks}
      ${chrome.themeToggle}
    </footer>
  `;
}
