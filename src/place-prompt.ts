/**
 * The first-place ask: the question a returning member who has never added a
 * place is shown on the home feed.
 *
 * Copy and markup only. Which rung a member is due, whether they should be asked
 * at all, and every fact quoted in the wording are decided server-side — see
 * pb_hooks/place_prompts.js for the ladder and pb_hooks/member_sessions.js for
 * what counts as coming back. Nothing here reads state or fetches anything, which
 * is why it lives apart from network.ts: the wording changes often and the feed's
 * machinery does not.
 */

/**
 * The ask, as the server settled it: which rung, and the facts that rung's
 * wording might need. Everything here is already circle-scoped — the count is what
 * this member can see, and `recommender` is somebody they are allowed to hear from.
 */
export interface PlacePrompt {
  /** 1, 2, or 3; the third repeats for as long as the member never answers. */
  rung: number;
  city: string;
  /** Places in their city on *their* list. Zero picks the empty-city track. */
  city_place_count: number;
  /** The most recent place in their city, and whose it is. Empty when there is none. */
  recommender: string;
  place_name: string;
  /** Occasion keys from ./occasions; the prose word for each is below. */
  place_occasion: string;
  occasion: string;
  other_occasion: string;
}

/**
 * How an occasion is said inside a sentence, which is not how it is labelled on a
 * card: "Breakfast or brunch" is a filter chip, "breakfast" is what somebody had.
 * Keys come from OCCASION_LADDER in pb_hooks/place_prompts.js — a key with no word
 * here falls back to the ask that needs no occasion at all.
 */
const PROMPT_OCCASION_WORDS: Record<string, string> = {
  breakfast_brunch: 'breakfast',
  neighborhood_meal: 'dinner',
  coffee: 'coffee',
  late_night: 'a late one',
  drinks_nightcap: 'drinks',
  quick_bite: 'a quick lunch',
  date_night: 'a date night',
};

/** Local, like every other module's: the codebase has no shared escape helper. */
function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * What each rung says. Two tracks — their city has places, or it does not — and
 * the first rung is shared by both.
 *
 * Tokens available: the city, the count, the most recent place and who put it
 * there, and three occasion words. Anything absent renders as the track's
 * occasion-free wording rather than an empty gap in a sentence.
 */
function placePromptCopy(prompt: PlacePrompt): { question: string; sub: string } {
  const city = esc(prompt.city);
  const occasion = PROMPT_OCCASION_WORDS[prompt.occasion] || '';
  const other = PROMPT_OCCASION_WORDS[prompt.other_occasion] || '';
  const placeOccasion = PROMPT_OCCASION_WORDS[prompt.place_occasion] || '';
  const member = esc(prompt.recommender);
  const place = esc(prompt.place_name);

  // Both tracks, first return: an occasion, a stance, their city, nobody else in
  // the sentence.
  if (prompt.rung <= 1) {
    return occasion
      ? {
          question: `You've had ${occasion} in ${city} a hundred times.`,
          sub: 'Same place most of the time, probably. Where?',
        }
      : {
          question: `You've eaten in ${city} a hundred times.`,
          sub: 'Same place most of the time, probably. Where?',
        };
  }

  // The empty-city track, and the fallback whenever the full-city wording would
  // need a member or an occasion that is not there to quote.
  const cityIsEmpty = prompt.city_place_count === 0;

  if (prompt.rung === 2) {
    // Names the place outright. The wording this replaced opened with "That's
    // where", which pointed at a card that was rendered above it in an earlier
    // draft — with no card, the pronoun had nothing to refer to.
    if (!cityIsEmpty && place && member && placeOccasion && other) {
      return {
        question: `${place} is where ${member} sends people for ${placeOccasion} in ${city}.`,
        sub: `So where do you send them for ${other}?`,
      };
    }
    return {
      question: `Someone's going to arrive in ${city} on a Tuesday night with no idea where to eat.`,
      sub: 'Right now Detour has nothing to tell them. You do.',
    };
  }

  if (!cityIsEmpty) {
    return {
      question: 'The place you’d be a bit annoyed to see get busy.',
      sub: `Say it anyway — someone's coming to ${city} and doesn't know it exists.`,
    };
  }
  return {
    question: `Where do you keep going back to in ${city}?`,
    sub: 'Not the best one. The one you actually return to.',
  };
}

/**
 * The ask itself. Text only, in the slot the first-place nudge already occupies —
 * this is the more specific version of that nudge, so it replaces rather than
 * stacks with it. Keeps the `network-first-place` class so it inherits that card's
 * frame; `network-place-prompt` is what restyles the heading as a question.
 */
export function placePromptMarkup(prompt: PlacePrompt, accountHref: string): string {
  const copy = placePromptCopy(prompt);
  return `<aside class="network-first-place network-place-prompt" data-place-prompt="${prompt.rung}" aria-labelledby="network-place-prompt-title">
    <div>
      <h2 id="network-place-prompt-title">${copy.question}</h2>
      <p>${copy.sub}</p>
    </div>
    <a class="network-primary-link" href="${esc(accountHref)}" data-community-route="recommend-place">Add place <span class="nav-arrow nav-arrow-external" aria-hidden="true">&#x2197;&#xFE0E;</span></a>
  </aside>`;
}
