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
  canExplore: boolean;
  /**
   * Whether this reader may mark this place as been & loved: a verified member,
   * looking at a place that is not their own. A member who has written about it
   * cannot — their note already is the endorsement, and one person must never
   * stand on a place twice.
   */
  canEndorse: boolean;
  /**
   * The member-only primary nav, rendered by main.ts so this page cannot drift
   * from the masthead every other surface shows. It used to hardcode an Explore
   * link here, which is how the place page ended up as the one screen with no way
   * through to My Circle.
   */
  memberNav: string;
  homeHref: string;
  accountHref: string;
  recommendHref(v: Venue): string;
  editRecommendationHref(v: Venue): string;
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
 */
function notesSection(v: Venue, chrome: PlaceChrome, h: PlaceHelpers): string {
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
 * The button, in the hero beside the count it changes.
 *
 * It sits with the stamp rather than in a section of its own, and that is the
 * whole point: a member decides they would send you here in the same glance that
 * tells them who else already has. Under the notes it was a footnote nobody
 * scrolled to, and a heading, an empty-state sentence and a line of instructions
 * were three pieces of furniture holding up one tap.
 *
 * Once pressed there is no control at all. The stamp above already says the mark
 * stands — the reader is counted in it and named in its tooltip — so anything
 * here would be stating a settled fact twice and offering it as though it were
 * still a decision.
 *
 * Shown only where a member could honestly press it — never on their own place,
 * where their note already is the endorsement.
 */
function endorsementControl(v: Venue, chrome: PlaceChrome, h: PlaceHelpers): string {
  if (!chrome.canEndorse || v.endorsedByCaller === true) return '';
  return `<div class="place-endorse-row">
    <button type="button" class="primary-button place-endorse-button" data-endorse-place="${h.esc(
      v.id
    )}" aria-label="${h.esc(`${ENDORSE_LABEL} — ${v.name}`)}">${h.esc(ENDORSE_LABEL)}</button>
    <p class="place-endorsement-status" role="status" data-endorse-status></p>
  </div>`;
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
          ? `<div class="place-map-wrap">
              <div id="${PLACE_MAP_ID}" class="detail-locator-map place-map" role="group" aria-label="${h.esc(`Map of ${v.name}${v.address ? `, ${v.address}` : ''} — zoom controls inside`)}"></div>
              <p class="detail-locator-credit">Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors</p>
            </div>`
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
      <nav class="network-primary-nav" aria-label="Primary navigation">
        ${chrome.memberNav}
        ${chrome.communityControl}
      </nav>
    </header>
    <nav class="place-back-row explore-breadcrumb" aria-label="Breadcrumb">
      ${
        chrome.canExplore
          ? `<a href="${h.esc(chrome.exploreHref)}" data-explore>Explore</a>`
          : `<a href="${h.esc(chrome.homeHref)}" data-home>Home</a>`
      }
      ${
        chrome.canExplore && chrome.countryName
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
          <p class="place-overline">${h.esc(`${chrome.destinationName}`)}</p>
          <h1 id="place-title" tabindex="-1">${h.esc(v.name)}</h1>
          <div class="place-hero-details">
            ${meta ? `<p class="place-meta">${h.esc(meta)}</p>` : ''}
            ${
              occasions.length
                ? `<p class="place-good-for">${h.esc(occasions.join(' · '))}</p>`
                : ''
            }
            <div class="place-signal-row">
              ${detouristSignalBadge(
                {
                  total: v.detouristTotal ?? v.detouristCount,
                  circle: v.circleCount,
                  founders: v.founderCount,
                  own: alreadyRecommended,
                },
                'plate',
                endorsementSignal(v)
              )}
            </div>
            ${endorsementControl(v, chrome, h)}
          </div>
        </div>
        ${h.cover(v)}
      </header>
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
      ${
        chrome.canExplore && !alreadyRecommended
          ? `<aside class="place-cta" aria-labelledby="place-cta-title">
              <div>
                <h2 id="place-cta-title">Been here too?</h2>
                <p>Add your own note for ${h.esc(v.name)} so the next Detourist knows what to order.</p>
              </div>
              <a class="network-primary-link" href="${h.esc(chrome.recommendHref(v))}" data-community-route="recommend-place" data-recommend-venue="${h.esc(v.id)}">Recommend this place <span class="nav-arrow nav-arrow-external" aria-hidden="true">&#x2197;&#xFE0E;</span></a>
            </aside>`
          : ''
      }
    </article>
    <footer class="footer place-footer">
      <p>${chrome.footerTagline}</p>${chrome.footerLinks}
      ${chrome.themeToggle}
    </footer>
  `;
}
