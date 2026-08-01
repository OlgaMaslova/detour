// Survey dashboard report formatter. This module is deliberately required inside
// the record hook: PocketBase runs hook callbacks in isolated VMs, so hook files
// must not rely on module-scope closures.
//
// The formatter is data-only: it turns stored answers into readable labels and
// makes only direct observations from those answers. It has no access to, and
// makes no claims about, other respondents or product activity.

function hasAnswer(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function questionsFor(config, formId, version) {
  const historical =
    config.reportingVersions &&
    config.reportingVersions[formId] &&
    config.reportingVersions[formId][String(version)];
  if (historical && Array.isArray(historical.questions)) return historical.questions;

  const forms = config.forms || {};
  const form = forms[formId];
  if (!form) return [];

  const sets = config.questionSets || {};
  const shared = form.questionSet ? sets[form.questionSet] || [] : [];
  return shared.concat(form.questions || []);
}

function readableAnswer(question, value) {
  if (!question.options) return String(value).trim();
  for (let index = 0; index < question.options.length; index += 1) {
    const option = question.options[index];
    if (option.value === value) return option.label;
  }
  // Keep the stored value visible if a retired option no longer has a label.
  return String(value).trim();
}

function labelForKey(key) {
  return String(key)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, function (character) {
      return character.toUpperCase();
    });
}

function quoted(value) {
  return "“" + String(value).trim() + "”";
}

function reportAnalysis(formId, answers, labels) {
  const analysis = [];
  const answer = function (key) {
    return hasAnswer(answers[key]) ? labels[key] : "";
  };

  if (formId === "discovery-habits") {
    const lastSearch = answer("lastSearchAction");
    const preferredSource = answer("preferredSource");
    const posting = answer("postedAboutFood");
    const lastRecommended = answer("lastRecommendWhen");
    const channel = answer("recommendChannel");
    const legacySource = answer("discoverySource");
    const circleInterest = answer("circleInterest");

    if (lastSearch && preferredSource) {
      analysis.push("Discovery: " + lastSearch + "; preferred recommendation source: " + preferredSource + ".");
    } else if (lastSearch) {
      analysis.push("Discovery behavior: " + lastSearch + ".");
    } else if (legacySource) {
      analysis.push("Current discovery source: " + legacySource + ".");
    }

    if (posting) {
      analysis.push("Food-sharing experience: " + posting + ".");
    } else if (lastRecommended && channel) {
      analysis.push("Recommendation habit: " + lastRecommended + ", via " + channel + ".");
    } else if (lastRecommended) {
      analysis.push("Recommendation habit: " + lastRecommended + ".");
    } else if (circleInterest) {
      analysis.push("Interest in a recommendation circle: " + circleInterest + ".");
    }

    if (hasAnswer(answers.discoveryFriction)) {
      analysis.push("Friction to address: " + quoted(answers.discoveryFriction));
    } else if (hasAnswer(answers.valueNeeded)) {
      analysis.push("Value requirement: " + quoted(answers.valueNeeded));
    }
    return analysis;
  }

  if (formId === "friends" || formId === "founding-members") {
    const wouldOpen = answer("wouldOpenIt");
    // friends v4 replaced the imagined-frequency question with a behavioural one.
    // Older responses still carry usageFrequency, so fall back to it.
    const usage = answer("newPlacesLastMonth") || answer("usageFrequency");
    const alternative = answer("easierAlternative");
    const blocker = answer("notAddedReason");

    if (wouldOpen && usage) {
      analysis.push("Usage signal: " + wouldOpen + "; occasions to use it: " + usage + ".");
    } else if (wouldOpen) {
      analysis.push("Usage signal: " + wouldOpen + ".");
    }
    if (alternative) analysis.push("Current alternative: " + alternative + ".");
    if (blocker) analysis.push("Contribution blocker: " + blocker + ".");
    if (hasAnswer(answers.confusingOrPointless)) {
      analysis.push("Feedback to investigate: " + quoted(answers.confusingOrPointless));
    }
    return analysis;
  }

  return analysis;
}

function storedAnswers(rawAnswers) {
  if (rawAnswers && typeof rawAnswers === "object" && !Array.isArray(rawAnswers)) {
    return rawAnswers;
  }
  // PocketBase's JSONField is exposed as its JSON string through Record#get in
  // lifecycle hooks. Parse that stored form before looking up answer keys.
  if (typeof rawAnswers === "string") {
    try {
      const parsed = JSON.parse(rawAnswers);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // A malformed historical value is handled as no structured answers below.
    }
  }
  return {};
}

function buildSurveyResponseReport(config, formId, version, rawAnswers) {
  const answers = storedAnswers(rawAnswers);
  const questions = questionsFor(config, formId, version);
  const answerLines = [];
  const labels = {};
  const reported = {};

  for (let index = 0; index < questions.length; index += 1) {
    const question = questions[index];
    const value = answers[question.key];
    if (!hasAnswer(value)) continue;
    const readable = readableAnswer(question, value);
    labels[question.key] = readable;
    reported[question.key] = true;
    answerLines.push(question.summaryLabel + ": " + readable);
  }

  // A form definition can move on after a response was saved. Preserve any
  // answer that its versioned definition does not know rather than hiding data.
  Object.keys(answers).forEach(function (key) {
    if (reported[key] || !hasAnswer(answers[key])) return;
    answerLines.push(labelForKey(key) + ": " + String(answers[key]).trim());
  });

  const text = ["Survey: " + formId + " (v" + version + ")"];
  if (answerLines.length) text.push("Answers\n" + answerLines.join("\n"));
  else text.push("Answers\nNo answers were stored with this response.");

  const analysis = reportAnalysis(formId, answers, labels);
  if (analysis.length) text.push("Product read\n" + analysis.join("\n"));

  return text.join("\n\n");
}

module.exports = {
  buildSurveyResponseReport: buildSurveyResponseReport,
};
