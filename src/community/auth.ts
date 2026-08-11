import { pb } from '../pocketbase';
import { getTokenPayload, isTokenExpired } from 'pocketbase';
import { esc, member, noticeMarkup, readableError, resetCommunityState, store } from './store';

/**
 * The three doors into Detour.
 *
 * `sign-in` for an account that exists. `sign-up` is the open one — no code, no
 * queue, and it starts a circle rather than joining one. `join` spends an
 * invitation and puts the new member inside the issuer's circle.
 *
 * The two signup doors differ in exactly one field, and it is the one that
 * matters: the invitation code, which is the graph edge. Everything else about
 * the account is identical, which is why one submit path serves both.
 *
 * `forgot` and `reset` are the two halves of the way back in when the password is
 * gone: the first asks for the email and sends the link, the second is what that
 * link opens. They are modes of the same card rather than pages of their own
 * because a member who cannot get in is looking at this card already, and the way
 * out of either one is the sign-in tab that is right there.
 */
type CommunityMode = 'sign-in' | 'sign-up' | 'join' | 'forgot' | 'reset';
let mode: CommunityMode = 'sign-in';
let invitationCodePrefill = '';
/**
 * What has been typed into the invitation card.
 *
 * The card asks for everything the server needs to write the account — the join
 * happens here now rather than over two screens — and any one of the five values
 * can come back refused: a code already claimed, a pseudo already taken. Every
 * refusal renders a notice, and a render rebuilds the panel's markup, so values
 * held only in the DOM would be wiped by the very message asking the member to
 * correct one of them.
 *
 * The password rides along for the same reason, but is refilled by bindCommunity
 * rather than written into the markup, so it never becomes a value attribute.
 */
const joinDraft = { email: '', password: '', pseudo: '', city: '' };
let routedInvitationCode: string | null = null;
/**
 * The email address on the sign-in card, kept for the same reason joinDraft is:
 * a refused sign-in renders a notice, and the render would otherwise wipe the
 * address along with the password the member got wrong.
 *
 * It is also the handover to the Forgot card. Somebody whose password has just
 * been refused has already typed the address the reset link has to go to, and
 * asking for it a second line down would read as a different question.
 */
let signInEmailDraft = '';
/**
 * The password-reset token from the emailed link, or null when this visit did not
 * arrive on one. Set from the route before the panel renders, like an invitation
 * code, and dropped from the URL as soon as it is spent or abandoned — it is a
 * credential, and it has no business in browser history or a shared link.
 */
let routedResetToken: string | null = null;
/**
 * Whether the reset email has just been sent. The Forgot card is done at that
 * point: the next step is in the member's inbox, and leaving the form up invites
 * a second send that only mints a second token and buys nothing.
 */
let resetEmailSent = false;
/**
 * The same normalization the server applies in pb_hooks/member_profile.js:
 * decompose accents away, drop the leading @, lowercase. Applying it here means
 * "Café-Anna" is accepted rather than refused for characters the server would
 * have folded anyway.
 */
function normalizePseudo(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase();
}

function resetJoinDraft(): void {
  joinDraft.email = '';
  joinDraft.password = '';
  joinDraft.pseudo = '';
  joinDraft.city = '';
}

function clearInvitationRoute(): void {
  invitationCodePrefill = '';
  routedInvitationCode = null;
  const url = new URL(window.location.href);
  if (!url.searchParams.has('invite')) return;
  url.searchParams.delete('invite');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

/**
 * Forget the reset token, and take it off the address bar.
 *
 * Called when the token has been spent and when the member walks away from the
 * card, which are the same requirement: a token in the URL is a credential
 * sitting in history, in the tab title's share sheet, and in whatever the member
 * pastes next. It stays exactly as long as the card that needs it.
 */
function clearPasswordResetRoute(): void {
  routedResetToken = null;
  const url = new URL(window.location.href);
  if (!url.searchParams.has('reset')) return;
  url.searchParams.delete('reset');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

/**
 * The address a reset token was minted for, or '' when the token does not say.
 *
 * PocketBase's confirm call hands back no session — it only changes the password —
 * so signing the member in afterwards needs an identity, and the only one on hand
 * is the claim inside the token they arrived with. Read defensively: a token this
 * function cannot make sense of costs the automatic sign-in, not the reset.
 */
function emailFromResetToken(token: string): string {
  try {
    const email = getTokenPayload(token).email;
    return typeof email === 'string' ? email.trim() : '';
  } catch {
    return '';
  }
}

/**
 * The account fields both signup doors ask for, in the same order and with the
 * same rules. Written once so the open form and the invitation card cannot drift
 * into asking for a pseudo two different ways.
 */
function accountFieldsMarkup(): string {
  return `<label>Email address<input name="email" type="email" value="${esc(joinDraft.email)}" autocomplete="email" required ${store.submitting ? 'disabled' : ''}></label>
    <label>Password<input name="password" type="password" autocomplete="new-password" minlength="8" required ${store.submitting ? 'disabled' : ''}></label>
    <p class="community-form-note">Eight characters or more. This is how you sign in from now on.</p>
    <label>Your pseudo<input name="pseudo" value="${esc(joinDraft.pseudo)}" autocomplete="off" spellcheck="false" minlength="3" maxlength="30"
      pattern="@?[a-zA-Z0-9][a-zA-Z0-9-]{1,28}[a-zA-Z0-9]" title="3-30 characters: letters, digits, and hyphens"
      required placeholder="anna-lisboa" ${store.submitting ? 'disabled' : ''}></label>
    <label>Where you live<input name="home_city" value="${esc(joinDraft.city)}" autocomplete="address-level2" minlength="2" maxlength="120"
      required placeholder="San Francisco" ${store.submitting ? 'disabled' : ''}></label>
    <p class="community-form-note">Your pseudo is your name on Detour. Your city is where the circle sees you recommending from.</p>`;
}

export function signedOutPanel(): string {
  const isJoin = mode === 'join';
  const isSignUp = mode === 'sign-up';
  const isForgot = mode === 'forgot';
  const isReset = mode === 'reset';
  // A token that is missing, malformed or past its half hour cannot be spent, and
  // saying so before the member types a new password twice is the whole
  // difference between one wasted minute and two.
  const resetTokenUsable = Boolean(routedResetToken) && !isTokenExpired(routedResetToken || '');
  const heading = isJoin
    ? 'Join with your personal invitation.'
    : isSignUp
      ? 'Start your circle.'
      : isForgot
        ? 'Forgotten your password?'
        : isReset
          ? 'Choose a new password.'
          : 'Return to your Detour.';
  const lead = isJoin
    ? 'Everything your account needs, on one card. Then the first place you would send someone to.'
    : isSignUp
      ? 'Four things, no invitation, no waiting. You start with the founding members’ places, and the circle you build from there is your own.'
      : isForgot
        ? 'Give us the address you signed up with and we will email you a link to set a new one.'
        : isReset
          ? 'Eight characters or more, and it signs you in as soon as it is saved.'
          : 'Sign in to your member account.';
  const tab = (value: CommunityMode, label: string): string =>
    `<button class="community-tab ${mode === value ? 'is-active' : ''}" type="button" role="tab" aria-selected="${
      mode === value
    }" data-community-mode="${value}">${label}</button>`;
  return `<section class="community-panel community-panel-auth" aria-label="Detour membership">
    <div class="community-panel-intro">
      <p class="community-kicker">The detourist circle</p>
      <h2>${heading}</h2>
      <p>${lead}</p>
    </div>
    <div class="community-form-wrap">
      <div class="community-tabs" role="tablist" aria-label="Membership options">
        ${tab('sign-in', 'Sign in')}${tab('sign-up', 'Start your circle')}${tab('join', 'Use an invitation')}
      </div>
      ${noticeMarkup()}
      ${
        isJoin
          ? `<form class="community-form" data-community-join>
              ${accountFieldsMarkup()}
              <label>Invitation code<input name="invite_code" value="${esc(invitationCodePrefill)}" autocomplete="off" spellcheck="false" maxlength="80" placeholder="DTR-…" required ${store.submitting ? 'disabled' : ''}></label>
              <button class="primary-button" type="submit" ${store.submitting ? 'disabled' : ''}>${store.submitting ? 'Joining…' : 'Join Detour'}</button>
              <p class="community-form-note">Next: the first place you would send someone to.</p>
            </form>`
          : isSignUp
            ? `<form class="community-form" data-community-sign-up>
              ${accountFieldsMarkup()}
              <button class="primary-button" type="submit" ${store.submitting ? 'disabled' : ''}>${store.submitting ? 'Creating your account…' : 'Start your circle'}</button>
              <p class="community-form-note">You read Detour's founding members from the start. Everything you write reaches the people you invite — nobody else.</p>
              <p class="community-form-note">Next: the first place you would send someone to.</p>
            </form>`
          : isForgot
            ? resetEmailSent
              // The form has done its job, and the next step is in the member's
              // inbox. The same button again would be the wrong offer as well as a
              // redundant one: the server sends nothing at all for two minutes
              // after a link goes out, and a form that answers "sent!" while
              // sending nothing is worse than no form.
              ? `<div class="community-form">
              <p class="community-form-note">The link is good for thirty minutes. If it has not arrived, check the spam folder — a second attempt in the next couple of minutes sends nothing.</p>
              <button class="secondary-button" type="button" data-community-mode="sign-in">Back to sign in</button>
            </div>`
              : `<form class="community-form" data-community-forgot>
              <label>Email address<input name="email" type="email" value="${esc(signInEmailDraft)}" autocomplete="email" required ${store.submitting ? 'disabled' : ''}></label>
              <button class="primary-button" type="submit" ${store.submitting ? 'disabled' : ''}>${store.submitting ? 'Sending…' : 'Email me a reset link'}</button>
              <p class="community-form-note">The link lets you choose a new password. It is good for thirty minutes, and nothing changes until you use it.</p>
            </form>`
          : isReset
            ? resetTokenUsable
              ? `<form class="community-form" data-community-reset>
              <label>New password<input name="password" type="password" autocomplete="new-password" minlength="8" required ${store.submitting ? 'disabled' : ''}></label>
              <label>Repeat it<input name="passwordConfirm" type="password" autocomplete="new-password" minlength="8" required ${store.submitting ? 'disabled' : ''}></label>
              <button class="primary-button" type="submit" ${store.submitting ? 'disabled' : ''}>${store.submitting ? 'Saving…' : 'Set my new password'}</button>
              <p class="community-form-note">Saving it signs you in here and signs out anywhere else you were still signed in.</p>
            </form>`
              : `<div class="community-form">
              <p class="community-form-note">That reset link has expired or been used already. Links last thirty minutes; asking for another takes a moment.</p>
              <button class="secondary-button" type="button" data-community-mode="forgot">Ask for a new link</button>
            </div>`
          : `<form class="community-form" data-community-sign-in>
              <label>Email address<input name="email" type="email" value="${esc(signInEmailDraft)}" autocomplete="email" required></label>
              <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
              <button class="primary-button" type="submit" ${store.submitting ? 'disabled' : ''}>${store.submitting ? 'Signing in…' : 'Sign in'}</button>
              <p class="community-form-note">Forgotten it? <button class="community-form-link" type="button" data-community-mode="forgot">Email me a reset link</button></p>
              <p class="community-form-note">New here? Start your circle, or use an invitation if somebody sent you one.</p>
            </form>`
      }
    </div>
  </section>`;
}
/** Apply invitation-link route state before the member area renders. */
export function applyInvitationRoute(code: string | null): void {
  const nextCode = code?.trim() || null;
  if (nextCode === routedInvitationCode) return;
  const leavingInvitationRoute = routedInvitationCode !== null && nextCode === null;
  routedInvitationCode = nextCode;
  invitationCodePrefill = nextCode || '';
  if (nextCode) mode = 'join';
  else if (leavingInvitationRoute) mode = 'sign-in';
}

/**
 * Apply reset-link route state before the panel renders.
 *
 * The token is the only thing that opens the reset card, so the route sets the
 * mode as well — a member arriving from their inbox has one thing to do and
 * should not have to find the card that does it. Leaving the route puts them back
 * on sign-in, the same way an abandoned invitation does.
 */
export function applyPasswordResetRoute(token: string | null): void {
  const nextToken = token?.trim() || null;
  if (nextToken === routedResetToken) return;
  const leavingResetRoute = routedResetToken !== null && nextToken === null;
  routedResetToken = nextToken;
  if (nextToken) {
    mode = 'reset';
    // A fresh link supersedes whatever the Forgot card was last saying, including
    // its "check your inbox" state — the inbox has been checked.
    resetEmailSent = false;
    store.notice = null;
  } else if (leavingResetRoute) {
    mode = 'sign-in';
  }
}

/**
 * Whether this visit is here to set a password. The reset card belongs to the
 * signed-out panel, and a member who still has a valid session in this browser
 * would otherwise be shown the member area and never see it — clicking a reset
 * link is a clear statement that the password needs changing, session or not.
 */
export function passwordResetRouted(): boolean {
  return routedResetToken !== null;
}
/**
 * Open the account page on the open-signup card, for the "Start your circle"
 * calls to action a visitor meets around the app.
 *
 * A no-op for somebody already signed in: the signed-out panel is not what they
 * would be looking at, and setting a mode behind a page they cannot see would
 * decide which card greets them the next time they sign out.
 */
export function openSignUp(): void {
  if (member()) return;
  mode = 'sign-up';
  clearInvitationRoute();
  store.notice = null;
}


/** The signed-out card another module needs to point at — see settings' account removal. */
export function setCommunityMode(next: CommunityMode): void {
  mode = next;
}

export function bindAuth(
  root: HTMLElement,
  render: () => void,
  onAuthed: () => void,
  /** A joined-and-signed-in member: opens the new-member flow at its first place. */
  onJoined: () => void
): void {
  root.querySelectorAll<HTMLButtonElement>('[data-community-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      const requested = button.dataset.communityMode;
      mode =
        requested === 'join'
          ? 'join'
          : requested === 'sign-up'
            ? 'sign-up'
            : requested === 'forgot'
              ? 'forgot'
              : 'sign-in';
      // Leaving the invitation card drops the code with it. A code left prefilled
      // behind the open form would be spent by a member who chose not to use it.
      if (mode !== 'join') clearInvitationRoute();
      // Same rule for the reset token, which is a credential rather than a
      // prefill — and unconditional, because no tab on this strip is the reset
      // card: the emailed link is the only thing that opens it, so every one of
      // these buttons is a member walking away from it.
      clearPasswordResetRoute();
      // Asked for afresh, the Forgot card is a form again rather than the "check
      // your inbox" note the last send left behind.
      if (mode === 'forgot') resetEmailSent = false;
      store.notice = null;
      render();
    });
  });

  // Both signup cards keep their answers through the render a refusal causes —
  // see `joinDraft`. The password is put back by hand rather than through the
  // markup, so it is never written into a value attribute.
  const signupForm = root.querySelector<HTMLFormElement>(
    '[data-community-join], [data-community-sign-up]'
  );
  if (signupForm) {
    const passwordField = signupForm.querySelector<HTMLInputElement>('input[name="password"]');
    if (passwordField && joinDraft.password) passwordField.value = joinDraft.password;
    signupForm.querySelectorAll<HTMLInputElement>('input').forEach((field) => {
      field.addEventListener('input', () => {
        if (field.name === 'email') joinDraft.email = field.value;
        else if (field.name === 'password') joinDraft.password = field.value;
        else if (field.name === 'pseudo') joinDraft.pseudo = field.value;
        else if (field.name === 'home_city') joinDraft.city = field.value;
        else if (field.name === 'invite_code') invitationCodePrefill = field.value;
      });
    });
  }

  // The sign-in card and the Forgot card ask for the same address, and a member
  // who has just been refused is about to be asked for it again. Held as it is
  // typed so the handover between the two cards carries it either way round.
  root
    .querySelector<HTMLInputElement>(
      '[data-community-sign-in] input[name="email"], [data-community-forgot] input[name="email"]'
    )
    ?.addEventListener('input', (event) => {
      signInEmailDraft = (event.currentTarget as HTMLInputElement).value;
    });
  // Either signup card is the whole account: the server requires a pseudo and a
  // home city on every public signup, and asking for them here rather than on a
  // second screen means one form holds everything one create call needs. What
  // src/onboarding.ts is left with is the part that is not the account — the first
  // place — which is why this hands over a session rather than a set of answers.
  //
  // ONE HANDLER FOR BOTH DOORS. The open card and the invitation card differ by a
  // single field, and it is the graph edge: with a code the new member lands
  // inside the issuer's circle, without one they start their own. Everything else
  // — the validation, the create call, the sign-in that follows, the recovery when
  // one of those fails — is identical, and a second copy of it would be the place
  // the two quietly stopped agreeing about what a pseudo is.
  const submitSignup = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();
    if (store.submitting) return;
    const form = event.currentTarget as HTMLFormElement;
    const withInvitation = form.hasAttribute('data-community-join');
    const values = new FormData(form);
    const email = String(values.get('email') || '').trim();
    const password = String(values.get('password') || '');
    const inviteCode = String(values.get('invite_code') || '').trim().toUpperCase();
    const pseudo = normalizePseudo(String(values.get('pseudo') || ''));
    const city = String(values.get('home_city') || '').trim();
    joinDraft.email = email;
    joinDraft.password = password;
    joinDraft.pseudo = pseudo;
    joinDraft.city = city;
    if (withInvitation) invitationCodePrefill = inviteCode;
    if (!email || (withInvitation && !inviteCode)) {
      store.notice = {
        kind: 'error',
        text: withInvitation
          ? 'Your email address and your invitation code are both needed.'
          : 'Your email address is needed.',
      };
      render();
      return;
    }
    if (password.length < 8) {
      store.notice = { kind: 'error', text: 'Use a password of at least eight characters.' };
      render();
      return;
    }
    if (pseudo.length < 3) {
      store.notice = { kind: 'error', text: 'Pick a pseudo of at least three characters.' };
      render();
      return;
    }
    // The input's `pattern` is advisory only — a browser that runs it refuses
    // before this handler, and one that does not would otherwise send a pseudo
    // with a space or a dot to the server and get back a 400 from the same catch
    // that reports a spent invitation, so the refusal would read as an
    // invitation problem. Applying the server's own rule states the real one.
    if (!/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(pseudo)) {
      store.notice = {
        kind: 'error',
        text: 'A pseudo is letters, digits and hyphens only — no spaces — starting and ending with a letter or digit.',
      };
      render();
      return;
    }
    // `required` lets a space through, and the city is asked for real.
    if (city.length < 2) {
      store.notice = { kind: 'error', text: 'Tell us the city you live in.' };
      render();
      return;
    }
    store.submitting = true;
    store.notice = null;
    render();
    try {
      await pb.collection('members').create({
        pseudo,
        email,
        password,
        passwordConfirm: password,
        home_city: city,
        // Absent on the open card, and the server reads that absence as "start a
        // circle" rather than as a missing field.
        invite_code: withInvitation ? inviteCode : '',
      });
    } catch (error) {
      // The invitation is spent here, so an invalid or already-claimed code
      // surfaces here too. Saying which of the values the server refused is the
      // whole of the recovery: every one of them can be corrected in place.
      store.submitting = false;
      store.notice = {
        kind: 'error',
        text: readableError(
          error,
          withInvitation
            ? 'That invitation could not be accepted. Check the code on your invitation and try again.'
            : 'That account could not be created. Check the details above and try again.'
        ),
      };
      render();
      return;
    }
    try {
      await pb.collection('members').authWithPassword(email, password);
    } catch {
      // The account exists; only the session does not. The sign-in tab is the
      // shortest way to one, and an invitation given here has been spent, so
      // there is nothing left on this card to come back to.
      store.submitting = false;
      mode = 'sign-in';
      resetJoinDraft();
      clearInvitationRoute();
      store.notice = {
        kind: 'error',
        text: 'Your account was created, but signing in did not go through. Sign in with the email and password you just chose.',
      };
      render();
      return;
    }
    store.submitting = false;
    resetJoinDraft();
    clearInvitationRoute();
    store.notice = null;
    resetCommunityState();
    onJoined();
  };

  root.querySelector<HTMLFormElement>('[data-community-join]')?.addEventListener('submit', submitSignup);
  root
    .querySelector<HTMLFormElement>('[data-community-sign-up]')
    ?.addEventListener('submit', submitSignup);

  root.querySelector<HTMLFormElement>('[data-community-sign-in]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget as HTMLFormElement);
    const email = String(values.get('email') || '').trim();
    // Kept before the attempt, so the refusal's own render puts the address back —
    // and so the Forgot card opens with it already filled in.
    signInEmailDraft = email;
    store.submitting = true;
    store.notice = null;
    render();
    try {
      await pb.collection('members').authWithPassword(email, String(values.get('password') || ''));
      store.submitting = false;
      signInEmailDraft = '';
      resetCommunityState();
      store.notice = null;
      onAuthed();
    } catch (error) {
      store.submitting = false;
      store.notice = { kind: 'error', text: readableError(error, 'Those sign-in details were not recognised.') };
      render();
    }
  });

  // Nothing here says whether the address has an account: PocketBase answers this
  // call the same way either way, and repeating that on the card is the point —
  // the form must not become a way to ask Detour who is a member.
  root.querySelector<HTMLFormElement>('[data-community-forgot]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (store.submitting) return;
    const values = new FormData(event.currentTarget as HTMLFormElement);
    const email = String(values.get('email') || '').trim();
    signInEmailDraft = email;
    if (!email) {
      store.notice = { kind: 'error', text: 'Your email address is needed.' };
      render();
      return;
    }
    store.submitting = true;
    store.notice = null;
    render();
    try {
      await pb.collection('members').requestPasswordReset(email);
    } catch (error) {
      // A refusal here is about the request, not the account: an address the
      // server will not accept as one, or the network. The send itself happens
      // after the answer and cannot fail this call, which is also why a member
      // whose address has no account is told exactly what one who has is told.
      store.submitting = false;
      store.notice = {
        kind: 'error',
        text: readableError(error, 'That link could not be sent just now. Please try again in a minute.'),
      };
      render();
      return;
    }
    store.submitting = false;
    resetEmailSent = true;
    store.notice = { kind: 'success', text: `If ${email} has a Detour account, a reset link is on its way to it.` };
    render();
  });

  root.querySelector<HTMLFormElement>('[data-community-reset]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (store.submitting) return;
    const token = routedResetToken || '';
    const values = new FormData(event.currentTarget as HTMLFormElement);
    const password = String(values.get('password') || '');
    const passwordConfirm = String(values.get('passwordConfirm') || '');
    if (!token) {
      // Only reachable if the token went away between render and submit. There is
      // nothing on this card to correct, so it hands over to the card that mints
      // a new link rather than leaving a dead form up.
      mode = 'forgot';
      resetEmailSent = false;
      store.notice = { kind: 'error', text: 'That reset link is no longer open. Ask for a new one and try again.' };
      render();
      return;
    }
    if (password.length < 8) {
      store.notice = { kind: 'error', text: 'Use a password of at least eight characters.' };
      render();
      return;
    }
    // Checked here as well as by the server, because the server's answer to this
    // one is a 400 that reads like a problem with the link.
    if (password !== passwordConfirm) {
      store.notice = { kind: 'error', text: 'Those two passwords are not the same.' };
      render();
      return;
    }
    store.submitting = true;
    store.notice = null;
    render();
    try {
      await pb.collection('members').confirmPasswordReset(token, password, passwordConfirm);
    } catch (error) {
      store.submitting = false;
      // The server refuses a spent or expired token as a problem with the `token`
      // field, which is nothing the form can fix. Dropping it turns the card into
      // its own dead-end state — the same one an expired link lands on, with the
      // button that mints a fresh one — rather than leaving a password form up in
      // front of a link that will refuse it again.
      const tokenRefused = Boolean(
        (error as { response?: { data?: { token?: unknown } } })?.response?.data?.token
      );
      if (tokenRefused) clearPasswordResetRoute();
      store.notice = {
        kind: 'error',
        text: tokenRefused
          ? 'That reset link has expired or been used already. Ask for a new one and try again.'
          : readableError(error, 'That password could not be saved. Please try again.'),
      };
      render();
      return;
    }
    // The password has changed, which spends the token and kills every session
    // that predates it — including one this browser may still be holding. Both go
    // before anything else: what follows either mints a new session or shows the
    // sign-in card, and neither may run with the old one still in the store.
    //
    // The card becomes the sign-in card first, and on purpose. Clearing the store
    // renders synchronously (main.ts watches the auth store), and a reset card
    // whose token has just gone would draw that frame as "this link has expired" —
    // the one thing that did not happen.
    const email = emailFromResetToken(token);
    mode = 'sign-in';
    signInEmailDraft = email;
    clearPasswordResetRoute();
    resetCommunityState();
    pb.authStore.clear();
    try {
      // The token names who it was for, so the member does not have to type the
      // address again to use the password they just chose.
      if (!email) throw new Error('The reset link does not say which account it is for.');
      await pb.collection('members').authWithPassword(email, password);
    } catch {
      // The password is changed either way — this is only the session. The
      // sign-in card is the shortest way to one, with the address already in it.
      store.submitting = false;
      store.notice = { kind: 'success', text: 'Your new password is saved. Sign in with it.' };
      render();
      return;
    }
    store.submitting = false;
    signInEmailDraft = '';
    store.notice = null;
    onAuthed();
  });
}
