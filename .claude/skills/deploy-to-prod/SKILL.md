---
name: deploy-to-prod
description: Release Detour to production — commit the working tree to dev, push it, merge dev into main, and push main (which is what actually deploys). Use this whenever the user wants to ship, deploy, release, go live, push to prod, put changes on the live site, or merge dev into main, even if they don't name the branches or say the word "deploy" — phrasings like "let's ship this", "put this live", "release it", "get this on takedetour.app", or "prod" all mean this skill. Also use it when the user asks whether it is safe to deploy, or wants to know what a release would include.
---

# Deploy Detour to production

Pushing to `main` **is** the deploy: `.github/workflows/deploy.yml` fires on it.
Work happens on `dev`; merging `dev` into `main` is the release.

## The sequence

```bash
npm test && npm run build    # CI runs both; failing here beats failing on main
git add -A
git commit -m "<message>"
git push origin dev
git checkout main
git merge dev                # fast-forwards — history here is linear
git push origin main         # ← this deploys
git checkout dev             # never leave the user sitting on main
```

Run it in one pass. If `npm test` or `npm run build` fails, stop there — commit
nothing, merge nothing, report the failure. CI runs the same two commands, so a
failure that gets through doesn't bounce off the push; it lands on `main` as a
broken release that needs a second commit to `main` to clear.

If there's nothing to commit, that's a normal release — skip to the push.

## The commit message

Use the user's words if they gave any. Otherwise write one from the diff in this
repo's style: a single lowercase line, no `feat:`/`fix:` prefix, no body, no
trailers.

```
place UI fixes
remove outdated docs
update FAQ
```

Ignore `public/index.html` when deciding what the release is about — `vite build`
regenerates it and the diff is only asset hashes.

## Does the API restart?

Check the whole range the merge carries, not just the working tree:

```bash
git diff --name-only origin/main..dev | grep -E '^(pb_hooks/|pb_migrations/|pb_public/|Dockerfile$|fly\.toml$)'
```

Any hit means the Fly deploy of PocketBase runs and `api.takedetour.app` goes
briefly down. This is worth checking properly because `dev` is usually already
ahead with backend commits, so a purely frontend working tree still restarts the
API — `git status` alone will tell you the wrong answer. Say which kind of
release it is when you report.

## Report, then stop

Give the commit message and short SHA, confirm `main` was pushed, say whether
the API restarts, and link https://github.com/OlgaMaslova/detour/actions. Don't
poll the deploy — the user watches it themselves.

## When to abort

Three things stop a release, and nothing else:

- **Tests fail** — report which, commit nothing.
- **Build fails** — same. If `vite build` died partway it has already emptied
  `public/` (`emptyOutDir: true`), so restore the tracked files there with
  `git checkout -- public/` before reporting.
- **Merge conflict** — `git merge --abort`, return to `dev`, report. Never
  resolve conflicts on `main`; a mistake there is live immediately.

Everything else is yours to handle without stopping:

- **Not on `dev`** — carry the work over (`git checkout dev` keeps uncommitted
  changes) and release from there. Say that you did.
- **`origin/dev` is ahead** — `git pull --rebase origin dev`, then carry on.
- **Untracked files** — they go in with `git add -A`. Name any new ones in your
  report, especially under `pb_hooks/`, since those change whether the API
  restarts.
