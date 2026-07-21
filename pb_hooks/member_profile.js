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

module.exports = { assertPseudoAvailable, normalizeMemberPseudo };
