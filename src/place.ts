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

/**
 * How this place reached the reader, when it did not simply appear in the feed.
 *
 * A place can arrive through two doors: somebody in the circle recommended it,
 * or the member read a published list and kept it. The first door needs no
 * explaining — the notes below are the explanation, in the recommender's own
 * name. The second does: a place on a member's own list because Eater put it on
 * theirs is a different kind of fact, and the page has to say so before the
 * reader takes the words underneath for a recommendation.
 *
 * Both doors can be the same place. A member imports a list, somebody in their
 * circle later recommends one of its places, and the two facts are both true —
 * so this is a field on the ordinary place page rather than a flag distinguishing
 * two page types. Nothing here is public: a guide import is private to the member
 * who made it, so this band is only ever rendered for its own owner.
 */
export interface PlaceOrigin {
  /** The piece's own headline — what it is called where it was published. */
  title: string;
  /** Who published it. The attribution the words belong to. */
  publisher: string;
  /** Where the title points: Detour's own page for that guide, or '' for none. */
  href: string;
  /** When the member kept it, already formatted; '' when the row has no date. */
  importedOn: string;
}

/**
 * The publication's own sentence about this place — quoted, credited, and never
 * presented as a note.
 *
 * It sits with the member notes because a reader wants every voice about a place
 * in one place, and apart from them in its badge and its wording because a
 * publication's line is not somebody standing behind it. Nothing about it counts
 * toward any figure on this page.
 */
export interface PlaceGuideVoice {
  publisher: string;
  /** The piece the sentence came from, named so the quote has a home. */
  guideTitle: string;
  excerpt: string;
  /** The article itself, for reading the rest of it; '' when we have no URL. */
  sourceHref: string;
}

/**
 * One step in the trail above the title.
 *
 * ONE RULE: THE CRUMB IS GEOGRAPHY. Every trail in the app is EXPLORE / country
 * / city / here, and nothing else gets a say in it — not the list the reader
 * keeps the place on, not the tab they came from, not the guide it arrived on.
 * The back button owns the journey and *How it got here* owns the origin story.
 *
 * It used to be ownership: a place sat under RECOMMENDATIONS, BEEN & LOVED or
 * WANNA GO depending on the reader's standing, which meant the same place had
 * four possible parents and the trail changed under a reader who pressed a
 * button. One place is in one city, and that is the answer the crumb gives.
 *
 * Two consequences worth stating. A guide never appears inside a place's crumb:
 * it is a lens over places, not a container of them. And a member's own reading
 * of a city is not a level — there is one city page with two readings, chosen by
 * the control under its title, not by the trail above it.
 */
export interface PlaceCrumb {
  label: string;
  /** '' for the step the reader is on — the last one, which is not a link. */
  href: string;
  /**
   * Router hook attributes for the anchor, already escaped by the caller (main.ts
   * owns the routes, so it owns their hooks: `data-explore`, `data-guide`,
   * `data-wanna-destination="new-york"`, and the rest).
   */
  attrs?: string;
}

/** Shell furniture — hrefs and fragments main.ts already renders elsewhere. */
export interface PlaceChrome {
  /**
   * The whole trail, Explore first, this page last — built by main.ts, which is
   * the only module that knows the routes and which city pages actually exist.
   * The page used to assemble it here from an explore href, a country and a
   * destination; main.ts builds every trail in the app now, so the place page,
   * the city, the country and a guide cannot drift into four shapes.
   */
  crumbs: PlaceCrumb[];
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
   * Where this place came from, when it came from a published list; null or
   * absent for a place that only ever arrived through the feed.
   *
   * Typed data rather than the markup slot this replaced. The slot existed
   * because provenance was a private place's business alone — but a published
   * place the member also holds through a guide has the same thing to say, so
   * the page had to learn the fact rather than be handed a rendering of it. Two
   * callers building the same band by hand is how two renderings of one fact
   * start disagreeing.
   */
  origin?: PlaceOrigin | null;
  /**
   * The publications' own words about this place — nothing, usually, and one
   * line when the member kept it off a list that carried one.
   *
   * Rendered inside What people say, above the members. Never merged into
   * `notes`: a note is somebody standing behind a place and these are not, and a
   * single list of both would be exactly the conflation the badges exist to
   * prevent.
   */
  guideVoices?: PlaceGuideVoice[];
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
  landingHref: string;
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
 * What people say — every voice this place has, in one section.
 *
 * TWO KINDS, AND THE BADGES ARE THE WHOLE OF IT. A publication's line comes off
 * a list the member kept and stands for nothing: nobody has been, nobody is
 * answerable for it. A member's note is somebody's name against a place. They
 * read as one family of blocks because a reader wants everything said about a
 * place together, and each says which it is in the first thing on it — a section
 * that let those two blur would be a page quietly presenting Eater's copy as a
 * recommendation.
 *
 * The publication's line comes first and only ever once or twice: it is the
 * context the notes are read against. Members follow, in the carousel, because
 * they are the point.
 *
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
/**
 * The member notes this reader is actually shown — an empty note or one whose
 * author cannot be named is not a recommendation anybody can read, and a reader
 * outside the place's scope is shown none of them at all.
 *
 * Asked in two places, so it lives in one: the notes section prints these, and
 * the hero's origin band stands down because of them.
 */
function visibleNotes(v: Venue, chrome: PlaceChrome, h: PlaceHelpers): PlaceNote[] {
  if (chrome.outsideCircle) return [];
  return h.notes(v).filter((item) => {
    const recommender = item.recommender_pseudo?.trim().replace(/^@+/, '');
    return Boolean(item.note?.trim() && (item.is_own || recommender));
  });
}

function voicesSection(v: Venue, chrome: PlaceChrome, h: PlaceHelpers): string {
  const guideVoices = (chrome.guideVoices ?? []).filter((voice) => voice.excerpt.trim());
  const guideBlocks = guideVoices.map((voice) => guideVoiceBlock(voice, h)).join('');
  const heading = '<h2 id="place-notes-title">What people say</h2>';
  // A reader who reached this place from outside their own scope. The notes are
  // real and they are not theirs to read, so the section says which of those two
  // facts applies rather than letting the ordinary empty state say the other: "no
  // member has attached a note" would be false, and this reader is the one person
  // likely to know it — they were sent the place by somebody who had read it.
  //
  // Their own guide line still prints above it. It is theirs — a list they kept —
  // and withholding it would be withholding a member's words from themselves.
  if (chrome.outsideCircle) {
    return `<section class="place-section place-notes" aria-labelledby="place-notes-title">
      ${heading}
      ${guideBlocks}
      <p class="place-empty">${
        chrome.isMember
          ? 'Nobody in your circle has recommended this place, so there is nothing here for you to read. Recommend it yourself and it goes on the list for everyone who can see you.'
          : 'This place was recommended by a member outside the founding circle, so what they wrote is inside Detour rather than out here.'
      }</p>
    </section>`;
  }
  const notes = visibleNotes(v, chrome, h);
  // The publication having said something is never an answer to whether anybody
  // here has. A page holding one guide line and no notes still says so plainly,
  // under the quote — that absence is the most important thing on it.
  if (notes.length === 0) {
    return `<section class="place-section place-notes" aria-labelledby="place-notes-title">
      ${heading}
      ${guideBlocks}
      ${
        h.notesStatus ||
        `<p class="place-empty">${
          guideBlocks
            ? 'Nobody on Detour has recommended this place yet.'
            : 'No member has attached a note to this place yet.'
        }</p>`
      }
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
    ${guideBlocks}
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
          // Date, founding mark and the edit link — the attribution itself moved
          // up into the badge, so a note with none of these carries no footer
          // rather than an empty rule across the bottom of the block.
          const footer = [
            item.founding_member
              ? '<span class="place-founding-note"><span aria-hidden="true">★</span> Founding member</span>'
              : '',
            when ? `<time datetime="${h.esc(item.created || '')}">${h.esc(when)}</time>` : '',
            item.is_own
              ? `<a class="place-note-edit" href="${h.esc(chrome.editRecommendationHref(v))}" data-community-route="edit-recommendation" data-recommend-venue="${h.esc(v.id)}" aria-label="${h.esc(`Edit your recommendation for ${v.name}`)}">Edit</a>`
              : '',
          ].join('');
          return `<blockquote class="detail-network-note place-note place-voice${item.photoHref ? ' has-photo' : ''}">
            <p class="place-voice-source">
              <span class="provenance-chip provenance-chip-feed">Member${
                memberLabel ? ` · ${h.esc(memberLabel)}` : ''
              }</span>
              <span class="place-voice-context">recommended on Detour</span>
            </p>
            ${
              item.photoHref
                ? `<figure class="place-note-photo"><img src="${h.esc(item.photoHref)}" alt="${h.esc(photoAlt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-place-note-photo></figure>`
                : ''
            }
            <p>${h.esc(item.note || '')}</p>
            ${footer ? `<footer>${footer}</footer>` : ''}
          </blockquote>`;
        })
        .join('')}
    </div>
  </section>`;
}

/**
 * One publication's line about this place.
 *
 * Deliberately built like a member's note and deliberately not mistakable for
 * one: same block, same quote, and a badge saying GUIDE with the publication's
 * name in it where the member's pseudonym would be. The link out is the last
 * thing in it, because an excerpt is a fragment somebody else owns the rest of —
 * offering the whole piece is the honest end of a quotation.
 *
 * Full width, above the members' carousel rather than inside it. A publication's
 * line is context for the notes, not one of them, and a carousel is a set of
 * peers.
 */
function guideVoiceBlock(voice: PlaceGuideVoice, h: PlaceHelpers): string {
  const source = h.safeExternalHref(voice.sourceHref);
  return `<blockquote class="detail-network-note place-note place-voice place-voice-guide">
    <p class="place-voice-source">
      <span class="provenance-chip provenance-chip-guide">Guide${
        voice.publisher ? ` · ${h.esc(voice.publisher)}` : ''
      }</span>
      ${
        voice.guideTitle
          ? `<span class="place-voice-context">from “${h.esc(voice.guideTitle)}”</span>`
          : ''
      }
    </p>
    <p>${h.esc(voice.excerpt)}</p>
    ${
      source
        ? `<footer><a class="place-note-edit" href="${h.esc(
            source
          )}" target="_blank" rel="noopener noreferrer">Read the full guide <span class="nav-arrow nav-arrow-external" aria-hidden="true">&#x2197;&#xFE0E;</span></a></footer>`
        : ''
    }
  </blockquote>`;
}

/**
 * How it got here — one line in the hero, above the buttons.
 *
 * Only ever rendered for a place the reader themselves kept off a published
 * list, so it can say "imported" without naming who did it: it was them. It
 * leads with the piece rather than the member's own name for the list, for the
 * same reason the credit under a quotation names the publication — "NYC trip,
 * October" wrote nothing.
 *
 * In the hero rather than down with the quote it belongs to, because it changes
 * how everything below it reads: a reader who does not know this place came off
 * a list will take the sentence under it for somebody's recommendation, and by
 * then it is too late to tell them.
 *
 * That is the whole job, so the band goes away once somebody has recommended the
 * place on Detour: there is no longer a lone guide line to be mistaken for a
 * recommendation, the real ones are right there under it, and the guide's own
 * chip already says which piece it came off. A place that is in Detour is in
 * Detour — how the reader first found it stops being the headline.
 */
function originBand(v: Venue, chrome: PlaceChrome, h: PlaceHelpers): string {
  const origin = chrome.origin;
  if (!origin || !origin.title) return '';
  if (visibleNotes(v, chrome, h).length > 0) return '';
  // `data-guide`, the same hook the cards' provenance chip uses — a real anchor
  // carrying `?guide=<id>`, so a modified click still opens a tab and a cold load
  // on that address resolves.
  const title = origin.href
    ? `<a href="${h.esc(origin.href)}" data-guide>${h.esc(origin.title)}</a>`
    : `<strong>${h.esc(origin.title)}</strong>`;
  const by = origin.publisher ? ` by ${h.esc(origin.publisher)}` : '';
  const when = origin.importedOn ? ` · imported ${h.esc(origin.importedOn)}` : '';
  return `<p class="place-origin-band">
    <span class="place-origin-label">How it got here</span>
    <span class="place-origin-line">From ${title}${by}${when}</span>
  </p>`;
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
 * The trail above the title — exported, because the place page is not the only
 * page that has one.
 *
 * Every page with a trail renders it through here — place, city, country, guide,
 * and the one non-geography page that has one. Surfaces hand-rolling the same
 * `<nav>` is how one of them quietly ends up with a different separator, a
 * different aria-label, or a last step that is still a link.
 *
 * The last step is never a link and always carries `aria-current`: it is the
 * page the reader is on, and offering it as somewhere to go is a small lie that
 * screen readers announce out loud.
 */
export function crumbTrailMarkup(
  crumbs: PlaceCrumb[],
  esc: (value: string) => string
): string {
  const steps = crumbs.filter((crumb) => crumb.label);
  if (!steps.length) return '';
  return `<nav class="place-back-row explore-breadcrumb" aria-label="Breadcrumb">
    ${steps
      .map((crumb, index) => {
        const last = index === steps.length - 1;
        const step =
          crumb.href && !last
            ? `<a href="${esc(crumb.href)}"${crumb.attrs ? ` ${crumb.attrs}` : ''}>${esc(
                crumb.label
              )}</a>`
            : `<span aria-current="page">${esc(crumb.label)}</span>`;
        return index === 0 ? step : `<span aria-hidden="true">/</span>${step}`;
      })
      .join('')}
  </nav>`;
}

/*
 * NOTHING ABOVE THE TITLE. The slot that lived here held an eyebrow repeating the
 * crumb, then a chip for standing the crumb did not state — which came down to
 * one chip on one kind of page, NOT ON DETOUR on an imported place. A label
 * naming what a place is not, over a page whose every band already says nobody
 * has written here, was the third telling of it. Both pages now start at the
 * title, and `statusChips` is gone from `PlaceChrome`.
 */

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
  // The city joins the meta line now that the eyebrow above the title is gone.
  // It reads there anyway — kind, quarter, city, narrowest first — and it must be
  // stated somewhere above the fold: the crumb carries it only under the two
  // member roots, and a place nobody has saved sits under EXPLORE with no city
  // step at all.
  const meta = [v.category, v.neighborhood, v.city].filter(Boolean).join(' · ');
  const occasions = h.occasionLabels(v);
  const alreadyRecommended = h.notes(v).some((item) => item.is_own && Boolean(item.note?.trim()));
  return `
    <a class="skip-link" href="#place-title">Skip to this place</a>
    <header class="network-masthead">
      <a class="network-brand" href="${h.esc(chrome.landingHref)}" data-landing>${chrome.brandMark}<span class="brand-word">Detour</span></a>
      ${
        chrome.memberNav
          ? `<nav class="network-primary-nav" aria-label="Primary navigation">${chrome.memberNav}</nav>`
          : ''
      }
      ${chrome.communityControl}
    </header>
    ${crumbTrailMarkup(chrome.crumbs, h.esc)}
    <article class="place-page">
      <header class="place-hero">
        <div class="place-hero-copy">
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
            ${originBand(v, chrome, h)}
            ${placeActions(v, chrome, h, alreadyRecommended)}
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
      ${voicesSection(v, chrome, h)}
      ${whereSection(v, h)}
      ${visitorInvitation(chrome, h)}
    </article>
    <footer class="footer place-footer">
      <p>${chrome.footerTagline}</p>${chrome.footerLinks}
      ${chrome.themeToggle}
    </footer>
  `;
}
