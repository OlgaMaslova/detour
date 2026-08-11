/**
 * The founding circle's curation desk: the photo review queue, and the
 * worklist of live places with no photograph at all.
 */
import { pb } from '../pocketbase';
import type { RecordModel } from 'pocketbase';
import { resyncAfterWrite } from '../live';
import { esc, focusNotice, member, onCommunityReset, readableError, store } from './store';
import { PHOTO_MAX_BYTES, chosenPhoto, photoFileName, preparePhoto } from './place-form';

interface ImageCurationItem {
  id: string;
  collection_id: string;
  snapshot: string;
  place_name: string;
  city: string;
  country: string;
  submitted_by: string;
  screening_status: 'pending' | 'screening_failed';
  relevance: 'relevant' | 'uncertain' | 'irrelevant';
  ai_note: string;
  created: string;
}

/**
 * A published place showing no photograph — neither an enrichment cover nor an
 * approved member photo. The automatic passes have had their turn; this is what
 * they could not do.
 */
interface CoverlessPlace {
  id: string;
  entry: string;
  place_name: string;
  city: string;
  country: string;
  disambiguator: string;
  official_url: string;
  instagram_url: string;
  published_at: string;
}
let curationItems: ImageCurationItem[] = [];
let curationLoaded = false;
let loadingCuration = false;
let coverlessPlaces: CoverlessPlace[] = [];
let coverlessLoaded = false;
let loadingCoverless = false;
let refreshingCoverlessId = '';
let coverUploadingId = '';
let curationSavingId = '';
function curationImageUrl(item: ImageCurationItem): string {
  return pb.files.getURL(
    {
      id: item.id,
      collectionId: item.collection_id,
      collectionName: 'community_place_images',
    } as RecordModel,
    item.snapshot,
    // the `f` suffix fits the image inside the box; plain WxH center-crops it,
    // which hid parts of the frame the reviewer has to judge
    { thumb: '720x540f' }
  );
}

export function curationPanel(): string {
  return `<section class="community-tab-panel community-curation-panel" id="member-panel-curation" role="tabpanel" aria-labelledby="member-tab-curation" tabindex="0">
    <div class="community-section-heading">
      <div><p class="community-kicker">Founding circle</p><h3>Photo review</h3></div>
      <p class="community-form-note">Approving a photo publishes it with the member's own recommendation. It does not become the place's image, and it replaces no one else's photo.</p>
    </div>
    ${
      loadingCuration || !curationLoaded
        ? '<p class="community-loading" role="status">Loading the review queue…</p>'
        : curationItems.length
          ? `<div class="community-curation-grid">${curationItems.map((item) => {
              const where = [item.city, item.country].filter(Boolean).join(', ');
              const submitter = item.submitted_by ? `@${item.submitted_by.replace(/^@+/, '')}` : 'a member';
              const screeningUnavailable = item.screening_status === 'screening_failed';
              return `<article class="community-curation-card">
                <img src="${esc(curationImageUrl(item))}" alt="Submitted image for ${esc(item.place_name)}" loading="lazy" decoding="async">
                <div class="community-curation-copy">
                  <p class="community-curation-status${screeningUnavailable ? ' is-unscreened' : ''}">${screeningUnavailable
                    ? 'Unscreened · Manual safety review required'
                    : `Safety passed · Relevance: ${esc(item.relevance)}`}</p>
                  <h4>${esc(item.place_name)}</h4>
                  ${where ? `<p>${esc(where)}</p>` : ''}
                  <p class="community-form-note">Submitted by ${esc(submitter)}. ${esc(item.ai_note || 'Founder judgment required.')}</p>
                  <form class="community-curation-form" data-image-curation="${esc(item.id)}">
                    <label>Review note <span class="community-optional">Optional</span><textarea name="note" rows="2" maxlength="1200" placeholder="Reason for approving or rejecting"></textarea></label>
                    <div class="community-curation-actions">
                      <button class="secondary-button" type="submit" name="decision" value="reject" ${curationSavingId ? 'disabled' : ''}>${curationSavingId === item.id ? 'Saving…' : 'Reject'}</button>
                      <button class="primary-button" type="submit" name="decision" value="approve" ${curationSavingId ? 'disabled' : ''}>${curationSavingId === item.id ? 'Saving…' : 'Approve photo'}</button>
                    </div>
                  </form>
                </div>
              </article>`;
            }).join('')}</div>`
          : '<p class="community-empty">No photos are waiting for review.</p>'
    }
    ${coverlessMarkup()}
  </section>`;
}

/**
 * Places the automatic passes could not find a photograph for.
 *
 * A worklist rather than a review queue: there is nothing here to approve or
 * reject, because there is no photo. Look again re-runs the same passes the
 * sweeps run, which is worth a click for a place that has gained a website since
 * it published. A place with no website and no Instagram has exhausted them, and
 * is marked so, because the only thing left is for someone to go and take a
 * picture — and a photo belongs to a recommendation, so that someone has to be a
 * member who recommends it.
 */
function coverlessMarkup(): string {
  const count = coverlessPlaces.length;
  return `<div class="community-coverless">
    <div class="community-subheading">
      <h4 id="community-coverless-title">Places with no photo</h4>
      ${coverlessLoaded && !loadingCoverless && count ? `<p class="community-queue-count">${count} ${count === 1 ? 'place' : 'places'}</p>` : ''}
    </div>
    <p class="community-form-note">Live with neither a found cover nor a member's photo. They show a monogram until one arrives.</p>
    ${
      loadingCoverless || !coverlessLoaded
        ? '<p class="community-loading" role="status">Loading…</p>'
        : count
          ? `<ul class="community-coverless-list" aria-labelledby="community-coverless-title">${coverlessPlaces
              .map((place) => {
                const where = [place.disambiguator, place.city, place.country].filter(Boolean).join(', ');
                const links = [
                  place.official_url ? `<a href="${esc(place.official_url)}" target="_blank" rel="noopener noreferrer">Website</a>` : '',
                  place.instagram_url ? `<a href="${esc(place.instagram_url)}" target="_blank" rel="noopener noreferrer">Instagram</a>` : '',
                ].filter(Boolean);
                const busy = refreshingCoverlessId === place.id;
                const uploading = coverUploadingId === place.id;
                const anyBusy = Boolean(refreshingCoverlessId || coverUploadingId);
                return `<li class="community-coverless-row">
                  <div class="community-coverless-place">
                    <span class="community-coverless-name">${esc(place.place_name)}</span>
                    ${where ? `<span class="community-coverless-where">${esc(where)}</span>` : ''}
                    <span class="community-coverless-links">${
                      links.length
                        ? links.join('<span aria-hidden="true"> · </span>')
                        : '<span class="community-coverless-exhausted">Nowhere left to look — no website or Instagram</span>'
                    }</span>
                  </div>
                  <form class="community-coverless-form" data-coverless-cover="${esc(place.id)}">
                    <div class="community-coverless-inputs">
                      <label>Upload a photo<input name="photo" type="file" accept="image/jpeg,image/png,image/webp" ${anyBusy ? 'disabled' : ''}></label>
                      <label>Or paste a link to one<input name="source_url" type="url" inputmode="url" autocomplete="off" spellcheck="false" maxlength="2048" placeholder="https://…/photo.jpg" ${anyBusy ? 'disabled' : ''}></label>
                    </div>
                    <div class="community-coverless-buttons">
                      <button class="primary-button" type="submit" ${anyBusy ? 'disabled' : ''}>${uploading ? 'Saving…' : 'Set as cover'}</button>
                      <button class="secondary-button" type="button" data-coverless-refresh="${esc(place.id)}" ${anyBusy ? 'disabled' : ''}>${busy ? 'Looking…' : 'Look again'}</button>
                    </div>
                  </form>
                </li>`;
              })
              .join('')}</ul>`
          : '<p class="community-empty">Every live place has a photo.</p>'
    }
  </div>`;
}
export async function loadCuration(render: () => void): Promise<void> {
  if (!member() || !store.foundingMember || loadingCuration) return;
  loadingCuration = true;
  render();
  try {
    const response = await pb.send<{ items?: ImageCurationItem[] }>(
      '/api/detour/curation/images',
      { requestKey: null }
    );
    curationItems = Array.isArray(response.items) ? response.items : [];
    store.imageCurationCount = curationItems.length;
    curationLoaded = true;
  } catch (error) {
    store.notice = {
      kind: 'error',
      text: readableError(error, 'The image review queue could not be loaded. Please try again.'),
    };
  } finally {
    loadingCuration = false;
    render();
  }
}

export async function loadCoverless(render: () => void): Promise<void> {
  if (!member() || !store.foundingMember || loadingCoverless) return;
  loadingCoverless = true;
  render();
  try {
    const response = await pb.send<{ items?: CoverlessPlace[] }>(
      '/api/detour/curation/coverless',
      { requestKey: null }
    );
    coverlessPlaces = Array.isArray(response.items) ? response.items : [];
    coverlessLoaded = true;
  } catch (error) {
    store.notice = {
      kind: 'error',
      text: readableError(error, 'The list of places without photos could not be loaded. Please try again.'),
    };
  } finally {
    loadingCoverless = false;
    render();
  }
}

/** A fresh look at both queues — the member tab strip asks for it on entry. */
export function reloadCuration(render: () => void): void {
  curationLoaded = false;
  coverlessLoaded = false;
  void loadCuration(render);
  void loadCoverless(render);
}

onCommunityReset(() => {
  curationItems = [];
  curationLoaded = false;
  loadingCuration = false;
  curationSavingId = '';
  coverlessPlaces = [];
  coverlessLoaded = false;
  loadingCoverless = false;
  refreshingCoverlessId = '';
  coverUploadingId = '';
});

/**
 * No catalogue refresher is passed in any more: every write here ends in
 * `resyncAfterWrite`, which re-reads the catalogue along with the feed and
 * everything else the write touched. See src/live.ts.
 */
export function bindCuration(root: HTMLElement, render: () => void): void {
  root.querySelectorAll<HTMLFormElement>('[data-image-curation]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const imageId = form.dataset.imageCuration || '';
      const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | null;
      const decision = submitter?.value === 'approve' ? 'approve' : 'reject';
      if (!imageId || !store.foundingMember || curationSavingId) return;
      const values = new FormData(form);
      curationSavingId = imageId;
      store.notice = null;
      render();
      try {
        await pb.send(`/api/detour/curation/images/${encodeURIComponent(imageId)}/${decision}`, {
          method: 'POST',
          body: { note: String(values.get('note') || '').trim() },
          requestKey: null,
        });
        curationItems = curationItems.filter((item) => item.id !== imageId);
        store.imageCurationCount = curationItems.length;
        store.notice = {
          kind: 'success',
          text:
            decision === 'approve'
              ? 'Photo approved. It now appears with that member’s recommendation.'
              : 'Photo rejected.',
        };
        if (decision === 'approve') {
          // The photo now belongs to a member's recommendation, so it is the circle
          // feed that changed and the cards built from it that are wrong. Awaited
          // like every other write, so the queue and the feed settle together.
          await resyncAfterWrite(render);
        }
      } catch (error) {
        store.notice = {
          kind: 'error',
          text: readableError(error, `The image could not be ${decision === 'approve' ? 'approved' : 'rejected'}.`),
        };
      } finally {
        curationSavingId = '';
        render();
        focusNotice(root);
      }
    });
  });

  root.querySelectorAll<HTMLFormElement>('[data-coverless-cover]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const venueId = form.dataset.coverlessCover || '';
      if (!venueId || !store.foundingMember || coverUploadingId || refreshingCoverlessId) return;
      const photo = chosenPhoto(form);
      const sourceUrl = String(new FormData(form).get('source_url') || '').trim();
      if (!photo && !sourceUrl) {
        store.notice = { kind: 'error', text: 'Choose a photo, or paste a link to one.' };
        render();
        return;
      }
      coverUploadingId = venueId;
      store.notice = null;
      render();
      try {
        let body: FormData | { source_url: string };
        if (photo) {
          // An upload wins when both are given: choosing a file is the more
          // deliberate of the two actions. It gets the same browser-side
          // downscale members' photos get — a phone photo is far larger than any
          // surface renders it.
          const prepared = await preparePhoto(photo);
          if (prepared.size > PHOTO_MAX_BYTES) {
            throw new Error('That photo is larger than 8 MB even after resizing. Choose a smaller one.');
          }
          const form_ = new FormData();
          form_.set('photo', prepared, photoFileName(prepared, photo));
          body = form_;
        } else {
          // The server fetches it, confirms it really serves an image, and stores
          // its own copy — so the cover cannot break later because someone else's
          // host stopped serving it.
          body = { source_url: sourceUrl };
        }
        await pb.send(`/api/detour/curation/places/${encodeURIComponent(venueId)}/cover`, {
          method: 'POST',
          body,
          requestKey: null,
        });
        coverlessPlaces = coverlessPlaces.filter((place) => place.id !== venueId);
        store.notice = { kind: 'success', text: 'Cover set. It is live on the place now.' };
        // The catalogue holds the old coverless venue and the feed holds the cards
        // built from it, so both have to be re-read for the cover to appear.
        await resyncAfterWrite(render);
      } catch (error) {
        store.notice = { kind: 'error', text: readableError(error, 'That cover could not be saved.') };
      } finally {
        coverUploadingId = '';
        render();
      }
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-coverless-refresh]').forEach((button) => {
    button.addEventListener('click', async () => {
      const venueId = button.dataset.coverlessRefresh || '';
      if (!venueId || !store.foundingMember || refreshingCoverlessId) return;
      refreshingCoverlessId = venueId;
      store.notice = null;
      render();
      try {
        const result = await pb.send<{ image_url?: string; official_url?: string; instagram_url?: string }>(
          `/api/detour/curation/coverless/${encodeURIComponent(venueId)}/refresh`,
          { method: 'POST', requestKey: null }
        );
        if (result.image_url) {
          // Found one: the place leaves the worklist, and the catalogue has to be
          // re-read for the cover to appear on its card.
          coverlessPlaces = coverlessPlaces.filter((place) => place.id !== venueId);
          store.notice = { kind: 'success', text: 'Found a photo. It is live on the place now.' };
          await resyncAfterWrite(render);
        } else {
          // Links the pass may have discovered even without a cover are worth
          // showing: they are where a person would look next.
          coverlessPlaces = coverlessPlaces.map((place) =>
            place.id === venueId
              ? {
                  ...place,
                  official_url: result.official_url || place.official_url,
                  instagram_url: result.instagram_url || place.instagram_url,
                }
              : place
          );
          store.notice = { kind: 'info', text: 'Still no photo for that place.' };
        }
      } catch (error) {
        store.notice = { kind: 'error', text: readableError(error, 'That place could not be checked again.') };
      } finally {
        refreshingCoverlessId = '';
        render();
      }
    });
  });

  if (member() && store.foundingMember && store.memberTab === 'curation' && !curationLoaded && !loadingCuration) {
    void loadCuration(render);
  }
  if (member() && store.foundingMember && store.memberTab === 'curation' && !coverlessLoaded && !loadingCoverless) {
    void loadCoverless(render);
  }
}
