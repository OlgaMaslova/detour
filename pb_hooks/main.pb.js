/// <reference path="../pb_data/types.d.ts" />

routerAdd("GET", "/api/supernaut/ready", (event) => {
  return event.json(200, { ok: true });
});

// Survey submissions are accepted only through this server-side route: the
// backing collection has no public CRUD rules. The questions, their options,
// and their limits come from pb_hooks/survey_forms.json — the same file the
// survey page renders from — so validation cannot drift from what was asked.
routerAdd("POST", "/api/detour/survey/{form}", (e) => {
  const config = require(__hooks + "/survey_forms.json");
  const forms = config.forms;

  function normalizeText(value, fieldName, maxLength) {
    if (typeof value !== "string") {
      throw new BadRequestError(fieldName + " must be a string.");
    }

    // Bound the raw payload too, so an input made mostly of controls or repeated
    // whitespace cannot bypass the normalized field limit cheaply.
    if (value.length > maxLength * 4 + 32) {
      throw new BadRequestError(fieldName + " is too long.");
    }

    const normalized = value
      .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (normalized.length > maxLength) {
      throw new BadRequestError(fieldName + " is too long.");
    }
    return normalized;
  }

  // A form's questions are its shared set, if it names one, then any of its own.
  function questionsFor(form, sets) {
    const shared = form.questionSet ? sets[form.questionSet] : null;
    if (form.questionSet && !shared) {
      throw new BadRequestError("This survey names a question set that does not exist.");
    }
    return (shared || []).concat(form.questions || []);
  }

  // A question is asked only while the answer it depends on still allows it.
  function applies(question, answers) {
    const condition = question.appliesWhen;
    if (!condition) return true;
    const value = answers[condition.key];
    if (!value) return false;
    if (condition.in && condition.in.indexOf(value) === -1) return false;
    if (condition.notIn && condition.notIn.indexOf(value) !== -1) return false;
    return true;
  }

  const formId = e.request.pathValue("form");
  const form = Object.prototype.hasOwnProperty.call(forms, formId) ? forms[formId] : null;
  if (!form) throw new NotFoundError("Unknown survey.");

  let body;
  try {
    body = e.requestInfo().body;
  } catch {
    throw new BadRequestError("A valid JSON object is required.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new BadRequestError("A valid JSON object is required.");
  }

  const submitted = body.answers;
  if (!submitted || typeof submitted !== "object" || Array.isArray(submitted)) {
    throw new BadRequestError("answers must be an object.");
  }

  // Member surveys are attributable on purpose; public ones must never record
  // who answered, even when a member happens to be signed in.
  let member = null;
  if (form.audience === "member") {
    // A superuser token authenticates, but it is not a member record and so
    // cannot be attributed to one — reject it rather than fail on the relation.
    if (!e.auth || !e.auth.id || e.hasSuperuserAuth()) {
      throw new UnauthorizedError("This survey is for signed-in members.");
    }
    member = e.auth.id;
  }

  const questions = questionsFor(form, config.questionSets || {});
  const declared = {};
  for (const question of questions) declared[question.key] = true;
  for (const key in submitted) {
    if (!Object.prototype.hasOwnProperty.call(declared, key)) {
      throw new BadRequestError(key + " is not a question in this survey.");
    }
  }

  const answers = {};
  for (const question of questions) {
    // Applicability reads the answers accepted so far, so a question may only
    // depend on one asked before it — the order in the config is the order asked.
    if (!applies(question, answers)) continue;
    const raw = submitted[question.key];

    // An optional question left blank is stored absent, like a skipped one:
    // "nothing to say" and "never asked" both read as no answer.
    if (question.optional && (raw == null || String(raw).trim() === "")) continue;

    if (question.kind === "single") {
      const value = normalizeText(raw == null ? "" : raw, question.key, 60);
      if (!value) {
        throw new BadRequestError(question.key + " is required by this survey.");
      }
      let allowed = false;
      for (const option of question.options) {
        if (option.value === value) allowed = true;
      }
      if (!allowed) {
        throw new BadRequestError(question.key + " is not one of its offered answers.");
      }
      answers[question.key] = value;
      continue;
    }

    if (question.kind === "text") {
      const minLength = question.minLength || 1;
      const value = normalizeText(raw == null ? "" : raw, question.key, question.maxLength || 1200);
      const meaningfulWords = value
        .split(/\s+/)
        .map((word) => word.replace(/[.,!?;:'"()\[\]{}<>/\\|`~@#$%^&*+=_-]+/g, ""))
        .filter((word) => word.length >= 2);
      if (value.length < minLength || meaningfulWords.length === 0) {
        throw new BadRequestError(
          question.key +
            " must contain a useful answer of at least " +
            minLength +
            " characters after whitespace normalization."
        );
      }
      answers[question.key] = value;
      continue;
    }

    throw new BadRequestError(question.key + " has an unsupported question kind.");
  }

  const collection = e.app.findCollectionByNameOrId("survey_responses");
  const response = new Record(collection);
  response.set("form", formId);
  response.set("form_version", form.version);
  response.set("answers", answers);
  if (member) response.set("member", member);
  response.set("source", form.source || "public_survey");
  e.app.save(response);

  return e.json(201, { ok: true });
});

// The route above persists through the normal record lifecycle, so this one
// after-create hook delivers exactly one dashboard event per saved response.
// The message is built from the form config, so a new survey is readable in the
// dashboard without touching this hook.
onRecordAfterCreateSuccess((e) => {
  try {
    const eventsUrl = $os.getenv("SUPERNAUT_EVENTS_URL");
    if (!eventsUrl) {
      throw new Error("SUPERNAUT_EVENTS_URL is not configured.");
    }

    const config = require(__hooks + "/survey_forms.json");
    const forms = config.forms;
    const sets = config.questionSets || {};
    const formId = e.record.getString("form");
    const form = Object.prototype.hasOwnProperty.call(forms, formId) ? forms[formId] : null;
    const answers = e.record.get("answers") || {};

    const lines = [];
    if (form) {
      const shared = form.questionSet ? sets[form.questionSet] || [] : [];
      for (const question of shared.concat(form.questions || [])) {
        const value = answers[question.key];
        let readable = "not asked";
        if (value) {
          readable = value;
          if (question.options) {
            for (const option of question.options) {
              if (option.value === value) readable = option.label;
            }
          }
        }
        lines.push(question.summaryLabel + ": " + readable);
      }
    } else {
      // An unknown form id means the config moved on; the raw answers are still
      // worth delivering rather than dropping the notification.
      lines.push(JSON.stringify(answers));
    }

    const response = $http.send({
      url: eventsUrl,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "detour.survey_response.created",
        subject: "New Detour survey response: " + formId,
        text:
          "Survey: " +
          formId +
          " (v" +
          e.record.get("form_version") +
          ")\n" +
          lines.join("\n"),
      }),
      timeout: 5,
    });
    if (!response || response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(
        "Dashboard events endpoint returned HTTP " +
          (response && response.statusCode ? response.statusCode : "unknown") +
          "."
      );
    }
  } catch (error) {
    try {
      e.app.logger().error(
        "Detour survey-response event delivery failed.",
        "responseId",
        e.record.id,
        "error",
        String(error)
      );
    } catch {
      // Logging must not turn best-effort dashboard delivery into a failed save.
    }
  }

  e.next();
}, "survey_responses");

// These private routes bypass member rules only for explicit safe projections.
routerAdd(
  "GET",
  "/api/detour/community/me",
  (e) => {
    // invitation_limit is the member's computed allowance, not their tier: the
    // founding markers it derives from are hidden fields and stay server-side.
    const founding = require(__hooks + "/founding_cap.js");
    const foundingMember = founding.isFoundingMember(e.app, e.auth);
    const imageCurationCount = foundingMember
      ? e.app.findRecordsByFilter(
          "community_place_images",
          "(status = 'pending' || status = 'screening_failed') && safety_flagged = false",
          "",
          10000,
          0
        ).length
      : 0;
    return e.json(200, {
      member: {
        id: e.auth.id,
        display_name: e.auth.getString("pseudo") || e.auth.getString("display_name"),
        pseudo: e.auth.getString("pseudo"),
        community_status: e.auth.getString("community_status"),
        invitation_limit: founding.invitationLimitFor(e.app, e.auth),
        founding_member: foundingMember,
        image_curation_count: imageCurationCount,
      },
    });
  },
  $apis.requireAuth("members")
);

// The verification note is private provenance, but members editing their own
// recommendations still need the exact lock state. Return only entry ids whose
// linked public venue has confirmed coordinates.
routerAdd(
  "GET",
  "/api/detour/community/place-locks",
  (e) => {
    const community = require(__hooks + "/community_waitlist.js");
    const entries = e.app.findRecordsByFilter(
      "community_waitlist_entries",
      "published_venue != ''",
      "-updated",
      5000,
      0
    );
    const ids = [];
    for (const entry of entries) {
      if (!community.isParticipant(entry, e.auth.id)) continue;
      try {
        const venue = e.app.findRecordById(
          "venues",
          entry.getString("published_venue")
        );
        if (community.hasConfirmedCoordinates(venue)) ids.push(entry.id);
      } catch {
        // A missing publication target cannot be considered confirmed.
      }
    }
    return e.json(200, { ids });
  },
  $apis.requireAuth("members")
);

// Anonymous recommendation projection. The home-page sample is deliberately
// stricter than city-scoped place notes: it shows at most three founding-circle
// recommendations, one per city. The private source collections have no public
// CRUD rules, so independently enforce visibility and fixture exclusions here.
routerAdd("GET", "/api/detour/public-recommendations", (e) => {
  const founding = require(__hooks + "/founding_cap.js");
  function meaningfulText(value) {
    if (typeof value !== "string") return "";
    const normalized = value.replace(/\s+/g, " ").trim();
    const words = normalized
      .split(/\s+/)
      .map((word) =>
        word.replace(/[.,!?;:'"()\[\]{}<>/\\|`~@#$%^&*+=_-]+/g, "")
      )
      .filter((word) => word.length >= 2);
    return normalized.length >= 24 && words.length >= 5 ? normalized : "";
  }

  function projectRecommendation(row) {
    const venueName = String(row.venue_name || "").trim();
    const city = String(row.city || "").trim();
    const country = String(row.country || "").trim();
    const note = meaningfulText(row.note);
    const recommenderPseudo = String(row.recommender_pseudo || "").trim();
    const venueId = String(row.venue_id || "").trim();
    if (!venueName || !city || !country || !note || !recommenderPseudo || !venueId) {
      return null;
    }
    return {
      venue_name: venueName,
      city: city,
      country: country,
      note: note,
      recommender_pseudo: recommenderPseudo,
      founding_member: Boolean(row.founding_member),
      venue_id: venueId,
    };
  }

  function normalizeCityFilter(value) {
    if (typeof value !== "string" || value.length > 512) return "";
    if (
      /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff\ufffd]/.test(
        value
      )
    ) {
      return "";
    }

    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized || normalized.length > 120) return "";
    return normalized;
  }

  const city = normalizeCityFilter(e.request.url.query().get("city") || "");
  const rows = arrayOf(
    new DynamicModel({
      venue_name: "",
      city: "",
      country: "",
      note: "",
      recommender_pseudo: "",
      founding_member: false,
      venue_id: "",
    })
  );

  try {
    const projection =
      "COALESCE(TRIM(v.name), '') AS venue_name, " +
      "COALESCE(TRIM(v.city), '') AS city, " +
      "COALESCE(TRIM(v.country), '') AS country, " +
      "COALESCE(TRIM(r.note), '') AS note, " +
      "COALESCE(TRIM(m.pseudo), '') AS recommender_pseudo, " +
      "CASE WHEN " + founding.foundingMemberSql("m") + " THEN TRUE ELSE FALSE END AS founding_member, " +
      "COALESCE(v.id, '') AS venue_id ";
    const joinsAndFilters =
      "FROM community_recommendations r " +
      "JOIN members m ON m.id = r.member " +
      "JOIN community_waitlist_entries w ON w.id = r.waitlist " +
      "JOIN venues v ON v.id = w.published_venue " +
      "WHERE w.status = 'published' " +
      "AND w.published_venue != '' " +
      "AND w.published_at != '' " +
      "AND COALESCE(m.internal_member, FALSE) = FALSE " +
      "AND m.community_status = 'verified' " +
      "AND COALESCE(m.discovery_visible, FALSE) = TRUE " +
      "AND LOWER(TRIM(m.email)) NOT LIKE '%.invalid' " +
      "AND LOWER(TRIM(m.email)) != 'agent@detour.supernaut.to' " +
      "AND LENGTH(TRIM(r.note)) >= 24 " +
      "AND TRIM(m.pseudo) != '' ";
    let sql;
    if (city) {
      // City-scoped notes continue to include every discovery-visible verified
      // member; the founding-member restriction belongs only to the landing
      // preview.
      sql =
        "SELECT " + projection + joinsAndFilters +
        "AND LOWER(TRIM(v.city)) = LOWER({:city}) " +
        "ORDER BY r.created DESC, r.id DESC LIMIT 24";
    } else {
      // The landing preview speaks only for the founding circle: the Founder
      // and the members the Founder invited. Rank before limiting so a busy
      // city can never occupy two of the three anonymous preview slots.
      sql =
        "WITH ranked AS (" +
        "SELECT " + projection +
        ", r.created AS recommendation_created, r.id AS recommendation_id, " +
        "ROW_NUMBER() OVER (" +
        "PARTITION BY LOWER(TRIM(v.city)), LOWER(TRIM(v.country)) " +
        "ORDER BY r.created DESC, r.id DESC" +
        ") AS city_rank " +
        joinsAndFilters +
        "AND " + founding.foundingMemberSql("m") + " " +
        ") " +
        "SELECT venue_name, city, country, note, recommender_pseudo, founding_member, venue_id " +
        "FROM ranked WHERE city_rank = 1 " +
        "ORDER BY recommendation_created DESC, recommendation_id DESC LIMIT 3";
    }

    const query = e.app.db().newQuery(sql);
    if (city) query.bind({ city: city });
    query.all(rows);
  } catch {
    return e.json(200, { recommendations: [] });
  }

  const recommendations = [];
  for (const row of rows) {
    const recommendation = projectRecommendation(row);
    if (recommendation) recommendations.push(recommendation);
  }
  return e.json(200, { recommendations: recommendations });
});

routerAdd(
  "GET",
  "/api/detour/network-discovery",
  (e) => {
    const founding = require(__hooks + "/founding_cap.js");
    // Route handlers run in isolated VMs, so all route-specific helpers and
    // query models live inside this handler.
    function projectReply(row) {
      return {
        id: row.id,
        body: row.body,
        author_pseudo: row.author_pseudo,
        created: row.created,
      };
    }

    function projectShare(row, replies) {
      return {
        id: row.id,
        direction: row.direction,
        venue_name: row.venue_name,
        city: row.city,
        country: row.country,
        address: row.address,
        personal_note: row.personal_note,
        sender_pseudo: row.sender_pseudo,
        recipient_pseudo: row.recipient_pseudo,
        seen: row.seen,
        created: row.created,
        replies: replies,
      };
    }

    function projectRecommendation(row, callerId) {
      return {
        venue_name: row.venue_name,
        recommender_pseudo: row.recommender_pseudo,
        is_own: row.member_id === callerId,
        founding_member: Boolean(row.founding_member),
        note: row.note,
        city: row.city,
        country: row.country,
        address: row.address,
        created: row.created,
      };
    }

    // Anonymous callers get the same recommendation shape the member feed
    // renders, reduced to a public-safe sample: published places only, from
    // real verified members who opted into discovery, meaningful notes,
    // capped at 4. If nobody is discovery-visible yet, the Founder's own
    // published recommendations stand in so the section is never empty.
    if (!e.auth || !e.auth.id) {
      function sampleRecommendations(visibilitySql) {
        const rows = arrayOf(
          new DynamicModel({
            recommender_pseudo: "",
            member_id: "",
            founding_member: false,
            note: "",
            venue_name: "",
            city: "",
            country: "",
            address: "",
            created: "",
          })
        );
        e.app
          .db()
          .newQuery(
            "SELECT m.pseudo AS recommender_pseudo, m.id AS member_id, " +
              "CASE WHEN " + founding.foundingMemberSql("m") + " THEN TRUE ELSE FALSE END AS founding_member, " +
              "r.note, r.venue_name, r.city, r.country, r.address, r.created " +
              "FROM community_recommendations r " +
              "JOIN members m ON m.id = r.member " +
              "JOIN community_waitlist_entries w ON w.id = r.waitlist " +
              "WHERE w.status = 'published' AND w.published_venue != '' " +
              "AND COALESCE(m.internal_member, FALSE) = FALSE " +
              "AND m.community_status = 'verified' " +
              "AND " + visibilitySql + " " +
              "AND LOWER(TRIM(m.email)) NOT LIKE '%.invalid' " +
              "AND LOWER(TRIM(m.email)) != 'agent@detour.supernaut.to' " +
              "AND LENGTH(TRIM(r.note)) >= 24 " +
              "AND TRIM(m.pseudo) != '' " +
              "ORDER BY r.created DESC, r.id DESC LIMIT 4"
          )
          .all(rows);
        return rows;
      }

      let sampleRows = sampleRecommendations("COALESCE(m.discovery_visible, FALSE) = TRUE");
      if (!sampleRows.length) {
        sampleRows = sampleRecommendations(founding.rootFounderSql("m"));
      }
      const sample = [];
      for (const row of sampleRows) {
        sample.push(projectRecommendation(row, ""));
      }
      return e.json(200, { discovery_visible: false, shares: [], recommendations: sample });
    }

    const callerId = e.auth.id;
    const caller = e.app.findRecordById("members", callerId);

    // The endpoint deliberately uses bounded, explicit SQL projections. It
    // bypasses collection rules only for caller-participant shares/replies,
    // recommendations from verified members who remain visible to the shared
    // invite-only circle, and the caller's own recommendations (always shown
    // to their author, even when kept private from the circle). Only pseudos
    // are projected for member attribution; no email, display name, relation,
    // moderation, or unrelated member field is selected or returned.
    const shareRows = arrayOf(
      new DynamicModel({
        id: "",
        direction: "",
        venue_name: "",
        city: "",
        country: "",
        address: "",
        personal_note: "",
        sender_pseudo: "",
        recipient_pseudo: "",
        seen: false,
        created: "",
      })
    );
    e.app
      .db()
      .newQuery(
        "SELECT id, " +
          "CASE WHEN recipient = {:caller} THEN 'received' ELSE 'sent' END AS direction, " +
          "venue_name, city, country, address, personal_note, " +
          "sender_pseudo, recipient_pseudo, seen, created " +
          "FROM community_shares " +
          // Archive state is per-side: a share leaves the caller's view once
          // they archived their own copy, while the other side still sees it.
          "WHERE (recipient = {:caller} AND COALESCE(archived, FALSE) = FALSE) " +
          "OR (sender = {:caller} AND COALESCE(sender_archived, FALSE) = FALSE) " +
          "ORDER BY created DESC, id DESC LIMIT 100"
      )
      .bind({ caller: callerId })
      .all(shareRows);

    // At most 50 chronological replies are returned for each of the same 100
    // caller-owned share threads selected above. The repeated bounded share CTE
    // avoids loading replies from older or unrelated threads.
    const replyRows = arrayOf(
      new DynamicModel({
        id: "",
        share_id: "",
        body: "",
        author_pseudo: "",
        created: "",
      })
    );
    e.app
      .db()
      .newQuery(
        "WITH selected_shares AS (" +
          "SELECT id FROM community_shares " +
          "WHERE sender = {:caller} OR recipient = {:caller} " +
          "ORDER BY created DESC, id DESC LIMIT 100" +
          "), ranked_replies AS (" +
          "SELECT r.id, r.share AS share_id, r.body, r.author_pseudo, r.created, " +
          "ROW_NUMBER() OVER (PARTITION BY r.share ORDER BY r.created ASC, r.id ASC) AS reply_rank " +
          "FROM community_share_replies r " +
          "JOIN selected_shares selected ON selected.id = r.share" +
          ") " +
          "SELECT id, share_id, body, author_pseudo, created " +
          "FROM ranked_replies WHERE reply_rank <= 50 " +
          "ORDER BY share_id ASC, created ASC, id ASC LIMIT 5000"
      )
      .bind({ caller: callerId })
      .all(replyRows);

    const repliesByShare = {};
    for (const row of replyRows) {
      if (!repliesByShare[row.share_id]) repliesByShare[row.share_id] = [];
      repliesByShare[row.share_id].push(projectReply(row));
    }

    const recommendationRows = arrayOf(
      new DynamicModel({
        recommender_pseudo: "",
        member_id: "",
        founding_member: false,
        note: "",
        venue_name: "",
        city: "",
        country: "",
        address: "",
        created: "",
      })
    );
    e.app
      .db()
      .newQuery(
        "SELECT m.pseudo AS recommender_pseudo, m.id AS member_id, " +
          "CASE WHEN " + founding.foundingMemberSql("m") + " THEN TRUE ELSE FALSE END AS founding_member, " +
          "r.note, r.venue_name, r.city, r.country, r.address, r.created " +
          "FROM community_recommendations r " +
          "JOIN members m ON m.id = r.member " +
          "WHERE COALESCE(m.internal_member, FALSE) = FALSE " +
          "AND (m.id = {:caller} " +
          "OR (m.community_status = 'verified' AND m.discovery_visible = TRUE)) " +
          "ORDER BY r.created DESC, r.id DESC LIMIT 100"
      )
      .bind({ caller: callerId })
      .all(recommendationRows);

    const shares = [];
    for (const row of shareRows) {
      shares.push(projectShare(row, repliesByShare[row.id] || []));
    }
    const recommendations = [];
    for (const row of recommendationRows) {
      recommendations.push(projectRecommendation(row, callerId));
    }

    return e.json(200, {
      discovery_visible: caller.getBool("discovery_visible"),
      shares: shares,
      recommendations: recommendations,
    });
  }
  // No auth middleware: anonymous callers are served the public-safe sample
  // branch above; authenticated members get their full circle feed.
);

routerAdd(
  "GET",
  "/api/detour/member-place-contributions",
  (e) => {
    const founding = require(__hooks + "/founding_cap.js");
    const records = e.app.findRecordsByFilter(
      "member_place_contributions",
      "member = {:member}",
      "-created",
      10000,
      0,
      { member: e.auth.id }
    );
    const items = [];
    for (const record of records) {
      items.push({
        id: record.id,
        place_name: record.getString("place_name"),
        city: record.getString("city"),
        country: record.getString("country"),
        address: record.getString("address"),
        category: record.getString("category"),
        occasions: record.getStringSlice("occasions"),
        status: record.getString("status"),
        created: record.getString("created"),
        updated: record.getString("updated"),
      });
    }

    return e.json(200, { items: items });
  },
  $apis.requireAuth("members")
);

// Public, aggregate-only social proof for the catalogue: how many distinct
// Detourists have recommended each place. Recommendation signals and
// contributions are private collections, so this route exposes counts keyed by
// public venue id and nothing else — no member identity, prose, or timing ever
// leaves the server. Shares stay completely private: sending a place to
// someone is never social proof and never moves a count here.
routerAdd("GET", "/api/detour/place-detourists", (e) => {
  const foundingPolicy = require(__hooks + "/founding_cap.js");
  const { normalizePlacePart } = require(__hooks + "/community_waitlist.js");

  // Distinct (venue, member) pairs from recommendation signals only. Waiting-
  // list entries resolve to their published venue first, then to the canonical
  // catalogue venue they were matched to before publication.
  const pairs = arrayOf(
    new DynamicModel({ venue_id: "", member_id: "", founding_member: false })
  );
  e.app
    .db()
    .newQuery(
      "SELECT venue_id, member_id, founding_member FROM (" +
        "SELECT COALESCE(NULLIF(w.published_venue, ''), w.canonical_venue) AS venue_id, " +
        "r.member AS member_id, " +
        "CASE WHEN " + foundingPolicy.foundingMemberSql("m") + " THEN TRUE ELSE FALSE END AS founding_member " +
        "FROM community_recommendations r " +
        "JOIN community_waitlist_entries w ON w.id = r.waitlist " +
        "JOIN members m ON m.id = r.member " +
        "WHERE LOWER(TRIM(m.email)) NOT LIKE '%.invalid'" +
        ") WHERE venue_id IS NOT NULL AND venue_id != '' AND member_id != ''"
    )
    .all(pairs);

  // Approved legacy contributions are one member's recommendation each,
  // matched to catalogue venues by the same normalized place identity the
  // waiting-list loop uses.
  const contributionPairs = [];
  const contributions = arrayOf(
    new DynamicModel({
      contribution_id: "",
      member_id: "",
      normalized_name: "",
      normalized_city: "",
      founding_member: false,
    })
  );
  e.app
    .db()
    .newQuery(
      "SELECT c.id AS contribution_id, c.member AS member_id, " +
        "c.normalized_name, c.normalized_city, " +
        "CASE WHEN " + foundingPolicy.foundingMemberSql("m") + " THEN TRUE ELSE FALSE END AS founding_member " +
        "FROM member_place_contributions c " +
        "JOIN members m ON m.id = c.member " +
        "WHERE c.status = 'approved' " +
        "AND LOWER(TRIM(m.email)) NOT LIKE '%.invalid'"
    )
    .all(contributions);
  const contributionRows = [];
  for (const row of contributions) {
    contributionRows.push({
      contribution_id: row.contribution_id,
      member_id: row.member_id,
      normalized_name: row.normalized_name,
      normalized_city: row.normalized_city,
      founding_member: Boolean(row.founding_member),
    });
  }
  if (contributionRows.length) {
    const venues = arrayOf(new DynamicModel({ id: "", name: "", city: "" }));
    e.app.db().newQuery("SELECT id, name, city FROM venues").all(venues);
    // Normalized parts never contain ":" (normalizePlacePart strips it), so
    // "::" joins name and city without cross-boundary collisions.
    const venueByIdentity = {};
    for (const venue of venues) {
      venueByIdentity[
        normalizePlacePart(venue.name) + "::" + normalizePlacePart(venue.city)
      ] = venue.id;
    }
    for (const row of contributionRows) {
      const venueId =
        venueByIdentity[row.normalized_name + "::" + row.normalized_city];
      const resolvedVenueId =
        venueId || (row.contribution_id ? "member-contribution-" + row.contribution_id : "");
      if (resolvedVenueId && row.member_id) {
        contributionPairs.push({
          venue_id: resolvedVenueId,
          member_id: row.member_id,
          founding_member: row.founding_member,
        });
      }
    }
  }

  const seen = {};
  const counts = {};
  const founding = {};
  function addPair(venueId, memberId, foundingMember) {
    const key = venueId + "::" + memberId;
    if (seen[key]) return;
    seen[key] = true;
    counts[venueId] = (counts[venueId] || 0) + 1;
    if (foundingMember) founding[venueId] = true;
  }
  for (const row of pairs) {
    addPair(row.venue_id, row.member_id, Boolean(row.founding_member));
  }
  for (const pair of contributionPairs) {
    addPair(pair.venue_id, pair.member_id, pair.founding_member);
  }

  return e.json(200, { counts: counts, founding: founding });
});

routerAdd(
  "GET",
  "/api/detour/member-directory",
  (e) => {
    const rawQuery = e.request.url.query().get("q") || "";
    // A leading "@" is the conventional way to write a pseudo; searching
    // matches both the pseudo handle and the display name either way.
    const query = rawQuery
      .slice(0, 100)
      .replace(/[\x00-\x1F\x7F%_]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^@+/, "");

    if (query.length < 2) {
      throw new BadRequestError("q must contain at least two searchable characters.");
    }

    // Members have one name: the pseudo. The directory matches and returns
    // nothing else.
    const matches = e.app.findRecordsByFilter(
      "members",
      "id != {:member} && internal_member = false && pseudo ~ {:query}",
      "pseudo",
      12,
      0,
      { member: e.auth.id, query: query }
    );
    const candidates = [];
    for (const match of matches) {
      candidates.push({
        id: match.id,
        pseudo: match.getString("pseudo"),
      });
    }

    return e.json(200, { items: candidates });
  },
  $apis.requireAuth("members")
);

// My Circle: the slice of the invitation graph the caller is actually part of.
// Detour grows only by personal invitation, so who brought whom is the app's
// trust structure — and a member can only judge a second-degree recommendation
// if they can see the edge that connects them to it.
//
// This route bypasses the members collection rules, so it is deliberately
// narrow. It projects display name, home city, and a published-place count,
// and only for: the caller's inviter, the members the caller invited, the
// members one hop out (invited by the caller's inviter or by one of the
// caller's invitees, each labelled with that connector), and the founding
// circle, which is not relational and reads the same for every member. No
// email, pseudo, status, recommendation prose, moderation, or membership
// marker is selected or returned, and the graph is never walked past one hop.
routerAdd(
  "GET",
  "/api/detour/circle",
  (e) => {
    const founding = require(__hooks + "/founding_cap.js");
    const callerId = e.auth.id;

    // Internal accounts and reserved .invalid fixtures are never people in
    // somebody's circle, on either end of an edge.
    function realMember(alias) {
      return (
        "COALESCE(" + alias + ".internal_member, FALSE) = FALSE " +
        "AND LOWER(TRIM(" + alias + ".email)) NOT LIKE '%.invalid'"
      );
    }

    // A member's place count is their public footprint on the Detourist List:
    // distinct published venues they have recommended. Unpublished entries and
    // private drafts never reach it, so the number one member sees against
    // another is the same number the catalogue already shows.
    const placeCounts = {};
    const placeRows = arrayOf(new DynamicModel({ member_id: "", places: 0 }));
    e.app
      .db()
      .newQuery(
        "SELECT r.member AS member_id, COUNT(DISTINCT w.published_venue) AS places " +
          "FROM community_recommendations r " +
          "JOIN community_waitlist_entries w ON w.id = r.waitlist " +
          "WHERE w.status = 'published' AND w.published_venue != '' " +
          "GROUP BY r.member LIMIT 5000"
      )
      .all(placeRows);
    for (const row of placeRows) {
      placeCounts[row.member_id] = Number(row.places || 0);
    }

    // The cities of those same published places — a member's recommendation
    // geography, not their self-declared home. Distinct (member, city) pairs
    // aggregated here rather than GROUP_CONCAT because SQLite cannot combine
    // DISTINCT with a custom separator, and city names may contain commas.
    const citiesByMember = {};
    const cityRows = arrayOf(new DynamicModel({ member_id: "", city: "" }));
    e.app
      .db()
      .newQuery(
        "SELECT DISTINCT r.member AS member_id, v.city AS city " +
          "FROM community_recommendations r " +
          "JOIN community_waitlist_entries w ON w.id = r.waitlist " +
          "JOIN venues v ON v.id = w.published_venue " +
          "WHERE w.status = 'published' AND w.published_venue != '' " +
          "AND TRIM(v.city) != '' LIMIT 5000"
      )
      .all(cityRows);
    for (const row of cityRows) {
      if (!citiesByMember[row.member_id]) citiesByMember[row.member_id] = [];
      citiesByMember[row.member_id].push(row.city);
    }
    for (const memberId in citiesByMember) {
      citiesByMember[memberId].sort();
    }

    // Each member's most recent published place — the one line that tells
    // another member whether this person's taste is worth following. SQLite
    // resolves the bare venue column from the MAX(created) row.
    const latestByMember = {};
    const latestRows = arrayOf(
      new DynamicModel({ member_id: "", venue: "", created: "" })
    );
    e.app
      .db()
      .newQuery(
        "SELECT r.member AS member_id, r.venue_name AS venue, MAX(r.created) AS created " +
          "FROM community_recommendations r " +
          "JOIN community_waitlist_entries w ON w.id = r.waitlist " +
          "WHERE w.status = 'published' AND w.published_venue != '' " +
          "GROUP BY r.member LIMIT 5000"
      )
      .all(latestRows);
    for (const row of latestRows) {
      if (row.venue) {
        latestByMember[row.member_id] = { place: row.venue, created: row.created };
      }
    }

    // Members are named by pseudo, exactly as recommendation bylines and the
    // member directory name them; display_name only fills a missing pseudo.
    function projectMember(row) {
      return {
        name: row.pseudo || row.display_name,
        home: row.home_city,
        places: placeCounts[row.member_id] || 0,
        cities: (citiesByMember[row.member_id] || []).slice(0, 8),
        latest: latestByMember[row.member_id] || null,
      };
    }

    function memberRows() {
      return arrayOf(
        new DynamicModel({
          member_id: "",
          display_name: "",
          pseudo: "",
          home_city: "",
        })
      );
    }

    // The one person who brought the caller in. Null for the root account and
    // for anyone whose inviter is an internal or fixture record.
    const inviterRows = memberRows();
    e.app
      .db()
      .newQuery(
        "SELECT m.id AS member_id, m.display_name, m.pseudo, m.home_city " +
          "FROM members m JOIN members caller ON caller.invited_by = m.id " +
          "WHERE caller.id = {:caller} AND " + realMember("m") + " LIMIT 1"
      )
      .bind({ caller: callerId })
      .all(inviterRows);

    const invitedRows = memberRows();
    e.app
      .db()
      .newQuery(
        "SELECT m.id AS member_id, m.display_name, m.pseudo, m.home_city " +
          "FROM members m WHERE m.invited_by = {:caller} AND m.id != {:caller} " +
          "AND " + realMember("m") + " " +
          "ORDER BY COALESCE(m.joined_at, '') ASC, m.id ASC LIMIT 500"
      )
      .bind({ caller: callerId })
      .all(invitedRows);

    // One hop out: everyone a single invitation away from the caller's own two
    // edges — the other people their inviter brought in, and the people their
    // invitees brought in. `connector` is the member who links each row to the
    // caller, which is the whole point of the section. The caller's own row
    // matches the first branch (they share an inviter with their siblings) and
    // is excluded explicitly.
    const secondDegreeRows = arrayOf(
      new DynamicModel({
        member_id: "",
        display_name: "",
        pseudo: "",
        home_city: "",
        connector: "",
        connector_id: "",
      })
    );
    e.app
      .db()
      .newQuery(
        "SELECT m.id AS member_id, m.display_name, m.pseudo, m.home_city, " +
          "CASE WHEN TRIM(COALESCE(c.pseudo, '')) != '' THEN c.pseudo ELSE c.display_name END AS connector, " +
          "c.id AS connector_id " +
          "FROM members m JOIN members c ON c.id = m.invited_by " +
          "WHERE m.id != {:caller} " +
          "AND (c.id = (SELECT invited_by FROM members WHERE id = {:caller}) " +
          "OR c.invited_by = {:caller}) " +
          "AND " + realMember("m") + " AND " + realMember("c") + " " +
          "ORDER BY c.display_name ASC, COALESCE(m.joined_at, '') ASC, m.id ASC " +
          "LIMIT 500"
      )
      .bind({ caller: callerId })
      .all(secondDegreeRows);

    // The founding circle uses the same predicate as the seat count, so the
    // list length and "n of fifty" can never disagree.
    const foundingRows = memberRows();
    e.app
      .db()
      .newQuery(
        "SELECT m.id AS member_id, m.display_name, m.pseudo, m.home_city FROM members m " +
          "WHERE " + founding.foundingMemberSql("m") + " " +
          "AND " + realMember("m") + " " +
          "ORDER BY COALESCE(m.joined_at, '') ASC, m.id ASC LIMIT 100"
      )
      .all(foundingRows);

    const unclaimed = new DynamicModel({ total: 0 });
    e.app
      .db()
      .newQuery(
        "SELECT COUNT(*) AS total FROM invites " +
          "WHERE issued_by = {:caller} AND COALESCE(claimed_by, '') = ''"
      )
      .bind({ caller: callerId })
      .one(unclaimed);
    const invitationLimit = founding.invitationLimitFor(e.app, e.auth);
    const unclaimedCount = Number(unclaimed.total || 0);

    const invited = [];
    for (const row of invitedRows) invited.push(projectMember(row));
    // Positional connector references let a client draw the graph (an edge
    // needs to know WHICH first-ring member it hangs off; display names can
    // collide) without any member id entering the payload: 'inviter', or
    // 'invited:<n>' as an index into the invited array above.
    const invitedIndexById = {};
    for (let i = 0; i < invitedRows.length; i++) {
      invitedIndexById[invitedRows[i].member_id] = i;
    }
    const inviterId = inviterRows.length ? inviterRows[0].member_id : "";
    const secondDegree = [];
    for (const row of secondDegreeRows) {
      const item = projectMember(row);
      item.connector = row.connector;
      if (inviterId && row.connector_id === inviterId) {
        item.connector_ref = "inviter";
      } else if (invitedIndexById[row.connector_id] !== undefined) {
        item.connector_ref = "invited:" + invitedIndexById[row.connector_id];
      }
      secondDegree.push(item);
    }
    const foundingMembers = [];
    for (const row of foundingRows) foundingMembers.push(projectMember(row));

    return e.json(200, {
      invitations: {
        limit: invitationLimit,
        unclaimed: unclaimedCount,
        available: Math.max(0, invitationLimit - unclaimedCount),
      },
      inviter: inviterRows.length ? projectMember(inviterRows[0]) : null,
      invited: invited,
      second_degree: secondDegree,
      founding: {
        seated: founding.countFoundingMembers(e.app),
        members: foundingMembers,
      },
    });
  },
  $apis.requireAuth("members")
);

// One circle member's published recommendations, for the My Circle panel.
// The person is addressed by the same positional reference the circle payload
// uses ('inviter', 'invited:<n>', 'second:<n>', 'founding:<n>') — the server
// re-derives the member from the caller's own graph with the same ordered
// queries, so no member id ever crosses the wire in either direction, and a
// caller can never address a member outside their circle. Notes are shown
// under the same policy as the discovery feed: the member's own always;
// another member's only while they are verified and discovery-visible —
// otherwise the panel is told the list is private and gets nothing.
routerAdd(
  "GET",
  "/api/detour/circle/places",
  (e) => {
    const founding = require(__hooks + "/founding_cap.js");
    const who = e.request.url.query().get("who") || "";
    if (!/^(inviter|invited:\d{1,3}|second:\d{1,3}|founding:\d{1,3})$/.test(who)) {
      throw new BadRequestError("who must reference a member of your circle.");
    }
    const callerId = e.auth.id;

    function realMember(alias) {
      return (
        "COALESCE(" + alias + ".internal_member, FALSE) = FALSE " +
        "AND LOWER(TRIM(" + alias + ".email)) NOT LIKE '%.invalid'"
      );
    }

    // Re-derive the addressed member with the same ordered queries the circle
    // payload was built from, so index references line up exactly.
    function resolveTargetId() {
      const rows = arrayOf(new DynamicModel({ member_id: "" }));
      const index = who.includes(":") ? Number(who.split(":")[1]) : 0;
      if (who === "inviter") {
        e.app
          .db()
          .newQuery(
            "SELECT m.id AS member_id FROM members m " +
              "JOIN members caller ON caller.invited_by = m.id " +
              "WHERE caller.id = {:caller} AND " + realMember("m") + " LIMIT 1"
          )
          .bind({ caller: callerId })
          .all(rows);
      } else if (who.indexOf("invited:") === 0) {
        e.app
          .db()
          .newQuery(
            "SELECT m.id AS member_id FROM members m " +
              "WHERE m.invited_by = {:caller} AND m.id != {:caller} " +
              "AND " + realMember("m") + " " +
              "ORDER BY COALESCE(m.joined_at, '') ASC, m.id ASC LIMIT 500"
          )
          .bind({ caller: callerId })
          .all(rows);
      } else if (who.indexOf("second:") === 0) {
        e.app
          .db()
          .newQuery(
            "SELECT m.id AS member_id FROM members m " +
              "JOIN members c ON c.id = m.invited_by " +
              "WHERE m.id != {:caller} " +
              "AND (c.id = (SELECT invited_by FROM members WHERE id = {:caller}) " +
              "OR c.invited_by = {:caller}) " +
              "AND " + realMember("m") + " AND " + realMember("c") + " " +
              "ORDER BY c.display_name ASC, COALESCE(m.joined_at, '') ASC, m.id ASC " +
              "LIMIT 500"
          )
          .bind({ caller: callerId })
          .all(rows);
      } else {
        e.app
          .db()
          .newQuery(
            "SELECT m.id AS member_id FROM members m " +
              "WHERE " + founding.foundingMemberSql("m") + " " +
              "AND " + realMember("m") + " " +
              "ORDER BY COALESCE(m.joined_at, '') ASC, m.id ASC LIMIT 100"
          )
          .all(rows);
      }
      return rows[index] ? rows[index].member_id : "";
    }

    const targetId = resolveTargetId();
    if (!targetId) {
      throw new NotFoundError("That member is not in your circle.");
    }
    const target = e.app.findRecordById("members", targetId);
    const name = target.getString("pseudo") || target.getString("display_name");

    const visible =
      targetId === callerId ||
      (target.getString("community_status") === "verified" &&
        target.getBool("discovery_visible"));
    if (!visible) {
      return e.json(200, { name: name, private: true, items: [] });
    }

    const rows = arrayOf(
      new DynamicModel({
        recommender_pseudo: "",
        founding_member: false,
        note: "",
        venue_name: "",
        city: "",
        country: "",
        address: "",
        created: "",
      })
    );
    e.app
      .db()
      .newQuery(
        "SELECT m.pseudo AS recommender_pseudo, " +
          "CASE WHEN " + founding.foundingMemberSql("m") + " THEN TRUE ELSE FALSE END AS founding_member, " +
          "r.note, r.venue_name, r.city, r.country, r.address, r.created " +
          "FROM community_recommendations r " +
          "JOIN community_waitlist_entries w ON w.id = r.waitlist " +
          "JOIN members m ON m.id = r.member " +
          "WHERE r.member = {:target} " +
          "AND w.status = 'published' AND w.published_venue != '' " +
          "ORDER BY r.created DESC, r.id DESC LIMIT 100"
      )
      .bind({ target: targetId })
      .all(rows);

    const items = [];
    for (const row of rows) {
      items.push({
        venue_name: row.venue_name,
        recommender_pseudo: row.recommender_pseudo,
        is_own: targetId === callerId,
        founding_member: Boolean(row.founding_member),
        note: row.note,
        city: row.city,
        country: row.country,
        address: row.address,
        created: row.created,
      });
    }

    return e.json(200, { name: name, private: false, items: items });
  },
  $apis.requireAuth("members")
);

// A public member account is valid only when it redeems an unused, server-
// generated invitation. `redeemed_invite` has a partial unique index, so a
// simultaneous second redemption cannot create another member account.
onRecordCreateRequest((e) => {
  // The members auth collection intentionally has no created autodate field.
  // Stamp every account in the create hook so both public invite redemption
  // and superuser creation use the same server-owned join time; this also
  // overwrites any value supplied in a public create payload.
  e.record.set("joined_at", new Date().toISOString());

  // Every verified invited member joins the shared discovery circle by
  // default. Ignore create payloads so the server owns the signup default;
  // members may opt out later through their existing profile preference.
  e.record.set("discovery_visible", true);
  if (e.hasSuperuserAuth()) {
    return e.next();
  }

  // Founder policy and fixture classification are server-owned. Public signup
  // can neither authorize a new issuer, self-assert the direct-invite fast
  // track, nor enter the reserved internal-member lane.
  e.record.set("founder_invitation_issuer", false);
  e.record.set("direct_founder_invited", false);
  e.record.set("internal_member", false);

  const inviteCode = e.record.getString("invite_code").trim().toUpperCase();
  if (!inviteCode) {
    throw new BadRequestError("A valid invitation code is required to join Detour.");
  }

  let invite;
  try {
    invite = e.app.findFirstRecordByFilter(
      "invites",
      "code = {:code} && claimed_by = ''",
      { code: inviteCode }
    );
  } catch {
    throw new BadRequestError("This invitation code is invalid or has already been used.");
  }

  const { assertPseudoAvailable, normalizeHomeCity, normalizeMemberPseudo } = require(
    __hooks + "/member_profile.js"
  );
  const pseudo = normalizeMemberPseudo(e.record.getString("pseudo"));
  assertPseudoAvailable(e.app, pseudo, "");
  // Every signup flow asks for a home city, so no public account is created
  // without one. Superuser-created fixtures returned above and are exempt.
  e.record.set("home_city", normalizeHomeCity(e.record.getString("home_city")));

  const issuerId = invite.getString("issued_by");
  const issuer = e.app.findRecordById("members", issuerId);

  e.record.set("pseudo", pseudo);
  // The pseudo is a member's one name on Detour. The schema's required
  // display_name is kept as a server-owned mirror of it so older reads and
  // superuser-created accounts keep working; public signup no longer sends it.
  e.record.set("display_name", pseudo);
  e.record.set("invite_code", "");
  e.record.set("invited_by", issuerId);
  e.record.set("redeemed_invite", invite.id);
  e.record.set("community_status", "verified");
  // Founding membership is not granted here and is not stored: it is derived
  // from invited_by — the Founder's own account and everyone the Founder
  // invited (see founding_cap.js). Setting invited_by above is the whole of it.
  e.next();
}, "members");

// Record the winning member only after the account has been committed. This
// keeps a failed account validation from consuming an invitation. The same
// after-create event sends one quiet transactional welcome; delivery failures
// are logged but never allowed to surface to or block the completed signup.
onRecordAfterCreateSuccess((e) => {
  const inviteId = e.record.getString("redeemed_invite");
  if (inviteId) {
    // The invite can be gone by the time this success hook runs: a fresh-DB
    // boot replays every migration in one transaction, so a fixture member's
    // invite may already be removed by its later cleanup migration. A missing
    // invite must not fail the committed signup.
    try {
      const invite = e.app.findRecordById("invites", inviteId);
      invite.set("claimed_by", e.record.id);
      invite.set("claimed_at", new Date().toISOString());
      e.app.save(invite);
    } catch {}
  }

  try {
    function escapeHtml(value) {
      return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    const apiKey = $os.getenv("AGENTMAIL_API_KEY");
    const inboxId = $os.getenv("AGENTMAIL_INBOX_ID");
    if (!apiKey || !inboxId) {
      throw new Error("AgentMail runtime configuration is missing.");
    }

    const recipient = e.record.getString("email").trim();
    if (!recipient) {
      throw new Error("The new member record has no email address.");
    }
    const displayName = e.record.getString("display_name").trim() || "there";
    const firstPlaceUrl = "https://takedetour.app";
    const response = $http.send({
      url:
        "https://api.agentmail.to/v0/inboxes/" +
        encodeURIComponent(inboxId) +
        "/messages/send",
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: recipient,
        subject: "Welcome to Detour",
        text:
          "Hello " +
          displayName +
          ",\n\nWelcome to Detour — a private circle sharing exceptional food-and-drink places.\n\nAdd your first place: " +
          firstPlaceUrl +
          "\n\nYou received this email because you joined Detour.",
        html:
          "<p>Hello " +
          escapeHtml(displayName) +
          ",</p>" +
          "<p>Welcome to Detour — a private circle sharing exceptional food-and-drink places.</p>" +
          '<p><a href="' +
          firstPlaceUrl +
          '">Add your first place</a></p>' +
          "<p>You received this email because you joined Detour.</p>",
        labels: ["app"],
      }),
      timeout: 10,
    });

    if (!response || response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(
        "AgentMail returned HTTP " +
          (response && response.statusCode ? response.statusCode : "unknown") +
          "."
      );
    }
  } catch (error) {
    try {
      e.app.logger().error(
        "Detour welcome email delivery failed.",
        "memberId",
        e.record.id,
        "recipient",
        e.record.getString("email"),
        "error",
        String(error)
      );
    } catch {
      // Logging must not turn a best-effort email failure into a signup failure.
    }
  }

  // Only invitation-backed public signups reach the dashboard. Reserved
  // internal fixtures and superuser-created records remain quiet.
  if (inviteId && !e.record.getBool("internal_member")) {
    try {
      const eventsUrl = $os.getenv("SUPERNAUT_EVENTS_URL");
      if (!eventsUrl) {
        throw new Error("SUPERNAUT_EVENTS_URL is not configured.");
      }

      const displayName = e.record.getString("display_name").trim();
      const pseudo = e.record.getString("pseudo").trim();
      const memberLabel =
        (displayName || "A new member") + (pseudo ? " (@" + pseudo + ")" : "");
      const response = $http.send({
        url: eventsUrl,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "detour.member.created",
          subject: "New Detour member",
          text: memberLabel + " joined Detour.",
        }),
        timeout: 5,
      });
      if (!response || response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(
          "Dashboard events endpoint returned HTTP " +
            (response && response.statusCode ? response.statusCode : "unknown") +
            "."
        );
      }
    } catch (error) {
      try {
        e.app.logger().error(
          "Detour member event delivery failed.",
          "memberId",
          e.record.id,
          "error",
          String(error)
        );
      } catch {
        // Logging must not turn best-effort dashboard delivery into a signup failure.
      }
    }
  }

  e.next();
}, "members");

// Members may edit their own profile and auth details, but never alter the
// verification or invitation provenance that is maintained on the server.
onRecordUpdateRequest((e) => {
  const original = e.record.original();
  if (e.hasSuperuserAuth()) {
    if (
      e.record.getBool("discovery_visible") !==
      original.getBool("discovery_visible")
    ) {
      throw new BadRequestError(
        "Network discovery visibility can be changed only by the member."
      );
    }
    return e.next();
  }
  if (!e.auth || e.auth.id !== e.record.id) {
    throw new BadRequestError("You can update only your own member profile.");
  }

  if (
    e.record.getString("community_status") !== original.getString("community_status") ||
    e.record.getBool("founding_verified") !== original.getBool("founding_verified") ||
    e.record.getString("invited_by") !== original.getString("invited_by") ||
    e.record.getString("redeemed_invite") !== original.getString("redeemed_invite") ||
    e.record.getBool("founder_invitation_issuer") !==
      original.getBool("founder_invitation_issuer") ||
    e.record.getBool("direct_founder_invited") !==
      original.getBool("direct_founder_invited") ||
    e.record.getBool("internal_member") !== original.getBool("internal_member")
  ) {
    // Keep both Founder markers inside the existing protected membership
    // provenance boundary; profile requests may never change publication trust.
    throw new BadRequestError("Membership verification and invitation details are managed by Detour.");
  }
  if (e.record.getString("pseudo") !== original.getString("pseudo")) {
    const { assertPseudoAvailable, normalizeMemberPseudo } = require(
      __hooks + "/member_profile.js"
    );
    const pseudo = normalizeMemberPseudo(e.record.getString("pseudo"));
    assertPseudoAvailable(e.app, pseudo, e.record.id);
    e.record.set("pseudo", pseudo);
  }
  // A member may correct their home city but never blank it: signup asked for
  // it, and the circle projection names it. Accounts that predate the required
  // field keep their empty value until they edit it.
  if (e.record.getString("home_city") !== original.getString("home_city")) {
    const { normalizeHomeCity } = require(__hooks + "/member_profile.js");
    e.record.set("home_city", normalizeHomeCity(e.record.getString("home_city")));
  }
  e.record.set("invite_code", "");
  e.next();
}, "members");

// Invitation codes are generated server-side and are always assigned to the
// authenticated member who created the invite. The allowance is the number of
// invitations a member may keep *open* at once — founding members get a larger
// one (see founding_cap.js) — and redeeming one frees a slot.
onRecordCreateRequest((e) => {
  if (!e.auth || e.hasSuperuserAuth()) {
    if (e.hasSuperuserAuth()) {
      return e.next();
    }
    throw new BadRequestError("Sign in to issue an invitation.");
  }

  const founding = require(__hooks + "/founding_cap.js");
  const limit = founding.invitationLimitFor(e.app, e.auth);
  const openInviteCount = e.app.countRecords(
    "invites",
    $dbx.hashExp({ issued_by: e.auth.id, claimed_by: "" })
  );
  if (openInviteCount >= limit) {
    throw new BadRequestError(
      "You already have " + limit +
        " unclaimed invitations. An invitation slot becomes available once someone redeems a code."
    );
  }

  e.record.set("issued_by", e.auth.id);
  e.record.set("code", "DTR-" + $security.randomString(20).toUpperCase());
  e.record.set("claimed_by", "");
  e.record.set("claimed_at", "");
  e.next();
}, "invites");

// Evidence is always attributed to the current member and begins pending.
// Curators approve or reject it in the operator interface.
onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) {
    return e.next();
  }
  if (!e.auth) {
    throw new BadRequestError("Sign in to submit visit evidence.");
  }

  e.record.set("member", e.auth.id);
  e.record.set("status", "pending");
  e.record.set("curator_note", "");
  e.next();
}, "visit_evidence");

// A verified member recommendation is one independent signal on the shared,
// normalized waiting-list entry. All attribution, place resolution, private
// participant state, and publication state are server-owned.
onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) {
    e.record.set("_detour_publication_actor", "");
    e.record.hide("_detour_publication_actor");
    return e.next();
  }

  const community = require(__hooks + "/community_waitlist.js");
  community.requireVerifiedMember(e.auth, "recommending a place");

  const note = community.validateRecommendationNote(e.record.getString("note"));
  const category = community.validateCategory(e.record.getString("category"));
  const occasions = community.validateOccasions(e.record.getStringSlice("occasions"));
  const requestBody = e.requestInfo().body || {};
  const links = community.validateMemberPlaceLinks({
    officialUrl: requestBody.official_url,
    instagram: requestBody.instagram_url,
  });
  const resolved = community.resolveEntry(e.app, e.record.getString("waitlist"), {
    venueName: e.record.getString("venue_name"),
    city: e.record.getString("city"),
    country: e.record.getString("country"),
    address: e.record.getString("address"),
  });

  const duplicate = community.findMemberRecommendation(
    e.app,
    e.auth.id,
    resolved.entry.id
  );
  if (duplicate) {
    // A retry after an after-create publication failure must still reconcile
    // the already-committed signal before returning the duplicate response.
    community.recalculateAndPublish(e.app, resolved.entry.id);
    throw new BadRequestError("You have already recommended this place.");
  }

  // Published places remain open to one recommendation from each member.
  // The shared entry and canonical venue stay the same; this request only adds
  // the caller's note and increments the distinct-member signal count.
  community.mergePlaceFacts(e.app, resolved.entry, category, occasions);
  community.mergePlaceLinks(e.app, resolved.entry, links);
  community.addParticipants(e.app, resolved.entry, [e.auth.id]);
  e.record.set("member", e.auth.id);
  e.record.set("waitlist", resolved.entry.id);
  e.record.set("note", note);
  e.record.set("venue_name", resolved.entry.getString("venue_name"));
  e.record.set("city", resolved.entry.getString("city"));
  e.record.set("country", resolved.entry.getString("country"));
  e.record.set("address", resolved.entry.getString("address"));
  e.record.set("category", category);
  e.record.set("occasions", occasions);
  // Request after-success events no longer retain e.auth in PocketBase 0.39.
  // Carry the authenticated member id as a hidden, non-schema record value so
  // only this real member request can authorize the publication side effects.
  e.record.set("_detour_publication_actor", e.auth.id);
  e.record.hide("_detour_publication_actor");
  e.next();
}, "community_recommendations");

onRecordAfterCreateSuccess((e) => {
  const community = require(__hooks + "/community_waitlist.js");
  const waitlistId = e.record.getString("waitlist");
  const publication = community.recalculateAndPublish(e.app, waitlistId);
  // Publication happened inside the transaction above; the external
  // enrichment runs after it so an outage of OpenStreetMap or of the place's
  // own website can never block or roll back the publish. Members only supply
  // name, city, country, and optionally an address — the address-based
  // geocoder validates what they gave, then the OSM place lookup fills the
  // remaining public facts (website, Instagram, missing address/coordinates),
  // and the cover resolver turns those links into a place image. Failures are
  // retried by the nightly sweeps.
  try {
    const entry = e.app.findRecordById("community_waitlist_entries", waitlistId);
    const publishedVenue = entry.getString("published_venue");
    if (entry.getString("status") === "published" && publishedVenue) {
      community.geocodeVenue(e.app, publishedVenue);
      community.enrichVenueFromOsm(e.app, publishedVenue);
      community.resolveCoverImage(e.app, publishedVenue);
    }
  } catch {
    // Entry lookup is best-effort; the sweeps cover anything missed.
  }

  // A fresh publication caused by this exact authenticated member request gets
  // one reserved notification attempt. Migration/backfill reconciliation,
  // superuser writes, already-published entries, internal members, and reserved
  // .invalid fixtures never claim the marker or produce publication noise.
  let publicationNotification = null;
  if (publication && publication.publishedNow) {
    try {
      const memberId = e.record.getString("member");
      const memberCreatedRecommendation =
        e.record.getString("_detour_publication_actor") === memberId;
      if (memberCreatedRecommendation) {
        const author = e.app.findRecordById("members", memberId);
        const recipient = author.getString("email").trim();
        const reservedInvalidRecipient = /@(?:[^@\s]+\.)*invalid$/i.test(recipient);
        if (
          author.getString("community_status") === "verified" &&
          !author.getBool("internal_member") &&
          recipient &&
          !reservedInvalidRecipient
        ) {
          const claimed = community.claimPublicationNotification(e.app, waitlistId);
          if (claimed) {
            publicationNotification = {
              memberId,
              recipient,
              placeName: String(claimed.venueName || "").trim() || "Your place",
              city: String(claimed.city || "").trim(),
            };
          }
        }
      }
    } catch (error) {
      try {
        e.app.logger().error(
          "Detour publication notification claim failed.",
          "recommendationId",
          e.record.id,
          "waitlistId",
          waitlistId,
          "error",
          String(error)
        );
      } catch {
        // Claim failures must not affect publication, enrichment, or the save.
      }
    }
  }

  if (publicationNotification) {
    try {
      function escapeHtml(value) {
        return String(value || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\"/g, "&quot;")
          .replace(/'/g, "&#39;");
      }

      const apiKey = $os.getenv("AGENTMAIL_API_KEY");
      const inboxId = $os.getenv("AGENTMAIL_INBOX_ID");
      if (!apiKey || !inboxId) {
        throw new Error("AgentMail runtime configuration is missing.");
      }

      const siteUrl = "https://takedetour.app";
      const response = $http.send({
        url:
          "https://api.agentmail.to/v0/inboxes/" +
          encodeURIComponent(inboxId) +
          "/messages/send",
        method: "POST",
        headers: {
          Authorization: "Bearer " + apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: publicationNotification.recipient,
          subject: publicationNotification.placeName + " is on Detour",
          text:
            "Good call — " +
            publicationNotification.placeName +
            " is now on Detour.\n\nSee it: " +
            siteUrl +
            "\n\nYou received this because your recommendation put this place on Detour.",
          html:
            "<p>Good call — <strong>" +
            escapeHtml(publicationNotification.placeName) +
            "</strong> is now on Detour.</p>" +
            '<p><a href="' +
            siteUrl +
            '">See it on Detour</a></p>' +
            "<p>You received this because your recommendation put this place on Detour.</p>",
          labels: ["app"],
        }),
        timeout: 10,
      });
      if (!response || response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(
          "AgentMail returned HTTP " +
            (response && response.statusCode ? response.statusCode : "unknown") +
            "."
        );
      }
    } catch (error) {
      try {
        e.app.logger().error(
          "Detour publication email delivery failed.",
          "recommendationId",
          e.record.id,
          "memberId",
          publicationNotification.memberId,
          "recipient",
          publicationNotification.recipient,
          "error",
          String(error)
        );
      } catch {
        // Email delivery is best-effort after the durable marker is claimed.
      }
    }

    try {
      const eventsUrl = $os.getenv("SUPERNAUT_EVENTS_URL");
      if (!eventsUrl) {
        throw new Error("SUPERNAUT_EVENTS_URL is not configured.");
      }
      const response = $http.send({
        url: eventsUrl,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "detour.place.published",
          subject: "Detour place published",
          text:
            publicationNotification.placeName +
            (publicationNotification.city
              ? " in " + publicationNotification.city
              : "") +
            " is now on Detour.",
        }),
        timeout: 5,
      });
      if (!response || response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(
          "Dashboard events endpoint returned HTTP " +
            (response && response.statusCode ? response.statusCode : "unknown") +
            "."
        );
      }
    } catch (error) {
      try {
        e.app.logger().error(
          "Detour publication event delivery failed.",
          "recommendationId",
          e.record.id,
          "waitlistId",
          waitlistId,
          "error",
          String(error)
        );
      } catch {
        // Dashboard delivery is best-effort after the durable marker is claimed.
      }
    }
  }

  try {
    const memberId = e.record.getString("member");
    const author = e.app.findRecordById("members", memberId);
    if (!author.getBool("internal_member")) {
      const eventsUrl = $os.getenv("SUPERNAUT_EVENTS_URL");
      if (!eventsUrl) {
        throw new Error("SUPERNAUT_EVENTS_URL is not configured.");
      }

      const displayName = author.getString("display_name").trim();
      const pseudo = author.getString("pseudo").trim();
      const memberLabel =
        (displayName || "A Detour member") +
        (pseudo ? " (@" + pseudo + ")" : "");
      const placeName = e.record.getString("venue_name").trim() || "a place";
      const city = e.record.getString("city").trim();
      const response = $http.send({
        url: eventsUrl,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "detour.community_recommendation.created",
          subject: "New Detour recommendation",
          text:
            memberLabel +
            " recommended " +
            placeName +
            (city ? " in " + city : "") +
            ".",
        }),
        timeout: 5,
      });
      if (!response || response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(
          "Dashboard events endpoint returned HTTP " +
            (response && response.statusCode ? response.statusCode : "unknown") +
            "."
        );
      }
    }
  } catch (error) {
    try {
      e.app.logger().error(
        "Detour recommendation event delivery failed.",
        "recommendationId",
        e.record.id,
        "error",
        String(error)
      );
    } catch {
      // Logging must not affect publication, enrichment, or the completed save.
    }
  }

  e.next();
}, "community_recommendations");

// Daily production launch-number rollup at 05:15 UTC. The shared helper owns
// fixture exclusion, zero-activity suppression, delivery, and best-effort
// failure logging; requiring it inside the callback is required by the hook VM.
cronAdd("detour_daily_launch_numbers", "15 5 * * *", () => {
  const launchMetrics = require(__hooks + "/launch_metrics.js");
  launchMetrics.emitLaunchNumbers($app);
});

// The work-list every enrichment sweep runs over: published, un-suppressed
// places, newest first.
//
// This used to be derived from `venue_awards` rows and each sweep swallowed a
// failed lookup with `catch { return }` — so anything that broke the award query
// silently stopped all enrichment, with no error and no signal that newly
// published places were never getting coordinates, cover images, or discovered
// links. Keying on the venue's own marker removes both the indirection and the
// silent-failure mode; a genuine failure here still returns an empty list, but
// there is no longer a second collection that can independently disappear.
function publishedVenuesForSweep(limit) {
  try {
    return $app.findRecordsByFilter(
      "venues",
      "published = true && suppressed != true",
      "-published_at",
      limit || 50,
      0
    );
  } catch {
    return [];
  }
}

// Nightly retry for published community venues that still lack verified
// coordinates (geocoder outage, no-match addresses corrected later, …).
// geocodeVenue exits early for venues that already have coordinates.
cronAdd("community_geocode_sweep", "0 4 * * *", () => {
  const community = require(__hooks + "/community_waitlist.js");
  for (const venue of publishedVenuesForSweep()) {
    community.geocodeVenue($app, venue.id);
  }
});

// Nightly retry for Detourist-list venues that still lack discovered facts or
// a cover image (OSM or the place's site was down at publication, the OSM
// record gained contact tags later, …). Both steps exit early for venues that
// already have everything.
cronAdd("community_cover_sweep", "30 4 * * *", () => {
  const community = require(__hooks + "/community_waitlist.js");
  for (const venue of publishedVenuesForSweep()) {
    community.enrichVenueFromOsm($app, venue.id);
    community.resolveCoverImage($app, venue.id);
  }
});

// Frequent, cost-bounded LLM web-discovery pass for Detourist-list venues the
// OSM tier left without a website, Instagram profile, or address (and thus
// usually without a cover image or map pin). enrichVenueFromWebSearch no-ops
// without OPENAI_API_KEY, skips venues with nothing missing, and re-attempts
// a still-incomplete venue at most weekly; the per-run cap below bounds
// worst-case spend regardless. Nominatim-confirmed coordinates are written by
// the discovery itself, and the cover resolver immediately turns any newly
// found link into a place image — so a member-added place gains its links,
// pin, and photo within the hour after publishing, with no manual step.
cronAdd("community_web_discovery_sweep", "0 * * * *", () => {
  const community = require(__hooks + "/community_waitlist.js");
  let attempts = 0;
  for (const venue of publishedVenuesForSweep()) {
    if (attempts >= 2) break;
    if (community.enrichVenueFromWebSearch($app, venue.id)) {
      attempts += 1;
      community.resolveCoverImage($app, venue.id);
    }
  }
});

// Safety screening fails closed. Retry a small number of transport/configuration
// failures every fifteen minutes; founders never see an unscreened image.
cronAdd("community_image_screening_retry", "*/15 * * * *", () => {
  const curation = require(__hooks + "/image_curation.js");
  curation.retryFailedScreens($app, 3);
});

// A member may correct their own recommendation: the personal note and its
// category/occasions classification. The identity fields (member, waitlist)
// are server-owned and frozen. The place-detail mirrors (venue_name, city,
// country) are re-synced from the shared entry rather than trusted from the
// request, so a note edit can never silently rewrite them and they never drift
// from an accompanying entry edit.
onRecordUpdateRequest((e) => {
  if (e.hasSuperuserAuth()) {
    return e.next();
  }

  const community = require(__hooks + "/community_waitlist.js");
  community.requireVerifiedMember(e.auth, "editing a recommendation");
  const original = e.record.original();
  if (original.getString("member") !== e.auth.id) {
    throw new BadRequestError("You can only edit your own recommendations.");
  }
  if (
    e.record.getString("member") !== original.getString("member") ||
    e.record.getString("waitlist") !== original.getString("waitlist")
  ) {
    throw new BadRequestError(
      "A recommendation cannot be moved to another place or member."
    );
  }

  e.record.set(
    "note",
    community.validateRecommendationNote(e.record.getString("note"))
  );
  e.record.set(
    "category",
    community.validateCategory(e.record.getString("category"))
  );
  e.record.set(
    "occasions",
    community.validateOccasions(e.record.getStringSlice("occasions"))
  );

  // The display mirrors stay authoritative to the shared entry, whatever the
  // request sent. Entry edits arrive first from the client, so this reads the
  // corrected place details.
  try {
    const entry = e.app.findRecordById(
      "community_waitlist_entries",
      original.getString("waitlist")
    );
    e.record.set("venue_name", entry.getString("venue_name"));
    e.record.set("city", entry.getString("city"));
    e.record.set("country", entry.getString("country"));
  } catch {
    // A missing entry is unexpected; leave the existing mirrors untouched.
  }
  e.next();
}, "community_recommendations");

// Deleting a signal updates the server-maintained count, and when it was the
// last one the place is removed from the catalogue outright. Every listed place
// exists because a member put their name behind it; once nobody does, it must
// not keep appearing on a city list. This is the delete-time half of the rule
// migrations 1768019000/1768019200 swept for once — see withdrawUnbackedEntry
// for what is deleted and why private shares survive it.
//
// This also covers account removal: deleting a member cascades their
// recommendations, so each place only they backed is withdrawn with them.
onRecordAfterDeleteSuccess((e) => {
  const community = require(__hooks + "/community_waitlist.js");
  const waitlistId = e.record.getString("waitlist");
  community.recalculateAndPublish(e.app, waitlistId);
  community.withdrawUnbackedEntry(e.app, waitlistId);
  e.next();
}, "community_recommendations");

// Member-supplied images never update a place directly. Public collection
// creation is disabled; the custom route below accepts the candidate URL,
// creates a stable PocketBase snapshot, and initializes every server-owned
// moderation field. Only a founding-member approval route can attach the
// snapshot to a public venue.
onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) {
    return e.next();
  }
  throw new ForbiddenError("Use the place-image submission route.");
}, "community_place_images");

onRecordAfterCreateSuccess((e) => {
  const curation = require(__hooks + "/image_curation.js");
  curation.screenImageSubmission(e.app, e.record.id);
  e.next();
}, "community_place_images");

routerAdd(
  "POST",
  "/api/detour/curation/images",
  (e) => {
    const community = require(__hooks + "/community_waitlist.js");
    community.requireVerifiedMember(e.auth, "submitting a place image");
    const body = e.requestInfo().body || {};
    const waitlistId =
      typeof body.waitlist === "string" ? body.waitlist.trim() : "";
    const entry = e.app.findRecordById(
      "community_waitlist_entries",
      waitlistId
    );
    if (!community.isParticipant(entry, e.auth.id)) {
      throw new BadRequestError(
        "Recommend this place before submitting an image for it."
      );
    }

    let existing = null;
    try {
      existing = e.app.findFirstRecordByFilter(
        "community_place_images",
        "submitted_by = {:member} && waitlist = {:waitlist} && " +
          "(status = 'screening' || status = 'pending' || status = 'screening_failed')",
        { member: e.auth.id, waitlist: entry.id }
      );
    } catch {
      existing = null;
    }
    if (existing) {
      throw new BadRequestError(
        "You already have an image for this place awaiting review."
      );
    }

    const links = community.validateMemberPlaceLinks({
      imageUrl: body.source_url,
    });
    if (!links.image_url) {
      throw new BadRequestError("Add a direct public link to an image.");
    }

    let snapshot;
    try {
      snapshot = $filesystem.fileFromURL(links.image_url);
    } catch {
      throw new BadRequestError(
        "That image could not be copied for private review."
      );
    }

    const collection = e.app.findCollectionByNameOrId(
      "community_place_images"
    );
    const image = new Record(collection);
    image.set("waitlist", entry.id);
    image.set("submitted_by", e.auth.id);
    image.set("source_url", links.image_url);
    image.set("snapshot", snapshot);
    image.set("status", "screening");
    image.set("safety_flagged", false);
    image.set("safety_categories", {});
    image.set("relevance", "");
    image.set("ai_note", "");
    image.set("moderated_at", "");
    image.set("reviewed_by", "");
    image.set("reviewed_at", "");
    image.set("curator_note", "");
    e.app.save(image);

    // Model success hooks normally screen this save. Calling the idempotent
    // helper here also covers direct route saves on PocketBase versions where
    // request success hooks are not dispatched for app.save().
    const curation = require(__hooks + "/image_curation.js");
    curation.screenImageSubmission(e.app, image.id);
    const saved = e.app.findRecordById("community_place_images", image.id);
    return e.json(201, {
      id: saved.id,
      waitlist: saved.getString("waitlist"),
      status: saved.getString("status"),
    });
  },
  $apis.requireAuth("members")
);

routerAdd(
  "GET",
  "/api/detour/curation/images",
  (e) => {
    const founding = require(__hooks + "/founding_cap.js");
    founding.requireFoundingMember(e.app, e.auth, "reviewing place images");
    const records = e.app.findRecordsByFilter(
      "community_place_images",
      "(status = 'pending' || status = 'screening_failed') && safety_flagged = false",
      "created",
      50,
      0
    );
    const collection = e.app.findCollectionByNameOrId("community_place_images");
    const items = [];
    for (const record of records) {
      let entry;
      let submitter;
      try {
        entry = e.app.findRecordById(
          "community_waitlist_entries",
          record.getString("waitlist")
        );
        submitter = e.app.findRecordById(
          "members",
          record.getString("submitted_by")
        );
      } catch {
        continue;
      }
      items.push({
        id: record.id,
        collection_id: collection.id,
        snapshot: record.getString("snapshot"),
        place_name: entry.getString("venue_name"),
        city: entry.getString("city"),
        country: entry.getString("country"),
        submitted_by: submitter.getString("pseudo"),
        screening_status: record.getString("status"),
        relevance: record.getString("relevance") || "uncertain",
        ai_note: record.getString("ai_note"),
        created: record.getString("created"),
      });
    }
    return e.json(200, { items });
  },
  $apis.requireAuth("members")
);

routerAdd(
  "POST",
  "/api/detour/curation/images/{id}/approve",
  (e) => {
    const founding = require(__hooks + "/founding_cap.js");
    founding.requireFoundingMember(e.app, e.auth, "approving a place image");
    const imageId = e.request.pathValue("id");
    const body = e.requestInfo().body || {};
    const curatorNote =
      typeof body.note === "string" ? body.note.trim().slice(0, 1200) : "";
    let result;

    e.app.runInTransaction((txApp) => {
      const image = txApp.findRecordById("community_place_images", imageId);
      const imageStatus = image.getString("status");
      if (
        (imageStatus !== "pending" && imageStatus !== "screening_failed") ||
        image.getBool("safety_flagged")
      ) {
        throw new BadRequestError(
          "Only an unflagged image awaiting founder review can be approved."
        );
      }
      const entry = txApp.findRecordById(
        "community_waitlist_entries",
        image.getString("waitlist")
      );
      const venueId = entry.getString("published_venue");
      if (!venueId) {
        throw new BadRequestError(
          "This place must be published before its image can be approved."
        );
      }
      const venue = txApp.findRecordById("venues", venueId);
      const previousImageId = venue.getString("curated_image");
      if (previousImageId && previousImageId !== image.id) {
        try {
          const previous = txApp.findRecordById(
            "community_place_images",
            previousImageId
          );
          if (previous.getString("status") === "approved") {
            previous.set("status", "superseded");
            txApp.save(previous);
          }
        } catch {
          // A missing prior image must not block a valid replacement.
        }
      }
      image.set("status", "approved");
      image.set("reviewed_by", e.auth.id);
      image.set("reviewed_at", new Date().toISOString());
      image.set("curator_note", curatorNote);
      txApp.save(image);
      venue.set("curated_image", image.id);
      txApp.save(venue);
      result = { id: image.id, status: "approved", venue_id: venue.id };
    });

    return e.json(200, result);
  },
  $apis.requireAuth("members")
);

routerAdd(
  "POST",
  "/api/detour/curation/images/{id}/reject",
  (e) => {
    const founding = require(__hooks + "/founding_cap.js");
    founding.requireFoundingMember(e.app, e.auth, "rejecting a place image");
    const image = e.app.findRecordById(
      "community_place_images",
      e.request.pathValue("id")
    );
    const imageStatus = image.getString("status");
    if (imageStatus !== "pending" && imageStatus !== "screening_failed") {
      throw new BadRequestError(
        "Only an image awaiting founder review can be rejected."
      );
    }
    const body = e.requestInfo().body || {};
    const curatorNote =
      typeof body.note === "string" ? body.note.trim().slice(0, 1200) : "";
    image.set("status", "rejected");
    image.set("reviewed_by", e.auth.id);
    image.set("reviewed_at", new Date().toISOString());
    image.set("curator_note", curatorNote);
    e.app.save(image);
    return e.json(200, { id: image.id, status: "rejected" });
  },
  $apis.requireAuth("members")
);

// Participants may correct a shared waiting-list entry's place details (name,
// address, city, country, category, occasions) and its public links (website
// and Instagram). Photos use the screened curation workflow above. Publication
// and bookkeeping state — status,
// signal_count, participants, the normalized dedup keys, and every venue/audit
// relation — stays server-owned and frozen. Published entries stay editable:
// that is when a wrong name or a poor auto-discovered link becomes visible, and
// the after-update hook below carries the correction to the public venue.
onRecordUpdateRequest((e) => {
  if (e.hasSuperuserAuth()) {
    return e.next();
  }

  const community = require(__hooks + "/community_waitlist.js");
  community.requireVerifiedMember(e.auth, "editing a place");
  const original = e.record.original();
  if (!community.isParticipant(original, e.auth.id)) {
    throw new BadRequestError(
      "Only members who recommended or shared this place can edit it."
    );
  }

  const publishedVenueId = original.getString("published_venue");
  if (publishedVenueId) {
    try {
      const publishedVenue = e.app.findRecordById("venues", publishedVenueId);
      if (community.hasConfirmedCoordinates(publishedVenue)) {
        for (const field of ["venue_name", "address", "city", "country"]) {
          if (e.record.getString(field) !== original.getString(field)) {
            throw new BadRequestError(
              "This place has confirmed coordinates. Its name and location are locked."
            );
          }
        }
      }
    } catch (error) {
      if (error instanceof BadRequestError) throw error;
    }
  }

  if (e.record.getString("image_url") !== original.getString("image_url")) {
    throw new BadRequestError(
      "Place photos must go through safety screening and founding-member review."
    );
  }

  if (e.record.getString("status") !== original.getString("status")) {
    throw new BadRequestError("A place's publication status is set automatically.");
  }
  if (e.record.getInt("signal_count") !== original.getInt("signal_count")) {
    throw new BadRequestError(
      "A place's recommendation count is maintained automatically."
    );
  }

  // Place details are member-correctable. Re-validate them the same way the
  // recommendation create path does and recompute the normalized dedup keys, so
  // a rename keeps the entry findable and de-duplicated.
  const venueName = community.cleanText(e.record.getString("venue_name"), 200);
  const city = community.cleanText(e.record.getString("city"), 120);
  const country = community.cleanText(e.record.getString("country"), 120);
  const address = community.cleanText(e.record.getString("address"), 300);
  const normalizedName = community.normalizePlacePart(venueName);
  const normalizedCity = community.normalizePlacePart(city);
  if (venueName.length < 2 || !normalizedName) {
    throw new BadRequestError("A valid place name is required.");
  }
  if (city.length < 2 || !normalizedCity) {
    throw new BadRequestError("A valid city is required.");
  }
  if (country.length < 2) {
    throw new BadRequestError("A valid country is required.");
  }
  if (
    normalizedName !== original.getString("normalized_name") ||
    normalizedCity !== original.getString("normalized_city")
  ) {
    let clash = null;
    try {
      clash = e.app.findFirstRecordByFilter(
        "community_waitlist_entries",
        "normalized_name = {:name} && normalized_city = {:city} && id != {:id}",
        { name: normalizedName, city: normalizedCity, id: original.id }
      );
    } catch {
      clash = null;
    }
    if (clash) {
      throw new BadRequestError(
        "Another place with this name and city is already on the list."
      );
    }
  }
  e.record.set("venue_name", venueName);
  e.record.set("city", city);
  e.record.set("country", country);
  e.record.set("address", address);
  e.record.set("normalized_name", normalizedName);
  e.record.set("normalized_city", normalizedCity);
  e.record.set(
    "category",
    community.validateCategory(e.record.getString("category"))
  );
  e.record.set(
    "occasions",
    community.validateOccasions(e.record.getStringSlice("occasions"))
  );

  const links = community.validateMemberPlaceLinks(
    {
      officialUrl: e.record.getString("official_url"),
      instagram: e.record.getString("instagram_url"),
      imageUrl: e.record.getString("image_url"),
    },
    { verifiedImageUrl: original.getString("image_url") }
  );
  e.record.set("official_url", links.official_url);
  e.record.set("instagram_url", links.instagram_url);
  e.record.set("image_url", links.image_url);
  e.next();
}, "community_waitlist_entries");

// Carries a member's corrections on an already-published entry — the place
// details (name, address, city, country, category) and its links — to the
// public venue, then lets the cover resolver use any new website/Instagram
// link when the venue still lacks an image. Detail carry-through is guarded to
// community-only venues, so a catalogue venue's editorial data stays
// authoritative. Best-effort by design: venue enrichment must never fail an
// entry update, and the nightly sweeps retry.
onRecordAfterUpdateSuccess((e) => {
  const community = require(__hooks + "/community_waitlist.js");
  try {
    const publishedVenue = e.record.getString("published_venue");
    if (e.record.getString("status") === "published" && publishedVenue) {
      const venue = e.app.findRecordById("venues", publishedVenue);
      community.mergeEntryPlaceIntoVenue(e.app, e.record, venue);
      community.mergeEntryLinksIntoVenue(e.app, e.record, venue);
      community.resolveCoverImage(e.app, publishedVenue);
    }
  } catch {
    // The nightly sweeps cover anything missed here.
  }
  e.next();
}, "community_waitlist_entries");

// A share sends a place to another member with a personal note. The place is
// either an existing catalogue venue (referenced directly) or the sender's own
// place, which enters the shared waiting list. A share never counts as a
// recommendation signal.
onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) {
    return e.next();
  }

  const community = require(__hooks + "/community_waitlist.js");
  community.requireVerifiedMember(e.auth, "sharing a place");

  const recipientId = e.record.getString("recipient");
  if (!recipientId) {
    throw new BadRequestError("Choose a Detour member to share with.");
  }
  if (recipientId === e.auth.id) {
    throw new BadRequestError("You cannot share a place with yourself.");
  }
  let recipient;
  try {
    recipient = e.app.findRecordById("members", recipientId);
  } catch {
    throw new BadRequestError("The share recipient is not a valid Detour member.");
  }

  const note = community.validateShareNote(e.record.getString("personal_note"));

  const venueId = e.record.getString("venue");
  if (venueId) {
    let venue;
    try {
      venue = e.app.findRecordById("venues", venueId);
    } catch {
      throw new BadRequestError("The shared place is not in the Detour selection.");
    }
    e.record.set("waitlist", "");
    e.record.set("venue_name", venue.getString("name"));
    e.record.set("city", venue.getString("city"));
    e.record.set("country", venue.getString("country"));
    e.record.set("address", venue.getString("address"));
  } else {
    const resolved = community.resolveEntry(e.app, e.record.getString("waitlist"), {
      venueName: e.record.getString("venue_name"),
      city: e.record.getString("city"),
      country: e.record.getString("country"),
      address: e.record.getString("address"),
    });
    // A place that already published is shared as its catalogue venue; an
    // unpublished one links the sender to its waiting-list entry.
    const publishedVenue = resolved.entry.getString("published_venue");
    if (resolved.entry.getString("status") === "published" && publishedVenue) {
      e.record.set("venue", publishedVenue);
      e.record.set("waitlist", "");
    } else {
      community.addParticipants(e.app, resolved.entry, [e.auth.id]);
      e.record.set("waitlist", resolved.entry.id);
    }
    e.record.set("venue_name", resolved.entry.getString("venue_name"));
    e.record.set("city", resolved.entry.getString("city"));
    e.record.set("country", resolved.entry.getString("country"));
    e.record.set("address", resolved.entry.getString("address"));
  }

  e.record.set("sender", e.auth.id);
  e.record.set("recipient", recipientId);
  e.record.set("sender_name", e.auth.getString("pseudo") || e.auth.getString("display_name") || "A Detour member");
  e.record.set("recipient_name", recipient.getString("pseudo") || recipient.getString("display_name") || "A Detour member");
  e.record.set("sender_pseudo", e.auth.getString("pseudo"));
  e.record.set("recipient_pseudo", recipient.getString("pseudo"));
  e.record.set("personal_note", note);
  e.record.set("seen", false);
  e.next();
}, "community_shares");

// Each side owns only its own view state: the recipient marks shares as seen
// and archives their inbox copy (`seen`, `archived`), the sender archives
// their sent copy (`sender_archived`). Every other share field is server-owned
// and immutable after creation.
onRecordUpdateRequest((e) => {
  if (e.hasSuperuserAuth()) {
    return e.next();
  }
  const isRecipient = e.auth && e.auth.id === e.record.getString("recipient");
  const isSender = e.auth && e.auth.id === e.record.getString("sender");
  if (!isRecipient && !isSender) {
    throw new BadRequestError("Only the sender or recipient can update a share.");
  }
  const original = e.record.original();
  const frozen = [
    "sender",
    "recipient",
    "waitlist",
    "venue",
    "personal_note",
    "venue_name",
    "city",
    "country",
    "address",
    "sender_name",
    "recipient_name",
    "sender_pseudo",
    "recipient_pseudo",
  ];
  for (const field of frozen) {
    if (e.record.getString(field) !== original.getString(field)) {
      throw new BadRequestError("Only the view state of a share can change.");
    }
  }
  if (!isRecipient) {
    for (const field of ["seen", "archived"]) {
      if (e.record.getBool(field) !== original.getBool(field)) {
        throw new BadRequestError("Only the recipient can change their inbox state.");
      }
    }
  }
  if (!isSender && e.record.getBool("sender_archived") !== original.getBool("sender_archived")) {
    throw new BadRequestError("Only the sender can archive their sent share.");
  }
  e.next();
}, "community_shares");

// Replies are contextual to one existing share, never a generic chat/feed. The
// server owns author attribution and accepts replies only from a verified share
// participant.
onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) {
    return e.next();
  }

  const community = require(__hooks + "/community_waitlist.js");
  community.requireVerifiedMember(e.auth, "replying to a shared place");

  const shareId = e.record.getString("share");
  if (!shareId) {
    throw new BadRequestError("Choose a valid shared place to reply to.");
  }

  let share;
  try {
    share = e.app.findRecordById("community_shares", shareId);
  } catch {
    throw new BadRequestError("The referenced shared place is not available.");
  }
  if (
    share.getString("sender") !== e.auth.id &&
    share.getString("recipient") !== e.auth.id
  ) {
    throw new BadRequestError("Only the share participants can reply.");
  }

  const rawBody = String(e.record.getString("body") || "");
  if (rawBody.length > 1200) {
    throw new BadRequestError("A reply can be at most 1200 characters.");
  }
  const body = rawBody
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = body
    .split(/\s+/)
    .map((word) =>
      word.replace(/[.,!?;:'"()\[\]{}<>/\\|`~@#$%^&*+=_-]+/g, "")
    )
    .filter((word) => word.length >= 2);
  if (body.length < 8 || words.length < 2) {
    throw new BadRequestError("Add a thoughtful reply of at least 8 characters and two words.");
  }

  const authorPseudo = e.auth.getString("pseudo");
  const authorName = authorPseudo || e.auth.getString("display_name") || "A Detour member";
  if (!authorPseudo) {
    throw new BadRequestError("Complete your member pseudo before replying.");
  }

  e.record.set("share", share.id);
  e.record.set("author", e.auth.id);
  e.record.set("author_name", authorName);
  e.record.set("author_pseudo", authorPseudo);
  e.record.set("body", body);
  e.next();
}, "community_share_replies");

// Member replies cannot be edited or deleted after creation. This preserves
// the private thread as sent while still allowing superuser moderation tools.
onRecordUpdateRequest((e) => {
  if (e.hasSuperuserAuth()) {
    return e.next();
  }
  throw new BadRequestError("Replies cannot be edited after they are sent.");
}, "community_share_replies");

onRecordDeleteRequest((e) => {
  if (e.hasSuperuserAuth()) {
    return e.next();
  }
  throw new BadRequestError("Replies cannot be deleted after they are sent.");
}, "community_share_replies");

// Recommendations enter a private, pending curation queue. A verified status
// is checked server-side as well as in the collection rule.
onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) {
    return e.next();
  }
  if (!e.auth || e.auth.getString("community_status") !== "verified") {
    throw new BadRequestError("Verified Detour membership is required before submitting a detour.");
  }

  e.record.set("member", e.auth.id);
  e.record.set("status", "pending");
  e.record.set("curator_note", "");
  e.next();
}, "detour_submissions");

// Olga and other authorized curators can retain the historic founding-cohort
// marker. Invitation redemption remains the membership requirement, so this
// legacy field never revokes active membership.
routerAdd(
  "POST",
  "/api/detour/curation/members/{id}/founding-verification",
  (e) => {
    const body = e.requestInfo().body || {};
    const memberId = e.request.pathValue("id");
    const verified = body.verified === undefined ? true : body.verified;

    if (typeof verified !== "boolean") {
      throw new BadRequestError("verified must be a boolean.");
    }

    const member = e.app.findRecordById("members", memberId);
    member.set("founding_verified", verified);
    member.set("community_status", "verified");
    e.app.save(member);

    const updated = e.app.findRecordById("members", member.id);
    return e.json(200, {
      member_id: updated.id,
      founding_verified: updated.getBool("founding_verified"),
      community_status: updated.getString("community_status"),
    });
  },
  $apis.requireSuperuserAuth()
);

// Publication is deliberately a curator-only action rather than a record update.
// It writes the safe public catalogue facts and the private audit link together
// in one transaction, so a submission is never marked published on its own.
routerAdd(
  "POST",
  "/api/detour/curation/submissions/{id}/publish",
  (e) => {
    const body = e.requestInfo().body || {};
    const submissionId = e.request.pathValue("id");
    const country = typeof body.country === "string" ? body.country.trim() : "";
    const address = typeof body.address === "string" ? body.address.trim() : "";
    const officialUrl = typeof body.official_url === "string" ? body.official_url.trim() : "";
    const category = typeof body.category === "string" ? body.category.trim() : "";
    const hasLat = typeof body.lat === "number";
    const hasLng = typeof body.lng === "number";

    function requireCheck(name) {
      if (body[name] !== true) {
        throw new BadRequestError("Curator confirmation is required: " + name + ".");
      }
    }

    let result;
    e.app.runInTransaction((txApp) => {
      const submission = txApp.findRecordById("detour_submissions", submissionId);
      const status = submission.getString("status");
      const member = txApp.findRecordById("members", submission.getString("member"));
      const venueName = submission.getString("venue_name").trim();
      const city = submission.getString("city").trim();

      if (
        member.getString("email") === "community-proof@detour.invalid" ||
        venueName === "Editorial curation proof — not public"
      ) {
        throw new BadRequestError("The reserved community proof fixture can never be published.");
      }
      if (status === "published") {
        const publishedVenueId = submission.getString("published_venue");
        // The audit link is the published venue plus `publication_audit_id`;
        // there is no award record to point at any more.
        if (!publishedVenueId || !submission.getString("publication_audit_id")) {
          throw new BadRequestError("This published submission is missing its private publication audit link.");
        }
        result = {
          submission_id: submission.id,
          venue_id: publishedVenueId,
          status: "published",
          attribution: "Detour community selection",
          idempotent: true,
        };
        return;
      }
      if (status !== "approved") {
        throw new BadRequestError("Only an approved submission can be published.");
      }
      if (!country || country.length > 120) {
        throw new BadRequestError("A separately verified country is required.");
      }
      if (address.length > 300 || officialUrl.length > 2048 || category.length > 120) {
        throw new BadRequestError("One or more public venue fields exceed their allowed length.");
      }
      requireCheck("identity_checked");
      requireCheck("official_url_checked");
      requireCheck("rights_checked");
      requireCheck("consent_checked");
      requireCheck("editorial_selected");
      if (address) requireCheck("address_checked");
      if (hasLat !== hasLng) {
        throw new BadRequestError("Latitude and longitude must be supplied together.");
      }
      if (hasLat) {
        if (
          !body.location_verified ||
          typeof body.location_approximate !== "boolean" ||
          body.lat < -90 ||
          body.lat > 90 ||
          body.lng < -180 ||
          body.lng > 180
        ) {
          throw new BadRequestError("Verified, qualified coordinates are required for a public map location.");
        }
      } else if (body.location_verified === true || body.location_approximate !== undefined) {
        throw new BadRequestError("Location qualification may be supplied only with latitude and longitude.");
      }
      if (!venueName || !city) {
        throw new BadRequestError("The approved submission is missing a venue name or city.");
      }

      let venue;
      try {
        venue = txApp.findFirstRecordByFilter(
          "venues",
          "name = {:name} && city = {:city}",
          { name: venueName, city: city }
        );
      } catch {
        const venues = txApp.findCollectionByNameOrId("venues");
        venue = new Record(venues);
        venue.set("name", venueName);
        venue.set("city", city);
        venue.set("country", country);
        venue.set("address", address);
        venue.set("official_url", officialUrl);
        venue.set("category", category);
        venue.set("approx_location", hasLat ? body.location_approximate : false);
        if (hasLat) {
          venue.set("lat", body.lat);
          venue.set("lng", body.lng);
        }
        txApp.save(venue);
      }

      if (venue.getString("country").trim().toLowerCase() !== country.toLowerCase()) {
        throw new BadRequestError("The canonical venue country does not match the curator-verified country.");
      }

      // A curator publishing is the deliberate reversal of a curator takedown.
      // Without clearing it here, re-publishing a suppressed venue would report
      // success and change nothing a visitor can see, because visibility is
      // derived and suppression overrides it.
      if (venue.getBool("suppressed") || !venue.getBool("published")) {
        venue.set("suppressed", false);
        venue.set("published", true);
        if (!venue.getString("published_at")) {
          venue.set("published_at", new Date().toISOString());
        }
        txApp.save(venue);
      }

      // No award record: the venue's own marker above is the publication, and
      // `publication_audit_id` is the audit link.
      submission.set("published_venue", venue.id);
      submission.set("published_at", new Date().toISOString());
      submission.set("publication_audit_id", "dc-" + $security.randomString(32));
      submission.set("status", "published");
      txApp.save(submission);

      result = {
        submission_id: submission.id,
        venue_id: venue.id,
        status: "published",
        attribution: "Detour community selection",
        idempotent: false,
      };
    });

    return e.json(200, result);
  },
  $apis.requireSuperuserAuth()
);

// Corrections and rights concerns remove the community label first while
// retaining the private submission for an audited re-review or rejection.
routerAdd(
  "POST",
  "/api/detour/curation/submissions/{id}/unpublish",
  (e) => {
    const submissionId = e.request.pathValue("id");
    let result;

    e.app.runInTransaction((txApp) => {
      const submission = txApp.findRecordById("detour_submissions", submissionId);
      if (submission.getString("status") !== "published") {
        result = {
          submission_id: submission.id,
          status: submission.getString("status"),
          idempotent: true,
        };
        return;
      }

      // Public visibility is a derived fact — a place is public because a real
      // member recommended it. That recommendation still stands after a takedown,
      // so clearing a publication record would not hide the place on its own.
      // Suppression is therefore the actual lever, and only a curator can set or
      // clear it (a later member recommendation must never silently undo a
      // takedown). This replaces demoting a `venue_awards` row to current = false.
      const suppressedVenueId = submission.getString("published_venue");
      if (suppressedVenueId) {
        try {
          const venue = txApp.findRecordById("venues", suppressedVenueId);
          if (!venue.getBool("suppressed") || venue.getBool("published")) {
            venue.set("suppressed", true);
            // Clear the marker too, so the enrichment sweeps stop spending
            // OSM/LLM calls on a place that is no longer public. `published_at`
            // is deliberately kept as history.
            venue.set("published", false);
            txApp.save(venue);
          }
        } catch {
          // A venue already deleted outright needs no suppression.
        }
      }

      submission.set("published_venue", "");
      submission.set("published_at", "");
      submission.set("publication_audit_id", "");
      submission.set("status", "approved");
      txApp.save(submission);
      result = { submission_id: submission.id, status: "approved", idempotent: false };
    });

    return e.json(200, result);
  },
  $apis.requireSuperuserAuth()
);

// Member-contributed places use a distinct curator-reviewed lane. The request
// hook owns attribution, private moderation state, normalization, rate limits,
// and open-submission duplicate protection; it never writes catalogue venues.
onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) {
    return e.next();
  }
  if (!e.auth || e.auth.getString("community_status") !== "verified") {
    throw new BadRequestError(
      "Verified Detour membership is required before contributing a place."
    );
  }

  function cleanText(value, max, label) {
    let cleaned = String(value || "");
    if (typeof cleaned.normalize === "function") {
      cleaned = cleaned.normalize("NFKC");
    }
    cleaned = cleaned
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned.length > max) {
      throw new BadRequestError(label + " is too long.");
    }
    return cleaned;
  }

  function normalizePlacePart(value) {
    let normalized = value;
    if (typeof normalized.normalize === "function") {
      normalized = normalized.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    }
    return normalized
      .toLowerCase()
      .replace(/[’'`´]/g, "")
      .replace(/&/g, " and ")
      .replace(/[\u2010-\u2015]/g, " ")
      .replace(/[.,/#!$%^*;:{}=\-_~()\[\]"?<>\\|+]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  const privateInput = new DynamicModel({ recommendation_note: "" });
  e.bindBody(privateInput);
  const placeName = cleanText(e.record.getString("place_name"), 200, "Place name");
  const city = cleanText(e.record.getString("city"), 120, "City");
  const country = cleanText(e.record.getString("country"), 120, "Country");
  const address = cleanText(e.record.getString("address"), 300, "Address");
  // Hidden fields are not hydrated from the public record input, so read the
  // private recommendation directly from this create request and then set it
  // on the record after validation.
  const recommendationNote = cleanText(
    privateInput.recommendation_note,
    2400,
    "Recommendation note"
  );
  const normalizedName = normalizePlacePart(placeName);
  const normalizedCity = normalizePlacePart(city);

  if (placeName.length < 2 || !normalizedName) {
    throw new BadRequestError("A valid place name is required.");
  }
  if (city.length < 2 || !normalizedCity) {
    throw new BadRequestError("A valid city is required.");
  }
  if (country.length < 2) {
    throw new BadRequestError("A valid country is required.");
  }

  const noteWords = recommendationNote
    .split(/\s+/)
    .map((word) => word.replace(/[.,!?;:'"()\[\]{}<>/\\|`~@#$%^&*+=_-]+/g, ""))
    .filter((word) => word.length >= 2);
  if (recommendationNote.length < 24 || noteWords.length < 5) {
    throw new BadRequestError(
      "Add a meaningful recommendation of at least 24 characters and five words."
    );
  }

  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace("T", " ");
  const recentContributions = e.app.findRecordsByFilter(
    "member_place_contributions",
    "member = {:member} && created >= {:cutoff}",
    "-created",
    5,
    0,
    { member: e.auth.id, cutoff: cutoff }
  );
  if (recentContributions.length >= 5) {
    throw new BadRequestError(
      "You can contribute up to five places in any seven-day period."
    );
  }

  let duplicate = null;
  try {
    duplicate = e.app.findFirstRecordByFilter(
      "member_place_contributions",
      "normalized_name = {:name} && normalized_city = {:city} && (status = 'in_review' || status = 'approved')",
      { name: normalizedName, city: normalizedCity }
    );
  } catch {
    // No open contribution currently has this normalized place identity.
  }
  if (duplicate) {
    throw new BadRequestError(
      "This place already has a contribution in review or approved for this city."
    );
  }

  e.record.set("place_name", placeName);
  e.record.set("city", city);
  e.record.set("country", country);
  e.record.set("address", address);
  e.record.set("recommendation_note", recommendationNote);
  e.record.set("normalized_name", normalizedName);
  e.record.set("normalized_city", normalizedCity);
  e.record.set("member", e.auth.id);
  e.record.set("source", "member_recommended");
  e.record.set("status", "in_review");
  e.record.set("curator_note", "");
  e.record.set("reviewed_at", "");
  e.next();
}, "member_place_contributions");
