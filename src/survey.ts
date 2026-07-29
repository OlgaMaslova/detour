import { apiBaseUrl } from './pocketbase';

type DiscoverySource = 'friends' | 'food-people' | 'social' | 'reviews' | 'other' | '';
type CircleInterest = 'yes' | 'maybe' | 'no' | '';
type SurveyField = 'discoverySource' | 'circleInterest' | 'recommendationMotivation';

interface SurveyState {
  discoverySource: DiscoverySource;
  circleInterest: CircleInterest;
  recommendationMotivation: string;
  submitting: boolean;
  submitted: boolean;
  submitError: string;
  errors: Partial<Record<SurveyField, string>>;
}

interface SurveyRenderOptions {
  homeHref: string;
  brandMark: string;
}

const state: SurveyState = {
  discoverySource: '',
  circleInterest: '',
  recommendationMotivation: '',
  submitting: false,
  submitted: false,
  submitError: '',
  errors: {},
};

const discoveryOptions: Array<{ value: Exclude<DiscoverySource, ''>; label: string }> = [
  { value: 'friends', label: 'Friends whose taste I trust' },
  { value: 'food-people', label: 'Food people I follow' },
  { value: 'social', label: 'Social media' },
  { value: 'reviews', label: 'Reviews and maps' },
  { value: 'other', label: 'Somewhere else' },
];

const circleOptions: Array<{ value: Exclude<CircleInterest, ''>; label: string }> = [
  { value: 'yes', label: 'Yes' },
  { value: 'maybe', label: 'Maybe' },
  { value: 'no', label: 'No' },
];

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function validate(): Partial<Record<SurveyField, string>> {
  const errors: Partial<Record<SurveyField, string>> = {};
  if (!state.discoverySource) errors.discoverySource = 'Choose where you most often find food-and-drink destinations worth the detour.';
  if (!state.circleInterest) errors.circleInterest = 'Choose yes, maybe, or no.';
  const motivation = state.recommendationMotivation.trim();
  if (!motivation) {
    errors.recommendationMotivation = 'Tell us what would make sharing a recommendation feel worthwhile.';
  } else if (motivation.length < 8) {
    errors.recommendationMotivation = 'Add a little more detail — at least 8 characters.';
  }
  return errors;
}

function optionMarkup(
  name: string,
  options: Array<{ value: string; label: string }>,
  selected: string,
  describedBy: string,
  invalid: boolean
): string {
  return options
    .map(
      ({ value, label }) => `<label class="survey-choice">
        <input type="radio" name="${name}" value="${value}" ${selected === value ? 'checked' : ''}
          aria-describedby="${describedBy}" ${invalid ? 'aria-invalid="true"' : ''}>
        <span>${label}</span>
      </label>`
    )
    .join('');
}

function fieldError(id: string, message: string | undefined): string {
  return `<p class="survey-field-error" id="${id}" ${message ? 'role="alert"' : 'hidden'}>${esc(message || '')}</p>`;
}

function clearFieldError(form: HTMLFormElement, field: SurveyField): void {
  if (!state.errors[field]) return;
  delete state.errors[field];
  const errorId = `survey-${field}-error`;
  const error = form.querySelector<HTMLElement>(`#${errorId}`);
  if (error) {
    error.textContent = '';
    error.hidden = true;
    error.removeAttribute('role');
  }
  const selector = field === 'recommendationMotivation'
    ? 'textarea[name="recommendationMotivation"]'
    : `input[name="${field}"]`;
  form.querySelectorAll<HTMLElement>(selector).forEach((control) => control.removeAttribute('aria-invalid'));
}

function safeSubmitError(response: Response): string {
  if (response.status === 429) return 'Too many responses were sent from this connection. Please wait a moment and try again.';
  if (response.status >= 500) return 'Detour could not save your feedback right now. Please try again in a moment.';
  return 'Your feedback could not be saved. Check that every question is answered, then try again.';
}

function bindSurvey(root: HTMLElement, options: SurveyRenderOptions): void {
  const form = root.querySelector<HTMLFormElement>('[data-founding-survey]');
  if (!form) return;

  form.querySelectorAll<HTMLInputElement>('input[name="discoverySource"]').forEach((input) => {
    input.addEventListener('change', () => {
      state.discoverySource = input.value as DiscoverySource;
      clearFieldError(form, 'discoverySource');
    });
  });
  form.querySelectorAll<HTMLInputElement>('input[name="circleInterest"]').forEach((input) => {
    input.addEventListener('change', () => {
      state.circleInterest = input.value as CircleInterest;
      clearFieldError(form, 'circleInterest');
    });
  });
  form.querySelector<HTMLTextAreaElement>('textarea[name="recommendationMotivation"]')?.addEventListener('input', (event) => {
    state.recommendationMotivation = (event.currentTarget as HTMLTextAreaElement).value;
    if (state.recommendationMotivation.trim()) clearFieldError(form, 'recommendationMotivation');
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.submitting) return;

    const values = new FormData(form);
    state.discoverySource = String(values.get('discoverySource') || '') as DiscoverySource;
    state.circleInterest = String(values.get('circleInterest') || '') as CircleInterest;
    state.recommendationMotivation = String(values.get('recommendationMotivation') || '');
    state.errors = validate();
    state.submitError = '';

    if (Object.keys(state.errors).length) {
      renderFoundingSurvey(root, options);
      const firstInvalid = root.querySelector<HTMLElement>('[aria-invalid="true"]');
      firstInvalid?.focus();
      return;
    }

    state.submitting = true;
    renderFoundingSurvey(root, options);

    try {
      const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/api/detour/founding-feedback`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          discovery_source: state.discoverySource,
          circle_interest: state.circleInterest,
          value_needed: state.recommendationMotivation.trim(),
        }),
      });

      if (!response.ok) {
        state.submitting = false;
        state.submitError = safeSubmitError(response);
        renderFoundingSurvey(root, options);
        root.querySelector<HTMLButtonElement>('[data-survey-submit]')?.focus();
        return;
      }

      state.submitting = false;
      state.submitted = true;
      renderFoundingSurvey(root, options);
      root.querySelector<HTMLElement>('#survey-success-title')?.focus();
    } catch {
      state.submitting = false;
      state.submitError = 'Detour could not save your feedback. Check your connection and try again.';
      renderFoundingSurvey(root, options);
      root.querySelector<HTMLButtonElement>('[data-survey-submit]')?.focus();
    }
  });
}

export function renderFoundingSurvey(root: HTMLElement, options: SurveyRenderOptions): void {
  if (state.submitted) {
    root.innerHTML = `
      <a class="skip-link" href="#survey-success-title">Skip to confirmation</a>
      <header class="survey-masthead">
        <a class="survey-brand" href="${esc(options.homeHref)}" data-home>${options.brandMark}<span>Detour</span></a>
        <a class="secondary-button survey-home-link" href="${esc(options.homeHref)}" data-home>Back to Detour</a>
      </header>
      <main class="survey-success" aria-labelledby="survey-success-title">
        <div class="survey-success-mark" aria-hidden="true">✓</div>
        <p class="survey-kicker">Feedback received</p>
        <h1 id="survey-success-title" tabindex="-1">Thank you for helping shape Detour.</h1>
        <p>Your answers are in. They’ll help us build food-and-drink discovery around trusted taste, not more noise.</p>
        <a class="survey-primary-link" href="${esc(options.homeHref)}" data-home>Return to Detour</a>
      </main>`;
    return;
  }

  const discoveryError = state.errors.discoverySource;
  const circleError = state.errors.circleInterest;
  const motivationError = state.errors.recommendationMotivation;

  root.innerHTML = `
    <a class="skip-link" href="#survey-title">Skip to survey</a>
    <header class="survey-masthead">
      <a class="survey-brand" href="${esc(options.homeHref)}" data-home>${options.brandMark}<span>Detour</span></a>
      <a class="secondary-button survey-home-link" href="${esc(options.homeHref)}" data-home>Back to Detour</a>
    </header>
    <main class="survey-layout" aria-labelledby="survey-title">
      <section class="survey-intro">
        <p class="survey-kicker">Founding feedback</p>
        <h1 id="survey-title">Good taste should travel.</h1>
        <p>Three quick questions about how you discover restaurants, cafés, bars, and other food-and-drink destinations, and what would make a trusted circle useful.</p>
        <p class="survey-privacy-note">Anonymous by design. No account, name, or email.</p>
      </section>
      <form class="survey-form" data-founding-survey novalidate>
        <fieldset class="survey-question" ${state.submitting ? 'disabled' : ''} aria-describedby="survey-discoverySource-note survey-discoverySource-error">
          <legend><span class="survey-question-number" aria-hidden="true">1</span><span>Where do you usually find restaurants, cafés, bars, and other food-and-drink destinations worth going out of your way for?</span></legend>
          <p class="survey-question-note" id="survey-discoverySource-note">Choose the one that is most true for you.</p>
          <div class="survey-choice-list">
            ${optionMarkup('discoverySource', discoveryOptions, state.discoverySource, 'survey-discoverySource-note survey-discoverySource-error', Boolean(discoveryError))}
          </div>
          ${fieldError('survey-discoverySource-error', discoveryError)}
        </fieldset>

        <fieldset class="survey-question" ${state.submitting ? 'disabled' : ''} aria-describedby="survey-circleInterest-error">
          <legend><span class="survey-question-number" aria-hidden="true">2</span><span>Would you use a private circle of people whose taste you trust to discover somewhere to eat or drink?</span></legend>
          <div class="survey-choice-list survey-choice-list-compact">
            ${optionMarkup('circleInterest', circleOptions, state.circleInterest, 'survey-circleInterest-error', Boolean(circleError))}
          </div>
          ${fieldError('survey-circleInterest-error', circleError)}
        </fieldset>

        <div class="survey-question survey-text-question">
          <label for="recommendation-motivation"><span class="survey-question-number" aria-hidden="true">3</span><span>What would make you want to add your own food-and-drink recommendations?</span></label>
          <textarea id="recommendation-motivation" name="recommendationMotivation" rows="6" required maxlength="1200"
            aria-describedby="survey-recommendationMotivation-note survey-recommendationMotivation-error"
            ${motivationError ? 'aria-invalid="true"' : ''} ${state.submitting ? 'disabled' : ''}
            placeholder="For example: knowing who will see them, keeping a personal list, or helping friends find somewhere memorable to eat or drink.">${esc(state.recommendationMotivation)}</textarea>
          <p class="survey-question-note" id="survey-recommendationMotivation-note">A sentence or two is plenty.</p>
          ${fieldError('survey-recommendationMotivation-error', motivationError)}
        </div>

        <div class="survey-submit-row">
          <p class="survey-submit-note">All three answers are required.</p>
          <button type="submit" class="survey-submit" data-survey-submit ${state.submitting ? 'disabled aria-busy="true"' : ''}>
            ${state.submitting ? 'Sending feedback…' : 'Send anonymous feedback'}
          </button>
        </div>
        <p class="survey-submit-error" role="${state.submitError ? 'alert' : 'status'}" aria-live="assertive">${esc(state.submitError)}</p>
      </form>
    </main>`;

  bindSurvey(root, options);
}
