// Shared member-profile validation. Require from inside request callbacks;
// PocketBase executes handlers in isolated VMs without hook-file globals.

function normalizeMemberPseudo(raw) {
  let pseudo = String(raw || "");
  if (typeof pseudo.normalize === "function") {
    pseudo = pseudo.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  }
  pseudo = pseudo.trim().toLowerCase().replace(/^@+/, "");
  if (!/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(pseudo)) {
    throw new BadRequestError(
      "A pseudo is 3-30 characters: lowercase letters, digits, and hyphens, starting and ending with a letter or digit."
    );
  }
  return pseudo;
}

// Every signup flow asks where the member lives, and `home_city` is where the
// answer lands: it is what the circle projection shows about a person, so an
// account is never created without one. City names are not a list we can own,
// so the value stays free text — normalized and bounded, unlike the controlled
// `home_country` vocabulary.
function normalizeHomeCity(raw) {
  let city = String(raw === undefined || raw === null ? "" : raw);
  if (city.length > 544) {
    throw new BadRequestError("That city name is too long.");
  }
  if (typeof city.normalize === "function") {
    city = city.normalize("NFKC");
  }
  city = city
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (city.length < 2) {
    throw new BadRequestError("Tell us where you live — the city you live in.");
  }
  if (city.length > 120) {
    throw new BadRequestError("That city name must be 120 characters or fewer.");
  }
  return city;
}

function assertPseudoAvailable(app, pseudo, selfId) {
  let existing = null;
  try {
    existing = app.findFirstRecordByFilter("members", "pseudo = {:pseudo}", {
      pseudo: pseudo,
    });
  } catch {
    // No member holds this pseudo.
  }
  if (existing && existing.id !== selfId) {
    throw new BadRequestError("This pseudo is already taken. Choose another one.");
  }
}

module.exports = { assertPseudoAvailable, normalizeHomeCity, normalizeMemberPseudo };
