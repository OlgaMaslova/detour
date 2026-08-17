/// <reference path="../pb_data/types.d.ts" />

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
// after-create hook delivers exactly one notification per saved response. The
// message is built from the form config, so a new survey is readable without
// touching this hook.
onRecordAfterCreateSuccess((e) => {
  try {
    const config = require(__hooks + "/survey_forms.json");
    // Require the formatter inside this callback. PocketBase invokes hook
    // callbacks in an isolated VM, so a module-scope helper would not exist here.
    const { buildSurveyResponseReport } = require(__hooks + "/survey_report.js");
    const formId = e.record.getString("form");
    const version = e.record.get("form_version");
    // JSONField values are raw bytes through Record#get. Build a DynamicModel
    // from every current and versioned question key, then unmarshal those bytes
    // so the report sees the answers actually stored in the response. Reading
    // keys from config keeps a later form addition readable without another
    // hook edit.
    const answerDefaults = {};
    function addAnswerKeys(questions) {
      for (const question of questions || []) answerDefaults[question.key] = "";
    }
    const sets = config.questionSets || {};
    for (const setName in sets) addAnswerKeys(sets[setName]);
    const forms = config.forms || {};
    for (const configuredFormId in forms) addAnswerKeys(forms[configuredFormId].questions);
    const historicalVersions = config.reportingVersions || {};
    for (const historicalFormId in historicalVersions) {
      const versions = historicalVersions[historicalFormId];
      for (const historicalVersion in versions) addAnswerKeys(versions[historicalVersion].questions);
    }
    const answers = new DynamicModel(answerDefaults);
    e.record.unmarshalJSONField("answers", answers);
    const report = buildSurveyResponseReport(config, formId, version, answers);

    require(__hooks + "/mailer.js").notifyOps(e.app, {
      subject: "New Detour survey response: " + formId,
      text: report,
    });
  } catch (error) {
    try {
      e.app.logger().error(
        "Detour survey-response notification failed.",
        "responseId",
        e.record.id,
        "error",
        String(error)
      );
    } catch {
      // Logging must not turn best-effort notification into a failed save.
    }
  }

  e.next();
}, "survey_responses");

// The invite claim offered on a survey confirmation asks for an email and
// nothing else: someone who has just answered four questions anonymously has
// already given what we needed, and a second form with a name, a city and a
// recommendation is where they leave.
//
// It cannot go through the collection's create API, because the create hook in
// invite_requests.pb.js requires all three of those — deliberately, for the home
// page form. A route saving the record itself keeps that guard intact for the
// form that means it, and puts `source` beyond the caller's reach: a claim is
// recorded as the survey it came from, which is the only way to tell a survey
// signup from a cold one on the home page.
routerAdd("POST", "/api/detour/invite-request/{form}", (e) => {
  // PocketBase runs each handler in an isolated VM, so helpers are local.
  // An address has no internal whitespace, so stripping it is clean up enough
  // here: anything else unwanted is rejected by the character check below.
  function normalizeEmail(value) {
    let raw = String(value === undefined || value === null ? "" : value);
    if (raw.length > 1024) throw new BadRequestError("Enter a valid email address.");
    if (typeof raw.normalize === "function") raw = raw.normalize("NFKC");
    return raw.replace(/\s+/g, "").toLowerCase();
  }

  // Deliberately the same shape as the create hook's check: a claim and a home
  // page request must not disagree about what an address is.
  function validEmail(email) {
    if (!email || email.length > 254) return false;
    const at = email.indexOf("@");
    if (at <= 0 || at !== email.lastIndexOf("@")) return false;

    const local = email.slice(0, at);
    const domain = email.slice(at + 1);
    if (
      local.length > 64 ||
      domain.length > 253 ||
      local.charAt(0) === "." ||
      local.charAt(local.length - 1) === "." ||
      local.indexOf("..") !== -1 ||
      !/^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+$/.test(local)
    ) {
      return false;
    }

    const labels = domain.split(".");
    if (labels.length < 2) return false;
    for (const label of labels) {
      if (
        !label ||
        label.length > 63 ||
        label.charAt(0) === "-" ||
        label.charAt(label.length - 1) === "-" ||
        !/^[a-z0-9-]+$/.test(label)
      ) {
        return false;
      }
    }
    return true;
  }

  function alreadyRequested(app, email) {
    try {
      return Boolean(
        app.findFirstRecordByFilter("invite_requests", "email = {:email}", { email: email })
      );
    } catch {
      return false;
    }
  }

  const config = require(__hooks + "/survey_forms.json");
  const forms = config.forms;
  const formId = e.request.pathValue("form");
  const form = Object.prototype.hasOwnProperty.call(forms, formId) ? forms[formId] : null;
  // Only a survey that offers the claim can accept one, so the endpoint cannot
  // be used as a general-purpose email-only signup the team never opened.
  if (!form || !form.success || !form.success.inviteCta) {
    throw new NotFoundError("This survey does not offer an invitation.");
  }

  let body;
  try {
    body = e.requestInfo().body;
  } catch {
    throw new BadRequestError("A valid JSON object is required.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new BadRequestError("A valid JSON object is required.");
  }

  const email = normalizeEmail(body.email);
  if (!validEmail(email)) throw new BadRequestError("Enter a valid email address.");

  // Asking twice is not an error worth scolding anyone for, but it is not a new
  // request either — the caller is told plainly which of the two happened.
  if (alreadyRequested(e.app, email)) return e.json(200, { ok: true, duplicate: true });

  const collection = e.app.findCollectionByNameOrId("invite_requests");
  const request = new Record(collection);
  request.set("email", email);
  request.set("status", "new");
  request.set("source", "survey-" + formId);
  try {
    e.app.save(request);
  } catch (error) {
    // A simultaneous claim for the same address loses the unique index race.
    if (alreadyRequested(e.app, email)) return e.json(200, { ok: true, duplicate: true });
    throw error;
  }

  return e.json(201, { ok: true, duplicate: false });
});

// These private routes bypass member rules only for explicit safe projections.
routerAdd(
  "GET",
  "/api/detour/community/me",
  (e) => {
    // invitation_limit is the member's computed allowance, not their tier: the
    // founding markers it derives from are hidden fields and stay server-side.
    const founding = require(__hooks + "/founding_cap.js");
    const foundingMember = founding.isFoundingMember(e.app, e.auth);
    // Only the Founder is offered the founding toggle when issuing an invitation,
    // and only she is told how many of the fifty are left — the size of the
    // remaining founding circle is not a fact the rest of the membership reads
    // off their own invitations tab.
    const canGrantFounding = founding.canGrantFounding(e.app, e.auth);
    // Attendance is recorded on the way past: this is the one authenticated call
    // every surface already makes once per document load, so it is where a visit
    // becomes a fact without new client plumbing.
    const sessions = require(__hooks + "/member_sessions.js");
    const session = sessions.touchMemberSession(e.app, e.auth);
    // ONE THING TO ANSWER, NEVER TWO. The landing's answer slot takes the first
    // that applies, by the precedence in docs/landing-spec.md: an ask, else a
    // triage card, else a "been yet?" follow-up, else the week's prompt, else
    // nothing. The three that exist today are resolved in that order here, and
    // silence is a legitimate answer — an invented prompt is the same broken
    // promise as an empty feed, one layer up.
    //
    // THE ORDER OF THESE THREE CALLS IS LOAD-BEARING, not stylistic. Both the
    // follow-up and the place prompt stamp the member's record as a side effect of
    // returning something — that stamp is what stops the same question arriving on
    // every page load — so calling one and discarding its answer burns a question
    // nobody was shown. Each is reached only while the slot is still free, and the
    // cheap check that cannot spend anything (the triage card) goes first.
    //
    // All three are after the session ping, never before: each reads the
    // previous-visit stamp that ping just moved to decide whether this visit has
    // been asked already.
    const triageCard = require(__hooks + "/landing_triage.js").nextTriageCard(
      e.app,
      e.auth.id,
      []
    );
    const followUp = triageCard
      ? null
      : require(__hooks + "/landing_followup.js").nextFollowUp(
          e.app,
          e.auth,
          session
        );
    const prompts = require(__hooks + "/place_prompts.js");
    const placePrompt =
      triageCard || followUp
        ? null
        : prompts.resolvePlacePrompt(e.app, e.auth, session);
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
        can_grant_founding: canGrantFounding,
        founding_seats_remaining: canGrantFounding
          ? founding.foundingSeatsRemaining(e.app)
          : null,
        image_curation_count: imageCurationCount,
        // Attendance, computed: the stored timestamps stay server-side.
        visit_count: session.visit_count,
        days_away: session.days_away,
        new_session: session.new_session,
        // Which rung of the first-place ask this member is due, and the facts it
        // may need. Null when there is nothing to ask. The wording is the
        // client's; see place_prompts.js.
        place_prompt: placePrompt,
        // The first card of the visit, so the landing's answer slot is filled by
        // the same request that decides the masthead rather than appearing a beat
        // later. Every card after this one comes from /api/detour/landing/triage.
        triage_card: triageCard,
        // *Been yet?* about a place this member said they wanted to go to, three
        // weeks ago or more, in a city they are plausibly in. Null when there is
        // nothing to ask — which is most members most of the time. One per visit:
        // it is not a queue, and it does not advance the way a triage card does.
        follow_up: followUp,
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
    const community = require(__hooks + "/place_entries.js");
    const entries = e.app.findRecordsByFilter(
      "community_place_entries",
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

// The visitor's feed: every published recommendation the founding circle stands
// behind, newest first. One rule, applied the same way whether the caller asked
// for a city or for everything — the founding tier is a visitor's whole
// visibility, exactly as /api/detour/place-detourists decides which places reach
// them. The two must agree: a card here whose place the catalogue withheld would
// open onto a page saying the place does not exist.
//
// It used to be two different rules — three founding-circle notes for the landing
// preview, and every discovery-visible member's notes for a city — which meant a
// visitor who clicked into a city read members the front page had never offered
// them and the catalogue had not put on their list.
//
// The one-per-city ranking that shaped the old landing preview now lives on the
// client, which is where it belongs: it is a rule about three slots on one
// screen, not about who may be read.
//
// The private source collections have no public CRUD rules, so visibility and
// fixture exclusions are independently enforced here.
routerAdd("GET", "/api/detour/public-recommendations", (e) => {
  const founding = require(__hooks + "/founding_cap.js");
  const photos = require(__hooks + "/recommendation_photos.js");
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
      // The recommendation's own id. Clients front the most recent
      // recommendation for a place and break ties on this, so the same card
      // shows the same note and the same photo on every render.
      id: String(row.recommendation_id || "").trim(),
      venue_name: venueName,
      city: city,
      country: country,
      // Carried so a visitor's card reads like a member's: the same renderer
      // prints the place's street line and dates the byline from `created`, and
      // without them the public feed would render the same component visibly
      // poorer for no reason of policy.
      address: String(row.address || "").trim(),
      created: String(row.created || "").trim(),
      note: note,
      recommender_pseudo: recommenderPseudo,
      founding_member: Boolean(row.founding_member),
      // No `in_graph`: it reports which of two visibility clauses matched, and a
      // visitor has only one. Sending a constant false would be read by the
      // client's Founders'-places filter as "outside your circle" and empty the
      // whole feed — the filter exists to separate the founding tier from a
      // member's own people, and a visitor has no own people to separate it from.
      venue_id: venueId,
      // The photo this member attached to this note, never the venue's cover.
      photo_url: photos.photoUrl(e.app, row),
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
  const rowShape = {
    recommendation_id: "",
    venue_name: "",
    city: "",
    country: "",
    address: "",
    created: "",
    note: "",
    recommender_pseudo: "",
    founding_member: false,
    venue_id: "",
  };
  const photoFields = photos.photoRowFields();
  for (const key of Object.keys(photoFields)) rowShape[key] = photoFields[key];
  const rows = arrayOf(new DynamicModel(rowShape));

  try {
    const projection =
      "COALESCE(r.id, '') AS recommendation_id, " +
      "COALESCE(TRIM(v.name), '') AS venue_name, " +
      "COALESCE(TRIM(v.city), '') AS city, " +
      "COALESCE(TRIM(v.country), '') AS country, " +
      "COALESCE(TRIM(v.address), '') AS address, " +
      "COALESCE(r.created, '') AS created, " +
      "COALESCE(TRIM(r.note), '') AS note, " +
      "COALESCE(TRIM(m.pseudo), '') AS recommender_pseudo, " +
      "CASE WHEN " + founding.foundingMemberSql("m") + " THEN TRUE ELSE FALSE END AS founding_member, " +
      "COALESCE(v.id, '') AS venue_id " +
      photos.photoColumns();
    const joinsAndFilters =
      "FROM community_recommendations r " +
      "JOIN members m ON m.id = r.member " +
      "JOIN community_place_entries w ON w.id = r.entry " +
      "JOIN venues v ON v.id = w.published_venue " +
      photos.photoJoin("r") +
      "WHERE w.status = 'published' " +
      "AND w.published_venue != '' " +
      "AND w.published_at != '' " +
      "AND COALESCE(v.suppressed, FALSE) = FALSE " +
      "AND COALESCE(m.internal_member, FALSE) = FALSE " +
      "AND m.community_status = 'verified' " +
      "AND COALESCE(m.discovery_visible, FALSE) = TRUE " +
      // The founding circle, and only the founding circle. This is the whole of
      // a visitor's visibility rule and it is the same one place-detourists
      // applies when it decides which places are on their list.
      "AND " + founding.foundingMemberSql("m") + " " +
      "AND LOWER(TRIM(m.email)) NOT LIKE '%.invalid' " +
      "AND LOWER(TRIM(m.email)) NOT LIKE 'agent@%' " +
      "AND LENGTH(TRIM(r.note)) >= 24 " +
      "AND TRIM(m.pseudo) != '' ";
    // Same cap as the member feed, so neither surface is the one that quietly
    // stops at a different number of notes.
    const sql =
      "SELECT " + projection + joinsAndFilters +
      (city ? "AND LOWER(TRIM(v.city)) = LOWER({:city}) " : "") +
      "ORDER BY r.created DESC, r.id DESC LIMIT 100";

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
    const photos = require(__hooks + "/recommendation_photos.js");
    const scope = require(__hooks + "/circle_scope.js");
    // Route handlers run in isolated VMs, so all route-specific helpers and
    // query models live inside this handler.
    function recommendationRowShape() {
      const shape = {
        recommendation_id: "",
        recommender_pseudo: "",
        member_id: "",
        founding_member: false,
        note: "",
        venue_name: "",
        city: "",
        country: "",
        address: "",
        venue_id: "",
        created: "",
      };
      const photoFields = photos.photoRowFields();
      for (const key of Object.keys(photoFields)) shape[key] = photoFields[key];
      return shape;
    }

    // The recommendation columns every branch below selects, photo included.
    // Written once so the anonymous sample and the member feed cannot drift
    // into showing a photo on one surface and not the other.
    //
    // Place facts come from the published venue when there is one, because the
    // venue is the canonical record and a curator may correct it after
    // publication; the copy stamped on the recommendation at submission time is
    // only the fallback for places that have not published yet. Serving the
    // stale copy is how a fixed city once silently detached every note from its
    // place card. Both branches therefore LEFT JOIN the entry and its venue.
    const recommendationColumns =
      "r.id AS recommendation_id, m.pseudo AS recommender_pseudo, m.id AS member_id, " +
      "CASE WHEN " + founding.foundingMemberSql("m") + " THEN TRUE ELSE FALSE END AS founding_member, " +
      "r.note, " +
      "COALESCE(NULLIF(TRIM(v.name), ''), r.venue_name) AS venue_name, " +
      "COALESCE(NULLIF(TRIM(v.city), ''), r.city) AS city, " +
      "COALESCE(NULLIF(TRIM(v.country), ''), r.country) AS country, " +
      "COALESCE(NULLIF(TRIM(v.address), ''), r.address) AS address, " +
      "COALESCE(v.id, '') AS venue_id, r.created " +
      photos.photoColumns();
    const venueJoin =
      "LEFT JOIN community_place_entries w ON w.id = r.entry " +
      "LEFT JOIN venues v ON v.id = w.published_venue ";

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
        // The published place this share points at, when it points at one. The
        // recipient already holds the name, city and address from the share
        // itself, so the id adds no fact about the place — it is what makes the
        // inbox's one-tap Wanna go callable, which is the only way somebody
        // else's suggestion ever becomes one of the recipient's own saves.
        // Empty for a share of a place that has not published yet.
        venue: row.venue,
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
        // Clients front the most recent recommendation per place and break ties
        // on this id, so a card's note and its cover stay the same pair across
        // renders.
        id: row.recommendation_id,
        venue_name: row.venue_name,
        recommender_pseudo: row.recommender_pseudo,
        is_own: row.member_id === callerId,
        founding_member: Boolean(row.founding_member),
        // Whether the invitation graph put this member in reach, independently of
        // the founding circle. Selected only by the member feed; the anonymous
        // sample has no caller to be in the graph of, and no switch to drive.
        in_graph: Boolean(row.in_graph),
        note: row.note,
        city: row.city,
        country: row.country,
        address: row.address,
        // The published venue this note belongs to, empty until publication.
        // Clients attach a note to its place card by this id; the name-and-city
        // fallback exists only for notes on places that have not published yet.
        venue_id: row.venue_id,
        created: row.created,
        // Attached to this recommendation by its own author. Selected in the
        // same projection as the note, so it is visible to exactly the callers
        // the note is.
        photo_url: photos.photoUrl(e.app, row),
      };
    }

    // Anonymous callers get the same recommendation shape the member feed
    // renders, reduced to what a visitor may read: published places recommended
    // by the founding circle, from real verified members who opted into
    // discovery, with meaningful notes. The founding clause is the same rule
    // /api/detour/place-detourists and /api/detour/public-recommendations apply,
    // so no public surface can offer a note about a place another public surface
    // withheld. If nobody is discovery-visible yet, the Founder's own published
    // recommendations stand in so the section is never empty.
    if (!e.auth || !e.auth.id) {
      function sampleRecommendations(visibilitySql) {
        const rows = arrayOf(new DynamicModel(recommendationRowShape()));
        e.app
          .db()
          .newQuery(
            "SELECT " + recommendationColumns +
              "FROM community_recommendations r " +
              "JOIN members m ON m.id = r.member " +
              venueJoin +
              photos.photoJoin("r") +
              "WHERE w.status = 'published' AND w.published_venue != '' " +
              "AND COALESCE(m.internal_member, FALSE) = FALSE " +
              "AND m.community_status = 'verified' " +
              "AND " + visibilitySql + " " +
              "AND LOWER(TRIM(m.email)) NOT LIKE '%.invalid' " +
              "AND LOWER(TRIM(m.email)) NOT LIKE 'agent@%' " +
              "AND LENGTH(TRIM(r.note)) >= 24 " +
              "AND TRIM(m.pseudo) != '' " +
              "ORDER BY r.created DESC, r.id DESC LIMIT 100"
          )
          .all(rows);
        return rows;
      }

      let sampleRows = sampleRecommendations(
        "COALESCE(m.discovery_visible, FALSE) = TRUE AND " + founding.foundingMemberSql("m")
      );
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

    const memberRowShape = recommendationRowShape();
    memberRowShape.in_graph = false;
    const recommendationRows = arrayOf(new DynamicModel(memberRowShape));
    e.app
      .db()
      .newQuery(
        // Notes, and the photos joined to them, reach the caller from their own
        // circle plus the founding circle — the set My Circle draws, derived in
        // pb_hooks/circle_scope.js. Two clauses, always: graph membership OR
        // founding member. `discovery_visible` is the member's own opt-out on top
        // of that, never a substitute for it.
        //
        // `in_graph` reports which of the two clauses actually placed this
        // recommender in reach, because the feed's Founders' places switch needs
        // to hide the members who are there *only* as founders. A caller's own
        // inviter is very often founding too; hiding founders' places must not
        // hide the person who brought them in.
        "SELECT " + recommendationColumns +
          ", CASE WHEN " + scope.graphMemberSql("m", "caller") +
          " THEN TRUE ELSE FALSE END AS in_graph " +
          "FROM community_recommendations r " +
          "JOIN members m ON m.id = r.member " +
          venueJoin +
          photos.photoJoin("r") +
          "WHERE COALESCE(m.internal_member, FALSE) = FALSE " +
          "AND (m.id = {:caller} " +
          "OR (m.community_status = 'verified' AND m.discovery_visible = TRUE " +
          "AND " + scope.visibleRecommenderSql("m", "caller") + ")) " +
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

// Aggregate-only social proof, scoped to the caller's circle: how many members
// *they can see* have recommended each place. A count is derived from
// member-authored recommendations, so it is scoped content, not a global fact —
// two members legitimately read different numbers for the same place at the same
// moment, and a member outside every recommender's circle receives no entry for
// that venue at all. The client derives what appears on its list from exactly
// this payload, so this route is the visibility boundary for the whole catalogue.
//
// A SIGNED-OUT VISITOR IS ANSWERED TOO, AND THE FOUNDING CIRCLE IS THEIR CIRCLE.
// They have no invitation graph, so there is no relational clause to apply — what
// they get is the tier that already reaches every member at any distance, and
// nothing else. That is the whole of the public catalogue: a place is on a
// visitor's list because a founding member recommended it, derived here by the
// same deduplicated pass that answers a member, so the two can never disagree
// about what a founding recommendation is.
//
// The empty caller id may never reach circle_scope.js. `graphMemberSql` compares
// `m.invited_by = {:caller}`, and against "" that matches every unparented
// account in the table — an anonymous caller would silently acquire a circle. The
// visitor branch therefore uses `foundingMemberSql` directly and binds no caller
// at all, so there is no empty id for a predicate to misread.
//
// No member identity, prose, or timing leaves the server. Shares stay completely
// private: sending a place to someone is never social proof and never moves a
// count here, in either direction.
routerAdd(
  "GET",
  "/api/detour/place-detourists",
  (e) => {
    const foundingPolicy = require(__hooks + "/founding_cap.js");
    const scope = require(__hooks + "/circle_scope.js");
    const { normalizePlacePart } = require(__hooks + "/place_entries.js");
    const callerId = e.auth && e.auth.id ? e.auth.id : "";
    const anonymous = !callerId;
    // Visibility has two clauses, and which one matched is part of the answer.
    // A recommender reached through the invitation graph is in the caller's
    // circle; a recommender reached through the founding tier is visible to
    // everyone and is in nobody's circle in particular. Returning only "visible"
    // forces the copy layer to guess, and the only word available to guess with
    // is "circle" — which is how a founding member's place came to be labelled as
    // being in the reader's circle.
    //
    // For a visitor only the second clause exists, and `in_graph` is constant
    // false: there is no graph, so no place may ever be described to them as
    // being in their circle.
    const visible = anonymous
      ? foundingPolicy.foundingMemberSql("m")
      : scope.visibleRecommenderSql("m", "caller");
    const inGraph = anonymous ? "FALSE" : scope.graphMemberSql("m", "caller");
    // Bound only when there is a caller to bind: the visitor's SQL carries no
    // {:caller} placeholder.
    const callerBinding = anonymous ? {} : { caller: callerId };

  // Distinct (venue, member) pairs from recommendation signals only. Waiting-
  // list entries resolve to their published venue first, then to the canonical
  // catalogue venue they were matched to before publication.
  //
  // Visibility is selected as a column rather than applied as a filter, because
  // two different numbers come out of one pass: the caller's scoped count, which
  // decides what is on their list, and the place's total, which is displayed
  // beside it as social proof. Only the scoped column may ever gate visibility —
  // see the pruning step below, which is what stops the totals from naming a
  // place the caller is not allowed to know exists.
  const pairs = arrayOf(
    new DynamicModel({
      venue_id: "",
      member_id: "",
      founding_member: false,
      visible_to_caller: false,
      in_graph: false,
    })
  );
  e.app
    .db()
    .newQuery(
      "SELECT venue_id, member_id, founding_member, visible_to_caller, in_graph FROM (" +
        "SELECT COALESCE(NULLIF(w.published_venue, ''), w.canonical_venue) AS venue_id, " +
        "r.member AS member_id, " +
        "CASE WHEN " + foundingPolicy.foundingMemberSql("m") + " THEN TRUE ELSE FALSE END AS founding_member, " +
        "CASE WHEN " + visible + " THEN TRUE ELSE FALSE END AS visible_to_caller, " +
        "CASE WHEN " + inGraph + " THEN TRUE ELSE FALSE END AS in_graph " +
        "FROM community_recommendations r " +
        "JOIN community_place_entries w ON w.id = r.entry " +
        "JOIN members m ON m.id = r.member " +
        "WHERE LOWER(TRIM(m.email)) NOT LIKE '%.invalid'" +
        ") WHERE venue_id IS NOT NULL AND venue_id != '' AND member_id != ''"
    )
    .bind(callerBinding)
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
      visible_to_caller: false,
      in_graph: false,
    })
  );
  e.app
    .db()
    .newQuery(
      "SELECT c.id AS contribution_id, c.member AS member_id, " +
        "c.normalized_name, c.normalized_city, " +
        "CASE WHEN " + foundingPolicy.foundingMemberSql("m") + " THEN TRUE ELSE FALSE END AS founding_member, " +
        // The review-gated lane is one member's recommendation each, so it
        // carries the same two clauses as the waiting-list loop.
        "CASE WHEN " + visible + " THEN TRUE ELSE FALSE END AS visible_to_caller, " +
        "CASE WHEN " + inGraph + " THEN TRUE ELSE FALSE END AS in_graph " +
        "FROM member_place_contributions c " +
        "JOIN members m ON m.id = c.member " +
        "WHERE c.status = 'approved' " +
        "AND LOWER(TRIM(m.email)) NOT LIKE '%.invalid'"
    )
    .bind(callerBinding)
    .all(contributions);
  const contributionRows = [];
  for (const row of contributions) {
    contributionRows.push({
      contribution_id: row.contribution_id,
      member_id: row.member_id,
      normalized_name: row.normalized_name,
      normalized_city: row.normalized_city,
      founding_member: Boolean(row.founding_member),
      visible_to_caller: Boolean(row.visible_to_caller),
      in_graph: Boolean(row.in_graph),
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
          visible_to_caller: row.visible_to_caller,
          in_graph: row.in_graph,
        });
      }
    }
  }

  // Accumulators over one deduplicated pass, split by the reason each recommender
  // is in reach. `circle` and `founders` are disjoint and sum to what the caller
  // can see; `counts` is that sum, kept because it is what decides whether a place
  // is on their list at all; `totals` is every distinct recommender the place has,
  // in any circle, for display beside it.
  //
  // The split exists so no surface has to infer a relationship from the mere fact
  // of visibility. A founding member's place is visible to everybody and is in
  // nobody's circle; a copy layer handed one number can only call it "circle", and
  // that is a claim about a relationship that does not exist.
  const seen = {};
  const counts = {};
  const circle = {};
  const founders = {};
  const totals = {};
  const founding = {};
  function addPair(venueId, memberId, foundingMember, visibleToCaller, inGraphSet) {
    const key = venueId + "::" + memberId;
    if (seen[key]) return;
    seen[key] = true;
    totals[venueId] = (totals[venueId] || 0) + 1;
    if (!visibleToCaller) return;
    counts[venueId] = (counts[venueId] || 0) + 1;
    // A founding member who is also in the graph — an inviter very often is —
    // counts as circle. The graph clause is the stronger claim, so it wins.
    if (inGraphSet) circle[venueId] = (circle[venueId] || 0) + 1;
    else founders[venueId] = (founders[venueId] || 0) + 1;
    if (foundingMember) founding[venueId] = true;
  }
  for (const row of pairs) {
    addPair(
      row.venue_id,
      row.member_id,
      Boolean(row.founding_member),
      Boolean(row.visible_to_caller),
      Boolean(row.in_graph)
    );
  }
  for (const pair of contributionPairs) {
    addPair(
      pair.venue_id,
      pair.member_id,
      pair.founding_member,
      pair.visible_to_caller,
      pair.in_graph
    );
  }

    // The containment step, and the reason totals are safe to serve at all: a
    // total survives only for a place the caller can already see. Without this,
    // the payload would enumerate every recommended venue in the database and
    // hand a member the size and shape of a catalogue they have no access to —
    // which is the leak, not the number beside a place they already have.
    for (const venueId in totals) {
      if (!counts[venueId]) delete totals[venueId];
    }

    // Been & loved rides along in the same payload rather than in a route of its
    // own: it is derived from the same visibility computation as the notes, so
    // it costs a join rather than a second pass, and a card that stamps both
    // figures gets them from one request.
    //
    // Same shape, same rule: a global count, names only for the members this
    // caller may see, each carrying the clause that matched. And the same
    // containment step — a place the caller cannot see contributes nothing, not
    // even a number.
    //
    // A visitor is named the founding members, and nobody else — the same tier
    // that put the place on their list in the first place, so no mark on a public
    // page names somebody the reader was not already reading.
    const endorsements = require(__hooks + "/place_endorsements.js")
      .endorsementSignals(e.app, callerId);
    for (const venueId in endorsements.totals) {
      if (counts[venueId]) continue;
      delete endorsements.totals[venueId];
      delete endorsements.names[venueId];
      delete endorsements.own[venueId];
    }

    // `scope` tells the client which rule produced the payload, so it can refuse
    // to fall back to a global publication marker when this route is unavailable.
    // Degrading to "show everything a server ever published" would turn one
    // failed request into a catalogue-wide visibility breach. `founding` is the
    // visitor's answer and `circle` the member's; a client that asked as one and
    // was answered as the other must reject the payload rather than render it.
    return e.json(200, {
      scope: anonymous ? "founding" : "circle",
      counts: counts,
      circle: circle,
      founders: founders,
      totals: totals,
      founding: founding,
      endorsements: endorsements,
    });
  }
  // No auth middleware: a signed-out visitor is answered with the founding
  // circle's places, which is the public catalogue.
);

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
          "JOIN community_place_entries w ON w.id = r.entry " +
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
          "JOIN community_place_entries w ON w.id = r.entry " +
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
        "SELECT r.member AS member_id, " +
          "COALESCE(NULLIF(TRIM(v.name), ''), r.venue_name) AS venue, MAX(r.created) AS created " +
          "FROM community_recommendations r " +
          "JOIN community_place_entries w ON w.id = r.entry " +
          "JOIN venues v ON v.id = w.published_venue " +
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
        // Whether this person's places reach the whole app rather than only the
        // circles they belong to. The drawing colours nodes by it, so it has to
        // travel with the person; deriving it on the client is impossible — the
        // rule is a fact about the Founder's invitations, which no client can see.
        founding_member: Boolean(row.founding_member),
      };
    }

    function memberRows() {
      return arrayOf(
        new DynamicModel({
          member_id: "",
          founding_member: false,
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
        "SELECT m.id AS member_id, m.display_name, m.pseudo, m.home_city, " +
          "CASE WHEN " + founding.foundingMemberSql("m") + " THEN TRUE ELSE FALSE END AS founding_member " +
          "FROM members m JOIN members caller ON caller.invited_by = m.id " +
          "WHERE caller.id = {:caller} AND " + realMember("m") + " LIMIT 1"
      )
      .bind({ caller: callerId })
      .all(inviterRows);

    const invitedRows = memberRows();
    e.app
      .db()
      .newQuery(
        "SELECT m.id AS member_id, m.display_name, m.pseudo, m.home_city, " +
          "CASE WHEN " + founding.foundingMemberSql("m") + " THEN TRUE ELSE FALSE END AS founding_member " +
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
        founding_member: false,
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
          "CASE WHEN " + founding.foundingMemberSql("m") + " THEN TRUE ELSE FALSE END AS founding_member, " +
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
        "SELECT m.id AS member_id, m.display_name, m.pseudo, m.home_city, " +
          "CASE WHEN " + founding.foundingMemberSql("m") + " THEN TRUE ELSE FALSE END AS founding_member FROM members m " +
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
    // The positional derivation above already walks the caller's own graph, so
    // this cannot normally fail. It is asserted anyway against the stored edge
    // set, because "the reference resolved" and "this member's content may reach
    // the caller" are two different claims, and only the second one is the rule.
    // If the circle payload's ordering ever drifts from the visibility set, this
    // is what refuses to serve the notes.
    const scope = require(__hooks + "/circle_scope.js");
    if (!scope.canSee(e.app, callerId, targetId)) {
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

    const photos = require(__hooks + "/recommendation_photos.js");
    const rowShape = {
      recommendation_id: "",
      recommender_pseudo: "",
      founding_member: false,
      note: "",
      venue_name: "",
      city: "",
      country: "",
      address: "",
      created: "",
    };
    const photoFields = photos.photoRowFields();
    for (const key of Object.keys(photoFields)) rowShape[key] = photoFields[key];
    const rows = arrayOf(new DynamicModel(rowShape));
    e.app
      .db()
      .newQuery(
        // Place facts come from the published venue, not the snapshot stamped
        // on the recommendation at submission time — the venue is the record a
        // curator corrects, and this panel must agree with the place card.
        "SELECT r.id AS recommendation_id, m.pseudo AS recommender_pseudo, " +
          "CASE WHEN " + founding.foundingMemberSql("m") + " THEN TRUE ELSE FALSE END AS founding_member, " +
          "r.note, " +
          "COALESCE(NULLIF(TRIM(v.name), ''), r.venue_name) AS venue_name, " +
          "COALESCE(NULLIF(TRIM(v.city), ''), r.city) AS city, " +
          "COALESCE(NULLIF(TRIM(v.country), ''), r.country) AS country, " +
          "COALESCE(NULLIF(TRIM(v.address), ''), r.address) AS address, " +
          "r.created " +
          photos.photoColumns() +
          "FROM community_recommendations r " +
          "JOIN community_place_entries w ON w.id = r.entry " +
          "JOIN venues v ON v.id = w.published_venue " +
          "JOIN members m ON m.id = r.member " +
          photos.photoJoin("r") +
          "WHERE r.member = {:target} " +
          "AND w.status = 'published' AND w.published_venue != '' " +
          "ORDER BY r.created DESC, r.id DESC LIMIT 100"
      )
      .bind({ target: targetId })
      .all(rows);

    const items = [];
    for (const row of rows) {
      items.push({
        id: row.recommendation_id,
        venue_name: row.venue_name,
        recommender_pseudo: row.recommender_pseudo,
        is_own: targetId === callerId,
        founding_member: Boolean(row.founding_member),
        note: row.note,
        city: row.city,
        country: row.country,
        address: row.address,
        created: row.created,
        photo_url: photos.photoUrl(e.app, row),
      });
    }

    return e.json(200, { name: name, private: false, items: items });
  },
  $apis.requireAuth("members")
);

// A public member account arrives one of two ways, and the code decides which.
//
// WITH A CODE: the invitation is redeemed here. It must be unused and
// server-generated, and `redeemed_invite` has a partial unique index, so a
// simultaneous second redemption cannot create another member account. The new
// member's `invited_by` is the issuer, which IS the graph edge — see
// circle_scope.js.
//
// WITHOUT ONE: an open signup, the "start your circle" path. No invitation is
// spent, `invited_by` and `redeemed_invite` stay empty, and the account is
// verified like any other. What it is NOT is a way into somebody else's circle:
// with no edge, this member's own graph is themselves and the people they go on
// to invite, and everything they write reaches exactly that set. What they read
// is the founding circle plus their own people — the same list a signed-out
// visitor sees, now with somewhere to add to it.
//
// The two paths must not diverge on anything else. Pseudo, home city, display
// name, the cleared code and the verified status are settled once, below, so an
// open account can never be a second-class one in some field nobody looked at.
//
// An empty `invited_by` is already a represented state — the Founder has one —
// and `graphMemberSql`'s COALESCE guard on the sibling branch is what stops two
// parentless members reading as each other's siblings. That guard is now
// load-bearing for every open signup rather than for one seeded account, so it
// must not be "simplified" away.
//
// Founding seats are unreachable this way: `foundingSeatIdsSql` joins through
// `redeemed_invite` and requires the Founder as issuer, so an open account can
// never occupy one however early it arrives.
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

  // An invitation, when one was given. Resolved before anything is written, so a
  // bad code fails the create rather than half-building an account.
  let invite = null;
  if (inviteCode) {
    try {
      invite = e.app.findFirstRecordByFilter(
        "invites",
        "code = {:code} && claimed_by = ''",
        { code: inviteCode }
      );
    } catch {
      throw new BadRequestError("This invitation code is invalid or has already been used.");
    }
  }

  const { assertPseudoAvailable, normalizeHomeCity, normalizeMemberPseudo } = require(
    __hooks + "/member_profile.js"
  );
  const pseudo = normalizeMemberPseudo(e.record.getString("pseudo"));
  assertPseudoAvailable(e.app, pseudo, "");
  // Every signup flow asks for a home city, so no public account is created
  // without one. Superuser-created fixtures returned above and are exempt.
  e.record.set("home_city", normalizeHomeCity(e.record.getString("home_city")));

  // The edge, or the absence of one. An open signup starts a circle rather than
  // joining a circle, and both are written explicitly so neither can inherit a
  // stray value from the create payload.
  const issuerId = invite ? invite.getString("issued_by") : "";
  e.record.set("invited_by", issuerId);
  e.record.set("redeemed_invite", invite ? invite.id : "");

  e.record.set("pseudo", pseudo);
  // The pseudo is a member's one name on Detour. The schema's required
  // display_name is kept as a server-owned mirror of it so older reads and
  // superuser-created accounts keep working; public signup no longer sends it.
  e.record.set("display_name", pseudo);
  e.record.set("invite_code", "");
  e.record.set("community_status", "verified");
  // Founding membership is not granted here and is not stored: it is derived
  // from invited_by and the redeemed invitation's grants_founding — the Founder's
  // own account, and whoever joined on an invitation she marked founding (see
  // founding_cap.js). Setting invited_by and redeemed_invite above is the whole
  // of it; the flag was decided when the invitation was issued.
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
      // Snapshot, not a relation read: the issuer can view this invite but not
      // the claimant's member record, so the pseudo has to travel with the
      // invite itself to ever be shown back to them.
      invite.set("claimed_pseudo", e.record.getString("pseudo"));
      e.app.save(invite);
    } catch {}
  }

  // Nothing to do here for visibility. Setting `invited_by` above IS the graph
  // edge, and circle scoping reads that column directly (see
  // pb_hooks/circle_scope.js), so a redeemed invitation takes effect on the next
  // read with no derived set to rebuild and no cache to invalidate.

  try {
    require(__hooks + "/member_welcome.js").sendWelcomeEmail(e.app, e.record);
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

  // Every public signup is reported, invitation-backed or open, and the notice
  // says which — an account that started its own circle is a different event from
  // one that joined somebody's, and the ops mailbox is where that difference is
  // noticed. Reserved internal fixtures and superuser-created records remain
  // quiet: those returned before any of this ran.
  if (!e.record.getBool("internal_member")) {
    try {
      const displayName = e.record.getString("display_name").trim();
      const pseudo = e.record.getString("pseudo").trim();
      const memberLabel =
        (displayName || "A new member") + (pseudo ? " (@" + pseudo + ")" : "");

      require(__hooks + "/mailer.js").notifyOps(e.app, {
        subject: inviteId ? "New Detour member" : "New Detour member (open signup)",
        text:
          memberLabel +
          (inviteId
            ? " joined Detour on an invitation."
            : " signed up without an invitation and is starting their own circle."),
      });
    } catch (error) {
      try {
        e.app.logger().error(
          "Detour member notification failed.",
          "memberId",
          e.record.id,
          "error",
          String(error)
        );
      } catch {
        // Logging must not turn a best-effort notification into a signup failure.
      }
    }
  }

  e.next();
}, "members");

// The waiting-list entry is shared by every member who recommended the place,
// across every circle, so three of its fields are global facts about members the
// caller may not be allowed to see: how many got there first (`signal_count`),
// when the place was first proposed (`created`), and when it went live
// (`published_at`). A caller reading them learns the size and age of a circle
// that is not theirs.
//
// Hidden on the way out, for every caller, on every read path the records API
// offers — list, view, and the response to the caller's own update. Deliberately
// unconditional rather than "hidden only from callers who can't see every
// recommender": that version would make the fields' presence a reliable signal
// that somebody outside your circle got there first, which is a cleaner oracle
// than the one the model already accepts.
//
// Nothing in the client needs them. What a member may know about who else stands
// behind a place comes from their own circle-scoped catalogue count — see
// entryRow in src/community/recommendations.ts.
onRecordEnrich((e) => {
  e.record.hide("signal_count", "created", "published_at");
  e.next();
}, "community_place_entries");

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
//
// `grants_founding` is the one field a client may state, and only the Founder may
// state it: it is what turns an invitation into an offer of one of the fifty
// founding seats. Everyone else's invitations are forced ordinary, silently — a
// member who never sees the toggle has no way to know they sent the field, and
// refusing their invitation over a value they did not choose would be a worse
// answer than ignoring it.
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

  e.record.set(
    "grants_founding",
    e.record.getBool("grants_founding") && founding.canGrantFounding(e.app, e.auth)
  );
  e.record.set("issued_by", e.auth.id);
  e.record.set("code", "DTR-" + $security.randomString(20).toUpperCase());
  e.record.set("claimed_by", "");
  e.record.set("claimed_at", "");
  // The issuer's own reminder of who a code was sent to. Free text, never
  // interpreted by anything server-side — just trimmed to a sane length.
  e.record.set("hint", e.record.getString("hint").trim().slice(0, 120));
  e.record.set("claimed_pseudo", "");
  e.next();
}, "invites");

// An invitation an issuer no longer needs — sent to the wrong person, or never
// sent at all — can be withdrawn while it is still unspent. Once it is
// claimed it is the record of how a real member joined, and stays.
onRecordDeleteRequest((e) => {
  if (e.hasSuperuserAuth()) {
    return e.next();
  }
  if (!e.auth || e.record.getString("issued_by") !== e.auth.id) {
    throw new BadRequestError("You can remove only invitations you issued.");
  }
  if (e.record.getString("claimed_by")) {
    throw new BadRequestError("A claimed invitation cannot be removed.");
  }
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

  const community = require(__hooks + "/place_entries.js");
  community.requireVerifiedMember(e.auth, "recommending a place");

  const note = community.validateRecommendationNote(e.record.getString("note"));
  const category = community.validateCategory(e.record.getString("category"));
  const occasions = community.validateOccasions(e.record.getStringSlice("occasions"));
  const requestBody = e.requestInfo().body || {};
  const links = community.validateMemberPlaceLinks({
    officialUrl: requestBody.official_url,
    instagram: requestBody.instagram_url,
  });
  // `place_intent` says what to do when this name and city already belong to a
  // place: see createOrResolveEntry. The recommendation form sends "ask" so the
  // member is shown the existing place and decides; the "recommend this exact
  // place" form sends "second", because arriving from a place page *is* the
  // decision. It is read from the request body rather than the record because it
  // is a routing instruction, not a stored fact about the recommendation.
  const resolved = community.resolveEntry(e.app, e.record.getString("entry"), {
    venueName: e.record.getString("venue_name"),
    city: e.record.getString("city"),
    country: e.record.getString("country"),
    address: e.record.getString("address"),
    disambiguator: requestBody.disambiguator,
    intent: requestBody.place_intent,
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
  // Writing about a place you had marked replaces the mark: the note says more,
  // and says it in your own words. It also enforces "never on your own place" —
  // the two states cannot be held at once.
  //
  // Done here, alongside the entry's own writes and before the record is saved,
  // so the place can never show one member twice — once under BEEN & LOVED and
  // once under RECOMMEND. That inflation is exactly what a catalogue this size
  // cannot survive, and it is the failure the ordering guards against: if the
  // save below fails, a member has lost a mark they can press again, which is
  // the harmless direction.
  require(__hooks + "/place_endorsements.js").clearEndorsement(
    e.app,
    e.auth.id,
    resolved.entry.id
  );
  // The rung below that — a Wanna go save — is left alone on purpose. One state
  // per place is a display rule, not a storage rule: the save drops off the
  // Wanna go tab while this note stands, and comes back if the note is ever
  // withdrawn. See ownSaves in pb_hooks/place_saves.js.
  e.record.set("member", e.auth.id);
  e.record.set("entry", resolved.entry.id);
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
  const community = require(__hooks + "/place_entries.js");
  const entryId = e.record.getString("entry");
  const publication = community.recalculateAndPublish(e.app, entryId);
  // Publication happened inside the transaction above; the external
  // enrichment runs after it so an outage of OpenStreetMap or of the place's
  // own website can never block or roll back the publish. Members only supply
  // name, city, country, and optionally an address — the address-based
  // geocoder validates what they gave, then the OSM place lookup fills the
  // remaining public facts (website, Instagram, missing address/coordinates),
  // and the cover resolver turns those links into a place image. Failures are
  // retried by the nightly sweeps.
  try {
    const entry = e.app.findRecordById("community_place_entries", entryId);
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
  // .invalid fixtures never claim the marker, so they never send member mail.
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
          const claimed = community.claimPublicationNotification(e.app, entryId);
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
          "entryId",
          entryId,
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
      const mailer = require(__hooks + "/mailer.js");
      const siteUrl = "https://takedetour.app";

      mailer.sendMail(e.app, {
        to: publicationNotification.recipient,
        subject: publicationNotification.placeName + " is on Detour",
        text:
          "Good call — " +
          publicationNotification.placeName +
          " is now on Detour.\n\nSee it: " +
          siteUrl +
          "\n\nThanks to you, our community keeps growing." +
          mailer.signatureText(),
        html:
          "<p>Good call — <strong>" +
          mailer.escapeHtml(publicationNotification.placeName) +
          "</strong> is now on Detour.</p>" +
          '<p><a href="' +
          siteUrl +
          '">See it on Detour</a></p>' +
          "<p>Thanks to you, our community keeps growing.</p>" +
          mailer.signatureHtml(),
      });
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
  }

  // One operator notification per member recommendation, publication folded in
  // rather than sent as a second mail: from an operator's side the note and the
  // publication it triggers are the same event. The published sentence is keyed
  // off the publication itself, not off publicationNotification -- whether the
  // member's own mail was suppressed (a reserved .invalid fixture, an
  // already-claimed marker) says nothing about whether ops should hear about a
  // place going live.
  try {
    const memberId = e.record.getString("member");
    const author = e.app.findRecordById("members", memberId);
    if (!author.getBool("internal_member")) {
      const displayName = author.getString("display_name").trim();
      const pseudo = author.getString("pseudo").trim();
      const memberLabel =
        (displayName || "A Detour member") +
        (pseudo ? " (@" + pseudo + ")" : "");
      const placeName = e.record.getString("venue_name").trim() || "a place";
      const city = e.record.getString("city").trim();
      const placeLabel = placeName + (city ? " in " + city : "");
      const publishedNow = Boolean(publication && publication.publishedNow);

      require(__hooks + "/mailer.js").notifyOps(e.app, {
        subject: publishedNow
          ? "New Detour place published"
          : "New Detour recommendation",
        text:
          memberLabel +
          " recommended " +
          placeLabel +
          "." +
          (publishedNow ? "\n\n" + placeName + " is now on Detour." : ""),
      });
    }
  } catch (error) {
    try {
      e.app.logger().error(
        "Detour recommendation notification failed.",
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

// The work-list every enrichment sweep runs over lives in place_entries.js
// (publishedVenuesForSweep). It cannot live here: cronAdd callbacks run in an
// isolated VM, so a module-scope helper in this file is out of scope by the time
// a job fires.

// Daily launch-number rollup at 05:15 UTC, emailed to DETOUR_REPORTS_EMAIL. The
// shared helper owns fixture exclusion, zero-activity suppression, delivery, and
// best-effort failure logging; requiring it inside the callback is required by
// the hook VM.
cronAdd("detour_daily_launch_numbers", "15 5 * * *", () => {
  const launchMetrics = require(__hooks + "/launch_metrics.js");
  launchMetrics.emitLaunchNumbers($app);
});

// Nightly retry for published community venues that still lack verified
// coordinates (geocoder outage, no-match addresses corrected later, …).
// geocodeVenue exits early for venues that already have coordinates.
cronAdd("community_geocode_sweep", "0 4 * * *", () => {
  const community = require(__hooks + "/place_entries.js");
  for (const venue of community.publishedVenuesForSweep($app)) {
    community.geocodeVenue($app, venue.id);
  }
});

// Nightly retry for Detourist-list venues that still lack discovered facts or
// a cover image (OSM or the place's site was down at publication, the OSM
// record gained contact tags later, …). Both steps exit early for venues that
// already have everything.
cronAdd("community_cover_sweep", "30 4 * * *", () => {
  const community = require(__hooks + "/place_entries.js");
  for (const venue of community.publishedVenuesForSweep($app)) {
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
  const community = require(__hooks + "/place_entries.js");
  let attempts = 0;
  for (const venue of community.publishedVenuesForSweep($app)) {
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
// category/occasions classification. The identity fields (member, entry)
// are server-owned and frozen. The place-detail mirrors (venue_name, city,
// country) are re-synced from the shared entry rather than trusted from the
// request, so a note edit can never silently rewrite them and they never drift
// from an accompanying entry edit.
onRecordUpdateRequest((e) => {
  if (e.hasSuperuserAuth()) {
    return e.next();
  }

  const community = require(__hooks + "/place_entries.js");
  community.requireVerifiedMember(e.auth, "editing a recommendation");
  const original = e.record.original();
  if (original.getString("member") !== e.auth.id) {
    throw new BadRequestError("You can only edit your own recommendations.");
  }
  if (
    e.record.getString("member") !== original.getString("member") ||
    e.record.getString("entry") !== original.getString("entry")
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
      "community_place_entries",
      original.getString("entry")
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
  const community = require(__hooks + "/place_entries.js");
  const entryId = e.record.getString("entry");
  community.recalculateAndPublish(e.app, entryId);
  community.withdrawUnbackedEntry(e.app, entryId);
  e.next();
}, "community_recommendations");

// Member-supplied images never update a place directly. Public collection
// creation is disabled; the custom route below accepts the upload, creates a
// stable PocketBase snapshot, and initializes every server-owned moderation
// field. A snapshot becomes visible one of two ways — automatic screening
// clearing it, or a founding member approving it — and either way only as the
// cover of the recommendation that submitted it, never as the place's own
// image. Nothing a request can set reaches `approved` on its own.
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

// The place a name and city already belong to, for the "is this the same place?"
// question.
//
// This exists as its own route because a thrown ApiError cannot carry it:
// PocketBase treats an error's `data` as a validation-error map and rewrites every
// leaf into {code, message}, so place facts put there arrive destroyed. The 409
// from the create path stays the authoritative refusal; this answers "which place
// was that, then" so the member can be shown what they are about to agree with.
//
// Place facts only, and deliberately no count. `signal_count` is global — it
// includes members in circles the caller cannot see — so reporting it would
// disclose their existence and their number. The caller supplied the name and the
// city themselves; what this adds is a street and a qualifier, both public facts
// about a restaurant, and whether it is already live.
routerAdd(
  "GET",
  "/api/detour/place-identity",
  (e) => {
    const community = require(__hooks + "/place_entries.js");
    community.requireVerifiedMember(e.auth, "checking whether a place is on the list");
    const query = e.request.url.query();
    const normalizedName = community.normalizePlacePart(query.get("name") || "");
    const normalizedCity = community.normalizePlacePart(query.get("city") || "");
    const normalizedDisambiguator = community.normalizePlacePart(
      query.get("disambiguator") || ""
    );
    if (!normalizedName || !normalizedCity) {
      throw new BadRequestError("A name and a city are required.");
    }
    const entry = community.findEntryByPlace(
      e.app,
      normalizedName,
      normalizedCity,
      normalizedDisambiguator
    );
    return e.json(200, entry ? community.placeCollisionData(entry) : { entry: "" });
  },
  $apis.requireAuth("members")
);

/**
 * Reads a pasted map link so the member does not retype what their phone already
 * knows. Answers 200 with `resolved: false` for anything it cannot read — an
 * unreadable link is not an error, it is a paste that turned out not to be a
 * link, and the form it came from must carry on unchanged. See
 * `pb_hooks/map_links.js` for what is and is not looked up.
 */
routerAdd(
  "POST",
  "/api/detour/place-link",
  (e) => {
    const community = require(__hooks + "/place_entries.js");
    const links = require(__hooks + "/map_links.js");
    community.requireVerifiedMember(e.auth, "reading a map link");
    const body = e.requestInfo().body || {};
    const url = typeof body.url === "string" ? body.url : "";
    if (!links.normalizeLink(url)) return e.json(200, { resolved: false });
    let resolved;
    try {
      resolved = links.resolvePlaceLink(url, { withCity: body.city !== false });
    } catch (err) {
      // Reading a link is a convenience; failing at it must never be the reason
      // a recommendation does not get written. It is still worth knowing about,
      // because a link shape that stops resolving is invisible from the outside
      // — the member simply types the name and never mentions it.
      e.app.logger().warn("place link read failed", "url", url, "error", String(err));
      return e.json(200, { resolved: false });
    }
    if (!resolved || !resolved.resolved) {
      e.app.logger().info("place link not understood", "url", url);
      return e.json(200, { resolved: false });
    }
    return e.json(200, {
      resolved: true,
      name: community.cleanText(resolved.name || "", 200),
      city: community.cleanText(resolved.city || "", 120),
      country: community.cleanText(resolved.country || "", 120),
      address: community.cleanText(resolved.address || "", 300),
      lat: resolved.lat,
      lng: resolved.lng,
    });
  },
  $apis.requireAuth("members")
);

routerAdd(
  "POST",
  "/api/detour/curation/images",
  (e) => {
    const community = require(__hooks + "/place_entries.js");
    community.requireVerifiedMember(e.auth, "submitting a place image");
    const body = e.requestInfo().body || {};
    const entryId =
      typeof body.entry === "string" ? body.entry.trim() : "";
    const entry = e.app.findRecordById(
      "community_place_entries",
      entryId
    );
    // A photo hangs off a recommendation, so the caller must have written one.
    // Being a participant is no longer enough: somebody who only received this
    // place as a private share has no note here for a photo to belong to.
    const recommendation = community.findMemberRecommendation(
      e.app,
      e.auth.id,
      entry.id
    );
    if (!recommendation) {
      throw new BadRequestError(
        "Write your recommendation for this place before adding a photo to it."
      );
    }

    let existing = null;
    try {
      existing = e.app.findFirstRecordByFilter(
        "community_place_images",
        "submitted_by = {:member} && entry = {:entry} && " +
          "(status = 'screening' || status = 'pending' || status = 'screening_failed')",
        { member: e.auth.id, entry: entry.id }
      );
    } catch {
      existing = null;
    }
    if (existing) {
      throw new BadRequestError(
        "You already have an image for this place awaiting review."
      );
    }

    // The member uploads the photo itself. Asking for a "direct link to an
    // image" asked for something most people cannot produce from a phone, and it
    // made the honest answer to "add your photo" a detour through an image host.
    //
    // The bytes arrive as multipart and go straight into the snapshot field, so
    // there is no fetch of a member-controlled URL on this path at all. The
    // field's own schema enforces the limits — 8 MB, JPEG/PNG/WebP — and
    // PocketBase rejects the save if the upload misses them.
    // findUploadedFiles throws rather than returning empty when the request
    // carries no such field at all, so absence has to be caught, not tested for.
    let uploads = null;
    try {
      uploads = e.findUploadedFiles("photo");
    } catch {
      uploads = null;
    }
    const snapshot = uploads && uploads.length ? uploads[0] : null;
    if (!snapshot) {
      throw new BadRequestError("Choose a photo to upload.");
    }

    const collection = e.app.findCollectionByNameOrId(
      "community_place_images"
    );
    const image = new Record(collection);
    image.set("entry", entry.id);
    image.set("recommendation", recommendation.id);
    image.set("submitted_by", e.auth.id);
    // An upload has no origin on the public web to record.
    image.set("source_url", "");
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
    try {
      e.app.save(image);
    } catch {
      // Almost always the file field rejecting the upload: too large, or not one
      // of the three image types. Say which, rather than surfacing a validation
      // payload the member cannot act on.
      throw new BadRequestError(
        "That photo could not be accepted. Use a JPEG, PNG or WebP image under 8 MB."
      );
    }

    // Model success hooks normally screen this save. Calling the idempotent
    // helper here also covers direct route saves on PocketBase versions where
    // request success hooks are not dispatched for app.save().
    const curation = require(__hooks + "/image_curation.js");
    curation.screenImageSubmission(e.app, image.id);
    const saved = e.app.findRecordById("community_place_images", image.id);
    return e.json(201, {
      id: saved.id,
      entry: saved.getString("entry"),
      recommendation: saved.getString("recommendation"),
      status: saved.getString("status"),
    });
  },
  $apis.requireAuth("members")
);

// Published places showing no photograph at all, for the founding circle to deal
// with by hand.
//
// The automatic tiers get most places a cover and will not get all of them: a
// venue's own site increasingly renders its og tags in JavaScript, Instagram
// serves bots an empty shell, and the OSM `image` tag is set on roughly one food
// venue in six hundred. Rather than keep adding sources with diminishing returns,
// what is left over becomes a worklist.
//
// "No photo" means no photograph anywhere in reach: no curated cover, no
// enrichment cover, and not one recommendation carrying a photo. A place whose
// cover comes from a member's photo is not missing one, even though
// `venues.image_url` is empty — that field is only ever the fallback.
//
// A photo still in screening or awaiting founder review counts as reach, not as
// absence. It is about to become the cover or about to be rejected, and either
// way a curator who spends a minute finding a picture for it has spent it on a
// place that was already handled. Only a photo that was actually turned away —
// rejected, auto-rejected, superseded — leaves a place genuinely without one.
routerAdd(
  "GET",
  "/api/detour/curation/coverless",
  (e) => {
    const founding = require(__hooks + "/founding_cap.js");
    founding.requireFoundingMember(e.app, e.auth, "reviewing places without photos");

    let venues = [];
    try {
      venues = e.app.findRecordsByFilter(
        "venues",
        "published = true && suppressed != true && " +
          "(image_url = '' || image_url = null) && " +
          "(curated_cover = '' || curated_cover = null)",
        "-published_at",
        200,
        0
      );
    } catch {
      venues = [];
    }
    if (!venues.length) return e.json(200, { items: [] });

    // The waiting-list entries behind those venues, and the entries that already
    // have an approved photo. Two bulk reads rather than a query per venue.
    const entryByVenue = {};
    const entryIds = [];
    for (const venue of venues) {
      let entry = null;
      try {
        entry = e.app.findFirstRecordByFilter(
          "community_place_entries",
          "published_venue = {:venue}",
          { venue: venue.id }
        );
      } catch {
        entry = null;
      }
      if (!entry) continue;
      entryByVenue[venue.id] = entry;
      entryIds.push(entry.id);
    }

    const hasPhotoInReach = {};
    for (const entryId of entryIds) {
      try {
        const photo = e.app.findFirstRecordByFilter(
          "community_place_images",
          "entry = {:entry} && (status = 'approved' || status = 'screening' || " +
            "status = 'pending' || status = 'screening_failed')",
          { entry: entryId }
        );
        if (photo) hasPhotoInReach[entryId] = true;
      } catch {
        // Nothing in reach for this entry.
      }
    }

    const items = [];
    for (const venue of venues) {
      const entry = entryByVenue[venue.id];
      if (entry && hasPhotoInReach[entry.id]) continue;
      items.push({
        id: venue.id,
        entry: entry ? entry.id : "",
        place_name: venue.getString("name"),
        city: venue.getString("city"),
        country: venue.getString("country"),
        disambiguator: venue.getString("disambiguator"),
        // Whether there is anywhere left for the automatic passes to look. A place
        // with neither link has exhausted them and needs a person.
        official_url: venue.getString("official_url"),
        instagram_url: venue.getString("instagram_url"),
        published_at: venue.getString("published_at"),
      });
    }
    return e.json(200, { items });
  },
  $apis.requireAuth("members")
);

// A founding member gives a place its cover directly.
//
// The photo goes on the venue, not on a recommendation, because the curator is
// not making a recommendation — they are fixing a picture. Nothing here is
// attributed to a member on any public surface: this is the same kind of value
// `image_url` already holds, chosen by a person rather than found by a scraper.
// A member's own photo still wins over it wherever one exists, so this can never
// displace somebody's picture of their own place, only fill a blank.
//
// Not screened. The screening pipeline exists to keep unreviewed member
// submissions away from founders; here the founder *is* the review, and sending
// their own upload through a queue only they can clear would be circular. The
// provenance columns record who chose it, which is the accountability that
// matters for a curated cover.
routerAdd(
  "POST",
  "/api/detour/curation/places/{id}/cover",
  (e) => {
    const founding = require(__hooks + "/founding_cap.js");
    founding.requireFoundingMember(e.app, e.auth, "setting a place's cover");
    const venueId = e.request.pathValue("id");
    let venue;
    try {
      venue = e.app.findRecordById("venues", venueId);
    } catch {
      throw new NotFoundError("That place does not exist.");
    }

    // Either an upload or a link. A member gets only the picker, because almost
    // nobody can produce a direct image URL from the device the photo is on; a
    // curator working from a browser usually has the address of the picture
    // already, and making them download it first would be busywork.
    //
    // See the note on the member submission route: absence throws.
    let uploads = null;
    try {
      uploads = e.findUploadedFiles("photo");
    } catch {
      uploads = null;
    }
    let cover = uploads && uploads.length ? uploads[0] : null;

    if (!cover) {
      const community = require(__hooks + "/place_entries.js");
      const body = e.requestInfo().body || {};
      const claimed = typeof body.source_url === "string" ? body.source_url.trim() : "";
      if (!claimed) {
        throw new BadRequestError("Choose a photo to upload, or paste a link to one.");
      }
      // Validated the same way a member's image link always was: a public
      // http(s) host, and a range GET proving the bytes are an image rather than
      // the page the image sits on. Throws a readable error naming the problem.
      const links = community.validateMemberPlaceLinks({ imageUrl: claimed });
      if (!links.image_url) {
        throw new BadRequestError("That link does not point at an image.");
      }
      try {
        cover = $filesystem.fileFromURL(links.image_url);
      } catch {
        throw new BadRequestError("That image could not be fetched. Check the link and try again.");
      }
    }

    venue.set("curated_cover", cover);
    venue.set("curated_cover_by", e.auth.id);
    venue.set("curated_cover_at", new Date().toISOString());
    try {
      e.app.save(venue);
    } catch {
      // Almost always the file field rejecting the upload: too large, or not one
      // of the three image types.
      throw new BadRequestError(
        "That photo could not be accepted. Use a JPEG, PNG or WebP image under 8 MB."
      );
    }

    const saved = e.app.findRecordById("venues", venue.id);
    return e.json(200, {
      id: saved.id,
      curated_cover: saved.getString("curated_cover"),
    });
  },
  $apis.requireAuth("members")
);

// Removes a curated cover, putting the place back to whatever the automatic
// sources found — or back onto the worklist if they found nothing. The wrong
// picture needs to be undoable by the same person who can put one up.
routerAdd(
  "DELETE",
  "/api/detour/curation/places/{id}/cover",
  (e) => {
    const founding = require(__hooks + "/founding_cap.js");
    founding.requireFoundingMember(e.app, e.auth, "removing a place's cover");
    const venueId = e.request.pathValue("id");
    let venue;
    try {
      venue = e.app.findRecordById("venues", venueId);
    } catch {
      throw new NotFoundError("That place does not exist.");
    }
    venue.set("curated_cover", null);
    venue.set("curated_cover_by", "");
    venue.set("curated_cover_at", "");
    e.app.save(venue);
    return e.json(200, { id: venue.id, curated_cover: "" });
  },
  $apis.requireAuth("members")
);

// Re-runs the automatic passes for one venue on demand, so a founder looking at
// the worklist does not have to wait for the nightly sweep to find out whether a
// place that gained a website since publication now has a cover too. Same
// functions the sweeps call, each a no-op when nothing is missing.
routerAdd(
  "POST",
  "/api/detour/curation/coverless/{id}/refresh",
  (e) => {
    const founding = require(__hooks + "/founding_cap.js");
    founding.requireFoundingMember(e.app, e.auth, "refreshing a place's photo");
    const community = require(__hooks + "/place_entries.js");
    const venueId = e.request.pathValue("id");
    let venue;
    try {
      venue = e.app.findRecordById("venues", venueId);
    } catch {
      throw new NotFoundError("That place does not exist.");
    }
    community.enrichVenueFromOsm(e.app, venue.id);
    community.enrichVenueFromWebSearch(e.app, venue.id);
    community.resolveCoverImage(e.app, venue.id);
    const refreshed = e.app.findRecordById("venues", venue.id);
    return e.json(200, {
      id: refreshed.id,
      image_url: refreshed.getString("image_url"),
      official_url: refreshed.getString("official_url"),
      instagram_url: refreshed.getString("instagram_url"),
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
          "community_place_entries",
          record.getString("entry")
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
      // The photo belongs to a recommendation, so approving it needs one to
      // belong to. A submission whose recommendation was withdrawn while it sat
      // in the queue is cascade-deleted with it and never reaches this route;
      // a pre-migration row that could not be matched to its author is refused
      // here rather than approved into nothing.
      const recommendationId = image.getString("recommendation");
      if (!recommendationId) {
        throw new BadRequestError(
          "This photo is not attached to a recommendation and cannot be approved."
        );
      }
      const recommendation = txApp.findRecordById(
        "community_recommendations",
        recommendationId
      );

      // One approved photo per recommendation, applied by the same helper the
      // automatic path uses so the supersede rule cannot drift between the two
      // ways an image reaches `approved`.
      const curation = require(__hooks + "/image_curation.js");
      curation.applyApproval(
        txApp,
        image,
        recommendation.id,
        e.auth.id,
        curatorNote
      );
      // Nothing is written to the venue. The place's own `image_url` stays
      // enrichment-sourced and remains the fallback for recommendations
      // without a photo.
      result = {
        id: image.id,
        status: "approved",
        recommendation_id: recommendation.id,
      };
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

  const community = require(__hooks + "/place_entries.js");
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

  // A place has no member-supplied photo of its own any more: a photo belongs
  // to the recommendation whose author took it, and reaches the public through
  // the screened curation route. This field is inert legacy state, frozen so a
  // request cannot revive a shared member-authored cover through the back door.
  if (e.record.getString("image_url") !== original.getString("image_url")) {
    throw new BadRequestError(
      "A photo belongs to your recommendation. Add it there, and it goes through safety screening and founding-member review."
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
  // Corrected the same way it is read on create: a state written into the city
  // box comes off it and pays for the country. See place_locality.js.
  const corrected = require(__hooks + "/place_locality.js").splitLocality(
    community.cleanText(e.record.getString("city"), 120),
    community.cleanText(e.record.getString("country"), 120)
  );
  const city = community.cleanText(corrected.city, 120);
  const country = community.cleanText(corrected.country, 120);
  const address = community.cleanText(e.record.getString("address"), 300);
  const disambiguator = community.cleanText(e.record.getString("disambiguator"), 120);
  const normalizedName = community.normalizePlacePart(venueName);
  const normalizedCity = community.normalizePlacePart(city);
  const normalizedDisambiguator = community.normalizePlacePart(disambiguator);
  if (venueName.length < 2 || !normalizedName) {
    throw new BadRequestError("A valid place name is required.");
  }
  if (city.length < 2 || !normalizedCity) {
    throw new BadRequestError("A valid city is required.");
  }
  // Country is optional here for the same reason it is optional on create: the
  // member was never asked for one, and clearing this field is a legitimate
  // correction. The enrichment pass refills it.
  if (
    normalizedName !== original.getString("normalized_name") ||
    normalizedCity !== original.getString("normalized_city") ||
    normalizedDisambiguator !== (original.getString("normalized_disambiguator") || "")
  ) {
    let clash = null;
    const clashParams = { name: normalizedName, city: normalizedCity, id: original.id };
    if (normalizedDisambiguator) clashParams.qualifier = normalizedDisambiguator;
    try {
      clash = e.app.findFirstRecordByFilter(
        "community_place_entries",
        "normalized_name = {:name} && normalized_city = {:city} && id != {:id} && " +
          // A bound empty string is dropped by the filter resolver, so the
          // no-qualifier case has to be written literally. See UNQUALIFIED_PLACE
          // in place_entries.js.
          (normalizedDisambiguator
            ? "normalized_disambiguator = {:qualifier}"
            : "(normalized_disambiguator = '' || normalized_disambiguator = null)"),
        clashParams
      );
    } catch {
      clash = null;
    }
    if (clash) {
      throw new BadRequestError(
        normalizedDisambiguator
          ? "Another place with this name, city and street is already on the list."
          : "Another place with this name and city is already on the list. Add the street or neighbourhood that tells them apart."
      );
    }
  }
  e.record.set("venue_name", venueName);
  e.record.set("city", city);
  e.record.set("country", country);
  e.record.set("address", address);
  e.record.set("disambiguator", disambiguator);
  e.record.set("normalized_name", normalizedName);
  e.record.set("normalized_city", normalizedCity);
  e.record.set("normalized_disambiguator", normalizedDisambiguator);
  e.record.set(
    "category",
    community.validateCategory(e.record.getString("category"))
  );
  e.record.set(
    "occasions",
    community.validateOccasions(e.record.getStringSlice("occasions"))
  );

  const links = community.validateMemberPlaceLinks({
    officialUrl: e.record.getString("official_url"),
    instagram: e.record.getString("instagram_url"),
  });
  e.record.set("official_url", links.official_url);
  e.record.set("instagram_url", links.instagram_url);
  e.next();
}, "community_place_entries");

// Carries a member's corrections on an already-published entry — the place
// details (name, address, city, country, category) and its links — to the
// public venue, then lets the cover resolver use any new website/Instagram
// link when the venue still lacks an image. Detail carry-through is guarded to
// community-only venues, so a catalogue venue's editorial data stays
// authoritative. Best-effort by design: venue enrichment must never fail an
// entry update, and the nightly sweeps retry.
onRecordAfterUpdateSuccess((e) => {
  const community = require(__hooks + "/place_entries.js");
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
}, "community_place_entries");

// A share sends a place to another member with a personal note. The place is
// either an existing catalogue venue (referenced directly) or the sender's own
// place, which enters the shared waiting list. A share never counts as a
// recommendation signal.
onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) {
    return e.next();
  }

  const community = require(__hooks + "/place_entries.js");
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
    e.record.set("entry", "");
    e.record.set("venue_name", venue.getString("name"));
    e.record.set("city", venue.getString("city"));
    e.record.set("country", venue.getString("country"));
    e.record.set("address", venue.getString("address"));
  } else {
    const resolved = community.resolveEntry(e.app, e.record.getString("entry"), {
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
      e.record.set("entry", "");
    } else {
      community.addParticipants(e.app, resolved.entry, [e.auth.id]);
      e.record.set("entry", resolved.entry.id);
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
    "entry",
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

  const community = require(__hooks + "/place_entries.js");
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

// Re-send the welcome email a member never received. Signup attempts it exactly
// once and swallows the failure, so a relay that was down or misconfigured at
// that moment loses the message for good; this is how it is recovered.
//
// Unlike the signup path this reports the delivery error instead of logging it,
// because a curator running it needs to know whether it actually went out. The
// route sends unconditionally rather than tracking a "welcomed" flag: it is
// operated by hand for a known member, and a duplicate welcome is a far smaller
// problem than a refusal to re-send after an ambiguous first attempt.
routerAdd(
  "POST",
  "/api/detour/curation/members/{id}/welcome-email",
  (e) => {
    const member = e.app.findRecordById("members", e.request.pathValue("id"));
    const recipient = member.getString("email").trim();
    if (!recipient) {
      throw new BadRequestError("This member has no email address.");
    }

    try {
      require(__hooks + "/member_welcome.js").sendWelcomeEmail(e.app, member);
    } catch (error) {
      throw new BadRequestError(
        "The welcome email could not be sent: " + String(error)
      );
    }

    return e.json(200, { member_id: member.id, sent_to: recipient });
  },
  $apis.requireSuperuserAuth()
);

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
      // A submitted "San Francisco, CA" would create a venue whose city forks
      // the catalogue's own San Francisco. Read the same way every other
      // publication path reads it — see place_locality.js. The curator's own
      // country answer wins; the state only fills a blank one.
      const locality = require(__hooks + "/place_locality.js").splitLocality(
        submission.getString("city").trim(),
        country
      );
      const city = locality.city;
      const publishedCountry = locality.country;

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
        venue.set("country", publishedCountry);
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
  // A state in the city box is read off it and spent on the country, which is
  // also how a contribution that carries no country of its own gets one. See
  // place_locality.js.
  const locality = require(__hooks + "/place_locality.js").splitLocality(
    cleanText(e.record.getString("city"), 120, "City"),
    cleanText(e.record.getString("country"), 120, "Country")
  );
  const city = locality.city;
  const country = locality.country;
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
