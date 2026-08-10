/// <reference path="../pb_data/types.d.ts" />
//
// Imported lists: a published list of places, read off its own page and kept
// privately by the member who pasted it.
//
// See docs/guides-spec.md. A member reads "The 38 Best Restaurants in
// New York" somewhere else, pastes the link, and the places land on their Wanna
// go list grouped under the list they came from. Nobody else ever sees any of
// it.
//
// WHY THIS IS NOT THE CATALOGUE, and must never become it. Detour's baseline
// deliberately swept away an external-guide catalogue — Michelin, Guía Repsol,
// 50 Top Pizza — because a place is public here for exactly one reason: a member
// recommended it. An imported list is thirty-eight places nobody has stood
// behind. So it gets its own two collections and touches neither `venues` nor
// `community_waitlist_entries`: no publication state, no signal count, no
// participants, nothing that any read path computed for another member can
// reach. `matched_venue` points one way only — into the catalogue, never out of
// it.
//
// WHY TWO COLLECTIONS RATHER THAN ONE. The list is a thing the member holds: it
// has a name they can change, an origin, and a heading their places sit under.
// Repeating that on every row would mean rewriting thirty-eight records to
// rename it, and would leave nowhere to hang list-level state later.
//
// WHY `lists` IS A MULTI-RELATION. A member holds one row per place. Import an
// Eater list and a Condé Nast list that both name Tatiana and there is one
// Tatiana, shown under both headings — the alternative puts the same restaurant
// on the same wishlist twice and makes the list look like it is counting
// something. That is also why `lists` does NOT cascade: deleting one list must
// not take a place that another list still names. The route unlinks instead,
// and deletes only the places left belonging to nothing.
migrate(
  (app) => {
    const members = app.findCollectionByNameOrId("members");
    const venues = app.findCollectionByNameOrId("venues");

    let lists;
    try {
      lists = app.findCollectionByNameOrId("community_guides");
    } catch {
      lists = new Collection({
        name: "community_guides",
        type: "base",
      });
    }

    const listFields = [
      // A departed member takes their lists with them, as with every other
      // private thing they hold.
      new RelationField({
        name: "member",
        collectionId: members.id,
        maxSelect: 1,
        required: true,
        cascadeDelete: true,
      }),
      // What the member calls it. Defaults to the article's own headline and is
      // theirs to change — "NYC trip, October" is what the list is actually for,
      // and the headline it arrived under is kept separately below.
      new TextField({ name: "title", required: true, max: 200 }),
      // Where it came from, kept so the member can go back and read the piece
      // that made them want to go. Also what a re-paste of the same link is
      // matched against, so pasting twice refreshes one list instead of
      // building a second.
      new URLField({ name: "source_url", required: true }),
      // The publication, as the page named itself: "Eater NY". Displayed under
      // the title so a renamed list still says where it is from.
      new TextField({ name: "source_name", required: false, max: 120 }),
      // The one city the whole list is about, confirmed by the member on the
      // review screen.
      //
      // It is here rather than only on each place because publications file by
      // borough and district — Eater gives "Astoria" and "Bronx" where the
      // catalogue files everything under "New York". Both the match against
      // recommended places and the geocoder need somewhere to fall back to when
      // a place's own city is a neighbourhood, and a place carries no memory of
      // the list it arrived on beyond this.
      new TextField({ name: "city", required: false, max: 120 }),
      new TextField({ name: "normalized_city", required: false, max: 300, hidden: true }),
      // The headline as published, before the member renamed anything.
      new TextField({ name: "source_title", required: false, max: 200 }),
      // Which of the three readers actually produced the places: json_ld,
      // structured, or model. Operationally the only way to tell whether the
      // model fallback is carrying sites it should not have to.
      new SelectField({
        name: "read_by",
        values: ["json_ld", "structured", "model"],
        maxSelect: 1,
        required: false,
      }),
      new AutodateField({ name: "created", onCreate: true, onUpdate: false }),
      new AutodateField({ name: "updated", onCreate: true, onUpdate: true }),
    ];

    for (const field of listFields) {
      if (!lists.fields.getByName(field.name)) lists.fields.add(field);
    }

    // A member reads and removes their own lists and nothing else. Creation and
    // renaming go through the routes, where "verified member", "a link that was
    // actually read", and the per-member place cap live — an open create rule
    // would make every one of those advisory.
    lists.listRule = "@request.auth.id != '' && member = @request.auth.id";
    lists.viewRule = "@request.auth.id != '' && member = @request.auth.id";
    lists.createRule = null;
    lists.updateRule = null;
    lists.deleteRule = "@request.auth.id != '' && member = @request.auth.id";
    app.save(lists);

    const listIndexes = [
      // The member's own lists, newest first. Always scoped to one member.
      "CREATE INDEX IF NOT EXISTS `idx_community_guides_member_created` " +
        "ON `community_guides` (member, created)",
      // A re-paste of the same link finds the list it already made.
      "CREATE INDEX IF NOT EXISTS `idx_community_guides_member_source` " +
        "ON `community_guides` (member, source_url)",
    ];
    let listIndexesChanged = false;
    for (const index of listIndexes) {
      if (lists.indexes.indexOf(index) === -1) {
        lists.indexes.push(index);
        listIndexesChanged = true;
      }
    }
    if (listIndexesChanged) app.save(lists);

    let places;
    try {
      places = app.findCollectionByNameOrId("community_imported_places");
    } catch {
      places = new Collection({
        name: "community_imported_places",
        type: "base",
      });
    }

    const placeFields = [
      new RelationField({
        name: "member",
        collectionId: members.id,
        maxSelect: 1,
        required: true,
        cascadeDelete: true,
      }),
      // Every list this place appears under. NOT cascading, deliberately — see
      // the header. Fifty is not a product limit anybody will meet; it is there
      // because an unbounded multi-relation has no ceiling on the join it makes.
      //
      // NOT REQUIRED, and that is a product decision rather than a loose schema.
      // Removing a list asks the member whether to take its places with it, and
      // "keep the places" leaves rows belonging to no list at all — places they
      // still mean to get to, shown on Wanna go under "Not from a list". An
      // empty `lists` is that state, and it is legitimate.
      new RelationField({
        name: "guides",
        collectionId: lists.id,
        maxSelect: 50,
        required: false,
        cascadeDelete: false,
      }),
      new TextField({ name: "name", required: true, max: 200 }),
      // The neighbourhood the piece gave — "Upper West Side". A list of
      // thirty-eight places in one city is unreadable without it, and it is the
      // only locating fact these pages reliably carry.
      new TextField({ name: "area", required: false, max: 120 }),
      new TextField({ name: "city", required: false, max: 120 }),
      new TextField({ name: "country", required: false, max: 120 }),
      new TextField({ name: "address", required: false, max: 300 }),
      // Filled lazily, from the address, when the private page is first opened.
      // Not at import: thirty-eight Nominatim lookups inside one request would
      // exceed both the request and the service's own rate limit.
      new NumberField({ name: "lat", required: false }),
      new NumberField({ name: "lng", required: false }),
      // When locating was last attempted, so a place with an address that does
      // not geocode is retried weekly rather than on every page open. Same
      // shape, and same reason, as venues.web_discovery_at.
      new DateField({ name: "located_at", required: false, hidden: true }),
      new TextField({ name: "located_note", required: false, max: 300, hidden: true }),
      // What the piece said about the place, when it said anything short enough
      // to be a line rather than an article. Never presented as a
      // recommendation: it is somebody else's published copy, attributed to the
      // publication, and it is the reason the member saved the place.
      new TextField({ name: "excerpt", required: false, max: 400 }),
      // The list page this place was read from — the same URL as its first
      // list's, held here too so a place that outlives that list can still say
      // where it came from.
      new URLField({ name: "source_url", required: false }),
      // The publication's own photograph of the place, as an address on their
      // servers.
      //
      // HOTLINKED, NEVER COPIED. Nothing is fetched, stored or re-served: the
      // card points at the publisher's URL and the browser asks them for it. That
      // is the difference between linking to a photograph and reproducing one,
      // and it is the whole reason this field holds a URL rather than a file.
      // Publishers who do not want that block it at their end, which costs the
      // card its cover and nothing else — every card already has a monogram
      // rendering for exactly this case.
      //
      // Never promoted to a venue's `image_url`. Detour's own covers are
      // separately resolved and verified, and a private row must not put a
      // publication's photograph on a public catalogue page.
      new URLField({ name: "image_url", required: false }),
      // What the unique index compares. Written by the route through the same
      // normalizePlacePart the catalogue uses, so an imported "Café Mütter"
      // matches a recommended "cafe mutter".
      new TextField({ name: "normalized_name", required: false, max: 300, hidden: true }),
      new TextField({ name: "normalized_city", required: false, max: 300, hidden: true }),
      // The catalogue row this place turned out to be, when it turned out to be
      // one. Set at import and re-checked when the list is read, because a place
      // nobody had recommended in August may have been recommended by October.
      //
      // Does not cascade: a venue that is deleted leaves the member's private
      // row where it was, which is a place they still mean to get to.
      new RelationField({
        name: "matched_venue",
        collectionId: venues.id,
        maxSelect: 1,
        required: false,
        cascadeDelete: false,
      }),
      new AutodateField({ name: "created", onCreate: true, onUpdate: false }),
      new AutodateField({ name: "updated", onCreate: true, onUpdate: true }),
    ];

    for (const field of placeFields) {
      if (!places.fields.getByName(field.name)) places.fields.add(field);
    }

    // The add loop above only ever adds, so a field that already exists keeps
    // whatever it was created with. `lists` shipped required and must not stay
    // that way — a place kept after its list was removed belongs to none, and a
    // required relation refuses to save one. Set explicitly rather than by
    // re-adding the field, which would lose the rows' existing values.
    const guidesField = places.fields.getByName("guides");
    if (guidesField && guidesField.required) guidesField.required = false;

    // Same shape as community_place_saves, and for the same reason: this is a
    // private list, so the member reads and removes their own rows and there is
    // no rule by which anybody reads anybody else's. There is no server
    // projection over this collection and none may be added — the test is the
    // one Wanna go carries: could a member learn anything at all about another
    // member's imports, including that they exist?
    places.listRule = "@request.auth.id != '' && member = @request.auth.id";
    places.viewRule = "@request.auth.id != '' && member = @request.auth.id";
    places.createRule = null;
    places.updateRule = null;
    places.deleteRule = "@request.auth.id != '' && member = @request.auth.id";
    app.save(places);

    const placeIndexes = [
      // One row per place per member, across every list they hold. This is what
      // makes a second import of an overlapping list add a heading rather than a
      // duplicate, and what makes a racing double-submit of the same review
      // screen safe.
      "CREATE UNIQUE INDEX IF NOT EXISTS `idx_community_imported_places_member_place` " +
        "ON `community_imported_places` (member, normalized_name, normalized_city)",
      // The Wanna go tab, and the per-list grouping on it. Always one member.
      "CREATE INDEX IF NOT EXISTS `idx_community_imported_places_member_created` " +
        "ON `community_imported_places` (member, created)",
      // DELIBERATELY NO INDEX ON `normalized_name` ALONE. Nothing should ever be
      // counting how many members imported a place, and not building the index
      // that would make it cheap is a small structural discouragement to the
      // first person who tries. Wanna go withheld the same index for the same
      // reason.
    ];
    let placeIndexesChanged = false;
    for (const index of placeIndexes) {
      if (places.indexes.indexOf(index) === -1) {
        places.indexes.push(index);
        placeIndexesChanged = true;
      }
    }
    if (placeIndexesChanged) app.save(places);
  },
  (app) => {
    // Places first: they hold the relation into lists.
    for (const name of ["community_imported_places", "community_guides"]) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch {
        // A partial or repeated rollback is already at the desired state.
      }
    }
  }
);
