/**
 * The first five minutes of membership.
 *
 * An invitation used to end on the account page: a six-field form, then a member
 * area with tabs, an empty recommendation ledger, and no indication of what to do
 * with any of it. This route is the alternative — one thing per screen, in the
 * order a new member actually does them:
 *
 *   1. who you are          pseudo and city, two fields
 *   2. one question         the place you keep going back to
 *   3. got another?         up to three, easy to stop after one
 *   4. the feed             where their own card is now waiting
 *
 * Step 1 creates the account, because the account cannot exist without it: the
 * server requires a pseudo and a home city on every public signup. The email and
 * password were taken on the invitation card before this route opened and are
 * held in `pendingJoin` until this screen has the other two halves.
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
import { meaningfulRecommendation, placeCollisionFor } from './community';
import type { PlaceCollision } from './community';
import type { Venue } from './data';

/** Held from the invitation card until the pseudo-and-city screen can spend it. */
interface PendingJoin {
  email: string;
  password: string;
  inviteCode: string;
}

type Step = 'identity' | 'place' | 'same-place' | 'saved';

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
  /** Back to the account route — the invitation card, when a join could not complete. */
  onAccount: () => void;
  onPlaceContributed: () => void;
  refreshCatalogue: () => Promise<Venue[]>;
}

let pendingJoin: PendingJoin | null = null;
let step: Step = 'identity';
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
const draft = { pseudo: '', city: '', name: '', note: '' };
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

/** True while this route has something to show: a held invitation, or a session. */
export function onboardingOpen(): boolean {
  return Boolean(pendingJoin) || pb.authStore.isValid;
}

/**
 * Takes the invitation card's answers and opens the flow at the pseudo-and-city
 * screen. Nothing is sent yet — the account is created when that screen is
 * answered, since the server requires all four values at once.
 */
export function beginOnboarding(join: PendingJoin): void {
  pendingJoin = join;
  step = 'identity';
  submitting = false;
  notice = null;
  placesAdded = 0;
  lastPlaceName = '';
  draft.pseudo = '';
  draft.city = '';
  draft.name = '';
  draft.note = '';
  collision = null;
  distinguishing = false;
  focusedStep = '';
}

/**
 * Opens the flow for a member who already has an account — someone who left
 * before adding a place, or who followed the route in directly. The identity step
 * is behind them by definition, so it is skipped.
 *
 * Idempotent, because the route is applied more than once for one arrival: the
 * boot sequence re-applies it when the catalogue lands. Only a flow that has not
 * started yet is moved, so a member already part-way through is left where they
 * are.
 */
export function resumeOnboarding(): void {
  if (pendingJoin || step !== 'identity') return;
  step = 'place';
  submitting = false;
  notice = null;
  collision = null;
  distinguishing = false;
  // The city they live in is the likeliest city of the place they keep going back
  // to, so it starts there — for a returning member it comes off their record,
  // and for someone who just joined it is still what they typed two screens ago.
  if (!draft.city) {
    const home = pb.authStore.record?.home_city;
    draft.city = typeof home === 'string' ? home : '';
  }
}

export function resetOnboarding(): void {
  pendingJoin = null;
  step = 'identity';
  submitting = false;
  notice = null;
  placesAdded = 0;
  lastPlaceName = '';
  draft.pseudo = '';
  draft.city = '';
  draft.name = '';
  draft.note = '';
  collision = null;
  distinguishing = false;
  focusedStep = '';
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

function identityMarkup(): string {
  return `<section class="welcome-question" aria-labelledby="welcome-title">
    <p class="welcome-kicker">Your invitation</p>
    <h1 id="welcome-title" tabindex="-1">Two things, and you're in.</h1>
    <p class="welcome-lead">Your pseudo is your name on Detour. Your city is where the circle sees you recommending from.</p>
    ${noticeMarkup()}
    <form class="welcome-form" data-welcome-identity novalidate>
      <label>Your pseudo
        <input name="pseudo" value="${esc(draft.pseudo)}" autocomplete="off" spellcheck="false" minlength="3" maxlength="30"
          pattern="@?[a-zA-Z0-9][a-zA-Z0-9-]{1,28}[a-zA-Z0-9]" title="3-30 characters: letters, digits, and hyphens"
          required placeholder="detour-anna" ${submitting ? 'disabled' : ''}>
      </label>
      <label>Where you live
        <input name="home_city" value="${esc(draft.city)}" autocomplete="address-level2" minlength="2" maxlength="120"
          required placeholder="San Francisco" ${submitting ? 'disabled' : ''}>
      </label>
      <div class="welcome-actions">
        <button class="primary-button" type="submit" ${submitting ? 'disabled' : ''}>${
          submitting ? 'Joining…' : 'Join Detour'
        }</button>
      </div>
    </form>
  </section>`;
}

function placeMarkup(venues: Venue[]): string {
  const first = placesAdded === 0;
  const listId = 'welcome-catalogue';
  return `<section class="welcome-question" aria-labelledby="welcome-title">
    <p class="welcome-kicker">${first ? 'Your first place' : `Place ${placesAdded + 1} of ${MAX_PLACES}`}</p>
    <h1 id="welcome-title" tabindex="-1">Where do you keep going back to?</h1>
    <p class="welcome-lead">The place where you already know what to order.</p>
    ${noticeMarkup()}
    <form class="welcome-form" data-welcome-place novalidate>
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
      <p class="welcome-note">Nobody reviews this. Your note and your name go on the place's page as soon as you send it.</p>
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
    step === 'identity'
      ? identityMarkup()
      : step === 'place'
        ? placeMarkup(venues)
        : step === 'same-place'
          ? samePlaceMarkup()
          : savedMarkup();
  return `<main class="welcome-layout" data-welcome-step="${step}">${body}</main>`;
}

export function bindOnboarding(root: HTMLElement, venues: Venue[], callbacks: Callbacks): void {
  const { render, onFinished, onAccount, onPlaceContributed, refreshCatalogue } = callbacks;

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
    '[data-welcome-identity] input, [data-welcome-place] input, [data-welcome-place] textarea'
  ).forEach((field) => {
    field.addEventListener('input', () => {
      if (field.name === 'pseudo') draft.pseudo = field.value;
      else if (field.name === 'home_city' || field.name === 'city') draft.city = field.value;
      else if (field.name === 'venue_name') draft.name = field.value;
      else if (field.name === 'note') draft.note = field.value;
    });
  });

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
      // The feed this route ends on is drawn from the catalogue, and the place
      // just published is not in the copy the app is holding.
      await refreshCatalogue().catch(() => {
        // The feed stays truthful without the refresh; it reloads on arrival.
      });
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

  root.querySelector<HTMLFormElement>('[data-welcome-identity]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const join = pendingJoin;
    if (!join || submitting) return;
    const values = new FormData(event.currentTarget as HTMLFormElement);
    const pseudo = String(values.get('pseudo') || '').trim().replace(/^@+/, '').toLowerCase();
    const city = String(values.get('home_city') || '').trim();
    draft.pseudo = pseudo;
    draft.city = city;
    if (pseudo.length < 3) {
      notice = { kind: 'error', text: 'Pick a pseudo of at least three characters.' };
      render();
      return;
    }
    // `required` lets a space through, and the city is asked for real.
    if (city.length < 2) {
      notice = { kind: 'error', text: 'Tell us the city you live in.' };
      render();
      return;
    }
    submitting = true;
    notice = null;
    render();
    try {
      await pb.collection('members').create({
        pseudo,
        email: join.email,
        password: join.password,
        passwordConfirm: join.password,
        home_city: city,
        invite_code: join.inviteCode,
      });
    } catch (error) {
      // The invitation is only spent here, so this is also where an invalid or
      // already-claimed code surfaces — after the pseudo rather than before it.
      // Saying which of the four values the server refused is the whole of the
      // recovery: everything else on this screen can be corrected in place.
      submitting = false;
      notice = {
        kind: 'error',
        text: readableError(
          error,
          'That invitation could not be accepted. Check the code on your invitation and try again.'
        ),
      };
      render();
      return;
    }
    try {
      await pb.collection('members').authWithPassword(join.email, join.password);
      pendingJoin = null;
      submitting = false;
      step = 'place';
      // The city they live in is the likeliest city of the place they keep going
      // back to, so it carries into the next screen as a starting point.
      draft.name = '';
      draft.note = '';
      render();
    } catch {
      // The account exists; only the session does not. Sending them to the
      // invitation card's sign-in tab is the shortest way to one.
      pendingJoin = null;
      submitting = false;
      onAccount();
    }
  });

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
    await sendPlace(
      {
        venue_name: venueName,
        city,
        note,
        place_intent: matched ? 'second' : 'ask',
      },
      { venueName, city, note }
    );
  });

  root.querySelector<HTMLButtonElement>('[data-welcome-second]')?.addEventListener('click', async () => {
    const place = collision;
    if (!place || submitting) return;
    // Resolved by entry id — the same path the ledger's own edit takes. The name
    // and city ride along so the server can still check they describe it.
    await sendPlace(
      {
        waitlist: place.entry,
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
