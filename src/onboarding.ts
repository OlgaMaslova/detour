/**
 * The first five minutes of membership.
 *
 * An invitation used to end on the account page: a six-field form, then a member
 * area with tabs, an empty recommendation ledger, and no indication of what to do
 * with any of it. This route is the alternative — one thing per screen, in the
 * order a new member actually does them:
 *
 *   1. one question         the place you keep going back to
 *   2. got another?         up to three, easy to stop after one
 *   3. the feed             where their own card is now waiting
 *
 * The account is not one of those screens. Every value the server requires on a
 * public signup — email, password, pseudo, home city, and an invitation code when
 * there is one — is asked for together on whichever signup card the member used,
 * which creates the account and signs them in before this route opens. Splitting
 * them over two screens only meant one form could not be submitted without the
 * other's answers; see `submitSignup` in src/community.ts.
 *
 * Both doors land here, and this route neither knows nor cares which one was
 * used. A member who started their own circle is asked the same question as one
 * who joined somebody's, because the question is about a place they love and that
 * is not a fact about how they got in.
 *
 * The place step is the ordinary recommendation path, not a private copy of it:
 * the same `community_recommendations` create, the same place-identity question
 * when a name and city are already taken, the same publication rule (a verified
 * member's first note publishes the place immediately, which is what puts their
 * card in the feed at the end). What it leaves out is everything optional —
 * category, occasions, links, the photo — all of which stay available on the
 * recommendation's own line afterwards.
 */
import { pb } from './pocketbase';
import { meaningfulRecommendation, placeCollisionFor, readPlaceLink } from './community';
import { resyncAfterWrite } from './live';
import type { PlaceCollision } from './community';
import type { Venue } from './data';

type Step = 'place' | 'same-place' | 'saved';

interface Notice {
  kind: 'error' | 'info';
  text: string;
}

/**
 * Three is where the invitation to keep going stops.
 *
 * One place is the whole ask — a member who adds one has done what this route is
 * for. The offer repeats because someone who has just remembered one place is
 * usually two thoughts away from remembering another, and stops at three because
 * a fourth "got another?" reads as a quota rather than an invitation.
 */
const MAX_PLACES = 3;

interface Callbacks {
  render: () => void;
  /** Leaves onboarding for the signed-in feed. */
  onFinished: () => void;
  onPlaceContributed: () => void;
}

let step: Step = 'place';
/** Set by the first `openOnboarding` of an arrival, so later ones leave it alone. */
let opened = false;
let submitting = false;
let notice: Notice | null = null;
let placesAdded = 0;
let lastPlaceName = '';
/**
 * What the member has typed.
 *
 * Retained here rather than read off the form at submit time because this route
 * re-renders on events it does not control: signing in swaps the catalogue, which
 * re-renders the whole app. Values that live only in the DOM would be wiped
 * mid-sentence.
 */
const draft = { city: '', name: '', note: '' };
/**
 * A pasted map link is read, not required.
 *
 * The link only ever fills fields in — the member can overwrite anything it put
 * there, and a link that cannot be read leaves their own typing exactly where it
 * was. Nothing about submitting a recommendation waits on this, which is why the
 * state here is two strings and not a step: at worst the note is written by hand,
 * which is the path that existed before.
 */
let linkReading = false;
let linkStatus = '';
/** Held like the other typed values, because this route re-renders unbidden. */
let linkValue = '';
/**
 * The facts a link supplied that the member is never asked for.
 *
 * They travel with the recommendation so the geocoder starts from the street the
 * pin was on rather than re-deriving one from a name and a city. Cleared
 * whenever the place changes, so one place's address can never follow another.
 */
let linkFacts: { address: string; country: string } = { address: '', country: '' };
/** The last link read, so a re-render or a stray blur does not read it twice. */
let lastLinkRead = '';
/** The place already on the list that the typed name and city turned out to be. */
let collision: PlaceCollision | null = null;
/** Set once the member says theirs is a different place and is asked which. */
let distinguishing = false;
/** The step whose heading has already been focused, so focus moves once per step. */
let focusedStep: Step | '' = '';

function esc(value: string | undefined | null): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function readableError(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    const response = (error as { response?: { message?: string; data?: Record<string, { message?: string }> } }).response;
    const fieldMessage = response?.data
      ? Object.values(response.data).find((entry) => entry?.message)?.message
      : '';
    if (fieldMessage) return fieldMessage;
    if (response?.message) return response.message;
  }
  return fallback;
}

/** True while this route has something to show, which now means: a session. */
export function onboardingOpen(): boolean {
  return pb.authStore.isValid;
}

/**
 * Opens the flow at its first place, for anyone with an account: someone who has
 * just joined on the invitation card, someone who left before adding a place, or
 * someone who followed the route in directly. There is no account step to skip —
 * the card behind this one created it.
 *
 * Idempotent, because the route is applied more than once for one arrival: the
 * boot sequence re-applies it when the catalogue lands. Only a flow that has not
 * opened yet is moved, so a member already part-way through is left where they
 * are.
 */
export function openOnboarding(): void {
  if (opened) return;
  opened = true;
  step = 'place';
  submitting = false;
  notice = null;
  collision = null;
  distinguishing = false;
  // The city they live in is the likeliest city of the place they keep going back
  // to, so it starts there — off their own record, which for someone who has just
  // joined holds the city they typed on the card.
  if (!draft.city) {
    const home = pb.authStore.record?.home_city;
    draft.city = typeof home === 'string' ? home : '';
  }
}

export function resetOnboarding(): void {
  step = 'place';
  opened = false;
  submitting = false;
  notice = null;
  placesAdded = 0;
  lastPlaceName = '';
  draft.city = '';
  draft.name = '';
  draft.note = '';
  collision = null;
  distinguishing = false;
  focusedStep = '';
  linkReading = false;
  linkStatus = '';
  linkValue = '';
  lastLinkRead = '';
  linkFacts = { address: '', country: '' };
}

function noticeMarkup(): string {
  if (!notice) return '';
  return `<p class="welcome-notice welcome-notice-${notice.kind}" role="${
    notice.kind === 'error' ? 'alert' : 'status'
  }">${esc(notice.text)}</p>`;
}

/**
 * The catalogue as autocomplete.
 *
 * Suggestions are the places Detour already knows, in the same `Place — City`
 * form the Explore search uses, so picking one is unambiguous and resolves back
 * to a record. A place nobody has added yet simply is not here, and typing it
 * takes the ordinary path: name, city, and the server's own enrichment after
 * publication. No live lookup against anything external happens on this screen.
 */
function catalogueOptions(venues: Venue[]): string {
  const values = new Set<string>();
  for (const venue of venues) {
    values.add(`${venue.name} — ${venue.city}`);
  }
  return [...values]
    .sort((a, b) => a.localeCompare(b))
    .map((value) => `<option value="${esc(value)}"></option>`)
    .join('');
}

/** The catalogue place a typed value names, or null when it names none. */
function matchCatalogue(typed: string, venues: Venue[]): Venue | null {
  const wanted = typed.trim().toLowerCase();
  if (!wanted) return null;
  const combined = venues.find((venue) => `${venue.name} — ${venue.city}`.toLowerCase() === wanted);
  if (combined) return combined;
  const byName = venues.filter((venue) => venue.name.trim().toLowerCase() === wanted);
  return byName.length === 1 ? byName[0] : null;
}

function placeMarkup(venues: Venue[]): string {
  const first = placesAdded === 0;
  const listId = 'welcome-catalogue';
  return `<section class="welcome-question" aria-labelledby="welcome-title">
    <p class="welcome-kicker">${first ? 'Last step' : `Place ${placesAdded + 1} of ${MAX_PLACES}`}</p>
    <h1 id="welcome-title" tabindex="-1">Where do you keep going back to?</h1>
    <p class="welcome-lead">The place where you already know what to order.</p>
    ${noticeMarkup()}
    <form class="welcome-form" data-welcome-place novalidate>
      <label class="welcome-link-field">Paste a map link <span>optional</span>
        <input name="map_link" type="url" inputmode="url" autocomplete="off" spellcheck="false"
          value="${esc(linkValue)}" maxlength="2048" placeholder="Share from Maps and paste it here" ${
            submitting || linkReading ? 'disabled' : ''
          }>
      </label>
      <p class="welcome-note welcome-link-note" data-welcome-link-status role="status">${
        linkReading ? 'Reading the link…' : esc(linkStatus)
      }</p>
      <label>The place
        <input name="venue_name" value="${esc(draft.name)}" list="${listId}" autocomplete="off" spellcheck="false"
          maxlength="200" required placeholder="Start typing its name" ${submitting ? 'disabled' : ''}>
      </label>
      <datalist id="${listId}">${catalogueOptions(venues)}</datalist>
      <label>City
        <input name="city" value="${esc(draft.city)}" autocomplete="off" maxlength="120" required
          placeholder="City or locality" ${submitting ? 'disabled' : ''}>
      </label>
      <label>Why this one
        <textarea name="note" rows="3" maxlength="2400" required
          placeholder="One or two lines. What do you order, and who should go?" ${
            submitting ? 'disabled' : ''
          }>${esc(draft.note)}</textarea>
      </label>
      <p class="welcome-note">Nobody reviews this. Your circle reads it in their feed, and it sits on the place's own page for whoever opens it. Your note and your name go up as soon as you send it.</p>
      <div class="welcome-actions">
        <button class="primary-button" type="submit" ${submitting ? 'disabled' : ''}>${
          submitting ? 'Adding…' : 'Add this place'
        }</button>
        <button class="secondary-button" type="button" data-welcome-skip ${submitting ? 'disabled' : ''}>${
          first ? 'Later' : 'Done for now'
        }</button>
      </div>
    </form>
  </section>`;
}

/**
 * The same-place question, asked here because a first place is exactly when it
 * comes up: the places a new member loves are the ones somebody else may already
 * have put on the list.
 *
 * What the place is is shown; how many members stand behind it is not — that
 * count includes circles this member cannot see.
 */
function samePlaceMarkup(): string {
  const place = collision;
  if (!place) return '';
  const locator = [place.address || place.disambiguator, place.city].filter(Boolean).join(', ');
  return `<section class="welcome-question" aria-labelledby="welcome-title">
    <p class="welcome-kicker">One moment</p>
    <h1 id="welcome-title" tabindex="-1">Is this the same place?</h1>
    <p class="welcome-lead">Somebody has already put this name on Detour. If it is the one you mean, your note joins theirs on its page.</p>
    ${noticeMarkup()}
    <div class="welcome-place-card">
      <strong>${esc(place.venue_name)}</strong>
      ${locator ? `<span>${esc(locator)}</span>` : ''}
    </div>
    ${
      distinguishing
        ? `<form class="welcome-form" data-welcome-distinct novalidate>
            <label>Which one is yours?
              <input name="disambiguator" maxlength="120" required placeholder="The street or the neighbourhood" ${
                submitting ? 'disabled' : ''
              }>
            </label>
            <p class="welcome-note">This only tells the two apart. It shows next to the name wherever both could be confused.</p>
            <div class="welcome-actions">
              <button class="primary-button" type="submit" ${submitting ? 'disabled' : ''}>${
                submitting ? 'Adding…' : 'Add as a separate place'
              }</button>
              <button class="secondary-button" type="button" data-welcome-collision-back ${
                submitting ? 'disabled' : ''
              }>Back</button>
            </div>
          </form>`
        : `<div class="welcome-actions">
            <button class="primary-button" type="button" data-welcome-second ${submitting ? 'disabled' : ''}>${
              submitting ? 'Adding…' : "That's the one — add my note"
            }</button>
            <button class="secondary-button" type="button" data-welcome-distinct-open ${
              submitting ? 'disabled' : ''
            }>A different place, same name</button>
            <button class="secondary-button" type="button" data-welcome-reopen ${
              submitting ? 'disabled' : ''
            }>Change what I typed</button>
          </div>`
    }
  </section>`;
}

function savedMarkup(): string {
  const full = placesAdded >= MAX_PLACES;
  return `<section class="welcome-question" aria-labelledby="welcome-title">
    <p class="welcome-kicker">${placesAdded === 1 ? 'That is one' : `That is ${placesAdded}`}</p>
    <h1 id="welcome-title" tabindex="-1">${
      full ? 'Three. Generous.' : `${lastPlaceName ? esc(lastPlaceName) : 'Your place'} is on Detour.`
    }</h1>
    <p class="welcome-lead">${
      full
        ? 'Your places are on the list, with your name on them.'
        : 'Your card is in the feed with your name on it. One is plenty — but if another just came to mind, add it while it has.'
    }</p>
    ${noticeMarkup()}
    <div class="welcome-actions">
      ${
        full
          ? ''
          : `<button class="primary-button" type="button" data-welcome-another>Got another?</button>`
      }
      <button class="${full ? 'primary-button' : 'secondary-button'}" type="button" data-welcome-finish>See the feed</button>
    </div>
  </section>`;
}

export function onboardingMarkup(venues: Venue[]): string {
  const body =
    step === 'place' ? placeMarkup(venues) : step === 'same-place' ? samePlaceMarkup() : savedMarkup();
  return `<main class="welcome-layout" data-welcome-step="${step}">${body}</main>`;
}

export function bindOnboarding(root: HTMLElement, venues: Venue[], callbacks: Callbacks): void {
  const { render, onFinished, onPlaceContributed } = callbacks;

  // Focus lands on the step's own heading, once per step: `autofocus` does not
  // fire on markup that was injected rather than parsed, and re-focusing on every
  // render would fight the member's cursor while they type.
  if (focusedStep !== step) {
    focusedStep = step;
    window.requestAnimationFrame(() => {
      root.querySelector<HTMLElement>('#welcome-title')?.focus({ preventScroll: true });
    });
  }

  // Typed values survive a render this route did not ask for — see `draft`.
  root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    '[data-welcome-place] input, [data-welcome-place] textarea'
  ).forEach((field) => {
    field.addEventListener('input', () => {
      if (field.name === 'city') draft.city = field.value;
      else if (field.name === 'venue_name') draft.name = field.value;
      else if (field.name === 'note') draft.note = field.value;
      else if (field.name === 'map_link') linkValue = field.value;
    });
  });

  /**
   * Reads a pasted map link and fills in what it named.
   *
   * The whole feature is a typing shortcut, so it is written to be ignorable:
   * every field it touches stays editable, a link it cannot read says so and
   * changes nothing, and the submit path neither waits for it nor knows it
   * happened. The one thing it must not do is silently overwrite a name the
   * member has already typed with a worse one, so the previous value is named
   * back to them in the status line rather than disappearing.
   */
  const readLink = async (raw: string): Promise<void> => {
    const url = raw.trim();
    if (!url || url === lastLinkRead || linkReading || submitting) return;
    lastLinkRead = url;
    linkReading = true;
    linkStatus = '';
    render();
    const result = await readPlaceLink(url);
    if (!result) {
      linkStatus = 'That link did not name a place. Type the name instead — it works just as well.';
    } else {
      const previousName = draft.name.trim();
      if (result.name) draft.name = result.name;
      if (result.city) draft.city = result.city;
      linkFacts = { address: result.address || '', country: result.country || '' };
      const filled = [draft.name, draft.city].filter(Boolean).join(', ');
      linkStatus =
        previousName && result.name && previousName !== result.name
          ? `From the link: ${filled}. It replaced "${previousName}" — change it back if that was the right one.`
          : `From the link: ${filled}. Change either if it is not what you call it.`;
      linkValue = '';
    }
    linkReading = false;
    render();
  };

  const linkField = root.querySelector<HTMLInputElement>('[data-welcome-place] input[name="map_link"]');
  if (linkField) {
    // Paste is the gesture this exists for, so it fires on its own rather than
    // waiting for a blur the member has no reason to perform.
    linkField.addEventListener('paste', (event) => {
      const pasted = event.clipboardData?.getData('text') || '';
      if (pasted.trim()) {
        linkValue = pasted.trim();
        void readLink(pasted);
      }
    });
    linkField.addEventListener('change', () => void readLink(linkField.value));
    linkField.addEventListener('blur', () => void readLink(linkField.value));
    // Enter in the link field reads it rather than submitting a form the member
    // has not finished — the note below it is still empty at this point.
    linkField.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      void readLink(linkField.value);
    });
  }

  /**
   * Sends one recommendation and reacts to the two ways it can not land: a place
   * identity that is already taken, which is a question rather than an error, and
   * everything else, which is an error.
   */
  const sendPlace = async (
    payload: Record<string, string>,
    held: { venueName: string; city: string; note: string }
  ): Promise<void> => {
    submitting = true;
    notice = null;
    render();
    try {
      await pb.collection('community_recommendations').create(payload);
      placesAdded += 1;
      lastPlaceName = held.venueName;
      collision = null;
      distinguishing = false;
      draft.name = '';
      draft.note = '';
      step = 'saved';
      onPlaceContributed();
      // The home page this route ends on is drawn from the catalogue and from the
      // circle payload, and the place just published is in neither copy the app is
      // holding. One resync re-reads both, or the member finishes the flow and lands
      // on a page with no sign of what they just wrote.
      await resyncAfterWrite(render);
    } catch (error) {
      const askedFor = String(payload.disambiguator || '');
      const found = await placeCollisionFor(error, { ...held, disambiguator: askedFor });
      if (found) {
        collision = found;
        // A collision on a qualifier the member just supplied means that one is
        // taken too, so the field stays open rather than dropping them back to a
        // choice they have already made.
        distinguishing = Boolean(askedFor);
        step = 'same-place';
        notice = askedFor
          ? { kind: 'info', text: 'That street is taken too. Try the one that actually tells them apart.' }
          : null;
      } else {
        notice = {
          kind: 'error',
          text: readableError(
            error,
            'That place could not be added. Check the name and the city, then try again.'
          ),
        };
      }
    } finally {
      submitting = false;
      render();
    }
  };

  root.querySelector<HTMLFormElement>('[data-welcome-place]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
    const values = new FormData(event.currentTarget as HTMLFormElement);
    const typed = String(values.get('venue_name') || '').trim();
    const note = String(values.get('note') || '').trim();
    const typedCity = String(values.get('city') || '').trim();
    draft.name = typed;
    draft.note = note;
    draft.city = typedCity;
    if (typed.length < 2) {
      notice = { kind: 'error', text: 'Name the place you keep going back to.' };
      render();
      return;
    }
    // Mirrors the server's own rule so a note that is too thin is caught here
    // rather than coming back as a refusal.
    if (!meaningfulRecommendation(note)) {
      notice = { kind: 'error', text: 'A line or two, at least — twenty-four characters and five words.' };
      render();
      return;
    }
    // A place picked out of the catalogue is a place that already exists, and
    // picking it out of a list of names and cities IS the answer to "is this the
    // same place?" — so it converges deliberately rather than being asked again.
    const matched = matchCatalogue(typed, venues);
    const venueName = matched ? matched.name : typed;
    const city = matched ? matched.city : typedCity;
    if (!matched && city.length < 2) {
      notice = { kind: 'error', text: 'Which city is it in?' };
      render();
      return;
    }
    const payload: Record<string, string> = {
      venue_name: venueName,
      city,
      note,
      place_intent: matched ? 'second' : 'ask',
    };
    // Only for a place the link named: a catalogue match is an existing place
    // whose facts are already settled, and must not be overwritten from here.
    if (!matched) {
      if (linkFacts.address) payload.address = linkFacts.address;
      if (linkFacts.country) payload.country = linkFacts.country;
    }
    await sendPlace(payload, { venueName, city, note });
  });

  root.querySelector<HTMLButtonElement>('[data-welcome-second]')?.addEventListener('click', async () => {
    const place = collision;
    if (!place || submitting) return;
    // Resolved by entry id — the same path the ledger's own edit takes. The name
    // and city ride along so the server can still check they describe it.
    await sendPlace(
      {
        entry: place.entry,
        venue_name: place.venue_name || draft.name,
        city: place.city || draft.city,
        note: draft.note,
      },
      { venueName: place.venue_name || draft.name, city: place.city || draft.city, note: draft.note }
    );
  });

  root.querySelector<HTMLButtonElement>('[data-welcome-distinct-open]')?.addEventListener('click', () => {
    if (!collision || submitting) return;
    distinguishing = true;
    notice = null;
    render();
  });

  root.querySelector<HTMLButtonElement>('[data-welcome-collision-back]')?.addEventListener('click', () => {
    if (!collision || submitting) return;
    distinguishing = false;
    notice = null;
    render();
  });

  // The way out of the question. Without it the same-place step is a dead end:
  // both its answers commit to a place, and a member who collided because they
  // mistyped a name — or who has changed their mind about answering at all — has
  // nothing to press. Their words are still in `draft`, so the question they came
  // from reopens filled in, and "Later" is one tap from there.
  root.querySelector<HTMLButtonElement>('[data-welcome-reopen]')?.addEventListener('click', () => {
    if (submitting) return;
    collision = null;
    distinguishing = false;
    notice = null;
    step = 'place';
    render();
  });

  root.querySelector<HTMLFormElement>('[data-welcome-distinct]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!collision || submitting) return;
    const disambiguator = String(
      new FormData(event.currentTarget as HTMLFormElement).get('disambiguator') || ''
    ).trim();
    if (!disambiguator) return;
    await sendPlace(
      {
        venue_name: draft.name,
        city: draft.city,
        note: draft.note,
        disambiguator,
        place_intent: 'distinct',
      },
      { venueName: draft.name, city: draft.city, note: draft.note }
    );
  });

  root.querySelector<HTMLButtonElement>('[data-welcome-another]')?.addEventListener('click', () => {
    if (submitting || placesAdded >= MAX_PLACES) return;
    step = 'place';
    notice = null;
    collision = null;
    distinguishing = false;
    // The previous place's link, and what it filled in, belong to that place.
    linkValue = '';
    linkStatus = '';
    lastLinkRead = '';
    linkFacts = { address: '', country: '' };
    render();
  });

  root.querySelectorAll<HTMLButtonElement>('[data-welcome-finish], [data-welcome-skip]').forEach((button) => {
    button.addEventListener('click', () => {
      if (submitting) return;
      resetOnboarding();
      onFinished();
    });
  });
}
