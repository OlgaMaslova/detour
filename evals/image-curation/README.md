# Image curation eval

Regression suite for the classifier in `pb_hooks/image_curation.js`, which decides
whether a member's photo appears on a public place page.

```
OPENAI_API_KEY=sk-... npm run eval:image-curation
OPENAI_API_KEY=sk-... node evals/image-curation/run.mjs --model gpt-4o --limit 5
```

Exit code is non-zero when the suite fails, so it can gate a workflow.

## What it tests

The hook makes two calls: `/v1/moderations` for safety, then `/v1/responses` for
venue relevance. This runner issues the same two requests — same endpoints, same
instructions string, same model default, same `detail: "low"` — and parses the
reply with the same logic. It does not load the hook itself: that code runs in
PocketBase's JSVM against `$http`, `$os` and `app`, and shimming those would test
the shim as much as the classifier.

The cost of that choice is duplication. `INSTRUCTIONS` in `run.mjs` is a copy of
the hook's. **Edit both in the same commit** — a diff in that string is the whole
reason this suite exists.

## Why the scoring is asymmetric

The classifier returns `relevant | uncertain | irrelevant`, and the hook routes
`uncertain` to founder review. Abstention is therefore a *safe* outcome that costs
attention rather than trust, which means a single accuracy number would average
away the only error that actually matters.

| Outcome | Meaning | Cost |
|---|---|---|
| `hit` | exact match | — |
| `abstained` | correct but deferred to review | founder time |
| `over_strict` | a good photo called irrelevant | annoys one member |
| `leak` | irrelevant or unsafe photo called relevant | **public page shows it** |
| `schema_fail` | reply not parseable, or `relevance` outside the enum | silent: hook falls back to `uncertain`, so in production this looks like caution |

`LEAK_BUDGET` is 0 and gates the run. Raise it only with a reason written beside it.

`schema_fail` deserves the emphasis it gets: the hook swallows a malformed reply
and defaults to `uncertain`. Nothing errors, nothing pages, and every photo
quietly queues for manual review. This suite is the only place that failure is
visible, and it needs no labels to detect — which makes the deterministic checks
worth more than the labelled ones.

## Cases

`cases.jsonl`, one object per line. Committed images live in `images/`.

Use your own photographs. Member uploads are personal data and this repository is
public.

Label from what the venue page *should* show, not from what the photo is of — a
technically fine picture of a street with no venue in it is `uncertain`, not
`relevant`. The `uncertain` cases are the ones worth arguing about; if you cannot
decide, the model cannot either, and that is the case to keep.

## Results

Each run writes `results/YYYY-MM-DDTHH-MM-SS-<model>.json` with the model version in
the filename. Commit it. Stamped to the second because testing a prompt edit means
running this twice in a row, and a date-only name overwrote the baseline. The point is the diff between runs after a prompt edit or a
model change, not any single run's numbers.

Twelve cases is not a statistically meaningful sample and the summary should not
be read as one. It is a smoke test with opinions: enough to catch a broken
contract, a prompt regression, or a model that started letting memes through.
