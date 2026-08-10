/**
 * Handing an invitation on. The clipboard is the lowest common denominator — it
 * works everywhere and asks nothing of the member — but most invitations are
 * actually sent in one of two places, so WhatsApp and email get their own way
 * through. On a phone the system sheet knows the rest (Messages, Signal,
 * Telegram, AirDrop), so it is offered wherever it exists rather than a longer
 * list of guesses about which app someone uses.
 */

const SUBJECT = 'An invitation to Detour';

/** One sentence of context above the link: an invitation with no words is a bare URL. */
const MESSAGE = "I'd like to invite you to Detour — a small circle sharing the places we actually love. This link puts you in mine:";

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function inviteMessage(link: string): string {
  return `${MESSAGE}\n\n${link}`;
}

export function whatsAppHref(link: string): string {
  return `https://wa.me/?text=${encodeURIComponent(inviteMessage(link))}`;
}

export function mailtoHref(link: string): string {
  return `mailto:?subject=${encodeURIComponent(SUBJECT)}&body=${encodeURIComponent(inviteMessage(link))}`;
}

/** The system share sheet, where the browser has one. */
export function canShareNatively(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

/**
 * The row of send-it-onward links for one invitation. Rendered only with a link
 * in hand: an app link built from an empty URL would send someone a broken
 * invitation. `compact` drops the leading label for rows that are already
 * labelled by their surroundings.
 */
export function inviteShareMarkup(link: string, compact = false): string {
  if (!link) return '';
  const native = canShareNatively()
    ? `<button class="invite-share-link" type="button" data-invite-share="${esc(link)}">More…</button>`
    : '';
  return `<div class="invite-share${compact ? ' is-compact' : ''}" role="group" aria-label="Send this invitation">
    ${compact ? '' : '<span class="invite-share-label">Send via</span>'}
    <a class="invite-share-link" href="${esc(whatsAppHref(link))}" target="_blank" rel="noopener noreferrer">WhatsApp</a>
    <a class="invite-share-link" href="${esc(mailtoHref(link))}">Email</a>
    ${native}
  </div>`;
}

/**
 * The same send-it-onward options, tucked behind one "Share" disclosure
 * instead of laid out inline — for rows that already carry a Copy link button
 * and a Remove button, where three more links would crowd the row past what
 * anyone can scan.
 */
export function inviteShareMenuMarkup(link: string): string {
  if (!link) return '';
  const native = canShareNatively()
    ? `<button class="invite-share-menu-link" type="button" data-invite-share="${esc(link)}">More…</button>`
    : '';
  return `<details class="invite-share-menu">
    <summary class="secondary-button invite-share-toggle">Share</summary>
    <div class="invite-share-menu-list" role="group" aria-label="Send this invitation">
      <a class="invite-share-menu-link" href="${esc(whatsAppHref(link))}" target="_blank" rel="noopener noreferrer">WhatsApp</a>
      <a class="invite-share-menu-link" href="${esc(mailtoHref(link))}">Email</a>
      ${native}
    </div>
  </details>`;
}

/**
 * Wires the system-sheet button. The plain links need no JavaScript, so this is
 * all there is to bind. A dismissed sheet throws AbortError, which is not a
 * failure worth reporting.
 */
export function bindInviteShare(root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>('[data-invite-share]').forEach((button) => {
    button.addEventListener('click', () => {
      const link = button.dataset.inviteShare || '';
      if (!link || !canShareNatively()) return;
      // `url` carries the link, so the text is the sentence alone — passing both
      // in the text as well makes the target app show the link twice.
      void navigator.share({ title: SUBJECT, text: MESSAGE, url: link }).catch(() => {});
    });
  });
  // A menu that stays open after the member has already acted on it reads as
  // unfinished. Any click inside the list — WhatsApp, Email, or the native
  // sheet — closes the disclosure it came from.
  root.querySelectorAll<HTMLElement>('.invite-share-menu-list').forEach((list) => {
    list.addEventListener('click', () => {
      list.closest('details')?.removeAttribute('open');
    });
  });
}
