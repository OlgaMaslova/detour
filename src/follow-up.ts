/**
 * *Been yet?* — the follow-up on somewhere the member said they wanted to go.
 *
 * The third entry in the landing's answer slot, sitting below the triage card and
 * above the week's prompt (docs/landing-spec.md), and the reason Wanna go earns a
 * place in the ladder at all (docs/wanna-go-spec.md). Saving does nothing for
 * anybody else on its own; what it buys is the right to ask one question later, at
 * the point where the member finally has something to say.
 *
 * THE ONE DIFFERENCE FROM THE TRIAGE CARD, which this otherwise mirrors: the place
 * is one the member chose. So the question needs no justification, cannot read as
 * social pressure, and has no "don't know it" — they know it, they put it on their
 * own list. Three answers instead of four.
 *
 * Which place, whether to ask at all, and every gate behind it are decided
 * server-side: see pb_hooks/landing_followup.js. Markup, state and the three
 * answers are here, the same division triage.ts holds.
 */

import { pb } from './pocketbase';
import { resyncAfterWrite } from './live';

/** One follow-up, as the server chose it. */
export interface FollowUpCard {
  /** The save row. Not sent anywhere by the client; the answers go by place. */
  save: string;
  /** The published venue id. Every answer posts against this. */
  place: string;
  /** The waiting-list entry, for surfaces that address a place that way. */
  entry: string;
  place_name: string;
  city: string;
  country: string;
  /** The note that put it on their list. Empty is allowed — see the markup. */
  note: string;
  recommender: string;
  /** Whole days since they saved it. Never printed as a number; see the copy. */
  saved_days_ago: number;
}

let card: FollowUpCard | null = null;
/** Answered during this visit: one question, and the slot empties behind it. */
let done = false;
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
 * A card is only worth rendering if it names the place it is asking about. The
 * note is optional — the member chose this place, so the name alone identifies it,
 * unlike a triage card where the note *is* the thing being asked about.
 */
export function readFollowUpCard(value: unknown): FollowUpCard | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const text = (key: string): string => (typeof raw[key] === 'string' ? (raw[key] as string) : '');
  const place = text('place').trim();
  const name = text('place_name').trim();
  if (!place || !name) return null;
  const days = Number(raw.saved_days_ago);
  return {
    save: text('save'),
    place,
    entry: text('entry'),
    place_name: name,
    city: text('city'),
    country: text('country'),
    note: text('note').trim(),
    recommender: text('recommender').replace(/^@+/, ''),
    saved_days_ago: Number.isFinite(days) && days > 0 ? Math.floor(days) : 0,
  };
}

/** Hand the landing the card /me arrived with. Ignored once one is answered. */
export function adoptFollowUpCard(next: FollowUpCard | null): void {
  if (done || !next) return;
  if (card && card.place === next.place) return;
  card = next;
}

/** The card in the answer slot, or null when there is nothing to ask. */
export function followUpCard(): FollowUpCard | null {
  return done ? null : card;
}

/** A new session answers its own questions; the previous member's are not kept. */
export function resetFollowUp(): void {
  card = null;
  done = false;
  busy = false;
  failure = '';
}

/**
 * The card itself.
 *
 * Two answers that cost a tap sit together, and *write your own* is the heavier
 * action beneath them — the same shape as the triage card, for the same reason.
 * Three visually equivalent buttons where one ambushes the member with a text
 * field is a small betrayal they only fall for once.
 *
 * "A while back" rather than "three weeks ago". The gate is three weeks but the
 * gap is however long it took the member to come back, and a card that states a
 * duration it has not measured is the same invented figure this screen is not
 * allowed to print.
 */
export function followUpCardMarkup(recommendHref: string): string {
  const current = followUpCard();
  if (!current) return '';
  const place = esc(current.place_name);
  return `<aside class="network-first-place network-triage network-follow-up" data-follow-up="${esc(
    current.place
  )}" aria-labelledby="network-follow-up-title">
    <div class="network-triage-head">
      <h2 id="network-follow-up-title">You saved <strong>${place}</strong> a while back. Been yet?</h2>
      ${
        current.city
          ? `<p class="network-follow-up-where"><span class="network-triage-where">${esc(current.city)}</span></p>`
          : ''
      }
    </div>
    ${
      current.note
        ? `<blockquote class="network-triage-note">
      <p>${esc(current.note)}</p>${
        current.recommender
          ? `<footer>Recommended by <strong class="network-pseudo">${esc(current.recommender)}</strong></footer>`
          : ''
      }
    </blockquote>`
        : ''
    }
    <div class="network-triage-answers">
      <button type="button" class="primary-button" data-follow-up-been ${busy ? 'disabled' : ''}>Been &amp; loved it</button>
      <button type="button" class="secondary-button" data-follow-up-not-yet ${busy ? 'disabled' : ''}>Not yet</button>
    </div>
    <div class="network-triage-more">
      <a class="network-triage-write" href="${esc(recommendHref)}" data-community-route="recommend-place" data-recommend-venue="${esc(
        current.place
      )}">Write your own</a>
    </div>
    ${failure ? `<p class="network-triage-status" role="alert">${esc(failure)}</p>` : ''}
  </aside>`;
}

/**
 * Wire the card's answers.
 *
 * ONE QUESTION PER VISIT, and the slot empties behind it rather than advancing to
 * the next saved place. A follow-up is not a queue to be worked through — the
 * triage card is capped at three because it is filling a blank record, and this is
 * asking a member to account for their own list. Twice in a sitting is an audit.
 *
 * *Been & loved it* goes through the endorsement route, with its own rules and its
 * own email to the member whose note was acted on, and the place drops out of the
 * server's own follow-up query once that mark exists — so nothing here has to tell
 * the server the question was answered. *Not yet* is the only answer that needs a
 * route of its own.
 */
export function bindFollowUpCard(root: HTMLElement, render: () => void): void {
  const current = followUpCard();
  if (!current) return;

  const answer = (run: () => Promise<unknown>) => {
    if (busy) return;
    busy = true;
    failure = '';
    render();
    run()
      .then(() => {
        done = true;
        card = null;
      })
      .catch((error) => {
        failure = readFollowUpError(error);
      })
      .finally(() => {
        busy = false;
        render();
      });
  };

  root.querySelector<HTMLButtonElement>('[data-follow-up-been]')?.addEventListener('click', () => {
    answer(async () => {
      await pb.send(`/api/detour/places/${encodeURIComponent(current.place)}/endorsement`, {
        method: 'POST',
        requestKey: null,
      });
      // The save survives the mark — one state per place is a display rule, not a
      // storage rule — but the Wanna go tab stops listing it, and the count on the
      // place has changed for the catalogue and the feed too, so everything is
      // re-read rather than edited by hand.
      void resyncAfterWrite(render);
    });
  });

  // Not yet is an answer, not a dismissal: it says the place is still ahead of
  // them, which buys it a month of quiet and retires the question on the second.
  root.querySelector<HTMLButtonElement>('[data-follow-up-not-yet]')?.addEventListener('click', () => {
    answer(() =>
      pb.send(`/api/detour/landing/follow-up/${encodeURIComponent(current.place)}/not-yet`, {
        method: 'POST',
        requestKey: null,
      })
    );
  });
}

/** The server's own sentence when it sent one — every refusal here is readable. */
function readFollowUpError(error: unknown): string {
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
