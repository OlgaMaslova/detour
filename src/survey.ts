import surveyForms from '../pb_hooks/survey_forms.json';
import { apiBaseUrl, pb } from './pocketbase';

interface SurveyOption {
  value: string;
  label: string;
}

interface SurveyCondition {
  key: string;
  in?: string[];
  notIn?: string[];
}

interface SurveyQuestion {
  key: string;
  kind: 'single' | 'text';
  summaryLabel: string;
  prompt: string;
  note?: string;
  error: string;
  options?: SurveyOption[];
  placeholder?: string;
  minLength?: number;
  maxLength?: number;
  rows?: number;
  appliesWhen?: SurveyCondition;
  /** Asked, but "nothing to say" is a real answer — stored absent when blank. */
  optional?: boolean;
}

/** Copy for the email-only invite dialog; every field has a usable default. */
interface SurveyInviteClaim {
  kicker?: string;
  title?: string;
  body?: string;
  emailLabel?: string;
  placeholder?: string;
  note?: string;
  submitLabel?: string;
  submittingLabel?: string;
  cancelLabel?: string;
  successTitle?: string;
  successBody?: string;
  duplicateBody?: string;
  closeLabel?: string;
}

interface SurveyForm {
  version: number;
  audience: 'public' | 'member';
  source: string;
  pageTitle: string;
  pageDescription: string;
  kicker: string;
  title: string;
  intro: string;
  privacyNote: string;
  submitNote: string;
  submitLabel: string;
  submittingLabel: string;
  /** `inviteCta` opens the invite dialog; see the config's comment. */
  success: {
    kicker: string;
    title: string;
    body: string;
    inviteLead?: string;
    inviteCta?: string;
    inviteClaim?: SurveyInviteClaim;
  };
  /** Shown instead of the questions when a member survey has no session. */
  signedOutNote?: string;
  /** A shared question list by name, asked before this form's own questions. */
  questionSet?: string;
  questions?: SurveyQuestion[];
}

const config = surveyForms as unknown as {
  questionSets: Record<string, SurveyQuestion[]>;
  forms: Record<string, SurveyForm>;
};
const forms = config.forms;

/** A form's questions: its shared set, if it names one, then any of its own. */
function questionsFor(form: SurveyForm): SurveyQuestion[] {
  const shared = form.questionSet ? config.questionSets[form.questionSet] || [] : [];
  return [...shared, ...(form.questions || [])];
}

// The survey a bare /survey path serves, so existing links keep working.
export const defaultSurveyForm = 'discovery-habits';

interface SurveyState {
  answers: Record<string, string>;
  submitting: boolean;
  submitted: boolean;
  submitError: string;
  errors: Record<string, string>;
  /** The invite dialog offered by the confirmation, once it has been opened. */
  claim: {
    status: 'idle' | 'submitting' | 'sent' | 'known';
    error: string;
  };
}

interface SurveyRenderOptions {
  landingHref: string;
  /** Where a signed-out visitor goes to sign in, for member-only surveys. */
  signInHref: string;
  brandMark: string;
  form?: string;
}

// One state per form: a visitor may open more than one survey in a session, and
// half-finished answers to one must never appear in another.
const states = new Map<string, SurveyState>();

function stateFor(formId: string): SurveyState {
  const existing = states.get(formId);
  if (existing) return existing;
  const fresh: SurveyState = {
    answers: {},
    submitting: false,
    submitted: false,
    submitError: '',
    errors: {},
    claim: { status: 'idle', error: '' },
  };
  states.set(formId, fresh);
  return fresh;
}

/** The form a path serves, or null when the path names no survey we have. */
export function surveyFormFromPath(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, '');
  if (path === '/survey') return defaultSurveyForm;
  const match = /^\/survey\/([a-z0-9-]+)$/.exec(path);
  if (!match) return null;
  return Object.prototype.hasOwnProperty.call(forms, match[1]) ? match[1] : null;
}

export function surveyPath(formId: string): string {
  return formId === defaultSurveyForm ? '/survey' : `/survey/${formId}`;
}

/** Document title and description for a survey, so each form carries its own. */
export function surveyMeta(formId: string | null): { title: string; description: string } {
  const form = formId && Object.prototype.hasOwnProperty.call(forms, formId)
    ? forms[formId]
    : forms[defaultSurveyForm];
  return { title: form.pageTitle, description: form.pageDescription };
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// A question is asked only while the answer it depends on still allows it. The
// server applies the same rule to the same config, so the two cannot disagree.
function applies(question: SurveyQuestion, answers: Record<string, string>): boolean {
  const condition = question.appliesWhen;
  if (!condition) return true;
  const value = answers[condition.key];
  if (!value) return false;
  if (condition.in && !condition.in.includes(value)) return false;
  if (condition.notIn && condition.notIn.includes(value)) return false;
  return true;
}

function validate(form: SurveyForm, state: SurveyState): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const question of questionsFor(form)) {
    if (!applies(question, state.answers)) continue;
    const value = (state.answers[question.key] || '').trim();
    if (!value) {
      if (!question.optional) errors[question.key] = question.error;
      continue;
    }
    const minLength = question.minLength || 0;
    if (question.kind === 'text' && minLength && value.length < minLength) {
      errors[question.key] = `Add a little more detail — at least ${minLength} characters.`;
    }
  }
  return errors;
}

function optionMarkup(question: SurveyQuestion, selected: string, describedBy: string, invalid: boolean): string {
  return (question.options || [])
    .map(
      ({ value, label }) => `<label class="survey-choice">
        <input type="radio" name="${esc(question.key)}" value="${esc(value)}" ${selected === value ? 'checked' : ''}
          aria-describedby="${describedBy}" ${invalid ? 'aria-invalid="true"' : ''}>
        <span>${esc(label)}</span>
      </label>`
    )
    .join('');
}

function fieldError(id: string, message: string | undefined): string {
  return `<p class="survey-field-error" id="${id}" ${message ? 'role="alert"' : 'hidden'}>${esc(message || '')}</p>`;
}

function questionMarkup(question: SurveyQuestion, index: number, form: SurveyForm, state: SurveyState): string {
  const number = index + 1;
  const noteId = question.note ? `survey-${question.key}-note` : '';
  const errorId = `survey-${question.key}-error`;
  const describedBy = [noteId, errorId].filter(Boolean).join(' ');
  const error = state.errors[question.key];
  const value = state.answers[question.key] || '';
  const skipped = !applies(question, state.answers);
  const disabled = state.submitting || skipped;
  const legend = `<span class="survey-question-number" aria-hidden="true">${number}</span><span>${esc(question.prompt)}</span>`;
  const note = question.note
    ? `<p class="survey-question-note" id="${noteId}">${esc(question.note)}</p>`
    : '';

  if (question.kind === 'text') {
    return `<div class="survey-question survey-text-question" data-question="${esc(question.key)}">
      <label for="survey-field-${esc(question.key)}">${legend}</label>
      <textarea id="survey-field-${esc(question.key)}" name="${esc(question.key)}" rows="${question.rows || 6}"
        ${question.optional ? '' : 'required'}
        maxlength="${question.maxLength || 1200}" aria-describedby="${describedBy}"
        ${error ? 'aria-invalid="true"' : ''} ${disabled ? 'disabled' : ''}
        placeholder="${esc(question.placeholder || '')}">${esc(value)}</textarea>
      ${note}
      ${fieldError(errorId, error)}
    </div>`;
  }

  return `<fieldset class="survey-question" data-question="${esc(question.key)}" ${disabled ? 'disabled' : ''}
    aria-describedby="${describedBy}">
    <legend>${legend}</legend>
    ${note}
    <div class="survey-choice-list">
      ${optionMarkup(question, value, describedBy, Boolean(error))}
    </div>
    ${fieldError(errorId, error)}
  </fieldset>`;
}

function clearFieldError(root: HTMLElement, state: SurveyState, key: string): void {
  if (!state.errors[key]) return;
  delete state.errors[key];
  const error = root.querySelector<HTMLElement>(`#survey-${key}-error`);
  if (error) {
    error.textContent = '';
    error.hidden = true;
    error.removeAttribute('role');
  }
  root
    .querySelectorAll<HTMLElement>(`[name="${key}"]`)
    .forEach((control) => control.removeAttribute('aria-invalid'));
}

// Answering one question can retire another. Toggling the affected fieldsets in
// place keeps the visitor's focus where it is, which a re-render would lose.
function syncConditionalQuestions(form: SurveyForm, state: SurveyState, root: HTMLElement): void {
  for (const question of questionsFor(form)) {
    if (!question.appliesWhen) continue;
    const skipped = !applies(question, state.answers);
    const container = root.querySelector<HTMLElement>(`[data-question="${question.key}"]`);
    if (skipped && state.answers[question.key]) {
      delete state.answers[question.key];
      root
        .querySelectorAll<HTMLInputElement>(`input[name="${question.key}"]`)
        .forEach((radio) => {
          radio.checked = false;
        });
      clearFieldError(root, state, question.key);
    }
    if (container instanceof HTMLFieldSetElement) container.disabled = state.submitting || skipped;
    else if (container) {
      container
        .querySelectorAll<HTMLTextAreaElement>('textarea')
        .forEach((field) => {
          field.disabled = state.submitting || skipped;
        });
    }
  }
}

function safeSubmitError(response: Response): string {
  if (response.status === 429) return 'Too many responses were sent from this connection. Please wait a moment and try again.';
  if (response.status === 401) return 'This survey is for signed-in members. Sign in and try again.';
  if (response.status >= 500) return 'Detour could not save your answers right now. Please try again in a moment.';
  return 'Your answers could not be saved. Check that every question is answered, then try again.';
}

// Every field has a default, so a survey that sets `inviteCta` and nothing else
// still opens a dialog that reads properly.
const CLAIM_COPY: Required<SurveyInviteClaim> = {
  kicker: 'One field',
  title: 'Ask for an invitation.',
  body: 'Your email is all we need to reach you. The team reads every request and replies personally.',
  emailLabel: 'Your email',
  placeholder: 'you@example.com',
  note: '',
  submitLabel: 'Send request',
  submittingLabel: 'Sending…',
  cancelLabel: 'Not now',
  successTitle: 'Request received.',
  successBody: 'This is a request, not membership yet — the team will reply personally.',
  duplicateBody: 'You’ve already asked with this address, so nothing was sent twice. The team will be in touch personally.',
  closeLabel: 'Close',
};

function claimCopy(form: SurveyForm): Required<SurveyInviteClaim> {
  return { ...CLAIM_COPY, ...(form.success.inviteClaim || {}) };
}

function claimSubmitError(response: Response): string {
  if (response.status === 429) return 'Too many requests were sent from this connection. Please wait a moment and try again.';
  if (response.status === 404) return 'This survey is not offering invitations right now.';
  if (response.status >= 500) return 'Detour could not send your request right now. Please try again in a moment.';
  // The route's only other refusal is an address it cannot deliver to.
  return 'Enter an email address in the usual name@example.com format.';
}

/** The dialog's contents once the request is in — the form has nothing left to ask. */
function claimOutcomeMarkup(copy: Required<SurveyInviteClaim>, duplicate: boolean): string {
  return `<p class="survey-kicker">${esc(copy.kicker)}</p>
    <h2 id="survey-claim-title" tabindex="-1">${esc(copy.successTitle)}</h2>
    <p id="survey-claim-body" role="status">${esc(duplicate ? copy.duplicateBody : copy.successBody)}</p>
    <div class="survey-claim-actions">
      <button type="button" class="survey-claim-submit" data-claim-close>${esc(copy.closeLabel)}</button>
    </div>`;
}

// One email, in the browser's modal top layer: someone who has just answered
// four questions anonymously should not meet a second, longer form to say they
// would like in. The home page form still asks for a recommendation — this is
// the low-friction way in, not a replacement for it.
function claimDialogMarkup(form: SurveyForm): string {
  const copy = claimCopy(form);
  const describedBy = ['survey-claim-error', copy.note ? 'survey-claim-note' : '']
    .filter(Boolean)
    .join(' ');
  return `<dialog class="survey-claim-dialog" data-claim-dialog aria-labelledby="survey-claim-title"
    aria-describedby="survey-claim-body">
    <div class="survey-claim-sheet" data-claim-sheet>
      <p class="survey-kicker">${esc(copy.kicker)}</p>
      <h2 id="survey-claim-title" tabindex="-1">${esc(copy.title)}</h2>
      <p id="survey-claim-body">${esc(copy.body)}</p>
      <form class="survey-claim-form" data-claim-form novalidate>
        <label for="survey-claim-email">${esc(copy.emailLabel)}</label>
        <input id="survey-claim-email" name="email" type="email" autocomplete="email" inputmode="email"
          required maxlength="254" placeholder="${esc(copy.placeholder)}" aria-describedby="${describedBy}">
        ${copy.note ? `<p class="survey-claim-note" id="survey-claim-note">${esc(copy.note)}</p>` : ''}
        <p class="survey-claim-error" id="survey-claim-error" hidden></p>
        <div class="survey-claim-actions">
          <button type="submit" class="survey-claim-submit" data-claim-submit>${esc(copy.submitLabel)}</button>
          <button type="button" class="secondary-button" data-claim-cancel>${esc(copy.cancelLabel)}</button>
        </div>
      </form>
    </div>
  </dialog>`;
}

function bindInviteClaim(root: HTMLElement, formId: string, form: SurveyForm, options: SurveyRenderOptions): void {
  const trigger = root.querySelector<HTMLButtonElement>('[data-claim-open]');
  const dialog = root.querySelector<HTMLDialogElement>('[data-claim-dialog]');
  const sheet = dialog?.querySelector<HTMLElement>('[data-claim-sheet]');
  const element = dialog?.querySelector<HTMLFormElement>('[data-claim-form]');
  const input = dialog?.querySelector<HTMLInputElement>('#survey-claim-email');
  const errorLine = dialog?.querySelector<HTMLElement>('#survey-claim-error');
  const submit = dialog?.querySelector<HTMLButtonElement>('[data-claim-submit]');
  if (!trigger || !dialog || !sheet || !element || !input || !errorLine || !submit) return;

  const state = stateFor(formId);
  const copy = claimCopy(form);

  const showError = (message: string): void => {
    state.claim.error = message;
    errorLine.textContent = message;
    errorLine.hidden = !message;
    if (message) {
      errorLine.setAttribute('role', 'alert');
      input.setAttribute('aria-invalid', 'true');
    } else {
      errorLine.removeAttribute('role');
      input.removeAttribute('aria-invalid');
    }
  };

  const close = (): void => {
    if (dialog.open) dialog.close();
  };

  trigger.addEventListener('click', () => {
    if (dialog.open) return;
    dialog.showModal();
    input.focus({ preventScroll: true });
  });

  // Esc, the backdrop, and "not now" are all the same exit.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });
  dialog.querySelector<HTMLButtonElement>('[data-claim-cancel]')?.addEventListener('click', close);

  // Closing a dialog that has already sent the request leaves the confirmation
  // on the page behind it, so the outcome is still there to read — and the
  // offer is not made a second time.
  dialog.addEventListener('close', () => {
    if (state.claim.status !== 'sent' && state.claim.status !== 'known') return;
    renderSurvey(root, options);
    root.querySelector<HTMLElement>('[data-claim-done]')?.focus({ preventScroll: true });
  });

  element.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.claim.status === 'submitting') return;

    const email = input.value.trim();
    if (!email) {
      showError('Enter your email address.');
      input.focus();
      return;
    }
    if (input.validity.typeMismatch) {
      showError('Enter an email address in the usual name@example.com format.');
      input.focus();
      return;
    }

    const restore = (message: string): void => {
      state.claim.status = 'idle';
      input.disabled = false;
      submit.disabled = false;
      submit.textContent = copy.submitLabel;
      showError(message);
      input.focus();
    };

    showError('');
    state.claim.status = 'submitting';
    input.disabled = true;
    submit.disabled = true;
    submit.textContent = copy.submittingLabel;

    try {
      const response = await fetch(
        `${apiBaseUrl.replace(/\/$/, '')}/api/detour/invite-request/${formId}`,
        {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        }
      );
      if (!response.ok) {
        restore(claimSubmitError(response));
        return;
      }
      // An address that had already asked is a different outcome, not a failure:
      // the dialog says which happened rather than claiming a second request.
      const payload = (await response.json().catch(() => ({}))) as { duplicate?: boolean };
      state.claim.status = payload.duplicate ? 'known' : 'sent';
      sheet.innerHTML = claimOutcomeMarkup(copy, Boolean(payload.duplicate));
      sheet.querySelector<HTMLElement>('#survey-claim-title')?.focus({ preventScroll: true });
      sheet.querySelector<HTMLButtonElement>('[data-claim-close]')?.addEventListener('click', close);
    } catch {
      restore('Detour could not send your request. Check your connection and try again.');
    }
  });
}

function bindSurvey(root: HTMLElement, formId: string, form: SurveyForm, options: SurveyRenderOptions): void {
  const element = root.querySelector<HTMLFormElement>('[data-survey-form]');
  if (!element) return;
  const state = stateFor(formId);

  for (const question of questionsFor(form)) {
    if (question.kind === 'single') {
      element.querySelectorAll<HTMLInputElement>(`input[name="${question.key}"]`).forEach((input) => {
        input.addEventListener('change', () => {
          state.answers[question.key] = input.value;
          clearFieldError(element, state, question.key);
          syncConditionalQuestions(form, state, element);
        });
      });
      continue;
    }
    element.querySelector<HTMLTextAreaElement>(`textarea[name="${question.key}"]`)?.addEventListener('input', (event) => {
      state.answers[question.key] = (event.currentTarget as HTMLTextAreaElement).value;
      if (state.answers[question.key].trim()) clearFieldError(element, state, question.key);
    });
  }

  element.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.submitting) return;

    const values = new FormData(element);
    for (const question of questionsFor(form)) {
      state.answers[question.key] = String(values.get(question.key) || '');
    }
    // Neither a skipped question nor an unanswered optional one has anything to
    // send, whatever the field last held: both are stored absent, not empty.
    for (const question of questionsFor(form)) {
      if (!applies(question, state.answers)) delete state.answers[question.key];
      else if (question.optional && !(state.answers[question.key] || '').trim()) {
        delete state.answers[question.key];
      }
    }
    state.errors = validate(form, state);
    state.submitError = '';

    if (Object.keys(state.errors).length) {
      renderSurvey(root, options);
      root.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }

    state.submitting = true;
    renderSurvey(root, options);

    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      };
      if (form.audience === 'member' && pb.authStore.token) headers.Authorization = pb.authStore.token;

      const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/api/detour/survey/${formId}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ answers: state.answers }),
      });

      if (!response.ok) {
        state.submitting = false;
        state.submitError = safeSubmitError(response);
        renderSurvey(root, options);
        root.querySelector<HTMLButtonElement>('[data-survey-submit]')?.focus();
        return;
      }

      state.submitting = false;
      state.submitted = true;
      renderSurvey(root, options);
      root.querySelector<HTMLElement>('#survey-success-title')?.focus();
    } catch {
      state.submitting = false;
      state.submitError = 'Detour could not save your answers. Check your connection and try again.';
      renderSurvey(root, options);
      root.querySelector<HTMLButtonElement>('[data-survey-submit]')?.focus();
    }
  });
}

export function renderSurvey(root: HTMLElement, options: SurveyRenderOptions): void {
  const formId = options.form && Object.prototype.hasOwnProperty.call(forms, options.form)
    ? options.form
    : defaultSurveyForm;
  const form = forms[formId];
  const state = stateFor(formId);
  const masthead = `<header class="survey-masthead">
      <a class="survey-brand" href="${esc(options.landingHref)}" data-landing>${options.brandMark}<span class="brand-word">Detour</span></a>
      <a class="secondary-button survey-home-link" href="${esc(options.landingHref)}" data-landing>Back to Detour</a>
    </header>`;

  if (state.submitted) {
    // Someone who answered anonymously may well want in. A member already is,
    // so the offer is only made to a visitor with no session to speak of.
    const offerInvite = Boolean(form.success.inviteCta) && !pb.authStore.isValid;
    const claimed = state.claim.status === 'sent' || state.claim.status === 'known';
    const copy = claimCopy(form);
    root.innerHTML = `
      <a class="skip-link" href="#survey-success-title">Skip to confirmation</a>
      ${masthead}
      <main class="survey-success" aria-labelledby="survey-success-title">
        <div class="survey-success-mark" aria-hidden="true">✓</div>
        <p class="survey-kicker">${esc(form.success.kicker)}</p>
        <h1 id="survey-success-title" tabindex="-1">${esc(form.success.title)}</h1>
        <p>${esc(form.success.body)}</p>
        ${claimed
          ? `<p class="survey-success-claim-done" data-claim-done tabindex="-1"><strong>${esc(copy.successTitle)}</strong>
              ${esc(state.claim.status === 'known' ? copy.duplicateBody : copy.successBody)}</p>`
          : offerInvite && form.success.inviteLead
            ? `<p class="survey-success-invite-lead">${esc(form.success.inviteLead)}</p>`
            : ''}
        <div class="survey-success-actions">
          ${offerInvite && !claimed
            ? `<button type="button" class="survey-primary-link" data-claim-open>${esc(form.success.inviteCta || '')}</button>
              <a class="secondary-button" href="${esc(options.landingHref)}" data-landing>Return to Detour</a>`
            : `<a class="survey-primary-link" href="${esc(options.landingHref)}" data-landing>Return to Detour</a>`}
        </div>
        ${offerInvite && !claimed ? claimDialogMarkup(form) : ''}
      </main>`;
    if (offerInvite && !claimed) bindInviteClaim(root, formId, form, options);
    return;
  }

  // A member survey records who answered, so there is nothing to submit without
  // a session. Say so before the questions are filled in rather than after.
  const needsSignIn = form.audience === 'member' && !pb.authStore.isValid;
  const body = needsSignIn
    ? `<div class="survey-question">
        <p class="survey-question-note">${esc(form.signedOutNote || 'You need to be signed in to answer this one.')}</p>
        <a class="survey-primary-link" href="${esc(options.signInHref)}">Sign in to Detour</a>
      </div>`
    : `${questionsFor(form).map((question, index) => questionMarkup(question, index, form, state)).join('')}
        <div class="survey-submit-row">
          <p class="survey-submit-note">${esc(form.submitNote)}</p>
          <button type="submit" class="survey-submit" data-survey-submit ${state.submitting ? 'disabled aria-busy="true"' : ''}>
            ${esc(state.submitting ? form.submittingLabel : form.submitLabel)}
          </button>
        </div>
        <p class="survey-submit-error" role="${state.submitError ? 'alert' : 'status'}" aria-live="assertive">${esc(state.submitError)}</p>`;

  root.innerHTML = `
    <a class="skip-link" href="#survey-title">Skip to survey</a>
    ${masthead}
    <main class="survey-layout" aria-labelledby="survey-title">
      <section class="survey-intro">
        <p class="survey-kicker">${esc(form.kicker)}</p>
        <h1 id="survey-title">${esc(form.title)}</h1>
        <p>${esc(form.intro)}</p>
        <p class="survey-privacy-note">${esc(form.privacyNote)}</p>
      </section>
      <form class="survey-form" data-survey-form novalidate>
        ${body}
      </form>
    </main>`;

  if (!needsSignIn) bindSurvey(root, formId, form, options);
}
