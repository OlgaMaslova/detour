/**
 * The member directory: the recipient picker's combobox, the circle shortcut
 * rows inside it, and the one route allowed to turn a pseudo into the member
 * id a share is addressed to.
 */
import { pb } from '../pocketbase';
import type { CircleRecipientGroup } from '../circle';
import { esc, member, onCommunityReset, pseudoLabel, readableError } from './store';

export interface DirectoryMember {
  id: string;
  pseudo?: string;
}

export interface DirectoryState {
  query: string;
  selected: DirectoryMember | null;
  items: DirectoryMember[];
  loading: boolean;
  error: string;
  activeIndex: number;
  timer: number | null;
  /**
   * Whether the cursor is in the field. The suggestions — the circle, the search
   * results, the hint — are a dropdown, so they exist only while it is, and they
   * overlay the form rather than pushing the note and the send button down the
   * page every time somebody clicks the recipient box.
   */
  focused: boolean;
}
// The member's circle, offered by the share pickers as somewhere to send it.
// Pushed in rather than read, so this module never imports circle.ts back.
let circleRecipients: CircleRecipientGroup[] = [];
let circleRecipientsLoading = false;
const directories = new Map<string, DirectoryState>();
export function directoryState(key: string): DirectoryState {
  let state = directories.get(key);
  if (!state) {
    state = { query: '', selected: null, items: [], loading: false, error: '', activeIndex: -1, timer: null, focused: false };
    directories.set(key, state);
  }
  return state;
}

function directoryListId(key: string): string {
  return `member-directory-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}
/**
 * The circle, in the slot the search results will occupy.
 *
 * What the field offers before anything is typed. It used to be the sentence
 * "Type a pseudo, such as anna-lisboa" — accurate, and useless: a member knows who
 * they want to send a place to as a person, not as a handle they can spell. Nearly
 * every share goes to somebody in here, so the people come first and the search
 * stays for everyone else.
 *
 * Not a popup. The input is a combobox with a listbox of its own for search
 * results, and a second overlay opening from the same field would fight it — so
 * this list sits in that same slot and is simply what is there first. Bands are
 * named on the rows rather than as headings, because "your inviter" is usually one
 * person and three headings over four names is furniture.
 *
 * Plain buttons, not options: these are shortcuts into a search, not the
 * combobox's own popup, and each still resolves through the directory when
 * pressed. Giving them listbox semantics would put two listboxes on one
 * aria-controls and break the activedescendant contract the arrow keys rely on.
 */
function circleRecipientsMarkup(): string {
  const hint = 'Or type any member’s pseudo, such as anna-lisboa.';
  if (!circleRecipients.length) {
    return `<p class="member-directory-hint">${
      circleRecipientsLoading
        ? 'Reading your circle… meanwhile, type a pseudo, such as anna-lisboa.'
        : 'Type a pseudo, such as anna-lisboa — at least two characters.'
    }</p>`;
  }
  const rows = circleRecipients
    .map((group) =>
      group.names
        // The label form travels in the attribute as well, so the exact-match test
        // in lookupPseudo compares the same string the row shows.
        .map((name) => pseudoLabel(name))
        .map(
          (name) =>
            `<li><button type="button" data-circle-recipient="${esc(name)}" aria-label="${esc(
              `Share with ${pseudoLabel(name)} — ${group.label.toLowerCase()}`
            )}"><span class="member-directory-circle-name">${esc(
              pseudoLabel(name)
            )}</span><span class="member-directory-circle-band">${esc(group.label)}</span></button></li>`
        )
        .join('')
    )
    .join('');
  return `<div class="member-directory-circle">
    <p class="member-directory-circle-label" aria-hidden="true">Your circle</p>
    <ul class="member-directory-circle-list" aria-label="Your circle">${rows}</ul>
    <p class="member-directory-hint">${hint}</p>
  </div>`;
}

/**
 * What sits under the recipient field.
 *
 * Two different things, and the difference is what stays put. A chosen member is
 * the field's answer, so it is stated in the flow and stays there — leaving the
 * field must never quietly withdraw the sentence naming who the share is going
 * to. Everything else is a suggestion, and suggestions are a dropdown: they open
 * on focus, close when the cursor leaves, and overlay the form rather than
 * shoving the note field down the page each time the box is clicked.
 */
function directoryResultsMarkup(key: string): string {
  const state = directoryState(key);
  if (state.selected) {
    return `<p class="member-directory-selected"><span>Selected</span><strong>${esc(pseudoLabel(state.selected.pseudo))}</strong></p>`;
  }
  if (!state.focused) return '';
  return `<div class="member-directory-panel">${directorySuggestionsMarkup(key)}</div>`;
}

function directorySuggestionsMarkup(key: string): string {
  const state = directoryState(key);
  if (state.query.trim().length < 2) return circleRecipientsMarkup();
  if (state.loading) return '<p class="member-directory-hint" role="status">Searching members…</p>';
  if (state.error) return `<p class="member-directory-error" role="alert">${esc(state.error)}</p>`;
  if (!state.items.length) return '<p class="member-directory-hint">No matching members.</p>';
  return `<ul class="member-directory-results" role="listbox">${state.items
    .map(
      (item, index) =>
        `<li><button type="button" role="option" id="${directoryListId(key)}-option-${index}" aria-selected="${state.activeIndex === index}" data-member-choice="${index}">${esc(pseudoLabel(item.pseudo))}</button></li>`
    )
    .join('')}</ul>`;
}

export function directoryMarkup(key: string, label: string): string {
  const state = directoryState(key);
  const listId = directoryListId(key);
  return `<div class="member-directory" data-member-directory="${esc(key)}">
    <label>${esc(label)}
      <input type="search" value="${esc(state.query)}" autocomplete="off" spellcheck="false" placeholder="anna-lisboa" role="combobox" aria-autocomplete="list" aria-expanded="${state.items.length > 0}" aria-controls="${listId}" ${state.activeIndex >= 0 ? `aria-activedescendant="${listId}-option-${state.activeIndex}"` : ''} data-member-search>
    </label>
    <div id="${listId}" class="member-directory-output" data-member-results>${directoryResultsMarkup(key)}</div>
  </div>`;
}
/**
 * One pseudo, asked of the directory. The name a circle row or a deep link carries
 * is a name, and only this route may turn one into the id a share is addressed to
 * — so both go through here and get the same answer to the same question.
 */
export async function lookupPseudo(
  pseudo: string
): Promise<{ items: DirectoryMember[]; exact: DirectoryMember | null; error: string }> {
  try {
    const response = await pb.send<{ items: DirectoryMember[] }>(
      `/api/detour/member-directory?q=${encodeURIComponent(pseudo)}`,
      { requestKey: null }
    );
    const ownId = member()?.id;
    const items = (response.items || []).filter((item) => item.id !== ownId && item.pseudo?.trim());
    return {
      items,
      exact:
        items.find((item) => pseudoLabel(item.pseudo).toLowerCase() === pseudo.toLowerCase()) ??
        null,
      error: '',
    };
  } catch (error) {
    return {
      items: [],
      exact: null,
      error: readableError(error, 'Member search is unavailable. Please try again.'),
    };
  }
}

/**
 * An exact pseudo selects itself; anything else is left as search results for the
 * member to choose from. So a renamed handle, or one that now matches two members,
 * degrades into the ordinary lookup rather than addressing the share to the wrong
 * person on the strength of a stale name.
 */
export function applyPseudoLookup(
  state: DirectoryState,
  pseudo: string,
  result: { items: DirectoryMember[]; exact: DirectoryMember | null; error: string }
): void {
  if (result.exact) {
    state.selected = result.exact;
    state.query = pseudoLabel(result.exact.pseudo);
    state.items = [];
  } else {
    state.items = result.items;
    state.query = pseudo;
  }
  state.error = result.error;
  state.loading = false;
  state.activeIndex = -1;
}
/**
 * Hand the share pickers the member's circle. Called on every render of a surface
 * that holds one, so the list appears as soon as the payload lands rather than on
 * the next thing the member happens to click.
 */
export function adoptCircleRecipients(groups: CircleRecipientGroup[], loading: boolean): void {
  circleRecipients = groups;
  circleRecipientsLoading = loading;
}
function updateDirectoryResults(root: HTMLElement, key: string): void {
  const container = Array.from(root.querySelectorAll<HTMLElement>('[data-member-directory]')).find(
    (item) => item.dataset.memberDirectory === key
  );
  if (!container) return;
  const output = container.querySelector<HTMLElement>('[data-member-results]');
  const input = container.querySelector<HTMLInputElement>('[data-member-search]');
  const state = directoryState(key);
  if (output) output.innerHTML = directoryResultsMarkup(key);
  if (input) {
    // The popup is open whenever the dropdown is on screen, which is what the
    // attribute is for — it used to describe only the search results, and read
    // "collapsed" over an open list of the member's circle.
    input.setAttribute(
      'aria-expanded',
      String(state.focused && !state.selected)
    );
    if (state.activeIndex >= 0) input.setAttribute('aria-activedescendant', `${directoryListId(key)}-option-${state.activeIndex}`);
    else input.removeAttribute('aria-activedescendant');
  }
}

function selectDirectoryMember(root: HTMLElement, key: string, index: number): void {
  const state = directoryState(key);
  const selected = state.items[index];
  if (!selected) return;
  state.selected = selected;
  state.query = pseudoLabel(selected.pseudo);
  state.items = [];
  state.activeIndex = -1;
  const container = Array.from(root.querySelectorAll<HTMLElement>('[data-member-directory]')).find(
    (item) => item.dataset.memberDirectory === key
  );
  const input = container?.querySelector<HTMLInputElement>('[data-member-search]');
  if (input) input.value = pseudoLabel(selected.pseudo);
  updateDirectoryResults(root, key);
}

export function bindDirectories(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('[data-member-directory]').forEach((container) => {
    const key = container.dataset.memberDirectory || '';
    const input = container.querySelector<HTMLInputElement>('[data-member-search]');
    const output = container.querySelector<HTMLElement>('[data-member-results]');
    if (!key || !input || !output) return;

    // A full render replaced this field, so whatever focus it had is gone with it:
    // the flag is re-read from the document rather than trusted across the
    // rebuild, or a dropdown open when the circle payload landed would stay open
    // over an input the browser is no longer in.
    const bound = directoryState(key);
    if (bound.focused !== (document.activeElement === input)) {
      bound.focused = document.activeElement === input;
      updateDirectoryResults(root, key);
    }

    // Open on focus, close when focus leaves the field for good. `focusout` fires
    // with the incoming element, so focus moving to something inside the dropdown
    // is not focus leaving — otherwise the panel would close under a row on its
    // way to being pressed.
    container.addEventListener('focusin', () => {
      const state = directoryState(key);
      if (state.focused) return;
      state.focused = true;
      updateDirectoryResults(root, key);
    });
    container.addEventListener('focusout', (event) => {
      const next = event.relatedTarget;
      if (next instanceof Node && container.contains(next)) return;
      const state = directoryState(key);
      if (!state.focused) return;
      state.focused = false;
      state.activeIndex = -1;
      updateDirectoryResults(root, key);
    });
    // Safari does not focus a button when it is clicked, so a press inside the
    // panel would read as focus leaving the field — closing the dropdown, and
    // taking the row out of the DOM before its click could land. Refusing the
    // mousedown's default keeps the cursor in the input; the click still fires.
    output.addEventListener('mousedown', (event) => event.preventDefault());

    input.addEventListener('input', () => {
      const state = directoryState(key);
      // A dropdown dismissed with Escape reopens as soon as the member types
      // rather than staying shut over the results of what they are typing.
      state.focused = true;
      state.query = input.value;
      state.selected = null;
      state.items = [];
      state.error = '';
      state.activeIndex = -1;
      if (state.timer !== null) window.clearTimeout(state.timer);
      if (state.query.trim().length < 2) {
        state.loading = false;
        updateDirectoryResults(root, key);
        return;
      }
      state.loading = true;
      updateDirectoryResults(root, key);
      const requestedQuery = state.query.trim();
      state.timer = window.setTimeout(async () => {
        try {
          const response = await pb.send<{ items: DirectoryMember[] }>(
            `/api/detour/member-directory?q=${encodeURIComponent(requestedQuery)}`,
            { requestKey: null }
          );
          if (directoryState(key).query.trim() !== requestedQuery) return;
          const ownId = member()?.id;
          state.items = (response.items || []).filter((item) => item.id !== ownId && item.pseudo?.trim());
          state.error = '';
        } catch (error) {
          if (directoryState(key).query.trim() !== requestedQuery) return;
          state.items = [];
          state.error = readableError(error, 'Member search is unavailable. Please try again.');
        } finally {
          if (directoryState(key).query.trim() === requestedQuery) {
            state.loading = false;
            state.activeIndex = -1;
            updateDirectoryResults(root, key);
          }
        }
      }, 220);
    });

    input.addEventListener('keydown', (event) => {
      const state = directoryState(key);
      // Escape closes the dropdown itself, results or circle, and does it before
      // the guard below — there is nothing in `items` to walk when what is open is
      // the circle, and Escape has to work over that too.
      if (event.key === 'Escape' && state.focused) {
        state.items = [];
        state.activeIndex = -1;
        state.focused = false;
        updateDirectoryResults(root, key);
        return;
      }
      if (!state.items.length) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        state.activeIndex = (state.activeIndex + 1) % state.items.length;
        updateDirectoryResults(root, key);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        state.activeIndex = state.activeIndex <= 0 ? state.items.length - 1 : state.activeIndex - 1;
        updateDirectoryResults(root, key);
      } else if (event.key === 'Enter' && state.activeIndex >= 0) {
        event.preventDefault();
        selectDirectoryMember(root, key, state.activeIndex);
      }
    });

    output.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const choice = target.closest<HTMLButtonElement>('[data-member-choice]');
      if (choice) {
        selectDirectoryMember(root, key, Number(choice.dataset.memberChoice));
        input.focus();
        return;
      }
      // A circle row names a person, so it still has to be looked up: the name
      // becomes the query and the directory turns it into the id the share is
      // addressed to. Everything refreshes through updateDirectoryResults rather
      // than a panel render, so a note already typed below survives the pick.
      const circleRow = target.closest<HTMLButtonElement>('[data-circle-recipient]');
      if (!circleRow) return;
      const pseudo = circleRow.dataset.circleRecipient || '';
      if (!pseudo) return;
      const state = directoryState(key);
      state.query = pseudo;
      state.selected = null;
      state.items = [];
      state.error = '';
      state.activeIndex = -1;
      state.loading = true;
      if (state.timer !== null) window.clearTimeout(state.timer);
      input.value = pseudo;
      updateDirectoryResults(root, key);
      input.focus();
      void lookupPseudo(pseudo).then((result) => {
        // The member may have started typing somebody else while this was in
        // flight; their query wins over the row they pressed.
        if (directoryState(key).query !== pseudo) return;
        applyPseudoLookup(state, pseudo, result);
        if (state.selected) input.value = pseudoLabel(state.selected.pseudo);
        updateDirectoryResults(root, key);
      });
    });
  });
}

/** Forget one picker's state — a cancelled or sent share must not keep its lookup. */
export function dropDirectory(key: string): void {
  directories.delete(key);
}

onCommunityReset(() => {
  directories.forEach((state) => {
    if (state.timer !== null) window.clearTimeout(state.timer);
  });
  directories.clear();
});
