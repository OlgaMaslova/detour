migrate((app) => {
  const members = app.findCollectionByNameOrId("members");
  const waitlist = app.findCollectionByNameOrId("community_waitlist_entries");
  const venues = app.findCollectionByNameOrId("venues");

  let images;
  try {
    images = app.findCollectionByNameOrId("community_place_images");
  } catch {
    images = new Collection({
      name: "community_place_images",
      type: "base",
      listRule:
        "status = 'approved' || (@request.auth.id != '' && submitted_by = @request.auth.id)",
      viewRule:
        "status = 'approved' || (@request.auth.id != '' && submitted_by = @request.auth.id)",
      // Creation goes through the custom submission route so the public URL
      // can stay hidden and every server-owned review field is initialized in
      // one place.
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });
  }

  const imageFields = [
    new RelationField({
      name: "waitlist",
      collectionId: waitlist.id,
      maxSelect: 1,
      required: true,
    }),
    new RelationField({
      name: "submitted_by",
      collectionId: members.id,
      maxSelect: 1,
      required: true,
      cascadeDelete: true,
      hidden: true,
    }),
    new URLField({
      name: "source_url",
      required: true,
      hidden: true,
    }),
    new FileField({
      name: "snapshot",
      maxSelect: 1,
      maxSize: 8 * 1024 * 1024,
      mimeTypes: ["image/jpeg", "image/png", "image/webp"],
      thumbs: ["480x360", "1200x900"],
      required: true,
    }),
    new SelectField({
      name: "status",
      values: [
        "screening",
        "pending",
        "screening_failed",
        "auto_rejected",
        "approved",
        "rejected",
        "superseded",
      ],
      maxSelect: 1,
      required: true,
    }),
    new BoolField({
      name: "safety_flagged",
      hidden: true,
    }),
    new JSONField({
      name: "safety_categories",
      maxSize: 12000,
      hidden: true,
    }),
    new SelectField({
      name: "relevance",
      values: ["relevant", "uncertain", "irrelevant"],
      maxSelect: 1,
      required: false,
    }),
    new TextField({
      name: "ai_note",
      max: 1200,
      hidden: true,
    }),
    new DateField({
      name: "moderated_at",
      hidden: true,
    }),
    new RelationField({
      name: "reviewed_by",
      collectionId: members.id,
      maxSelect: 1,
      required: false,
      hidden: true,
    }),
    new DateField({
      name: "reviewed_at",
      hidden: true,
    }),
    new TextField({
      name: "curator_note",
      max: 1200,
      hidden: true,
    }),
    new AutodateField({
      name: "created",
      onCreate: true,
      onUpdate: false,
    }),
    new AutodateField({
      name: "updated",
      onCreate: true,
      onUpdate: true,
    }),
  ];

  for (const field of imageFields) {
    if (!images.fields.getByName(field.name)) images.fields.add(field);
  }
  images.listRule =
    "@request.auth.id != '' && submitted_by = @request.auth.id";
  images.viewRule =
    "status = 'approved' || (@request.auth.id != '' && submitted_by = @request.auth.id)";
  images.createRule = null;
  images.updateRule = null;
  images.deleteRule = null;
  // Save once before adding indexes so PocketBase initializes the base
  // collection's system id/created/updated fields and their SQL columns.
  app.save(images);

  const statusIndex =
    "CREATE INDEX IF NOT EXISTS `idx_community_place_images_status_created` ON `community_place_images` (status, created)";
  const openMemberIndex =
    "CREATE UNIQUE INDEX IF NOT EXISTS `idx_community_place_images_member_open` ON `community_place_images` (submitted_by, waitlist) WHERE status = 'screening' OR status = 'pending' OR status = 'screening_failed'";
  if (images.indexes.indexOf(statusIndex) === -1) images.indexes.push(statusIndex);
  if (images.indexes.indexOf(openMemberIndex) === -1) images.indexes.push(openMemberIndex);
  app.save(images);

  if (!venues.fields.getByName("curated_image")) {
    venues.fields.add(
      new RelationField({
        name: "curated_image",
        collectionId: images.id,
        maxSelect: 1,
        required: false,
      })
    );
    app.save(venues);
  }
}, (app) => {
  const venues = app.findCollectionByNameOrId("venues");
  const curatedImage = venues.fields.getByName("curated_image");
  if (curatedImage) {
    venues.fields.removeById(curatedImage.id);
    app.save(venues);
  }
  try {
    const images = app.findCollectionByNameOrId("community_place_images");
    app.delete(images);
  } catch {
    // A partial or repeated rollback is already at the desired state.
  }
});
