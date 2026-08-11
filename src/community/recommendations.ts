/**
 * The member's own recommendation ledger: the queue of places they stand
 * behind, the entry editor, the recommend form, the same-place question a
 * colliding submission is held at, and the deletion dialogue.
 */
import { pb } from '../pocketbase';
import type { Venue } from '../data';
import { OCCASION_OPTIONS } from '../occasions';
import { recommendationColumnCount } from '../network';
import { resyncAfterWrite } from '../live';
import {
  cleanCount,
  esc,
  focusNotice,
  member,
  onCommunityReset,
  readableError,
  store,
} from './store';
import {
  CATEGORY_OPTIONS,
  bindMapLinkField,
  categoryField,
  chosenPhoto,
  focusCollision,
  mapLinkField,
  meaningfulRecommendation,
  photoField,
  placeCollisionFor,
  placeLinkFields,
  submitImageForReview,
} from './place-form';
import type { PlaceCollision } from './place-form';
import { placeCardMarkup } from './cards';
import { directoryMarkup, directoryState, dropDirectory } from './directory';
import { resetEndorsementWithdrawal } from './endorsements';
import type { PlaceEntry, RecommendationRecord } from './store';

interface PendingRecommendationDeletion {
  recommendationId: string;
  entryId: string;
  placeName: string;
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
let recommendationDraft: Venue | null = null;
let recommendationIntent: 'add' | 'edit' = 'add';
// Recommendations opens on the member's own ledger; the blank form is revealed
// by Add new, so the tab reads as a record first and a submission second.
let recommendationFormOpen = false;
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
let deletingRecommendationId = '';
let pendingRecommendationDeletion: PendingRecommendationDeletion | null = null;
let pendingCollision: PendingCollision | null = null;
let highlightedEntryId = '';
let queueExpanded = false;
export function deleteRecommendationDialogMarkup(): string {
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
function recommendationForEntry(entryId: string): RecommendationRecord | undefined {
  return store.recommendations.find((rec) => rec.entry === entryId);
}

function placeIdentity(name: string | undefined, city: string | undefined): string {
  const normalize = (value: string | undefined) => (value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  return `${normalize(name)}\u0000${normalize(city)}`;
}

function publishedVenueForEntry(entry: PlaceEntry): Venue | undefined {
  const publishedId = entry.published_venue?.trim();
  if (publishedId) {
    const directMatch = store.knownVenues.find((venue) => venue.id === publishedId);
    if (directMatch) return directMatch;
  }
  const identity = placeIdentity(entry.venue_name, entry.city);
  if (!identity || identity === '\u0000') return undefined;
  const matches = store.knownVenues.filter((venue) => placeIdentity(venue.name, venue.city) === identity);
  return matches.length === 1 ? matches[0] : undefined;
}

export function entryForVenue(venue: Venue): PlaceEntry | undefined {
  const direct = store.placeEntries.find((entry) => entry.published_venue?.trim() === venue.id);
  if (direct) return direct;
  const identity = placeIdentity(venue.name, venue.city);
  const matches = store.placeEntries.filter(
    (entry) => placeIdentity(entry.venue_name, entry.city) === identity
  );
  return matches.length === 1 ? matches[0] : undefined;
}


function entryPlaceLocked(entry: PlaceEntry): boolean {
  return store.lockedEntryIds.has(entry.id);
}

function entryEditMarkup(entry: PlaceEntry): string {
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
      <form class="community-form community-links-form" data-community-edit data-entry="${esc(entry.id)}"${rec ? ` data-recommendation="${esc(rec.id)}"` : ''}>
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
          <button class="primary-button" type="submit" ${store.submitting ? 'disabled' : ''}>${store.submitting && !deletingRecommendationId ? 'Saving…' : 'Save changes'}</button>
          <!-- Leaving the form is one decision with two answers, so Cancel sits
               on the same row as Save rather than below it. It closes the
               disclosure and nothing else: the fields keep whatever was typed
               until the next render, and no edit is written. -->
          <button class="secondary-button" type="button" data-entry-edit-cancel="${esc(entry.id)}" ${store.submitting ? 'disabled' : ''}>Cancel</button>
        </div>
      </form>`;
}

/**
 * One recommendation, one line: the name, the Edit disclosure that opens the
 * whole entry underneath it, and Open for a place that is live. Everything
 * else — publication state, facts, links, the private-share form — waits
 * inside the expanded line rather than stacking a card per entry.
 */
function entryRow(entry: PlaceEntry): string {
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
  const highlighted = highlightedEntryId === entry.id;
  // NO OPEN CONTROL. The card's own title is the link to the place page, the
  // same anchor every other card in the app carries, so a second one underneath
  // would be two ways to do one thing sitting a centimetre apart. A place with
  // no page yet says so instead — the strip still tells the truth about what is
  // live, which is the half of the old control that was carrying weight.
  const status = publishedVenue
    ? ''
    : `<span class="community-queue-status is-${statusClass}">${statusLabel}</span>`;
  const deleteAction = rec
    ? `<button class="community-queue-delete" type="button" data-community-delete-recommendation="${esc(rec.id)}" data-entry="${esc(entry.id)}" data-place-name="${esc(entry.venue_name || '')}" data-published="${published ? 'true' : 'false'}" ${store.submitting ? 'disabled' : ''}>${deletingRecommendationId === rec.id ? 'Deleting…' : 'Delete'}</button>`
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
      <button class="community-queue-edit" type="button" data-entry-edit="${esc(entry.id)}" aria-expanded="false" ${store.submitting ? 'disabled' : ''}>Edit</button>
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
                <form class="community-form community-share-form" data-community-share data-entry="${esc(entry.id)}">
                  ${directoryMarkup(directoryKey, 'Share with a member')}
                  <label>Personal note<textarea name="personal_note" rows="3" maxlength="1200" minlength="8" required placeholder="Why you thought of them for this food-and-drink destination"></textarea></label>
                  <button class="secondary-button" type="submit" ${store.submitting ? 'disabled' : ''}>${store.submitting ? 'Sharing…' : 'Share privately'}</button>
                </form>
              </details>`
            : ''
        }
      </div>
    </div>`;
  return `<li class="community-queue-row${highlighted ? ' is-highlighted' : ''}${editing ? ' is-editing' : ''}" id="entry-${esc(entry.id)}" tabindex="-1">
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
function entryCardMarkup(entry: PlaceEntry, rec: RecommendationRecord | undefined): string {
  return placeCardMarkup({
    name: entry.venue_name || 'Unnamed food-and-drink destination',
    city: entry.city || '',
    country: entry.country || '',
    // Reached only by an entry with no published note yet — nothing is in the
    // feed for it, because there is nothing for anybody else to see.
    fallback: {
      id: rec?.id || entry.id,
      is_own: true,
      founding_member: store.foundingMember,
      note: rec?.note || '',
      address: entry.address || '',
      // The entry's own `created` is deliberately not on PlaceEntry, so an
      // entry with no note yet carries no date — and the card simply omits one
      // rather than inventing the day it was typed.
      created: rec?.created || '',
    },
    emptyNote: 'Not live yet, so nobody can see this one but you.',
  });
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
        <label>Which one is yours? <span class="community-optional">The street or the neighbourhood</span><input name="disambiguator" maxlength="120" required autofocus placeholder="e.g. Calle de la Palma" ${store.submitting ? 'disabled' : ''}></label>
        <p class="community-form-note">This is only used to tell the two apart. It shows next to the name wherever both could be confused.</p>
        <div class="community-form-actions">
          <button class="primary-button" type="submit" ${store.submitting ? 'disabled' : ''}>${store.submitting ? 'Adding…' : 'Add as a separate place'}</button>
          <button class="secondary-button" type="button" data-collision-back ${store.submitting ? 'disabled' : ''}>Back</button>
        </div>
      </form>`
    : `<div class="community-form-actions community-collision-actions">
        <button class="primary-button" type="button" data-collision-second ${store.submitting ? 'disabled' : ''}>${store.submitting ? 'Adding…' : "That's the one — add my note"}</button>
        <button class="secondary-button" type="button" data-collision-distinct ${store.submitting ? 'disabled' : ''}>A different place with the same name</button>
        <button class="secondary-button" type="button" data-collision-cancel ${store.submitting ? 'disabled' : ''}>Cancel</button>
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

export function recommendationPanel(): string {
  const draft = recommendationIntent === 'edit' ? null : recommendationDraft;
  // The ledger is still loading, so the place cannot be matched to a row yet.
  if (recommendationIntent === 'edit' && (store.loadingCommunity || !store.communityLoaded)) {
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
  const cancelButton = `<button class="secondary-button community-recommend-cancel" type="button" data-recommend-close ${store.submitting ? 'disabled' : ''}>Cancel</button>`;
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
          <button class="primary-button" type="submit" ${store.submitting ? 'disabled' : ''}>${store.submitting ? 'Adding…' : 'Recommend this place'}</button>
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
          <button class="primary-button" type="submit" ${store.submitting ? 'disabled' : ''}>${store.submitting ? 'Adding…' : 'Recommend'}</button>
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
        store.loadingCommunity || !store.communityLoaded
          ? '<p class="community-loading" role="status">Loading…</p>'
          : store.placeEntries.length
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
              <div><h3 id="community-recommend-title">${draft ? `Recommend ${esc(draft.name)}` : 'Recommend a destination'}</h3></div>
              <p>${
                draft
                  ? 'You are recommending this exact place. Add your own note; its existing details stay attached.'
                  : `As a verified member, you can recommend a restaurant, café, bar, or other food-and-drink destination anywhere in the world. It becomes visible to ${
                      store.foundingMember ? 'every member of Detour' : 'the members whose circles you appear in'
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
  const shown = queueExpanded ? store.placeEntries : store.placeEntries.slice(0, queuePreviewLimit());
  const hidden = store.placeEntries.length - shown.length;
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
    .map(entryRow)
    .join('')}</ul>${toggle}`;
}
/** Point the member area at the Recommend form, optionally fixed to one published place. */
export function openRecommendPlace(venue?: Venue): void {
  store.detourTab = 'recommendations';
  store.detourTabChosen = false;
  editingEntryId = '';
  resetEndorsementWithdrawal();
  newPlacePrefill.name = '';
  newPlacePrefill.city = '';
  recommendationDraft = venue || null;
  recommendationIntent = 'add';
  // "Recommend" from the feed or a place page is an explicit ask for the form,
  // with or without a place attached.
  recommendationFormOpen = true;
  pendingCollision = null;
  store.pendingFormReveal = 'recommendation';
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
  store.detourTab = 'recommendations';
  recommendationDraft = venue;
  recommendationIntent = 'edit';
  recommendationFormOpen = false;
  pendingCollision = null;
  store.pendingFormReveal = null;
}
export function focusEntryRow(id: string): void {
  if (!id) return;
  window.requestAnimationFrame(() => {
    const target = document.getElementById(`entry-${id}`);
    target?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    target?.focus({ preventScroll: true });
  });
}

/**
 * An Edit that arrived from a place page resolves to a row only after the
 * ledger loads — this is the focus half, run when that load settles.
 */
export function focusPendingEditEntry(): void {
  if (recommendationIntent === 'edit' && recommendationDraft) {
    const entry = entryForVenue(recommendationDraft);
    if (entry) focusEntryRow(entry.id);
  }
}

onCommunityReset(() => {
  recommendationDraft = null;
  recommendationIntent = 'add';
  recommendationFormOpen = false;
  pendingCollision = null;
  deletingRecommendationId = '';
  pendingRecommendationDeletion = null;
  highlightedEntryId = '';
  queueExpanded = false;
});

/**
 * No catalogue refresher is passed in any more: every write here ends in
 * `resyncAfterWrite`, which re-reads the catalogue along with everything else the
 * write touched. See src/live.ts.
 */
export function bindRecommendations(
  root: HTMLElement,
  render: () => void,
  onPlaceContributed: () => void
): void {
  root.querySelector<HTMLButtonElement>('[data-recommend-open]')?.addEventListener('click', () => {
    recommendationFormOpen = true;
    pendingCollision = null;
    store.notice = null;
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
    store.pendingFormReveal = null;
    recommendationDraft = null;
    render();
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>('[data-recommend-open]')?.focus({ preventScroll: true });
    });
  });
  root.querySelector<HTMLButtonElement>('[data-queue-toggle]')?.addEventListener('click', (event) => {
    event.preventDefault();
    if (queueExpanded) return;
    const firstRevealedId = store.placeEntries[queuePreviewLimit()]?.id || '';
    queueExpanded = true;
    render();
    if (firstRevealedId) {
      window.requestAnimationFrame(() => {
        const firstRevealed = document.getElementById(`entry-${firstRevealedId}`);
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
      const row = document.getElementById(`entry-${pendingEditRow}`);
      row?.scrollIntoView({ block: 'center' });
    });
  }

  // Open the form for one place. Only one at a time: two half-finished edits on
  // one screen is a way to save the wrong one.
  root.querySelectorAll<HTMLButtonElement>('[data-entry-edit]').forEach((button) => {
    button.addEventListener('click', () => {
      const entryId = button.dataset.entryEdit || '';
      if (!entryId || store.submitting) return;
      editingEntryId = entryId;
      render();
      window.requestAnimationFrame(() => {
        const row = document.getElementById(`entry-${entryId}`);
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
      if (store.submitting) return;
      editingEntryId = '';
      // An Edit pressed on a place page arrives as a draft rather than an id, so
      // Cancel has to drop that too or the form reopens on the next render.
      recommendationDraft = null;
      recommendationIntent = 'add';
      render();
      // Back to the control that opened it, rather than leaving focus nowhere.
      window.requestAnimationFrame(() => {
        const row = entryId ? document.getElementById(`entry-${entryId}`) : null;
        row?.querySelector<HTMLElement>('[data-entry-edit]')?.focus({ preventScroll: true });
      });
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
    store.submitting = true;
    store.notice = null;
    render();
    try {
      const created = await pb
        .collection('community_recommendations')
        .create<RecommendationRecord>(payload);
      pendingCollision = null;
      let photoQueued = false;
      let photoError = '';
      if (photo && created.entry) {
        try {
          await submitImageForReview(created.entry, photo);
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
      highlightedEntryId = created.entry || '';
      store.notice = { kind: 'success', text: 'Recommendation saved.' };
      onPlaceContributed();
      // Everything the server holds, re-read before the notice below is settled —
      // and settled from what came back rather than from what was sent. A new
      // recommendation moves more than the ledger: it publishes or seconds a place
      // in the catalogue, it enters the circle feed every card's words, byline and
      // photograph come from, and it takes any save the member had on that place off
      // Wanna go. Deciding which of those to refresh per write path is what left the
      // member's own sentence missing from their own card.
      await resyncAfterWrite(render);
      const createdEntry = store.placeEntries.find((entry) => entry.id === highlightedEntryId);
      store.notice = createdEntry?.status === 'published'
        ? { kind: 'success', text: 'Your recommendation is live.' }
        : createdEntry
          ? { kind: 'info', text: 'Your recommendation is saved. Its line shows whether the place is live.' }
          : store.notice;
      // What a place is good for is still not asked before the note is written —
      // it is a list of checkboxes, not one tap like the category — so the ledger
      // line is where it gets added. Worth saying once here, because the occasion
      // filters on discovery are what it feeds.
      if (store.notice && createdEntry) {
        store.notice.text += ' Open its line to say what it is good for.';
      }
      if (store.notice && photoQueued) {
        store.notice.text += ' Your photo is awaiting review and will appear with your note.';
      } else if (photoError) {
        store.notice = { kind: 'info', text: `${store.notice?.text || 'Recommendation saved.'} ${photoError}` };
      }
      focusEntryRow(highlightedEntryId);
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
        store.notice = askedFor
          ? { kind: 'info', text: 'A place with that name and street is already on the list. Try a different street or neighbourhood.' }
          : null;
      } else {
        store.notice = {
          kind: 'error',
          text: readableError(
            error,
            'That recommendation could not be added. Check the name, the city and your note, then try again.'
          ),
        };
      }
    } finally {
      store.submitting = false;
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
      store.notice = { kind: 'error', text: 'Add a meaningful recommendation of at least 24 characters and five words.' };
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
    if (!pending || store.submitting) return;
    // Resolved by entry id, which is the path a private share and the ledger's
    // own edit already take. The name and city ride along so the server can still
    // check they describe the entry being joined.
    await sendRecommendation(
      {
        entry: pending.collision.entry,
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
    if (!pendingCollision || store.submitting) return;
    pendingCollision = { ...pendingCollision, distinguishing: true };
    render();
  });

  root.querySelector<HTMLButtonElement>('[data-collision-back]')?.addEventListener('click', () => {
    if (!pendingCollision || store.submitting) return;
    pendingCollision = { ...pendingCollision, distinguishing: false };
    render();
  });

  root.querySelector<HTMLButtonElement>('[data-collision-cancel]')?.addEventListener('click', () => {
    if (store.submitting) return;
    pendingCollision = null;
    store.notice = null;
    render();
  });

  root.querySelector<HTMLFormElement>('[data-collision-distinct-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const pending = pendingCollision;
    if (!pending || store.submitting) return;
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
      const entryId = form.dataset.entry || '';
      if (!entryId || store.submitting) return;
      const values = new FormData(form);
      const recommendationId = form.dataset.recommendation || '';
      const category = String(values.get('category') || '').trim();
      const occasions = values.getAll('occasions').map((value) => String(value));
      const proposedPhoto = chosenPhoto(form);
      store.submitting = true;
      store.notice = null;
      render();
      let saved = false;
      try {
        // The shared place first, so the recommendation hook re-syncs its
        // display mirrors from the freshly corrected entry.
        await pb.collection('community_place_entries').update(entryId, {
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
        store.notice = { kind: 'success', text: 'Recommendation updated.' };
        if (proposedPhoto) {
          try {
            await submitImageForReview(entryId, proposedPhoto);
            store.notice.text += ' Your photo is awaiting review and will appear with your note.';
          } catch (error) {
            store.notice = {
              kind: 'info',
              text: `Recommendation updated. ${readableError(
                error,
                'The photo could not be submitted for review.'
              )}`,
            };
          }
        }
        // An edit changes the place as well as the note — its name, its city, its
        // category — so the catalogue row and the feed card built from it are as out
        // of date as the ledger line. Awaited, so "updated" appears over the
        // corrected data rather than a beat ahead of it.
        await resyncAfterWrite(render);
        highlightedEntryId = '';
        recommendationDraft = null;
        recommendationIntent = 'add';
        recommendationFormOpen = false;
        // Saved is finished: the card comes back with its strip, rather than
        // leaving the form up as though there were more to do.
        editingEntryId = '';
        saved = true;
      } catch (error) {
        store.notice = { kind: 'error', text: readableError(error, 'Those changes could not be saved. Check the details and try again.') };
      } finally {
        store.submitting = false;
        render();
        if (saved) focusNotice(root);
      }
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-community-delete-recommendation]').forEach((button) => {
    button.addEventListener('click', () => {
      const recommendationId = button.dataset.communityDeleteRecommendation || '';
      const entryId = button.dataset.entry || '';
      if (!recommendationId || !entryId || store.submitting) return;
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
      if (!pending || store.submitting) return;
      const { recommendationId, entryId, published } = pending;
      pendingRecommendationDeletion = null;
      store.submitting = true;
      deletingRecommendationId = recommendationId;
      highlightedEntryId = entryId;
      store.notice = null;
      render();
      try {
        await pb.collection('community_recommendations').delete(recommendationId);
        store.recommendations = store.recommendations.filter((recommendation) => recommendation.id !== recommendationId);
        // A deletion reaches as far as a creation: the place may have been withdrawn
        // from the catalogue entirely if nobody else stood behind it, the feed still
        // holds the note that is now gone — and it is what the cards are built from,
        // so the member's own words would stay on screen after they removed them —
        // and any save they had on the place before they recommended it comes back to
        // Wanna go.
        await resyncAfterWrite(render);
        store.notice = {
          kind: 'success',
          text: published
            ? 'Your recommendation was deleted. The place remains live without your note, photo or attribution.'
            : 'Your recommendation was deleted.',
        };
        focusEntryRow(entryId);
      } catch (error) {
        store.notice = { kind: 'error', text: readableError(error, 'Your recommendation could not be deleted. Please try again.') };
      } finally {
        store.submitting = false;
        deletingRecommendationId = '';
        render();
      }
    });
    if (!deleteDialog.open) {
      deleteDialog.showModal();
      deleteDialog.querySelector<HTMLElement>('#delete-recommendation-title')?.focus({ preventScroll: true });
    }
  }
}
