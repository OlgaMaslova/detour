import { pb } from './pocketbase';
import type { Venue } from './data';

type CommunityMode = 'sign-in' | 'join';
type NoticeKind = 'success' | 'error' | 'info';

interface MemberRecord {
  id: string;
  email?: string;
  display_name?: string;
  community_status?: 'unverified' | 'verified';
}

interface EvidenceRecord {
  id: string;
  venue?: string;
  note?: string;
  evidence_url?: string;
  status?: 'pending' | 'approved' | 'rejected';
  created?: string;
  expand?: { venue?: { name?: string; city?: string } };
}

interface SubmissionRecord {
  id: string;
  venue_name?: string;
  city?: string;
  address?: string;
  detour_note?: string;
  source_url?: string;
  status?: 'pending' | 'approved' | 'rejected';
  created?: string;
}

interface InviteRecord {
  id: string;
  code?: string;
  claimed_by?: string;
  claimed_at?: string;
  created?: string;
}

interface Notice {
  kind: NoticeKind;
  text: string;
}

let mode: CommunityMode = 'sign-in';
let notice: Notice | null = null;
let evidence: EvidenceRecord[] = [];
let evidenceLoaded = false;
let loadingEvidence = false;
let submissions: SubmissionRecord[] = [];
let submissionsLoaded = false;
let loadingSubmissions = false;
let invites: InviteRecord[] = [];
let invitesLoaded = false;
let loadingInvites = false;
let submitting = false;

function esc(value: string | undefined | null): string {
  return (value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function member(): MemberRecord | null {
  if (!pb.authStore.isValid || !pb.authStore.record) return null;
  return pb.authStore.record as unknown as MemberRecord;
}

function memberName(record: MemberRecord): string {
  return record.display_name?.trim() || record.email?.split('@')[0] || 'Member';
}

function readableError(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    const response = error as { response?: { message?: string; data?: Record<string, { message?: string }> }; message?: string };
    const fieldError = response.response?.data
      ? Object.values(response.response.data).find((value) => value?.message)?.message
      : undefined;
    return fieldError || response.response?.message || response.message || fallback;
  }
  return fallback;
}

function statusLabel(record: MemberRecord): string {
  return record.community_status === 'verified' ? 'Verified detourist' : 'Building verification';
}

function evidenceCounts(): { approved: number; pending: number; rejected: number } {
  return evidence.reduce(
    (counts, item) => {
      if (item.status === 'approved') counts.approved += 1;
      if (item.status === 'pending') counts.pending += 1;
      if (item.status === 'rejected') counts.rejected += 1;
      return counts;
    },
    { approved: 0, pending: 0, rejected: 0 }
  );
}

function evidenceName(item: EvidenceRecord): string {
  return item.expand?.venue?.name || 'A catalogued place';
}

function submissionPlace(item: SubmissionRecord): string {
  const place = item.venue_name?.trim() || 'Untitled detour';
  return item.city?.trim() ? `${place} — ${item.city.trim()}` : place;
}

function openInvites(): InviteRecord[] {
  return invites.filter((invite) => !invite.claimed_by);
}

function noticeMarkup(): string {
  if (!notice) return '';
  return `<p class="community-notice community-notice-${notice.kind}" role="status">${esc(notice.text)}</p>`;
}

function signedOutPanel(): string {
  const isJoin = mode === 'join';
  return `<section class="community-panel community-panel-auth" aria-label="Detour membership">
    <div class="community-panel-intro">
      <p class="community-kicker">The detourist circle</p>
      <h2>${isJoin ? 'Join through a trusted introduction.' : 'Return to your Detour.'}</h2>
      <p>${isJoin ? 'Membership begins with a personal invitation from an existing detourist.' : 'Sign in to continue recording the places that have stayed with you.'}</p>
    </div>
    <div class="community-form-wrap">
      <div class="community-tabs" role="tablist" aria-label="Membership options">
        <button class="community-tab ${!isJoin ? 'is-active' : ''}" type="button" role="tab" aria-selected="${!isJoin}" data-community-mode="sign-in">Sign in</button>
        <button class="community-tab ${isJoin ? 'is-active' : ''}" type="button" role="tab" aria-selected="${isJoin}" data-community-mode="join">Use an invitation</button>
      </div>
      ${noticeMarkup()}
      ${
        isJoin
          ? `<form class="community-form" data-community-join>
              <label>How should we know you?<input name="display_name" autocomplete="name" maxlength="100" required></label>
              <label>Email address<input name="email" type="email" autocomplete="email" required></label>
              <div class="community-form-grid">
                <label>Password<input name="password" type="password" autocomplete="new-password" minlength="8" required></label>
                <label>Confirm password<input name="passwordConfirm" type="password" autocomplete="new-password" minlength="8" required></label>
              </div>
              <label>Invitation code<input name="invite_code" autocomplete="off" spellcheck="false" maxlength="80" placeholder="DTR-…" required></label>
              <p class="community-form-note">Every invitation is personal and can be used once.</p>
              <button class="community-primary" type="submit" ${submitting ? 'disabled' : ''}>${submitting ? 'Joining…' : 'Join Detour'}</button>
            </form>`
          : `<form class="community-form" data-community-sign-in>
              <label>Email address<input name="email" type="email" autocomplete="email" required></label>
              <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
              <button class="community-primary" type="submit" ${submitting ? 'disabled' : ''}>${submitting ? 'Signing in…' : 'Sign in'}</button>
              <p class="community-form-note">New here? You’ll need a personal invitation to join.</p>
            </form>`
      }
    </div>
  </section>`;
}

function signedInPanel(venues: Venue[]): string {
  const record = member();
  if (!record) return signedOutPanel();
  const counts = evidenceCounts();
  const verified = record.community_status === 'verified';
  const sortedVenues = [...venues].sort((a, b) => a.name.localeCompare(b.name));
  const options = sortedVenues
    .map((venue) => `<option value="${esc(venue.id)}">${esc(venue.name)}${venue.city ? ` — ${esc(venue.city)}` : ''}</option>`)
    .join('');
  const statusCopy = verified
    ? 'Your three approved visits have opened verified membership.'
    : `Three approved visits unlock verified membership. ${counts.approved} of 3 approved so far.`;

  return `<section class="community-panel community-panel-member" aria-label="Your Detour membership">
    <div class="community-member-head">
      <div>
        <p class="community-kicker">Your field notes</p>
        <h2>${esc(memberName(record))}</h2>
        <p class="community-status ${verified ? 'is-verified' : ''}"><span aria-hidden="true"></span>${esc(statusLabel(record))}</p>
      </div>
      <button class="community-signout" type="button" data-community-sign-out>Sign out</button>
    </div>
    <section class="community-invites" aria-labelledby="community-invites-title">
      <div>
        <p class="community-kicker">Trusted introductions</p>
        <h3 id="community-invites-title">Invite a detourist</h3>
        <p>Each code is personal and works once. Share it directly with someone you trust.</p>
      </div>
      <div class="community-invite-actions">
        <button class="community-secondary" type="button" data-community-invite ${submitting ? 'disabled' : ''}>${submitting ? 'Preparing…' : 'Issue a personal invitation'}</button>
        ${
          loadingInvites || !invitesLoaded
            ? '<p class="community-loading" role="status">Checking your invitations…</p>'
            : openInvites().length
              ? `<ul class="community-invite-codes" aria-label="Your unclaimed invitation codes">${openInvites()
                  .map((invite) => `<li><code>${esc(invite.code || '')}</code><span>Unclaimed</span></li>`)
                  .join('')}</ul>`
              : '<p class="community-empty">No unclaimed invitations yet.</p>'
        }
      </div>
    </section>
    <div class="community-member-grid">
      <aside class="community-progress" aria-label="Verification progress">
        <p class="community-progress-label">Visit verification</p>
        <p class="community-progress-count"><strong>${Math.min(counts.approved, 3)}</strong><span>/3</span></p>
        <div class="community-progress-track" aria-hidden="true"><span style="width: ${Math.min((counts.approved / 3) * 100, 100)}%"></span></div>
        <p>${esc(statusCopy)}</p>
        <dl class="community-evidence-totals">
          <div><dt>Approved</dt><dd>${counts.approved}</dd></div>
          <div><dt>In review</dt><dd>${counts.pending}</dd></div>
          ${counts.rejected ? `<div><dt>Needs another visit</dt><dd>${counts.rejected}</dd></div>` : ''}
        </dl>
      </aside>
      <div class="community-evidence-area">
        <div class="community-section-heading">
          <div><p class="community-kicker">A place you know</p><h3>Record a visit</h3></div>
          <p>Share a note for editorial review. Each place can be recorded once.</p>
        </div>
        ${noticeMarkup()}
        ${
          loadingEvidence
            ? '<p class="community-loading" role="status">Gathering your field notes…</p>'
            : `<form class="community-form community-evidence-form" data-community-evidence>
                <label>Catalogued place
                  <select name="venue" required ${sortedVenues.length ? '' : 'disabled'}>
                    <option value="">Choose a place</option>${options}
                  </select>
                </label>
                <label>What stayed with you?<textarea name="note" rows="4" maxlength="1200" required placeholder="A few considered words about your visit."></textarea></label>
                <label>Supporting link <span class="community-optional">Optional</span><input name="evidence_url" type="url" inputmode="url" placeholder="https://"></label>
                <button class="community-primary" type="submit" ${submitting || !sortedVenues.length ? 'disabled' : ''}>${submitting ? 'Sending…' : 'Send for review'}</button>
              </form>`
        }
      </div>
    </div>
    <section class="community-evidence-list" aria-labelledby="your-notes-title">
      <div class="community-section-heading"><div><p class="community-kicker">Your record</p><h3 id="your-notes-title">Visits on file</h3></div><p>Approval is considered individually by the editorial team.</p></div>
      ${
        !evidenceLoaded || loadingEvidence
          ? '<p class="community-loading" role="status">Loading your visits…</p>'
          : evidence.length
            ? `<ul>${evidence.map((item) => `<li><div><strong>${esc(evidenceName(item))}</strong><span>${esc(item.note || '')}</span></div><p class="community-evidence-status is-${esc(item.status || 'pending')}">${esc(item.status || 'pending')}</p></li>`).join('')}</ul>`
            : '<p class="community-empty">No visits on file yet. Your first three approved visits begin your verification.</p>'
      }
    </section>
    <section class="community-submission-area" aria-labelledby="detour-submission-title">
      <div class="community-section-heading">
        <div><p class="community-kicker">A detour worth making</p><h3 id="detour-submission-title">Recommend a place</h3></div>
        <p>Every recommendation is considered privately before it can become part of Detour.</p>
      </div>
      ${
        verified
          ? `<div class="community-submission-grid">
              <form class="community-form community-submission-form" data-community-submission>
                <label>Place name<input name="venue_name" maxlength="200" required placeholder="The place you would send someone"></label>
                <div class="community-form-grid">
                  <label>City<input name="city" maxlength="120" required placeholder="Madrid"></label>
                  <label>Address <span class="community-optional">Optional</span><input name="address" maxlength="300" placeholder="A neighbourhood or address"></label>
                </div>
                <label>Why take the detour?<textarea name="detour_note" rows="5" maxlength="2400" required placeholder="What makes this place worth seeking out?"></textarea></label>
                <label>Supporting link <span class="community-optional">Optional</span><input name="source_url" type="url" inputmode="url" placeholder="https://"></label>
                <button class="community-primary" type="submit" ${submitting ? 'disabled' : ''}>${submitting ? 'Sending…' : 'Send recommendation'}</button>
              </form>
              <div class="community-submission-guidance"><strong>Editorial curation</strong><p>Your recommendation enters a private review queue as pending. It never appears on the map or in the guide unless an editor chooses to add it.</p></div>
            </div>
            <div class="community-submission-list" aria-labelledby="your-recommendations-title">
              <div class="community-section-heading"><div><p class="community-kicker">Your recommendations</p><h3 id="your-recommendations-title">In the editorial room</h3></div></div>
              ${
                !submissionsLoaded || loadingSubmissions
                  ? '<p class="community-loading" role="status">Gathering your recommendations…</p>'
                  : submissions.length
                    ? `<ul>${submissions.map((item) => `<li><div><strong>${esc(submissionPlace(item))}</strong><span>${esc(item.detour_note || '')}</span></div><p class="community-submission-status is-${esc(item.status || 'pending')}">${esc(item.status || 'pending')}</p></li>`).join('')}</ul>`
                    : '<p class="community-empty">Nothing in the editorial room yet. Send the place you keep returning to.</p>'
              }
            </div>`
          : `<div class="community-submission-locked"><p class="community-kicker">Verified membership</p><h4>Keep recording the places that stayed with you.</h4><p>Three approved visits unlock recommendations. Until then, your visit notes are the way into the editorial conversation.</p></div>`
      }
    </section>
  </section>`;
}

export function communityControl(href: string, current = false): string {
  const record = member();
  const label = record ? `Member: ${memberName(record)}` : 'Members';
  return `<a class="community-toggle${current ? ' is-current' : ''}" href="${esc(href)}" data-community-route${current ? ' aria-current="page"' : ''}>${esc(label)}<span aria-hidden="true">${current ? '•' : '↗'}</span></a>`;
}

export function communityPanel(venues: Venue[]): string {
  return `<div id="community-area" class="community-area">${member() ? signedInPanel(venues) : signedOutPanel()}</div>`;
}

async function loadEvidence(render: () => void): Promise<void> {
  if (!member() || loadingEvidence) return;
  loadingEvidence = true;
  render();
  try {
    evidence = await pb.collection('visit_evidence').getFullList<EvidenceRecord>({ sort: '-created', expand: 'venue', requestKey: null });
    evidenceLoaded = true;
  } catch (error) {
    notice = { kind: 'error', text: readableError(error, 'Your visit record could not be loaded. Please try again.') };
  } finally {
    loadingEvidence = false;
    render();
  }
}

async function loadInvites(render: () => void): Promise<void> {
  if (!member() || loadingInvites) return;
  loadingInvites = true;
  render();
  try {
    invites = await pb.collection('invites').getFullList<InviteRecord>({ sort: '-created', requestKey: null });
    invitesLoaded = true;
  } catch (error) {
    notice = { kind: 'error', text: readableError(error, 'Your invitations could not be loaded. Please try again.') };
  } finally {
    loadingInvites = false;
    render();
  }
}

async function loadSubmissions(render: () => void): Promise<void> {
  if (!member() || loadingSubmissions) return;
  loadingSubmissions = true;
  render();
  try {
    submissions = await pb.collection('detour_submissions').getFullList<SubmissionRecord>({ sort: '-created', requestKey: null });
    submissionsLoaded = true;
  } catch (error) {
    notice = { kind: 'error', text: readableError(error, 'Your recommendations could not be loaded. Please try again.') };
  } finally {
    loadingSubmissions = false;
    render();
  }
}

async function refreshMember(render: () => void): Promise<void> {
  if (!member()) return;
  try {
    await pb.collection('members').authRefresh({ requestKey: null });
  } catch {
    // A stored session can expire naturally; the next render offers a sign-in.
    pb.authStore.clear();
  }
  render();
}

export function bindCommunity(root: HTMLElement, venues: Venue[], render: () => void): void {
  root.querySelectorAll<HTMLButtonElement>('[data-community-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      mode = button.dataset.communityMode === 'join' ? 'join' : 'sign-in';
      notice = null;
      render();
    });
  });

  root.querySelector<HTMLFormElement>('[data-community-join]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const values = new FormData(form);
    const password = String(values.get('password') || '');
    const passwordConfirm = String(values.get('passwordConfirm') || '');
    if (password !== passwordConfirm) {
      notice = { kind: 'error', text: 'The two passwords do not match.' };
      render();
      return;
    }
    submitting = true;
    notice = null;
    render();
    try {
      await pb.collection('members').create({
        display_name: String(values.get('display_name') || '').trim(),
        email: String(values.get('email') || '').trim(),
        password,
        passwordConfirm,
        invite_code: String(values.get('invite_code') || '').trim().toUpperCase(),
      });
      mode = 'sign-in';
      notice = { kind: 'success', text: 'Your membership is ready. Sign in to begin recording visits.' };
    } catch (error) {
      notice = { kind: 'error', text: readableError(error, 'That invitation could not be accepted. Check the code and try again.') };
    } finally {
      submitting = false;
      render();
    }
  });

  root.querySelector<HTMLFormElement>('[data-community-sign-in]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget as HTMLFormElement);
    submitting = true;
    notice = null;
    render();
    try {
      await pb.collection('members').authWithPassword(String(values.get('email') || '').trim(), String(values.get('password') || ''));
      evidenceLoaded = false;
      invites = [];
      invitesLoaded = false;
      submissions = [];
      submissionsLoaded = false;
      notice = { kind: 'success', text: 'Welcome back. Your visits are ready when you are.' };
      await refreshMember(render);
      void loadEvidence(render);
      void loadInvites(render);
      if (member()?.community_status === 'verified') void loadSubmissions(render);
    } catch (error) {
      notice = { kind: 'error', text: readableError(error, 'Those sign-in details were not recognised.') };
      render();
    } finally {
      submitting = false;
    }
  });

  root.querySelector<HTMLButtonElement>('[data-community-sign-out]')?.addEventListener('click', () => {
    pb.authStore.clear();
    evidence = [];
    evidenceLoaded = false;
    invites = [];
    invitesLoaded = false;
    submissions = [];
    submissionsLoaded = false;
    notice = { kind: 'info', text: 'You have signed out of Detour.' };
    render();
  });

  root.querySelector<HTMLButtonElement>('[data-community-invite]')?.addEventListener('click', async () => {
    if (!member()) return;
    submitting = true;
    notice = null;
    render();
    try {
      await pb.collection('invites').create({});
      invitesLoaded = false;
      notice = { kind: 'success', text: 'A personal invitation is ready to share.' };
      await loadInvites(render);
    } catch (error) {
      notice = { kind: 'error', text: readableError(error, 'That invitation could not be prepared. Please try again.') };
    } finally {
      submitting = false;
      render();
    }
  });

  root.querySelector<HTMLFormElement>('[data-community-evidence]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget as HTMLFormElement);
    submitting = true;
    notice = null;
    render();
    try {
      await pb.collection('visit_evidence').create({
        venue: String(values.get('venue') || ''),
        note: String(values.get('note') || '').trim(),
        evidence_url: String(values.get('evidence_url') || '').trim(),
      });
      notice = { kind: 'success', text: 'Your visit is with the editorial team for review.' };
      evidenceLoaded = false;
      await loadEvidence(render);
    } catch (error) {
      notice = { kind: 'error', text: readableError(error, 'That visit could not be sent. Please check the details and try again.') };
    } finally {
      submitting = false;
      render();
    }
  });

  root.querySelector<HTMLFormElement>('[data-community-submission]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (member()?.community_status !== 'verified') {
      notice = { kind: 'error', text: 'Three approved visits are required before submitting a detour.' };
      render();
      return;
    }
    const values = new FormData(event.currentTarget as HTMLFormElement);
    submitting = true;
    notice = null;
    render();
    try {
      await pb.collection('detour_submissions').create({
        venue_name: String(values.get('venue_name') || '').trim(),
        city: String(values.get('city') || '').trim(),
        address: String(values.get('address') || '').trim(),
        detour_note: String(values.get('detour_note') || '').trim(),
        source_url: String(values.get('source_url') || '').trim(),
      });
      notice = { kind: 'success', text: 'Your recommendation is now with the editorial team.' };
      submissionsLoaded = false;
      await loadSubmissions(render);
    } catch (error) {
      notice = { kind: 'error', text: readableError(error, 'That recommendation could not be sent. Please check the details and try again.') };
    } finally {
      submitting = false;
      render();
    }
  });

  // The account route owns these records. Load them on first render without a
  // global auth-store listener that could duplicate across re-renders.
  if (member() && !evidenceLoaded && !loadingEvidence) {
    void loadEvidence(render);
  }
  if (member() && !invitesLoaded && !loadingInvites) {
    void loadInvites(render);
  }
  if (member()?.community_status === 'verified' && !submissionsLoaded && !loadingSubmissions) {
    void loadSubmissions(render);
  }

  // `venues` is intentionally accepted so the caller's current catalogue is
  // rendered in the select without a second backend request.
  void venues;
}
