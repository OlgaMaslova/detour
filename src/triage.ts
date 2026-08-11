/**
 * The triage card — what fills the landing's answer slot for a member who has
 * added nothing.
 *
 * A real place from their own city, somebody else's note, shown in full, and one
 * question: *Know this place?* See docs/landing-spec.md. The question is about the
 * place and never about what another member achieved, which is what keeps it from
 * reading as social pressure — and that matters most now, while the other name on
 * the card is nearly always the founder's.
 *
 * Markup, state and answers, all three, unlike place-prompt.ts next door: a
 * prompt is a sentence and this is an interaction, with a cap to hold and a card
 * to advance.
 */

import { pb } from './pocketbase';
import { toggleSavedPlace } from './saved';
import { resyncAfterWrite } from './live';

/** One card, as the server chose it. */
export interface TriageCard {
  /** The published venue id. Every answer posts against this. */
  place: string;
  /** The waiting-list entry, for surfaces that address a place that way. */
  entry: string;
  place_name: string;
  city: string;
  country: string;
  note: string;
  recommender: string;
  founding_member: boolean;
  created: string;
}

/**
 * Three cards per session, then it stops.
 *
 * This is the real risk in the mechanic, and the number is not arbitrary. *Been &
 * loved* is public and it emails somebody; a member triaging twenty places in
 * ninety seconds produces noise indistinguishable from signal, on the one surface
 * where trust is the whole product. Three is enough to fill a screen and too few
 * to become a game.
 */
const TRIAGE_CAP = 3;

let card: TriageCard | null = null;
/** How many cards this member has answered during this visit. */
let answered = 0;
/** Venue ids already shown, so a card is never handed back a second time. */
const seen = new Set<string>();
let busy = false;
let failure = '';

/** Local, like every other module's: the codebase has no shared escape helper. */
function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * A card is only worth rendering if it names a place and carries the note it is
 * asking about. Anything less is a question with nothing in it.
 */
export function readTriageCard(value: unknown): TriageCard | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const text = (key: string): string => (typeof raw[key] === 'string' ? (raw[key] as string) : '');
  const place = text('place').trim();
  const name = text('place_name').trim();
  const note = text('note').trim();
  if (!place || !name || !note) return null;
  return {
    place,
    entry: text('entry'),
    place_name: name,
    city: text('city'),
    country: text('country'),
    note,
    recommender: text('recommender').replace(/^@+/, ''),
    founding_member: raw.founding_member === true,
    created: text('created'),
  };
}

/** Hand the landing the card /me arrived with. Ignored once the cap is spent. */
export function adoptTriageCard(next: TriageCard | null): void {
  if (answered >= TRIAGE_CAP) return;
  if (!next || seen.has(next.place)) return;
  if (card && card.place === next.place) return;
  card = next;
  seen.add(next.place);
}

/** The card currently in the answer slot, or null when there is nothing to ask. */
export function triageCard(): TriageCard | null {
  return answered >= TRIAGE_CAP ? null : card;
}

/** A new session answers its own cards; the previous member's are not inherited. */
export function resetTriage(): void {
  card = null;
  answered = 0;
  seen.clear();
  busy = false;
  failure = '';
}

/**
 * The card itself.
 *
 * The note is shown in full and attributed, because the card is asking about a
 * place somebody stood behind and an excerpt would be asking about a fragment.
 *
 * Two one-tap answers sit together; *I'd recommend it myself* is styled as the
 * heavier action beneath them, and *Don't know it* is quiet beside it. Three
 * visually equivalent buttons where one ambushes the member with a text field is
 * a small betrayal they only fall for once.
 */
export function triageCardMarkup(recommendHref: string): string {
  const current = triageCard();
  if (!current) return '';
  const place = esc(current.place_name);
  const who = current.recommender ? esc(current.recommender) : 'A member';
  return `<aside class="network-first-place network-triage" data-triage="${esc(current.place)}" aria-labelledby="network-triage-title">
    <div class="network-triage-head">
      <h2 id="network-triage-title">Know this place?</h2>
      <p class="network-triage-place">${place}${
        current.city ? ` <span class="network-triage-where">${esc(current.city)}</span>` : ''
      }</p>
    </div>
    <blockquote class="network-triage-note">
      <p>${esc(current.note)}</p>
      <footer>Recommended by <strong class="network-pseudo">${who}</strong>${
        current.founding_member
          ? '<span class="place-founding-note"><span aria-hidden="true">★</span> Founding member</span>'
          : ''
      }</footer>
    </blockquote>
    <div class="network-triage-answers">
      <button type="button" class="primary-button" data-triage-been ${busy ? 'disabled' : ''}>Been &amp; loved it</button>
      <button type="button" class="secondary-button" data-triage-save ${busy ? 'disabled' : ''}>Wanna go</button>
    </div>
    <div class="network-triage-more">
      <a class="network-triage-write" href="${esc(recommendHref)}" data-community-route="recommend-place" data-recommend-venue="${esc(
        current.place
      )}">I'd recommend it myself</a>
      <button type="button" class="network-triage-skip" data-triage-skip ${busy ? 'disabled' : ''}>Don't know it</button>
    </div>
    ${failure ? `<p class="network-triage-status" role="alert">${esc(failure)}</p>` : ''}
  </aside>`;
}

/**
 * Move to the next card, or empty the slot when there is none.
 *
 * Called after every answer, including *Don't know it* — which is not a failure.
 * It advances the card and tells us the place is unknown outside its recommender,
 * which is worth knowing, and it is the only honest answer available to somebody
 * who has never heard of the place.
 */
async function advance(render: () => void): Promise<void> {
  answered += 1;
  card = null;
  if (answered >= TRIAGE_CAP) {
    render();
    return;
  }
  const skip = Array.from(seen).join(',');
  const payload = await pb
    .send<unknown>(`/api/detour/landing/triage?skip=${encodeURIComponent(skip)}`, {
      requestKey: null,
    })
    .catch(() => null);
  const next = payload && typeof payload === 'object'
    ? readTriageCard((payload as { card?: unknown }).card)
    : null;
  if (next && !seen.has(next.place)) {
    card = next;
    seen.add(next.place);
  }
  render();
}

/**
 * Wire the card's four answers.
 *
 * Each of the two one-tap answers goes through the route that owns it rather than
 * through anything of this card's own: *Been & loved it* is the endorsement route,
 * with its own rules and its own email to the member whose note was acted on, and
 * *Wanna go* is the save route. The card is a surface onto them, never a shortcut
 * around them — which is also why a refusal is shown here verbatim instead of
 * being swallowed.
 */
export function bindTriageCard(root: HTMLElement, render: () => void): void {
  const current = triageCard();
  if (!current) return;

  const answer = (run: () => Promise<unknown>) => {
    if (busy) return;
    busy = true;
    failure = '';
    render();
    run()
      .then(() => advance(render))
      .catch((error) => {
        failure = readTriageError(error);
      })
      .finally(() => {
        busy = false;
        render();
      });
  };

  root.querySelector<HTMLButtonElement>('[data-triage-been]')?.addEventListener('click', () => {
    answer(async () => {
      await pb.send(`/api/detour/places/${encodeURIComponent(current.place)}/endorsement`, {
        method: 'POST',
        requestKey: null,
      });
      // A mark is a count on the place, so it reaches further than this card: the
      // Wanna go tab stops listing a save the member has now passed — the row
      // survives, so the list is re-read rather than edited by hand — and the
      // catalogue row and feed card both carry the figure that just changed.
      void resyncAfterWrite(render);
    });
  });

  root.querySelector<HTMLButtonElement>('[data-triage-save]')?.addEventListener('click', () => {
    answer(async () => {
      await toggleSavedPlace(current.place, 'triage', () => {});
    });
  });

  // Nothing is recorded about the member, which is what makes this an honest
  // answer rather than a failure. The card simply advances.
  root.querySelector<HTMLButtonElement>('[data-triage-skip]')?.addEventListener('click', () => {
    if (busy) return;
    busy = true;
    render();
    void advance(render).finally(() => {
      busy = false;
      render();
    });
  });
}

/** The server's own sentence when it sent one — every refusal here is readable. */
function readTriageError(error: unknown): string {
  if (error && typeof error === 'object') {
    // Only what the server itself said: the SDK's own `message` is a placeholder
    // on transport failures, and says less than the sentence below.
    const response = error as { response?: { message?: string } };
    return (
      response.response?.message || 'That could not be recorded just now. Try again in a moment.'
    );
  }
  return 'That could not be recorded just now. Try again in a moment.';
}
