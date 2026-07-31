// Automated screening and application helpers for member-supplied place images.
// Require inside PocketBase handlers; request callbacks run in isolated VMs.

function cleanText(value, max) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function openAiBaseUrl() {
  return $os.getenv("DETOUR_OPENAI_BASE_URL") || "https://api.openai.com";
}

function outputText(payload) {
  let text = "";
  for (const item of (payload && payload.output) || []) {
    if (!item || item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (part && part.type === "output_text" && part.text) text += part.text;
    }
  }
  return text;
}

function parseJsonObject(value) {
  const text = String(value || "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function failScreening(app, image, note) {
  image.set("status", "screening_failed");
  image.set("ai_note", cleanText(note || "Automated safety screening failed.", 1200));
  app.save(image);
  return false;
}

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Normalizes whatever $os.readFile hands back into something indexable as bytes.
// The JSVM types it as string|Array<number> and which one arrives depends on the
// runtime, so both are supported rather than guessed at.
function byteReaderFor(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    return { length: raw.length, at: (i) => raw.charCodeAt(i) & 0xff };
  }
  if (typeof raw.length === "number") {
    return { length: raw.length, at: (i) => Number(raw[i]) & 0xff };
  }
  return null;
}

// Base64 without a platform helper — the JSVM has no btoa and exposes no
// encoder. Emitted in chunks and joined once: appending to a single string
// across a few hundred thousand iterations is what makes this slow in goja, not
// the arithmetic.
function base64Encode(raw) {
  const bytes = byteReaderFor(raw);
  if (!bytes || !bytes.length) return "";
  const chunks = [];
  let chunk = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const remaining = bytes.length - i;
    const b0 = bytes.at(i);
    const b1 = remaining > 1 ? bytes.at(i + 1) : 0;
    const b2 = remaining > 2 ? bytes.at(i + 2) : 0;
    chunk +=
      BASE64_ALPHABET[b0 >> 2] +
      BASE64_ALPHABET[((b0 & 3) << 4) | (b1 >> 4)] +
      (remaining > 1 ? BASE64_ALPHABET[((b1 & 15) << 2) | (b2 >> 6)] : "=") +
      (remaining > 2 ? BASE64_ALPHABET[b2 & 63] : "=");
    if (chunk.length >= 8192) {
      chunks.push(chunk);
      chunk = "";
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks.join("");
}

function mimeForFileName(name) {
  const lower = String(name || "").toLowerCase();
  if (lower.slice(-4) === ".png") return "image/png";
  if (lower.slice(-5) === ".webp") return "image/webp";
  return "image/jpeg";
}

// The image as OpenAI has to receive it: inlined bytes, not a link.
//
// A photo is uploaded now rather than linked, so there is no public URL to hand
// over — and handing one over was never ideal anyway, since it made screening
// depend on a third-party host still serving the file at review time. The
// snapshot in PocketBase storage is the thing being screened, so it is the thing
// that gets sent. Returns "" when the bytes cannot be read; the caller fails
// screening and the nightly retry picks it up.
function snapshotDataUrl(app, image) {
  const fileName = image.getString("snapshot");
  if (!fileName) return "";
  let raw;
  try {
    raw = $os.readFile(
      app.dataDir() + "/storage/" + image.baseFilesPath() + "/" + fileName
    );
  } catch {
    return "";
  }
  const encoded = base64Encode(raw);
  if (!encoded) return "";
  return "data:" + mimeForFileName(fileName) + ";base64," + encoded;
}

function screenImageSubmission(app, imageId) {
  const apiKey = $os.getenv("OPENAI_API_KEY");
  let image;
  try {
    image = app.findRecordById("community_place_images", imageId);
  } catch {
    return false;
  }
  if (
    image.getString("status") !== "screening" &&
    image.getString("status") !== "screening_failed"
  ) {
    return false;
  }
  if (!apiKey) return failScreening(app, image, "AI screening skipped.");

  let entry;
  try {
    entry = app.findRecordById(
      "community_waitlist_entries",
      image.getString("waitlist")
    );
  } catch {
    return failScreening(app, image, "The linked place no longer exists.");
  }

  // Uploads store no source_url, so the stored snapshot is the only copy. A row
  // predating the upload switch still has its link; either way what is screened
  // is the snapshot, so the inlined bytes are preferred and the link is only the
  // fallback for a snapshot that cannot be read off disk.
  const inlined = snapshotDataUrl(app, image);
  const sourceUrl = inlined || image.getString("source_url");
  if (!sourceUrl) {
    return failScreening(app, image, "The stored photo could not be read for screening.");
  }

  let moderationResponse;
  try {
    moderationResponse = $http.send({
      url: openAiBaseUrl() + "/v1/moderations",
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "omni-moderation-latest",
        input: [{ type: "image_url", image_url: { url: sourceUrl } }],
      }),
      timeout: 45,
    });
  } catch {
    return failScreening(app, image, "The safety moderation request failed.");
  }
  if (
    !moderationResponse ||
    moderationResponse.statusCode < 200 ||
    moderationResponse.statusCode >= 300
  ) {
    return failScreening(
      app,
      image,
      "Safety moderation returned HTTP " +
        (moderationResponse ? moderationResponse.statusCode : "unknown") +
        "."
    );
  }

  const moderationPayload = moderationResponse.json || {};
  const moderation = (moderationPayload.results || [])[0];
  if (!moderation || typeof moderation.flagged !== "boolean") {
    return failScreening(app, image, "Safety moderation returned an invalid result.");
  }

  image.set("safety_flagged", moderation.flagged);
  image.set("safety_categories", moderation.categories || {});
  image.set("moderated_at", new Date().toISOString());
  if (moderation.flagged) {
    image.set("status", "auto_rejected");
    image.set("relevance", "uncertain");
    image.set("ai_note", "Automatically rejected by image safety moderation.");
    app.save(image);
    return true;
  }

  let relevance = "uncertain";
  let relevanceNote = "Safety passed; venue relevance needs founder review.";
  try {
    const response = $http.send({
      url: openAiBaseUrl() + "/v1/responses",
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: $os.getenv("DETOUR_IMAGE_CURATION_MODEL") || "gpt-4o-mini",
        instructions:
          "Classify a candidate image for a food-and-drink destination. " +
          "Relevant images may show the named venue's exterior, interior, sign, " +
          "menu, food, drinks, staff at work, or recognizable branding. Mark " +
          "generic stock imagery, unrelated people or objects, screenshots, " +
          "memes, and images that cannot plausibly represent the named venue as " +
          "irrelevant. When evidence is insufficient, use uncertain. Return JSON only.",
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text:
                  "Venue: " +
                  entry.getString("venue_name") +
                  "\nCity: " +
                  entry.getString("city") +
                  "\nCountry: " +
                  entry.getString("country") +
                  '\nReturn {"relevance":"relevant"|"uncertain"|"irrelevant","note":"brief reason"}.',
              },
              { type: "input_image", image_url: sourceUrl, detail: "low" },
            ],
          },
        ],
      }),
      timeout: 60,
    });
    if (response && response.statusCode >= 200 && response.statusCode < 300) {
      const answer = parseJsonObject(outputText(response.json || {}));
      if (
        answer &&
        ["relevant", "uncertain", "irrelevant"].indexOf(answer.relevance) !== -1
      ) {
        relevance = answer.relevance;
        relevanceNote = cleanText(answer.note, 1000) || relevanceNote;
      }
    }
  } catch {
    // Safety already passed. Relevance is advisory; founders make the final call.
  }

  image.set("relevance", relevance);
  image.set("ai_note", relevanceNote);
  image.set("status", "pending");
  app.save(image);
  return true;
}

function retryFailedScreens(app, limit) {
  let records = [];
  try {
    records = app.findRecordsByFilter(
      "community_place_images",
      "status = 'screening_failed'",
      "updated",
      Math.max(1, Number(limit || 3)),
      0
    );
  } catch {
    return 0;
  }
  let attempted = 0;
  for (const record of records) {
    record.set("status", "screening");
    app.save(record);
    screenImageSubmission(app, record.id);
    attempted += 1;
  }
  return attempted;
}

module.exports = {
  retryFailedScreens,
  screenImageSubmission,
};
