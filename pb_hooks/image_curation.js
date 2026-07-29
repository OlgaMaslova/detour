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

  const sourceUrl = image.getString("source_url");
  let entry;
  try {
    entry = app.findRecordById(
      "community_waitlist_entries",
      image.getString("waitlist")
    );
  } catch {
    return failScreening(app, image, "The linked place no longer exists.");
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
